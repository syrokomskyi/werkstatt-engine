/*
<MODULE_CONTRACT>
<purpose>RFC-0520: unit tests for checkBreaksCDeclaration helper.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0520: initial unit tests for breaksC frontmatter parsing.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { checkBreaksCDeclaration } from "./breaks-c-helper.ts";

async function withTempWorkspace(fn: (root: string) => Promise<void>): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rfc0520-test-"));
  const rfcsDir = path.join(root, "docs", "rfcs");
  await fs.mkdir(rfcsDir, { recursive: true });
  try {
    await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("breaksC: true → returns true", async () => {
  await withTempWorkspace(async (root) => {
    const rfcPath = path.join(root, "docs", "rfcs", "rfc-RFC-0500.md");
    await fs.writeFile(rfcPath, "---\nid: RFC-0500\nbreaksC: true\n---\n\n# Test\n");
    const result = await checkBreaksCDeclaration(root, "RFC-0500");
    expect(result).toBe(true);
  });
});

test("breaksC: yes → returns true", async () => {
  await withTempWorkspace(async (root) => {
    const rfcPath = path.join(root, "docs", "rfcs", "rfc-RFC-0501.md");
    await fs.writeFile(rfcPath, "---\nid: RFC-0501\nbreaksC: yes\n---\n\n# Test\n");
    const result = await checkBreaksCDeclaration(root, "RFC-0501");
    expect(result).toBe(true);
  });
});

test("missing breaksC field → returns false", async () => {
  await withTempWorkspace(async (root) => {
    const rfcPath = path.join(root, "docs", "rfcs", "rfc-RFC-0502.md");
    await fs.writeFile(rfcPath, "---\nid: RFC-0502\nstatus: draft\n---\n\n# Test\n");
    const result = await checkBreaksCDeclaration(root, "RFC-0502");
    expect(result).toBe(false);
  });
});

test("empty frontmatter → returns false", async () => {
  await withTempWorkspace(async (root) => {
    const rfcPath = path.join(root, "docs", "rfcs", "rfc-RFC-0503.md");
    await fs.writeFile(rfcPath, "# No frontmatter at all\n\nJust content.\n");
    const result = await checkBreaksCDeclaration(root, "RFC-0503");
    expect(result).toBe(false);
  });
});
