/*
<MODULE_CONTRACT>
<purpose>
RFC-1326: cloudflare.permissions.generate rewrites the marked
cloudflare-permissions sections in the workspace-root .env.example and
docs/engineering/workshop-setup.md from the shared CLOUDFLARE_PERMISSIONS
registry; cloudflare.permissions.validate drift-guards both sections
(CFPERM-01). Hand-edits inside the markers are forbidden — change the
registry and re-run generate.
</purpose>
<non-goals>
  <item>Do not manage the site-level .env.example — env.example.generate renders its hint from the same registry.</item>
  <item>Do not probe the Cloudflare API — that is cloudflare.token.check.</item>
</non-goals>
<KEY_DECISIONS>
  <item>Markers are seeded by hand once; generate refuses when a target file carries no marked section (the file would otherwise grow a duplicated block).</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-1326: initial — generate + validate pair over the two marked permission surfaces.</item>
  <item>RFC-1326: single Cloudflare permission registry, token preflight, birth provisioning</item>
</CHANGE_SUMMARY>
*/

import { join } from "node:path";
import type {
  KernelCommandDefinition,
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import {
  renderCloudflarePermissionCommentLines,
  renderCloudflarePermissionTableRows,
} from "@warpgogol/werkstatt-shared/cloudflare/permissions";
import {
  diagnosticsResult,
  failResult,
  passResult,
} from "@warpgogol/werkstatt-shared/checks/result-helpers";
import type { Diagnostic } from "@warpgogol/werkstatt-shared/kernel";

const ENV_EXAMPLE_PATH = ".env.example";
const WORKSHOP_SETUP_PATH = join("docs", "engineering", "workshop-setup.md");

const ENV_BEGIN = "# BEGIN cloudflare-permissions";
const ENV_END = "# END cloudflare-permissions";
const DOC_BEGIN = "<!-- BEGIN cloudflare-permissions";
const DOC_END = "<!-- END cloudflare-permissions";

interface MarkedTarget {
  relativePath: string;
  beginMarker: string;
  endMarker: string;
  render: () => string[];
}

const TARGETS: readonly MarkedTarget[] = [
  {
    relativePath: ENV_EXAMPLE_PATH,
    beginMarker: ENV_BEGIN,
    endMarker: ENV_END,
    render: () => ["#   Required permissions:", ...renderCloudflarePermissionCommentLines()],
  },
  {
    relativePath: WORKSHOP_SETUP_PATH,
    beginMarker: DOC_BEGIN,
    endMarker: DOC_END,
    render: renderCloudflarePermissionTableRows,
  },
];

/**
 * Replace the lines between the markers (exclusive) with `lines`, keeping the
 * marker lines themselves. Slices at marker-line starts so stray indentation
 * in front of a marker cannot accumulate (RFC-0786 lesson).
 */
function replaceMarkedSection(
  content: string,
  beginMarker: string,
  endMarker: string,
  lines: string[],
): string | null {
  const beginIdx = content.indexOf(beginMarker);
  const endIdx = content.indexOf(endMarker);
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) return null;

  const beginLineEnd = content.indexOf("\n", beginIdx);
  const endLineStart = content.lastIndexOf("\n", endIdx) + 1;

  const head = content.slice(0, beginLineEnd === -1 ? content.length : beginLineEnd + 1);
  const tail = content.slice(endLineStart);
  return `${head}${lines.join("\n")}\n${tail}`;
}

/** Extract the marked section's inner lines for drift comparison. */
function extractMarkedSection(
  content: string,
  beginMarker: string,
  endMarker: string,
): string[] | null {
  const beginIdx = content.indexOf(beginMarker);
  const endIdx = content.indexOf(endMarker);
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) return null;

  const beginLineEnd = content.indexOf("\n", beginIdx);
  const endLineStart = content.lastIndexOf("\n", endIdx) + 1;
  const inner = content.slice(beginLineEnd + 1, endLineStart);
  return inner === "" ? [] : inner.replace(/\n$/, "").split("\n");
}

