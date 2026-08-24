/*
<MODULE_CONTRACT>
<purpose>Facilitates integrity verification of managed files against their manifests and registry records.</purpose>
<non-goals>
  <item>Do not handle file content parsing or transformation.</item>
  <item>Do not manage the lifecycle of registry entities.</item>
  <item>Do not perform network operations for data retrieval.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Migrated sha256FileHex from deleted ./hash.ts to byteHashFile from @warpgogol/fingerprint directly.</item>
</CHANGE_SUMMARY>
*/

/**
 * Core integrity verification logic.
 * Validates file hashes against manifests and checks registry consistency.
 */

import path from "node:path";
import { byteHashFile } from "@warpgogol/werkstatt-engine/fingerprint";
import { discoverManagedDirectories, discoverManagedFiles } from "./discover.ts";
import { pathExists } from "./fs.ts";
import { getManifestFileName, loadDirectoryManifest } from "./manifests.ts";
import { loadEntitiesById, loadPathsCurrent } from "./registry.ts";
import { validateIntegrityJsonSchemas } from "./schema-validation.ts";
import type {
  DirectoryManifest,
  ManifestFileRecord,
  RegistryEntity,
  VerifyIssue,
  VerifyReport,
  VerifyStats,
} from "./types.ts";

function isIsoDateTime(value: string): boolean {
  if (!value) return false;
  return !Number.isNaN(Date.parse(value));
}

function isHexSha256(value: string): boolean {
  return /^sha256:[0-9a-f]{64}$/i.test(value);
}

function pushIssue(
  issues: VerifyIssue[],
  level: "error" | "warning",
  code: string,
  message: string,
  extras: Pick<VerifyIssue, "path" | "entityId"> = {},
): void {
  issues.push({ level, code, message, ...extras });
}

function validateRecordShape(
  issues: VerifyIssue[],
  scope: "manifest" | "registry",
  record: ManifestFileRecord | RegistryEntity,
  filePath: string,
  entityId?: string,
): void {
  if (!isIsoDateTime(record.createdAt)) {
    pushIssue(issues, "error", "INVALID_CREATED_AT", `${scope} has invalid createdAt`, {
      path: filePath,
      entityId,
    });
  }
  if (!isIsoDateTime(record.updatedAt)) {
    pushIssue(issues, "error", "INVALID_UPDATED_AT", `${scope} has invalid updatedAt`, {
      path: filePath,
      entityId,
    });
  }
  if (
    isIsoDateTime(record.createdAt) &&
    isIsoDateTime(record.updatedAt) &&
    record.createdAt > record.updatedAt
  ) {
    pushIssue(
      issues,
      "error",
      "INVALID_TIMESTAMP_ORDER",
      `${scope} createdAt is greater than updatedAt`,
      { path: filePath, entityId },
    );
  }
  if (!Number.isInteger(record.revision) || record.revision < 1) {
    pushIssue(issues, "error", "INVALID_REVISION", `${scope} revision must be an integer >= 1`, {
      path: filePath,
      entityId,
    });
  }
  if (!isHexSha256(record.contentHash)) {
    pushIssue(
      issues,
      "error",
      "INVALID_CONTENT_HASH",
      `${scope} contentHash must match sha256:<64-hex>`,
      { path: filePath, entityId },
    );
  }
  if (!record.gitSha || record.gitSha.length < 7) {
    pushIssue(issues, "warning", "WEAK_GIT_SHA", `${scope} gitSha looks missing or too short`, {
      path: filePath,
      entityId,
    });
  }
}

