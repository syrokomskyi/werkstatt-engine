/*
<MODULE_CONTRACT>
<purpose>RFC-0707/RFC-0886: nachweis.consent.update command handler — updates PBP Consent entity's consentScope[scope] and appends Bordbuch entry.</purpose>
<keywords>nachweis, consent, update, bordbuch, pbp, scope, granular</keywords>
<responsibilities>
  <item>Updates PBP Consent entity's consentScope[scope] field in cache clone (RFC-0886: granular per-aspect consent).</item>
  <item>Accepts --scope flag (document|screenshot|websiteLink) to select which consent aspect to update.</item>
  <item>Appends nachweis-consent Bordbuch entry with metadata (consentId, scope, previous/new status, method, actor).</item>
  <item>Acquires system and bordbuch locks before modifying state.</item>
  <item>Skips silently when nachweis entitlement is not resolved.</item>
</responsibilities>
<non-goals>
  <item>Does not validate consent text or legal sufficiency — that is a human review step.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0707: initial nachweis.consent.update command handler.</item>
  <item>RFC-0885: update consentScope instead of consentStatus (document aspect only).</item>
  <item>RFC-0886: add --scope flag for granular per-aspect consent (document|screenshot|websiteLink).</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import {
  parseMarkdownFrontmatter,
  stringifyMarkdownFrontmatter,
} from "@warpgogol/werkstatt-shared/content";
import { appendAndCommitBordbuch } from "../bordbuch/bordbuch-commit-helper.ts";
import { acquireLock, releaseLock, generateOperationId } from "../werkstatt/index.ts";
import {
  isNachweisEntitled,
  makeSkipResult,
  resolveNachweisCachePath,
  resolvePbpEntityDir,
  resolveDefaultLang,
  type NachweisConsentUpdateResult,
} from "./nachweis-io.ts";

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

export async function runNachweisConsentUpdate(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<NachweisConsentUpdateResult>> {
  const { workspaceRoot, logger } = context;
  const systemId = flagString(input, "system") ?? context.site?.name;
  const consentId = flagString(input, "consent-id");
  const scope = flagString(input, "scope");
  const newStatus = flagString(input, "status");
  const method = flagString(input, "method") ?? "none";

  if (!systemId) throw new Error("[nachweis.consent.update] --system is required");
  if (!consentId) throw new Error("[nachweis.consent.update] --consent-id is required");
  if (!scope)
    throw new Error(
      "[nachweis.consent.update] --scope is required (document|screenshot|websiteLink)",
    );
  const VALID_SCOPES = new Set(["document", "screenshot", "websiteLink"]);
  if (!VALID_SCOPES.has(scope)) {
    throw new Error(
      `[nachweis.consent.update] invalid --scope '${scope}'. Must be one of: document, screenshot, websiteLink`,
    );
  }
  if (!newStatus) throw new Error("[nachweis.consent.update] --status is required");

  const entitled = await isNachweisEntitled(workspaceRoot, systemId);
  if (!entitled) {
    return makeSkipResult(
      "nachweis.consent.update",
      systemId,
    ) as unknown as KernelCommandResult<NachweisConsentUpdateResult>;
  }

  const cachePath = await resolveNachweisCachePath(workspaceRoot, systemId);
  const lang = await resolveDefaultLang(cachePath);
  const consentDir = resolvePbpEntityDir(cachePath, lang, "consent");
  const consentFile = path.join(consentDir, `${consentId}.md`);

  if (!existsSync(consentFile)) {
    throw new Error(
      `[nachweis.consent.update] NOT_FOUND: consent '${consentId}' not found at ${consentFile}`,
    );
  }

  const raw = await fs.readFile(consentFile, "utf8");
  const { data, content } = parseMarkdownFrontmatter(raw);

  // RFC-0886: Read consentScope for the requested scope aspect
  const existingScope =
    (data.consentScope as
      | {
          document?: { status?: string; grantedAt?: string | null; method?: string };
          screenshot?: { status?: string; grantedAt?: string | null; method?: string };
          websiteLink?: { status?: string; grantedAt?: string | null; method?: string };
        }
      | undefined) ?? {};
  const previousStatus =
    existingScope[scope as "document" | "screenshot" | "websiteLink"]?.status ?? "not_requested";

  const now = new Date().toISOString();
  const defaultEntry = { status: "not_requested", grantedAt: null, method: "none" };
  const docEntry = existingScope.document ?? defaultEntry;
  const screenshotEntry = existingScope.screenshot ?? defaultEntry;
  const websiteLinkEntry = existingScope.websiteLink ?? defaultEntry;

  // RFC-0886: Update only the requested scope aspect, preserve others
  const newScopeEntry = {
    status: newStatus,
    grantedAt:
      newStatus === "granted"
        ? now
        : (existingScope[scope as "document" | "screenshot" | "websiteLink"]?.grantedAt ?? null),
    method,
  };

  data.consentScope = {
    document: scope === "document" ? newScopeEntry : docEntry,
    screenshot: scope === "screenshot" ? newScopeEntry : screenshotEntry,
    websiteLink: scope === "websiteLink" ? newScopeEntry : websiteLinkEntry,
  };
  delete data.consentStatus;
  delete data.grantedAt;
  delete data.method;

  const updatedContent = stringifyMarkdownFrontmatter(content, data);
  await fs.writeFile(consentFile, updatedContent, "utf8");

  logger.info(
    `[nachweis.consent.update] updated consent '${consentId}' ${scope}: ${previousStatus} → ${newStatus}`,
  );

  // Append Bordbuch entry
  const operationId = generateOperationId();
  await acquireLock(
    workspaceRoot,
    `system:${systemId}`,
    operationId,
    "nachweis.consent.update",
    "agent",
  );
  await acquireLock(
    workspaceRoot,
    `bordbuch:${systemId}`,
    operationId,
    "nachweis.consent.update",
    "agent",
  );

  let bordbuchEventId: string;
  try {
    const { entry } = await appendAndCommitBordbuch(
      workspaceRoot,
      systemId,
      "nachweis-consent",
      `Consent '${consentId}' ${scope}: ${previousStatus} → ${newStatus}`,
      "agent",
      {
        writerRole: "nachweis",
        metadata: {
          consentId,
          scope,
          previousStatus,
          newStatus,
          method,
        },
      },
      `Bordbuch: nachweis-consent ${systemId} ${consentId}`,
    );
    bordbuchEventId = entry.id;
  } finally {
    await releaseLock(workspaceRoot, `bordbuch:${systemId}`);
    await releaseLock(workspaceRoot, `system:${systemId}`);
  }

  return {
    data: {
      consentId,
      systemId,
      scope,
      previousStatus,
      newStatus,
      bordbuchEventId,
    },
    exitCode: 0,
    summary: `[nachweis.consent.update] ${systemId}: consent '${consentId}' ${scope}: ${previousStatus} → ${newStatus} (bordbuch: ${bordbuchEventId})`,
    nextSteps: [
      {
        action: `Validate the nachweis: pnpm exec werkstatt run nachweis.validate --site ${systemId}`,
        kind: "optional",
      },
    ],
  };
}
