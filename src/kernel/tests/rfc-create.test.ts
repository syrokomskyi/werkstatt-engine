import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test, expect } from "vitest";
import { runRfcCreate, runRfcValidate } from "@warpgogol/forge/os/rfc";
import type { KernelCommandInput, KernelLogger, KernelRuntimeContext } from "../types.ts";
import { createDefaultIO } from "../workspace-io.ts";

/*
<MODULE_CONTRACT>
  <purpose>
    Guard the rfc.create → rfc.validate contract: a freshly generated RFC must be
    born valid. Regression cover for the bug where the generator emitted a
    lowercase `id: rfc-NNNN` and `# rfc-NNNN:` heading, tripping V-01 (id format)
    and V-15 (title/heading mismatch) on every new file.
  </purpose>
  <responsibilities>
    <item>Copy the real RFC templates into a temp workspace and run runRfcCreate.</item>
    <item>Assert the emitted id/heading use the uppercase RFC-NNNN form.</item>
    <item>Assert the filename slug stays lowercase rfc-NNNN-&lt;kebab&gt;.md.</item>
    <item>Assert runRfcValidate reports zero violations for the new file.</item>
  </responsibilities>
</MODULE_CONTRACT>
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

// Repo root is five levels up from this test file (tests → src → site-kernel → os → packages).
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..", "..", "..");

async function makeWorkspace(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-create-"));
  const dir = path.join(root, "docs", "rfcs");
  await fs.mkdir(dir, { recursive: true });
  await fs.copyFile(
    path.join(repoRoot, "docs", "architecture-dna.md"),
    path.join(root, "docs", "architecture-dna.md"),
  );
  return root;
}

test("rfc.create emits an uppercase id/heading and passes rfc.validate cleanly", async () => {
  const root = await makeWorkspace();
  try {
    const title = "Add example dot command";
    const createInput: KernelCommandInput = {
      argv: [],
      flags: { title, satisfies: "DNA-35" },
    };
    const created = await runRfcCreate(createInput, ctx(root));

    // Canonical id is uppercase RFC-NNNN.
    expect(created.data?.id ?? "").toMatch(/^RFC-\d{4}$/);

    // Filename slug stays lowercase rfc-NNNN-<kebab>.md.
    const file = created.data?.file ?? "";
    expect(path.basename(file)).toMatch(/^rfc-\d{4}-add-example-dot-command\.md$/);

    // Frontmatter id and body heading both use the uppercase form.
    const body = await fs.readFile(path.join(root, file), "utf8");
    expect(body).toMatch(/^id: RFC-\d{4}$/m);
    expect(body).toMatch(/^satisfies:\n  - DNA-35$/m);
    expect(body).toMatch(new RegExp(`^# RFC-\\d{4}: ${title}$`, "m"));

    // The freshly created RFC must validate with zero violations.
    const validateInput: KernelCommandInput = { argv: [], flags: {} };
    const res = await runRfcValidate(validateInput, ctx(root));
    const violations = res.data?.violations ?? [];
    expect(violations.length).toBe(0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("rfc.create rejects post-cutoff architecture RFCs without an explicit satisfies trace", async () => {
  const root = await makeWorkspace();
  try {
    await expect(
      runRfcCreate({ argv: [], flags: { title: "Add untraced invariant" } }, ctx(root)),
    ).rejects.toThrow(/--satisfies DNA-N/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("rfc.create accounts for archived RFCs when determining the next number", async () => {
  const root = await makeWorkspace();
  try {
    // Seed a top-level RFC at 0391 and an archived RFC at 0397.
    // A non-recursive scan would pick 0392; the correct next number is 0398.
    const rfcDir = path.join(root, "docs", "rfcs");
    const archiveDir = path.join(rfcDir, "archive", "implemented");
    await fs.mkdir(archiveDir, { recursive: true });

    const topRfc = path.join(rfcDir, "rfc-0391-example-top-level.md");
    await fs.writeFile(
      topRfc,
      "---\nid: RFC-0391\nstatus: accepted\nkind: policy\nscope: workspace\n---\n# RFC-0391: Example\n",
    );

    const archivedRfc = path.join(archiveDir, "rfc-0397-example-archived.md");
    await fs.writeFile(
      archivedRfc,
      "---\nid: RFC-0397\nstatus: implemented\nkind: policy\nscope: workspace\n---\n# RFC-0397: Example archived\n",
    );

    const created = await runRfcCreate(
      { argv: [], flags: { title: "Next after archive", satisfies: "DNA-35" } },
      ctx(root),
    );

    expect(created.data?.id).toBe("RFC-0398");
    expect(path.basename(created.data?.file ?? "")).toMatch(/^rfc-0398-next-after-archive\.md$/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
