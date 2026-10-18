/*
<MODULE_CONTRACT>
<purpose>
RFC-1326 tests for cloudflare.permissions.generate / .validate — the
marked-section writer and drift guard over .env.example and
docs/engineering/workshop-setup.md. Covers marker-missing failure,
registry-rendered rewrite, rerun-safe second run (IDEMP-02 backing test
for the rerun-safe declaration), and CFPERM-01 drift detection.
</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1326: initial — generate/validate fixture tests incl. rerun-safe coverage.</item>
  <item>RFC-1326: single Cloudflare permission registry, token preflight, birth provisioning</item>
</CHANGE_SUMMARY>
*/

import { afterEach, describe, expect, test } from "vitest";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDefaultIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import {
  renderCloudflarePermissionCommentLines,
  renderCloudflarePermissionTableRows,
} from "@warpgogol/werkstatt-shared/cloudflare/permissions";
import {
  cloudflarePermissionsGenerateCommand,
  cloudflarePermissionsValidateCommand,
} from "./cloudflare-permissions.ts";

const ENV_EXAMPLE_FIXTURE = `# header
# ── Cloudflare API
#   IMPORTANT: Create a User API Token, NOT an Account API Token.
# BEGIN cloudflare-permissions
#   Required permissions:
#     STALE → Entry → Edit  (nothing)
# END cloudflare-permissions
#   Scope: specific account.
CLOUDFLARE_API_TOKEN=
`;

const WORKSHOP_SETUP_FIXTURE = `### 3.2 Permissions

| Permission | Scope | Level | Purpose |
| --- | --- | --- | --- |
<!-- BEGIN cloudflare-permissions -->
| **STALE** | Account | Edit | nothing |
<!-- END cloudflare-permissions -->

Not needed: Page Rules.
`;

function makeInput(): KernelCommandInput {
  return { argv: [], flags: {} } as unknown as KernelCommandInput;
}

async function fixture(opts?: { envExample?: string; setup?: string }): Promise<{
  root: string;
  context: KernelRuntimeContext;
}> {
  const root = await mkdtemp(join(tmpdir(), "cf-perms-"));
  await mkdir(join(root, "docs", "engineering"), { recursive: true });
  await writeFile(join(root, ".env.example"), opts?.envExample ?? ENV_EXAMPLE_FIXTURE);
  await writeFile(
    join(root, "docs", "engineering", "workshop-setup.md"),
    opts?.setup ?? WORKSHOP_SETUP_FIXTURE,
  );

  const { io } = createDefaultIO();
  const context = {
    workspaceRoot: root,
    dryRun: false,
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, success: () => {} },
    io,
  } as unknown as KernelRuntimeContext;
  return { root, context };
}

let roots: string[] = [];
afterEach(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
  roots = [];
});

describe("cloudflare.permissions.generate", () => {
  test("rewrites both marked sections from the registry", async () => {
    const { root, context } = await fixture();
    roots.push(root);

    const result = (await cloudflarePermissionsGenerateCommand.execute(makeInput(), context))!;
    expect(result.exitCode).toBe(0);

    const envContent = await readFile(join(root, ".env.example"), "utf8");
    for (const line of [
      "#   Required permissions:",
      ...renderCloudflarePermissionCommentLines(),
    ]) {
      expect(envContent).toContain(line);
    }
    expect(envContent).not.toContain("STALE");
    // Content outside the markers survives.
    expect(envContent).toContain("IMPORTANT: Create a User API Token");
    expect(envContent).toContain("CLOUDFLARE_API_TOKEN=");

    const docContent = await readFile(
      join(root, "docs", "engineering", "workshop-setup.md"),
      "utf8",
    );
    for (const row of renderCloudflarePermissionTableRows()) {
      expect(docContent).toContain(row);
    }
    expect(docContent).not.toContain("**STALE**");
  });

  test("rerun-safe: second run reports up to date and changes nothing", async () => {
    const { root, context } = await fixture();
    roots.push(root);

    await cloudflarePermissionsGenerateCommand.execute(makeInput(), context);
    const envAfterFirst = await readFile(join(root, ".env.example"), "utf8");
    const docAfterFirst = await readFile(
      join(root, "docs", "engineering", "workshop-setup.md"),
      "utf8",
    );

    const second = (await cloudflarePermissionsGenerateCommand.execute(makeInput(), context))!;
    expect(second.exitCode).toBe(0);
    expect(second.summary).toContain("up to date");

    expect(await readFile(join(root, ".env.example"), "utf8")).toBe(envAfterFirst);
    expect(await readFile(join(root, "docs", "engineering", "workshop-setup.md"), "utf8")).toBe(
      docAfterFirst,
    );
  });

  test("fails when a target file carries no marked section", async () => {
    const { context } = await fixture({ envExample: "# no markers\nCLOUDFLARE_API_TOKEN=\n" });
    roots.push(context.workspaceRoot);

    const result = (await cloudflarePermissionsGenerateCommand.execute(makeInput(), context))!;
    expect(result.exitCode).toBe(1);
  });
});

describe("cloudflare.permissions.validate", () => {
  test("passes after generate", async () => {
    const { context } = await fixture();
    roots.push(context.workspaceRoot);

    await cloudflarePermissionsGenerateCommand.execute(makeInput(), context);
    const result = (await cloudflarePermissionsValidateCommand.execute(makeInput(), context))!;
    expect(result.exitCode).toBe(0);
  });

  test("emits CFPERM-01 on a drifted marked section", async () => {
    const { context } = await fixture();
    roots.push(context.workspaceRoot);

    const result = (await cloudflarePermissionsValidateCommand.execute(makeInput(), context))!;
    expect(result.exitCode).toBe(1);
    const diagnostics = (result.data as { diagnostics: { ruleId: string }[] }).diagnostics;
    expect(diagnostics.some((d) => d.ruleId === "CFPERM-01")).toBe(true);
  });
});
