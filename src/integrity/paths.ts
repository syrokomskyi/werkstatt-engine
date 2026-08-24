/*******************************************************************************  
<MODULE_CONTRACT>  
<purpose>Defines path utilities for managing integrity-related file locations within a specified working directory.</purpose>  
  
  
<non-goals>  
  <item>Do not handle file reading or writing operations.</item>  
  <item>Do not manage integrity validation or enforcement logic.</item>  
  <item>Do not parse raw content from files.</item>  
</non-goals>  
</MODULE_CONTRACT>  
  
<CHANGE_SUMMARY>
  <item>Tidied by compass.changesummary.tidy; see git history for prior entries.</item>
</CHANGE_SUMMARY>  
******************************************************************************/

/**
 * Path constants and utilities for integrity file locations.
 * Defines all paths within the .integrity directory structure.
 */

import path from "node:path";

export function integrityRoot(cwd: string): string {
  return path.join(cwd, ".integrity");
}

export function configDir(cwd: string): string {
  return path.join(integrityRoot(cwd), "config");
}

export function schemaDir(cwd: string): string {
  return path.join(integrityRoot(cwd), "schema");
}

export function policyPath(cwd: string): string {
  return path.join(configDir(cwd), "policy.json");
}

export function indexDir(cwd: string): string {
  return path.join(integrityRoot(cwd), "index");
}

export function entitiesByIdPath(cwd: string): string {
  return path.join(indexDir(cwd), "entities.by-id.json");
}

export function currentPathsPath(cwd: string): string {
  return path.join(indexDir(cwd), "paths.current.json");
}

export function manifestsRoot(cwd: string): string {
  return path.join(integrityRoot(cwd), "manifests");
}

export function manifestPathForDirectory(cwd: string, repoDir: string): string {
  const safeDir = repoDir === "." ? "root" : repoDir;
  return path.join(manifestsRoot(cwd), safeDir, "versions.json");
}

export function stateDir(cwd: string): string {
  return path.join(integrityRoot(cwd), "state");
}

export function deletedLogPath(cwd: string): string {
  return path.join(stateDir(cwd), "deleted-log.json");
}

export function movedLogPath(cwd: string): string {
  return path.join(stateDir(cwd), "moved-log.json");
}

export function buildDir(cwd: string): string {
  return path.join(integrityRoot(cwd), "build");
}

export function buildLatestDir(cwd: string): string {
  return path.join(buildDir(cwd), "latest");
}

export function outputsPath(cwd: string): string {
  return path.join(buildLatestDir(cwd), "outputs.json");
}

export function provenancePath(cwd: string): string {
  return path.join(buildLatestDir(cwd), "build-provenance.json");
}

export function signatureBinaryPath(cwd: string): string {
  return path.join(buildLatestDir(cwd), "signature.bin");
}

export function signatureHexPath(cwd: string): string {
  return path.join(buildLatestDir(cwd), "signature.hex");
}

export function signedManifestPath(cwd: string): string {
  return path.join(buildLatestDir(cwd), "signed-manifest.json");
}
