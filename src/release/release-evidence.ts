/*
<MODULE_CONTRACT>
<purpose>
  RFC-1290: copyReleaseEvidence — release.prepare step that copies every
  *.json in the workpiece's gitignored .werkstatt/release-evidence/ into the
  staged release's evidence/ directory, then verifies text-corpus.json's
  htmlTreeHash against the staged dist tree. Stale evidence is false evidence
  (DNA-106): a mismatch throws and blocks the release.
</purpose>
<non-goals>
  <item>Do not invoke the diff here — release-commands.ts calls text.corpus.diff by name (DNA-64).</item>
  <item>Do not skip silently — a missing corpus in evidence is tolerated (pre-1290 sites),
  a stale one is not.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1290: initial — copyReleaseEvidence + staged-dist htmlTreeHash verification.</item>
  <item>RFC-1290</item>
  <item>RFC-1290: rendered-text corpus + release text diff</item>
</CHANGE_SUMMARY>
*/

import { join, relative } from "node:path";
import type { WorkspaceIO } from "@warpgogol/werkstatt-shared/kernel";
import {
  computeHtmlTreeHash,
  textCorpusSchema,
} from "@warpgogol/werkstatt-shared/text-corpus";

const RELEASE_EVIDENCE_REL = join(".werkstatt", "release-evidence");
const STALE_MSG =
  "[release.prepare] text corpus is stale for the staged dist (RFC-1290) — rerun build.post";

async function collectHtml(io: WorkspaceIO, root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await io.readdir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const p = join(dir, entry.name);
      if (entry.isDirectory) await walk(p);
      else if (entry.isFile && entry.name.endsWith(".html")) out.push(p);
    }
  };
  await walk(root);
  return out.sort();
}

/**
 * Copy <workpiece>/.werkstatt/release-evidence/[i].json into
 * <stagingDir>/evidence/ and verify the corpus hash against the staged dist.
 * No-op when the workpiece carries no release-evidence directory.
 */
export async function copyReleaseEvidence(
  workpieceDir: string,
  stagingDir: string,
  io: WorkspaceIO,
): Promise<void> {
  const evidenceSrc = join(workpieceDir, RELEASE_EVIDENCE_REL);
  if (!(await io.exists(evidenceSrc))) return;

  const evidenceDest = join(stagingDir, "evidence");
  await io.mkdir(evidenceDest);
  for (const entry of await io.readdir(evidenceSrc)) {
    if (entry.isFile && entry.name.endsWith(".json")) {
      await io.copyFile(join(evidenceSrc, entry.name), join(evidenceDest, entry.name));
    }
  }

  const corpusPath = join(evidenceDest, "text-corpus.json");
  if (!(await io.exists(corpusPath))) return;

  const corpus = textCorpusSchema.safeParse(
    JSON.parse(await io.readFile(corpusPath)),
  );
  if (!corpus.success) {
    throw new Error(
      "[release.prepare] text-corpus.json evidence fails schema (RFC-1290) — rerun build.post",
    );
  }

  const clientRoot = join(stagingDir, "dist", "client");
  const distRoot = (await io.exists(clientRoot)) ? clientRoot : join(stagingDir, "dist");
  const inputs: Array<{ relPath: string; content: string }> = [];
  for (const file of await collectHtml(io, distRoot)) {
    inputs.push({
      relPath: relative(distRoot, file).replace(/\\/g, "/"),
      content: await io.readFile(file),
    });
  }
  if (computeHtmlTreeHash(inputs) !== corpus.data.htmlTreeHash) {
    throw new Error(STALE_MSG);
  }
}