function compareManifestAndRegistry(
  issues: VerifyIssue[],
  repoPath: string,
  manifestRecord: ManifestFileRecord,
  registryRecord: RegistryEntity,
): void {
  const entityId = manifestRecord.entityId;

  if (registryRecord.status !== "active") {
    pushIssue(
      issues,
      "error",
      "REGISTRY_ENTITY_NOT_ACTIVE",
      "Registry entity for managed file is not active",
      { path: repoPath, entityId },
    );
  }
  if (registryRecord.currentPath !== repoPath) {
    pushIssue(
      issues,
      "error",
      "CURRENT_PATH_MISMATCH",
      "Registry currentPath does not match managed file path",
      { path: repoPath, entityId },
    );
  }
  if (manifestRecord.status !== "active") {
    pushIssue(
      issues,
      "error",
      "MANIFEST_RECORD_NOT_ACTIVE",
      "Manifest record for managed file is not active",
      { path: repoPath, entityId },
    );
  }
  if (manifestRecord.createdAt !== registryRecord.createdAt) {
    pushIssue(issues, "error", "CREATED_AT_MISMATCH", "Manifest and registry createdAt differ", {
      path: repoPath,
      entityId,
    });
  }
  if (manifestRecord.updatedAt !== registryRecord.updatedAt) {
    pushIssue(issues, "error", "UPDATED_AT_MISMATCH", "Manifest and registry updatedAt differ", {
      path: repoPath,
      entityId,
    });
  }
  if (manifestRecord.revision !== registryRecord.revision) {
    pushIssue(issues, "error", "REVISION_MISMATCH", "Manifest and registry revision differ", {
      path: repoPath,
      entityId,
    });
  }
  if (manifestRecord.contentHash !== registryRecord.contentHash) {
    pushIssue(
      issues,
      "error",
      "CONTENT_HASH_MISMATCH_BETWEEN_INDEXES",
      "Manifest and registry contentHash differ",
      { path: repoPath, entityId },
    );
  }
  if (manifestRecord.gitSha !== registryRecord.gitSha) {
    pushIssue(
      issues,
      "warning",
      "GIT_SHA_MISMATCH_BETWEEN_INDEXES",
      "Manifest and registry gitSha differ",
      { path: repoPath, entityId },
    );
  }
}

async function loadExpectedManifests(
  cwd: string,
  managedDirectories: string[],
  issues: VerifyIssue[],
): Promise<Map<string, DirectoryManifest>> {
  const manifests = new Map<string, DirectoryManifest>();

  for (const repoDir of managedDirectories) {
    const manifest = await loadDirectoryManifest(cwd, repoDir);
    if (!manifest) {
      pushIssue(
        issues,
        "error",
        "MISSING_DIRECTORY_MANIFEST",
        "Managed directory is missing versions.json",
        { path: repoDir },
      );
      continue;
    }
    manifests.set(repoDir, manifest);

    if (manifest.$schemaVersion !== 1) {
      pushIssue(
        issues,
        "error",
        "INVALID_MANIFEST_SCHEMA_VERSION",
        "Manifest has unsupported $schemaVersion",
        { path: repoDir },
      );
    }
    if (manifest.directory !== repoDir) {
      pushIssue(
        issues,
        "error",
        "MANIFEST_DIRECTORY_MISMATCH",
        "Manifest directory field does not match directory path",
        { path: repoDir },
      );
    }
    if (!isIsoDateTime(manifest.generatedAt)) {
      pushIssue(
        issues,
        "error",
        "INVALID_MANIFEST_GENERATED_AT",
        "Manifest generatedAt is invalid",
        { path: repoDir },
      );
    }
  }

  return manifests;
}

