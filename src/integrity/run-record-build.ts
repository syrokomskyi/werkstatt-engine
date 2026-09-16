/******************************************************************************* 
<MODULE_CONTRACT> 
<purpose>Facilitates the recording of build artifacts and generation of provenance metadata.</purpose> 
 
 
<non-goals> 
  <item>Do not handle raw content parsing of build files.</item> 
  <item>Do not manage transport or configuration orchestration.</item> 
</non-goals> 
</MODULE_CONTRACT> 
 
<CHANGE_SUMMARY>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into <history>, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
</CHANGE_SUMMARY> 
*******************************************************************************/

/**
 * Record build artifacts and create provenance metadata.
 * Collects hashes of dist files and stores build metadata for signing.
 */

import { collectBuildOutputs, createBuildProvenance, writeBuildArtifacts } from "./build.ts";

export async function runRecordBuild(args: {
  cwd: string;
  builder?: string;
  distDir?: string;
}): Promise<void> {
  const outputs = await collectBuildOutputs(args.cwd, args.distDir);
  const provenance = await createBuildProvenance({
    cwd: args.cwd,
    builder: args.builder ?? "local",
    outputs,
  });
  await writeBuildArtifacts({ cwd: args.cwd, outputs, provenance });

  console.log("");
  console.log("Integrity build record");
  console.log(`  build id ${outputs.buildId}`);
  console.log(`  outputs  ${Object.keys(outputs.outputs).length}`);
  console.log(`  builder  ${provenance.builder}`);
}
