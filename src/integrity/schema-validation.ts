/*
<MODULE_CONTRACT>
<purpose>Facilitates JSON schema validation for integrity files using AJV, ensuring compliance with defined schemas.</purpose>
<non-goals>
  <item>Do not handle schema definition or modification logic.</item>
  <item>Do not parse raw content of JSON files outside validation context.</item>
  <item>Do not manage the lifecycle of AJV instances beyond loading and validation.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Tidied by compass.changesummary.tidy; see git history for prior entries.</item>
</CHANGE_SUMMARY>
*/

/**
 * JSON schema validation for integrity files using AJV.
 * Validates all integrity JSON files against their defined schemas.
 */

import { discoverManagedDirectories } from "./discover.ts";
import { pathExists } from "./fs.ts";
import { readJsonFile } from "./json.ts";
import {
  buildLatestDir,
  currentPathsPath,
  deletedLogPath,
  entitiesByIdPath,
  manifestPathForDirectory,
  outputsPath,
  policyPath,
  provenancePath,
  schemaDir,
} from "./paths.ts";
import type { VerifyIssue } from "./types.ts";

type AjvValidateFunction = {
  (data: unknown): boolean;
  errors?: Array<{ instancePath?: string; message?: string }> | null;
};

interface AjvLike {
  compile(schema: object): AjvValidateFunction;
}

interface LoadedAjv {
  ajv: AjvLike;
  addFormats: (ajv: AjvLike) => void;
}

interface SchemaTarget {
  schemaFile: string;
  dataFile: string;
  pathLabel: string;
  optional?: boolean;
}

function formatAjvErrors(
  errors: Array<{ instancePath?: string; message?: string }> | null | undefined,
): string {
  if (!errors?.length) return "schema validation failed";
  return errors
    .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`.trim())
    .join("; ");
}

async function tryLoadAjv(): Promise<LoadedAjv | null> {
  try {
    const [{ default: Ajv2020 }, addFormatsModule] = await Promise.all([
      import("ajv/dist/2020.js"),
      import("ajv-formats"),
    ]);

    const ajv = new Ajv2020({ allErrors: true, strict: false }) as AjvLike;
    const addFormats = (addFormatsModule.default ?? addFormatsModule) as unknown as (
      ajv: AjvLike,
    ) => void;
    addFormats(ajv);

    return { ajv, addFormats };
  } catch {
    return null;
  }
}

async function loadValidator(
  ajv: AjvLike,
  root: string,
  schemaFile: string,
): Promise<AjvValidateFunction> {
  const schema = await readJsonFile<object>(`${root}/${schemaFile}`);
  return ajv.compile(schema);
}

export async function validateIntegrityJsonSchemas(cwd: string): Promise<VerifyIssue[]> {
  const issues: VerifyIssue[] = [];
  const root = schemaDir(cwd);
  const loadedAjv = await tryLoadAjv();

  if (!loadedAjv) {
    issues.push({
      level: "warning",
      code: "SCHEMA_VALIDATION_SKIPPED",
      message:
        "Ajv is not installed, so Draft 2020-12 schema validation was skipped. Structural verification is still active.",
      path: ".integrity/schema",
    });
    return issues;
  }

  const { ajv } = loadedAjv;

  const validatorFiles = [
    "policy.schema.json",
    "entities.by-id.schema.json",
    "paths.current.schema.json",
    "deleted-log.schema.json",
    "manifest.schema.json",
    "outputs.schema.json",
    "build-provenance.schema.json",
  ];

  const validators = new Map<string, AjvValidateFunction>();
  for (const schemaFile of validatorFiles) {
    validators.set(schemaFile, await loadValidator(ajv, root, schemaFile));
  }

  const targets: SchemaTarget[] = [
    {
      schemaFile: "policy.schema.json",
      dataFile: policyPath(cwd),
      pathLabel: ".integrity/config/policy.json",
    },
    {
      schemaFile: "entities.by-id.schema.json",
      dataFile: entitiesByIdPath(cwd),
      pathLabel: ".integrity/index/entities.by-id.json",
    },
    {
      schemaFile: "paths.current.schema.json",
      dataFile: currentPathsPath(cwd),
      pathLabel: ".integrity/index/paths.current.json",
    },
    {
      schemaFile: "deleted-log.schema.json",
      dataFile: deletedLogPath(cwd),
      pathLabel: ".integrity/state/deleted-log.json",
    },
    {
      schemaFile: "outputs.schema.json",
      dataFile: outputsPath(cwd),
      pathLabel: ".integrity/build/latest/outputs.json",
      optional: true,
    },
    {
      schemaFile: "build-provenance.schema.json",
      dataFile: provenancePath(cwd),
      pathLabel: ".integrity/build/latest/build-provenance.json",
      optional: true,
    },
  ];

  const managedDirs = await discoverManagedDirectories(cwd).catch(() => []);
  for (const repoDir of managedDirs) {
    targets.push({
      schemaFile: "manifest.schema.json",
      dataFile: manifestPathForDirectory(cwd, repoDir),
      pathLabel: `.integrity/manifests/${repoDir === "." ? "root" : repoDir}/versions.json`,
    });
  }

  for (const target of targets) {
    const exists = await pathExists(target.dataFile);
    if (!exists) {
      if (target.optional) {
        continue;
      }
      issues.push({
        level: "error",
        code: "SCHEMA_TARGET_MISSING",
        message: "Required integrity JSON file is missing",
        path: target.pathLabel,
      });
      continue;
    }

    let data: unknown;
    try {
      data = await readJsonFile<unknown>(target.dataFile);
    } catch (error) {
      issues.push({
        level: "error",
        code: "INVALID_JSON",
        message: `Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`,
        path: target.pathLabel,
      });
      continue;
    }

    const validator = validators.get(target.schemaFile);
    if (!validator) {
      issues.push({
        level: "error",
        code: "SCHEMA_VALIDATOR_MISSING",
        message: `Missing validator for ${target.schemaFile}`,
        path: target.pathLabel,
      });
      continue;
    }

    if (!validator(data)) {
      issues.push({
        level: "error",
        code: "SCHEMA_VALIDATION_FAILED",
        message: formatAjvErrors(validator.errors),
        path: target.pathLabel,
      });
    }
  }

  const buildDirExists = await pathExists(buildLatestDir(cwd));
  if (buildDirExists) {
    const hasOutputs = await pathExists(outputsPath(cwd));
    const hasProvenance = await pathExists(provenancePath(cwd));
    if (hasOutputs !== hasProvenance) {
      issues.push({
        level: "error",
        code: "INCOMPLETE_BUILD_LAYER",
        message:
          "Build layer is incomplete: outputs.json and build-provenance.json must exist together",
        path: ".integrity/build/latest",
      });
    }
  }

  return issues;
}
