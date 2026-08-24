/*
<MODULE_CONTRACT>
<purpose>Facilitates integrity policy management and schema file generation for path validation within the system.</purpose>
<non-goals>
  <item>Do not perform raw content parsing or validation beyond JSON schema definitions.</item>
  <item>Do not manage the orchestration of transport or configuration for policy files.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Refined Compass scaffolding to improve clarity and navigation for future modifications.</item>
</CHANGE_SUMMARY>
*/

/**
 * Integrity policy management and path matching.
 * Defines include/exclude patterns and JSON schemas for validation.
 */

import { pathExists } from "./fs.ts";
import { readJsonFile, writeJsonFile } from "./json.ts";
import { policyPath, schemaDir } from "./paths.ts";
import type { IntegrityPolicy } from "./types.ts";

function escapeRegex(input: string): string {
  return input.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.replace(/\\/g, "/");
  const placeholder = "__DOUBLE_STAR__";
  const source = escapeRegex(normalized)
    .replace(/\*\*/g, placeholder)
    .replace(/\*/g, "[^/]*")
    .replace(new RegExp(placeholder, "g"), ".*");
  return new RegExp(`^${source}$`);
}

const BOOTSTRAP_POLICY = {
  $schemaVersion: 1,
  hashAlgorithm: "sha256",
  include: [
    "src/**",
    "public/**",
    "*.json",
    "**/*.json",
    "*.ts",
    "**/*.ts",
    "*.js",
    "**/*.js",
    "*.astro",
    "**/*.astro",
    "*.md",
    "**/*.md",
    "*.mdx",
    "**/*.mdx",
  ],
  exclude: [
    ".git/**",
    "node_modules/**",
    ".astro/**",
    "dist/**",
    ".idea/**",
    ".vscode/**",
    ".integrity/**",
    "spec/**",
    "todo/**",
  ],
  moveDetection: {
    enableHeuristics: false,
    similarityThreshold: 0.85,
    maxDeletedCandidateAgeHours: 72,
  },
  history: {
    keepDeletedLog: true,
    keepBuildHistory: true,
  },
} satisfies IntegrityPolicy;