async function runGenerate(
  _input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult> {
  const rewritten: string[] = [];
  const upToDate: string[] = [];

  for (const target of TARGETS) {
    const abs = join(context.workspaceRoot, target.relativePath);
    let content: string;
    try {
      content = await context.io.readFile(abs);
    } catch {
      return failResult("cloudflare.permissions.generate", [
        `${target.relativePath} not found — the marked permission surfaces must exist`,
      ]);
    }

    const next = replaceMarkedSection(
      content,
      target.beginMarker,
      target.endMarker,
      target.render(),
    );
    if (next === null) {
      return failResult("cloudflare.permissions.generate", [
        `${target.relativePath} carries no '${target.beginMarker}' marked section — seed the markers once, then re-run`,
      ]);
    }
    if (next === content) {
      upToDate.push(target.relativePath);
      continue;
    }
    if (!context.dryRun) {
      await context.io.writeFile(abs, next);
    }
    rewritten.push(target.relativePath);
  }

  const verb = context.dryRun ? "would rewrite" : "rewrote";
  const summary =
    `cloudflare.permissions.generate: ${verb} ${rewritten.length} file(s)` +
    (upToDate.length > 0 ? `, ${upToDate.length} up to date` : "") +
    (rewritten.length > 0 ? ` — ${rewritten.join(", ")}` : "");
  return {
    ...passResult("cloudflare.permissions.generate", summary),
    data: { command: "cloudflare.permissions.generate", rewritten, upToDate },
  };
}

async function runValidate(
  _input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult> {
  const violations: Diagnostic[] = [];

  for (const target of TARGETS) {
    const abs = join(context.workspaceRoot, target.relativePath);
    let content: string;
    try {
      content = await context.io.readFile(abs);
    } catch {
      violations.push({
        ruleId: "CFPERM-01",
        severity: "error",
        message: `${target.relativePath} not found`,
        file: target.relativePath,
      });
      continue;
    }

    const actual = extractMarkedSection(content, target.beginMarker, target.endMarker);
    if (actual === null) {
      violations.push({
        ruleId: "CFPERM-01",
        severity: "error",
        message: `${target.relativePath} carries no '${target.beginMarker}' marked section`,
        file: target.relativePath,
      });
      continue;
    }
    const expected = target.render();
    if (actual.join("\n") !== expected.join("\n")) {
      violations.push({
        ruleId: "CFPERM-01",
        severity: "error",
        message:
          `${target.relativePath} marked section drifted from CLOUDFLARE_PERMISSIONS ` +
          `— run cloudflare.permissions.generate`,
        file: target.relativePath,
      });
    }
  }

  return diagnosticsResult("cloudflare.permissions.validate", violations);
}

export const cloudflarePermissionsGenerateCommand: KernelCommandDefinition = {
  name: "cloudflare.permissions.generate",
  modulePath: "packages/werkstatt-engine/src/leitstand/cloudflare-permissions.ts",
  generates: [],
  description:
    "Rewrite the marked cloudflare-permissions sections in .env.example and docs/engineering/workshop-setup.md from the shared CLOUDFLARE_PERMISSIONS registry (RFC-1326).",
  scope: "workspace",
  flags: {},
  mutatesState: true,
  idempotency: "rerun-safe",
  writes: [".env.example", "docs/engineering/workshop-setup.md"],
  reads: ["package.json"],
  modulePaths: ["cloudflare-permissions.ts"],
  execute: runGenerate,
};

export const cloudflarePermissionsValidateCommand: KernelCommandDefinition = {
  name: "cloudflare.permissions.validate",
  modulePath: "packages/werkstatt-engine/src/leitstand/cloudflare-permissions.ts",
  generates: [],
  description:
    "Drift-guard the marked cloudflare-permissions sections in .env.example and docs/engineering/workshop-setup.md against the CLOUDFLARE_PERMISSIONS registry (RFC-1326). Emits CFPERM-01.",
  scope: "workspace",
  flags: {},
  mutatesState: false,
  contract: "cloudflare",
  rules: ["CFPERM-01"],
  writes: [],
  reads: [".env.example", "docs/engineering/workshop-setup.md"],
  modulePaths: ["cloudflare-permissions.ts"],
  execute: runValidate,
};
