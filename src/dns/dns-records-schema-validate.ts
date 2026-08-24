/*
<MODULE_CONTRACT>
<purpose>
RFC-0753: dns.records.schema.validate command handler — schema-only validation
of DNS record declaration files. No Cloudflare API calls, no CLOUDFLARE_API_TOKEN
needed. Designed for CI pipeline integration (PACKAGES_CHECK_PIPELINE).
</purpose>
<non-goals>
  <item>Do not make live API calls — that is dns.record.validate's responsibility.</item>
  <item>Do not check record content against live Cloudflare state.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0753: initial dns.records.schema.validate command handler.</item>
</CHANGE_SUMMARY>
*/

import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { dnsRecordFileSchema } from "@warpgogol/werkstatt-shared/ontology/schemas";
import { flagString } from "./dns-helpers.ts";
import { discoverSystems, resolveCacheClonePath } from "../sternsystem/registry-io.ts";

export interface DnsRecordsSchemaValidateResult {
  command: "dns.records.schema.validate";
  systemId: string | null;
  files: Array<{
    path: string;
    valid: boolean;
    errors: string[] | null;
  }>;
  state: "valid" | "invalid";
}

export async function runDnsRecordsSchemaValidate(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<DnsRecordsSchemaValidateResult>> {
  const { workspaceRoot } = context;
  const systemId = flagString(input, "system");

  const files: DnsRecordsSchemaValidateResult["files"] = [];
  let allValid = true;

  const filePaths: string[] = [];

  if (systemId) {
    const cacheDir = resolveCacheClonePath(workspaceRoot, systemId);
    const filePath = join(cacheDir, "dns-records.yaml");
    filePaths.push(filePath);
  } else {
    const { systems } = await discoverSystems(workspaceRoot);
    for (const sys of systems) {
      const cacheDir = resolveCacheClonePath(workspaceRoot, sys.id);
      const filePath = join(cacheDir, "dns-records.yaml");
      filePaths.push(filePath);
    }
  }

  for (const filePath of filePaths) {
    let raw: string;
    try {
      raw = await readFile(filePath, "utf-8");
    } catch {
      continue;
    }

    try {
      const { parse } = await import("yaml");
      const parsed = parse(raw);
      dnsRecordFileSchema.parse(parsed);
      files.push({ path: filePath, valid: true, errors: null });
    } catch (err) {
      allValid = false;
      const errors: string[] = [];
      if (err && typeof err === "object" && "issues" in err) {
        for (const issue of (err as { issues: { message: string; path: (string | number)[] }[] })
          .issues) {
          errors.push(`${issue.path.join(".")}: ${issue.message}`);
        }
      } else if (err instanceof Error) {
        errors.push(err.message);
      } else {
        errors.push(String(err));
      }
      files.push({ path: filePath, valid: false, errors });
    }
  }

  const checkedFiles = files.filter((f) => f !== null);
  const state: DnsRecordsSchemaValidateResult["state"] = allValid ? "valid" : "invalid";

  return {
    data: {
      command: "dns.records.schema.validate",
      systemId: systemId ?? null,
      files: checkedFiles,
      state,
    },
    summary: `[dns.records.schema.validate] ${checkedFiles.length} file(s) checked: ${state}`,
    nextSteps: allValid
      ? undefined
      : [
          {
            action: `Fix the schema violations above, then re-run: pnpm exec werkstatt run dns.records.schema.validate`,
            kind: "required",
          },
        ],
    ...(allValid ? {} : { exitCode: 1 }),
  };
}