const BOOTSTRAP_SCHEMAS = {
  "policy.schema.json": {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://example.local/integrity/policy.schema.json",
    type: "object",
    additionalProperties: false,
    required: ["$schemaVersion", "hashAlgorithm", "include", "exclude", "moveDetection", "history"],
    properties: {
      $schemaVersion: { const: 1 },
      hashAlgorithm: { const: "sha256" },
      include: { type: "array", items: { type: "string", minLength: 1 } },
      exclude: { type: "array", items: { type: "string", minLength: 1 } },
      moveDetection: {
        type: "object",
        additionalProperties: false,
        required: ["enableHeuristics", "similarityThreshold", "maxDeletedCandidateAgeHours"],
        properties: {
          enableHeuristics: { type: "boolean" },
          similarityThreshold: { type: "number", minimum: 0, maximum: 1 },
          maxDeletedCandidateAgeHours: { type: "integer", minimum: 0 },
        },
      },
      history: {
        type: "object",
        additionalProperties: false,
        required: ["keepDeletedLog", "keepBuildHistory"],
        properties: {
          keepDeletedLog: { type: "boolean" },
          keepBuildHistory: { type: "boolean" },
        },
      },
    },
  },
  "entities.by-id.schema.json": {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://example.local/integrity/entities.by-id.schema.json",
    type: "object",
    propertyNames: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" },
    additionalProperties: {
      type: "object",
      additionalProperties: false,
      required: [
        "currentPath",
        "createdAt",
        "updatedAt",
        "revision",
        "contentHash",
        "gitSha",
        "status",
      ],
      properties: {
        currentPath: { type: "string", minLength: 1 },
        firstPath: { type: "string", minLength: 1 },
        createdAt: { type: "string", format: "date-time" },
        updatedAt: { type: "string", format: "date-time" },
        revision: { type: "integer", minimum: 1 },
        contentHash: { type: "string", pattern: "^sha256:[0-9a-fA-F]{64}$" },
        gitSha: { type: "string", minLength: 1 },
        status: { enum: ["active", "deleted"] },
        moves: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["from", "to", "detectedAt", "confidence", "method"],
            properties: {
              from: { type: "string", minLength: 1 },
              to: { type: "string", minLength: 1 },
              detectedAt: { type: "string", format: "date-time" },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              method: { enum: ["same-hash", "heuristic"] },
            },
          },
        },
      },
    },
  },
  "paths.current.schema.json": {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://example.local/integrity/paths.current.schema.json",
    type: "object",
    propertyNames: { type: "string", minLength: 1 },
    additionalProperties: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" },
  },
  "deleted-log.schema.json": {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://example.local/integrity/deleted-log.schema.json",
    type: "array",
    items: {
      type: "object",
      additionalProperties: false,
      required: ["entityId", "lastPath", "deletedAt", "lastRevision", "lastHash"],
      properties: {
        entityId: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" },
        lastPath: { type: "string", minLength: 1 },
        deletedAt: { type: "string", format: "date-time" },
        lastRevision: { type: "integer", minimum: 1 },
        lastHash: { type: "string", pattern: "^sha256:[0-9a-fA-F]{64}$" },
      },
    },
  },
  "manifest.schema.json": {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://example.local/integrity/manifest.schema.json",
    type: "object",
    additionalProperties: false,
    required: ["$schemaVersion", "directory", "generatedAt", "files"],
    properties: {
      $schemaVersion: { const: 1 },
      directory: { type: "string", minLength: 1 },
      generatedAt: { type: "string", format: "date-time" },
      files: {
        type: "object",
        propertyNames: { type: "string", minLength: 1 },
        additionalProperties: {
          type: "object",
          additionalProperties: false,
          required: [
            "entityId",
            "createdAt",
            "updatedAt",
            "revision",
            "contentHash",
            "gitSha",
            "status",
          ],
          properties: {
            entityId: { type: "string", pattern: "^[0-9a-fA-F-]{36}$" },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
            revision: { type: "integer", minimum: 1 },
            contentHash: { type: "string", pattern: "^sha256:[0-9a-fA-F]{64}$" },
            gitSha: { type: "string", minLength: 1 },
            status: { enum: ["active", "deleted"] },
          },
        },
      },
    },
  },
  "outputs.schema.json": {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://example.local/integrity/outputs.schema.json",
    type: "object",
    additionalProperties: false,
    required: ["buildId", "outputs"],
    properties: {
      buildId: { type: "string", minLength: 1 },
      outputs: {
        type: "object",
        propertyNames: { type: "string", minLength: 1 },
        additionalProperties: {
          type: "string",
          pattern: "^sha256:[0-9a-fA-F]{64}$",
        },
      },
    },
  },
  "build-provenance.schema.json": {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://example.local/integrity/build-provenance.schema.json",
    type: "object",
    additionalProperties: false,
    required: [
      "buildId",
      "sourceRepo",
      "sourceCommit",
      "builder",
      "buildStartedAt",
      "buildFinishedAt",
      "inputsDigest",
      "outputsDigest",
    ],
    properties: {
      buildId: { type: "string", minLength: 1 },
      sourceRepo: { type: "string", minLength: 1 },
      sourceCommit: { type: "string", minLength: 1 },
      builder: { type: "string", minLength: 1 },
      buildStartedAt: { type: "string", format: "date-time" },
      buildFinishedAt: { type: "string", format: "date-time" },
      inputsDigest: {
        type: "string",
        pattern: "^sha256:[0-9a-fA-F]{64}$",
      },
      outputsDigest: {
        type: "string",
        pattern: "^sha256:[0-9a-fA-F]{64}$",
      },
    },
  },
} as const;

async function ensureSchemaFiles(cwd: string): Promise<void> {
  const root = schemaDir(cwd);

  for (const [fileName, schema] of Object.entries(BOOTSTRAP_SCHEMAS)) {
    const filePath = `${root}/${fileName}`;
    if (await pathExists(filePath)) {
      continue;
    }

    await writeJsonFile(filePath, schema);
  }
}

export async function ensurePolicyFile(cwd: string): Promise<IntegrityPolicy> {
  const filePath = policyPath(cwd);
  await ensureSchemaFiles(cwd);

  if (await pathExists(filePath)) {
    return readJsonFile<IntegrityPolicy>(filePath);
  }

  await writeJsonFile(filePath, BOOTSTRAP_POLICY);
  return BOOTSTRAP_POLICY;
}

export async function loadPolicy(cwd: string): Promise<IntegrityPolicy> {
  return ensurePolicyFile(cwd);
}

export function isManagedPath(repoPath: string, policy: IntegrityPolicy): boolean {
  const normalized = repoPath.replace(/\\/g, "/");
  const excluded = policy.exclude.some((pattern) => globToRegExp(pattern).test(normalized));
  if (excluded) return false;
  return policy.include.some((pattern) => globToRegExp(pattern).test(normalized));
}