export async function verifyIntegrity(cwd: string): Promise<VerifyReport> {
  const issues: VerifyIssue[] = [];
  issues.push(...(await validateIntegrityJsonSchemas(cwd)));
  const managedFiles = await discoverManagedFiles(cwd);
  const managedDirectories = await discoverManagedDirectories(cwd);
  const entities = await loadEntitiesById(cwd);
  const paths = await loadPathsCurrent(cwd);
  const manifests = await loadExpectedManifests(cwd, managedDirectories, issues);

  const activeEntities = Object.entries(entities).filter(
    ([, entity]) => entity.status === "active",
  );
  const duplicateEntityIds = new Set<string>();
  const seenEntityIds = new Set<string>();

  for (const [repoPath, entityId] of Object.entries(paths)) {
    if (!managedFiles.includes(repoPath)) {
      const exists = await pathExists(path.join(cwd, repoPath));
      pushIssue(
        issues,
        exists ? "warning" : "error",
        "UNEXPECTED_PATH_BINDING",
        exists
          ? "paths.current contains a binding for a file outside managed scope"
          : "paths.current contains a binding for a missing file",
        { path: repoPath, entityId },
      );
    }
    if (seenEntityIds.has(entityId)) {
      duplicateEntityIds.add(entityId);
    }
    seenEntityIds.add(entityId);
  }

  for (const entityId of duplicateEntityIds) {
    pushIssue(
      issues,
      "error",
      "DUPLICATE_ACTIVE_ENTITY_ID",
      "The same entityId is bound to multiple current paths",
      { entityId },
    );
  }

  for (const file of managedFiles) {
    const entityId = paths[file];
    const absPath = path.join(cwd, file);
    const repoDir = path.posix.dirname(file);
    const fileName = getManifestFileName(file);
    const manifest = manifests.get(repoDir);

    if (!entityId) {
      pushIssue(
        issues,
        "error",
        "MISSING_PATH_BINDING",
        "Managed file is missing from paths.current index",
        { path: file },
      );
      continue;
    }

    const entity = entities[entityId];
    if (!entity) {
      pushIssue(
        issues,
        "error",
        "MISSING_REGISTRY_ENTITY",
        "Path binding points to absent registry entity",
        { path: file, entityId },
      );
      continue;
    }

    validateRecordShape(issues, "registry", entity, file, entityId);

    if (!manifest) continue;

    const manifestRecord = manifest.files[fileName];
    if (!manifestRecord) {
      pushIssue(
        issues,
        "error",
        "MISSING_MANIFEST_RECORD",
        "Managed file is missing from its directory manifest",
        { path: file, entityId },
      );
      continue;
    }

    validateRecordShape(issues, "manifest", manifestRecord, file, entityId);

    if (manifestRecord.entityId !== entityId) {
      pushIssue(
        issues,
        "error",
        "ENTITY_ID_MISMATCH",
        "Manifest record entityId differs from paths.current binding",
        { path: file, entityId },
      );
    }

    compareManifestAndRegistry(issues, file, manifestRecord, entity);

    const actualHash = await byteHashFile(absPath);
    if (actualHash !== entity.contentHash) {
      pushIssue(
        issues,
        "error",
        "HASH_MISMATCH_REGISTRY",
        "Actual file hash differs from registry hash",
        { path: file, entityId },
      );
    }
    if (actualHash !== manifestRecord.contentHash) {
      pushIssue(
        issues,
        "error",
        "HASH_MISMATCH_MANIFEST",
        "Actual file hash differs from manifest hash",
        { path: file, entityId },
      );
    }
  }

  for (const [repoDir, manifest] of manifests) {
    for (const [fileName, manifestRecord] of Object.entries(manifest.files)) {
      const repoPath = path.posix.join(repoDir, fileName);
      const entity = entities[manifestRecord.entityId];
      const hasFile = managedFiles.includes(repoPath);

      validateRecordShape(issues, "manifest", manifestRecord, repoPath, manifestRecord.entityId);

      if (!hasFile) {
        const exists = await pathExists(path.join(cwd, repoPath));
        pushIssue(
          issues,
          exists ? "warning" : "error",
          "STALE_MANIFEST_RECORD",
          exists
            ? "Manifest record points to an existing file outside managed scope"
            : "Manifest record points to a missing file",
          { path: repoPath, entityId: manifestRecord.entityId },
        );
      }

      if (!entity) {
        pushIssue(
          issues,
          "error",
          "MANIFEST_ENTITY_MISSING_IN_REGISTRY",
          "Manifest record points to missing registry entity",
          { path: repoPath, entityId: manifestRecord.entityId },
        );
      }
    }
  }

  for (const [entityId, entity] of activeEntities) {
    validateRecordShape(issues, "registry", entity, entity.currentPath, entityId);

    if (!managedFiles.includes(entity.currentPath)) {
      const exists = await pathExists(path.join(cwd, entity.currentPath));
      pushIssue(
        issues,
        exists ? "warning" : "error",
        "ACTIVE_ENTITY_OUTSIDE_SCOPE",
        exists
          ? "Active registry entity points to a file outside managed scope"
          : "Active registry entity points to a missing file",
        { path: entity.currentPath, entityId },
      );
    }

    if (paths[entity.currentPath] !== entityId) {
      pushIssue(
        issues,
        "error",
        "REGISTRY_PATH_NOT_BOUND",
        "Active registry entity currentPath is not correctly bound in paths.current",
        { path: entity.currentPath, entityId },
      );
    }
  }

  const collator = new Intl.Collator("en");
  issues.sort((a, b) => {
    if (a.level !== b.level) return a.level === "error" ? -1 : 1;
    if ((a.code ?? "") !== (b.code ?? "")) return collator.compare(a.code ?? "", b.code ?? "");
    if ((a.path ?? "") !== (b.path ?? "")) return collator.compare(a.path ?? "", b.path ?? "");
    return collator.compare(a.entityId ?? "", b.entityId ?? "");
  });

  const stats: VerifyStats = {
    managedFiles: managedFiles.length,
    managedDirectories: managedDirectories.length,
    manifestsLoaded: manifests.size,
    activeEntities: activeEntities.length,
    activePathBindings: Object.keys(paths).length,
    errors: issues.filter((issue) => issue.level === "error").length,
    warnings: issues.filter((issue) => issue.level === "warning").length,
  };

  return { ok: stats.errors === 0, issues, stats };
}
