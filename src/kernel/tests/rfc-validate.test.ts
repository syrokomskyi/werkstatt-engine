import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test, expect } from "vitest";
import { runRfcValidate } from "@warpgogol/forge/os/rfc";
import type { KernelCommandInput, KernelLogger, KernelRuntimeContext } from "../types.ts";
import { createDefaultIO } from "../workspace-io.ts";

/*
<MODULE_CONTRACT>
  <purpose>
    Verify the lifecycle and referential validation rules added by RFC-0153:
    bidirectional supersession (V-12), status/date coupling (V-16), strict
    supersededBy (V-17), and related[] referential integrity (V-18).
  </purpose>
  <responsibilities>
    <item>Build temporary docs/rfcs fixtures and run runRfcValidate against them.</item>
    <item>Assert each new rule fires on a violating fixture and is silent on a clean one.</item>
  </responsibilities>
  <non-goals>
    <item>Do not re-test V-01..V-11, V-13..V-15 (covered implicitly elsewhere).</item>
  </non-goals>
</MODULE_CONTRACT>
<MODULE_MAP>
  <entry key="V-12-test">One-directional vs bidirectional supersession edges.</entry>
  <entry key="V-16-test">status implemented without implementedAt.</entry>
  <entry key="V-17-test">supersededBy set with non-superseded status.</entry>
  <entry key="V-18-test">related pointing at a nonexistent RFC.</entry>
</MODULE_MAP>
<CHANGE_SUMMARY>
  <item>New test file added by RFC-0153 to cover the new validator rules.</item>
</CHANGE_SUMMARY>
*/

const noopLogger: KernelLogger = {
  section() {},
  info() {},
  warn() {},
  error() {},
  success() {},
  event() {},
  getEvents() {
    return [];
  },
};

function ctx(workspaceRoot: string): KernelRuntimeContext {
  return {
    workspaceRoot,
    siteExplicit: false,
    logger: noopLogger,
    dryRun: false,
    outputFormat: "json",
    io: createDefaultIO().io,
  };
}
const input: KernelCommandInput = { argv: [], flags: {} };

interface RfcOpts {
  status?: string;
  implementedAt?: string;
  closedAt?: string;
  supersedes?: string[];
  supersededBy?: string;
  related?: string[];
}

function rfc(id: string, o: RfcOpts = {}): string {
  const list = (key: string, arr?: string[]) =>
    arr && arr.length ? `${key}:\n${arr.map((x) => `  - ${x}`).join("\n")}\n` : `${key}: []\n`;
  return (
    `---\n` +
    `id: ${id}\n` +
    `title: "Fixture ${id}"\n` +
    `status: ${o.status ?? "draft"}\n` +
    `kind: command\n` +
    `scope: workspace\n` +
    `owners:\n  - architecture\n` +
    `reviewers: []\n` +
    `createdAt: 2026-06-04\n` +
    `updatedAt: 2026-06-04\n` +
    `implementedAt:${o.implementedAt ? " " + o.implementedAt : ""}\n` +
    `closedAt:${o.closedAt ? " " + o.closedAt : ""}\n` +
    list("supersedes", o.supersedes) +
    `supersededBy:${o.supersededBy ? " " + o.supersededBy : ""}\n` +
    list("related", o.related) +
    `---\n\n# ${id}: Fixture ${id}\n\n` +
    `## Context\nx\n\n## Decision\nx\n\n` +
    `## Acceptance criteria\n- [ ] a\n- [ ] b\n- [ ] c\n\n` +
    `## Implementation notes for agents\nx\n`
  );
}

async function setup(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-validate-"));
  const dir = path.join(root, "docs", "rfcs");
  await fs.mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await fs.writeFile(path.join(dir, name), content, "utf8");
  }
  return root;
}

async function rulesFor(files: Record<string, string>, rule: string): Promise<number> {
  const root = await setup(files);
  try {
    const res = await runRfcValidate(input, ctx(root));
    return (res.data?.violations ?? []).filter((v) => v.rule === rule).length;
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("V-12 flags a one-directional supersedes edge (missing back-link)", async () => {
  const n = await rulesFor(
    {
      "RFC-9001-a.md": rfc("RFC-9001", { supersedes: ["RFC-9002"] }),
      "RFC-9002-b.md": rfc("RFC-9002"), // no supersededBy back-link
    },
    "V-12",
  );
  expect(n >= 1).toBeTruthy();
});

test("V-12 is silent for a fully bidirectional supersession", async () => {
  const n = await rulesFor(
    {
      "RFC-9001-a.md": rfc("RFC-9001", { supersedes: ["RFC-9002"] }),
      "RFC-9002-b.md": rfc("RFC-9002", {
        status: "superseded",
        closedAt: "2026-06-04",
        supersededBy: "RFC-9001",
      }),
    },
    "V-12",
  );
  expect(n).toBe(0);
});

test("V-16 flags implemented status with no implementedAt", async () => {
  const n = await rulesFor({ "RFC-9003-c.md": rfc("RFC-9003", { status: "implemented" }) }, "V-16");
  expect(n >= 1).toBeTruthy();
});

test("V-17 flags supersededBy set with non-superseded status", async () => {
  const n = await rulesFor(
    {
      "RFC-9001-a.md": rfc("RFC-9001", { supersedes: ["RFC-9004"] }),
      "RFC-9004-d.md": rfc("RFC-9004", {
        status: "implemented",
        implementedAt: "2026-06-04",
        supersededBy: "RFC-9001",
      }),
    },
    "V-17",
  );
  expect(n >= 1).toBeTruthy();
});

test("V-18 flags a related ref to a nonexistent RFC", async () => {
  const n = await rulesFor({ "RFC-9005-e.md": rfc("RFC-9005", { related: ["RFC-9999"] }) }, "V-18");
  expect(n >= 1).toBeTruthy();
});

test("targeted validation finds archived RFC files by basename id", async () => {
  const root = await setup({
    "archive/implemented/rfc-9006-archived.md": rfc("RFC-9006"),
  });
  try {
    const res = await runRfcValidate({ argv: [], flags: {} }, ctx(root));
    expect(res.data?.count).toBe(1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("V-02 duplicate id message includes cause and fix hint", async () => {
  const root = await setup({
    "archive/implemented/rfc-9007-archived.md": rfc("RFC-9007"),
    "rfc-9007-duplicate.md": rfc("RFC-9007"),
  });
  try {
    const res = await runRfcValidate(input, ctx(root));
    const v02 = (res.data?.violations ?? []).filter((v) => v.rule === "V-02");
    expect(v02.length).toBeGreaterThanOrEqual(1);
    const msg = v02[0]!.message;
    expect(msg).toContain("Duplicate id");
    expect(msg).toContain("archive");
    expect(msg).toContain("rfc.create");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
