/*
<MODULE_CONTRACT>
<purpose>RFC-0359 + RFC-0380: notausgang.export and notausgang.validate command handlers. RFC-0380 upgrades validate from shallow existence checks to deep integrity verification with @warpgogol/fingerprint hashing and YAML artifacts.</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
  <item>Do not use ad hoc crypto.createHash — all hashing via @warpgogol/fingerprint (DNA-53).</item>
  <item>Do not write JSON artifacts — export uses YAML per RFC-0376.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0359: initial notausgang command handlers.</item>
  <item>RFC-0380: deep integrity verification, @warpgogol/fingerprint hashing, YAML artifacts, refined secret scanning, CheckStatus enum types.</item>
  <item>RFC-0381: fix bordbuch field names (id, kind, occurredAt), nested pin access (platform.version), optional artifact manifest, fix timestamp validation logic.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  resolveSiteWorkspace,
  type KernelCommandInput,
  type KernelCommandResult,
  type KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { collectFiles } from "@warpgogol/werkstatt-shared/share/fs";
import { fingerprintTree, fingerprintFile } from "@warpgogol/werkstatt-engine/fingerprint/semantic";
import { byteHashFile } from "@warpgogol/werkstatt-engine/fingerprint";
import {
  notausgangManifestSchema,
  type NotausgangManifest,
} from "@warpgogol/werkstatt-engine/schemas";
import { generateOperationId } from "../werkstatt/index.ts";
import { atomicMoveDir, atomicWriteFile } from "../werkstatt/atomic.ts";
import { readSystemConfig, resolveCacheClonePath } from "../sternsystem/registry-io.ts";

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

function flagStringArray(input: KernelCommandInput, key: string): string[] {
  const v = input.flags[key];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "string") return [v];
  return [];
}

const RUNTIME_FILE_PATTERNS = [
  "package.json",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "astro.config",
  "wrangler.",
  "tsconfig.",
  "node_modules",
];

const SECRET_PATTERNS = [
  /TESTSECRET_[a-zA-Z0-9]{20,}/,
  /sk_live_[a-zA-Z0-9]{20,}/,
  /sk_test_[a-zA-Z0-9]{20,}/,
  /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/,
  /xoxb-[a-zA-Z0-9-]+/,
  /ghp_[a-zA-Z0-9]{36,}/,
  /AKIA[0-9A-Z]{16}/,
];

const SECRET_SCAN_SKIP_PATHS = ["bordbuch/", "system.pin.yaml", ".hash"];

function shouldSkipForSecretScan(relPath: string): boolean {
  return SECRET_SCAN_SKIP_PATHS.some(
    (skip) => relPath === skip || relPath.startsWith(skip) || relPath.endsWith(skip),
  );
}

async function copyDir(src: string, dest: string): Promise<void> {
  if (!existsSync(src)) return;
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

function isRuntimeFile(fileName: string): boolean {
  return RUNTIME_FILE_PATTERNS.some((p) => fileName.startsWith(p) || fileName === p);
}

async function scanForSecrets(dir: string): Promise<Array<{ file: string; pattern: string }>> {
  const findings: Array<{ file: string; pattern: string }> = [];

  for (const fullPath of await collectFiles(dir)) {
    const relPath = path.relative(dir, fullPath).replace(/\\/g, "/");
    if (shouldSkipForSecretScan(relPath)) continue;
    const content = await fs.readFile(fullPath, "utf8").catch(() => "");
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(content)) {
        findings.push({ file: relPath, pattern: pattern.source });
      }
    }
  }

  return findings;
}

// §5.1: notausgang.export
export interface NotausgangExportData {
  systemId: string;
  releaseId: string;
  outputPath: string;
  integrationNulling: { nulled: string[]; exceptions: Array<{ name: string; reason: string }> };
  distHash: string;
  siteHash: string;
  bordbuchHash: string;
}

export async function runNotausgangExport(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<NotausgangExportData>> {
  const { workspaceRoot, logger } = context;
  const systemId = flagString(input, "system");
  const releaseId = flagString(input, "release");
  const outputFlag = flagString(input, "output");
  const keepIntegrations = flagStringArray(input, "keep-integration");
  const reasons = flagStringArray(input, "reason");

  if (!systemId || !releaseId || !outputFlag) {
    throw new Error("[notausgang.export] --system, --release, and --output are required");
  }

  const outputPath = path.resolve(workspaceRoot, outputFlag);
  if (existsSync(outputPath)) {
    const entries = await fs.readdir(outputPath);
    if (entries.length > 0) {
      throw new Error(`[notausgang.export] output path '${outputFlag}' exists and is non-empty`);
    }
  }

  // Read release manifest
  const releaseDir = path.join(workspaceRoot, "releases", releaseId);
  const releaseManifestPath = path.join(releaseDir, "release.yaml");
  if (!existsSync(releaseManifestPath)) {
    throw new Error(`[notausgang.export] release '${releaseId}' not found`);
  }

  const releaseManifestRaw = await fs.readFile(releaseManifestPath, "utf8");
  const releaseManifest = parseYaml(releaseManifestRaw) as Record<string, string>;

  if (releaseManifest.state !== "ready") {
    throw new Error(
      `[notausgang.export] release '${releaseId}' is not ready (state: ${releaseManifest.state})`,
    );
  }

  // Read system config for cosmic star and resolve the runnable site workspace.
  const config = await readSystemConfig(workspaceRoot, systemId);
  const siteWorkspace = await resolveSiteWorkspace(workspaceRoot, systemId);

  const operationId = generateOperationId();
  const stagingDir = `${outputPath}.tmp-${operationId}`;

  logger.info(`  Staging: ${stagingDir}`);

  try {
    await fs.mkdir(stagingDir, { recursive: true });

    // Copy site data (from the resolved site workspace)
    const siteSrcDir = path.join(siteWorkspace.directory, "src", "content");
    const siteDest = path.join(stagingDir, "site", "src", "content");
    if (existsSync(siteSrcDir)) {
      await copyDir(siteSrcDir, siteDest);
    }

    // Copy provenance if present
    const provenanceDir = path.join(siteWorkspace.directory, "provenance");
    if (existsSync(provenanceDir)) {
      await copyDir(provenanceDir, path.join(stagingDir, "site", "provenance"));
    }

    // Copy dist from release
    const distSrc = path.join(releaseDir, "dist");
    if (existsSync(distSrc)) {
      await copyDir(distSrc, path.join(stagingDir, "dist"));
    }

    // Copy artifact manifest if present — convert JSON to YAML (RFC-0376)
    const artifactManifestSrcPath = path.join(releaseDir, "artifact-manifest.json");
    const artifactManifestDestPath = path.join(stagingDir, "artifact-manifest.yaml");
    if (existsSync(artifactManifestSrcPath)) {
      const artifactJson = JSON.parse(await fs.readFile(artifactManifestSrcPath, "utf8"));
      await atomicWriteFile(artifactManifestDestPath, stringifyYaml(artifactJson) + "\n");
    }

    // Copy Bordbuch
    const cacheDir = resolveCacheClonePath(workspaceRoot, systemId);
    const bordbuchPath = path.join(cacheDir, "bordbuch", "events.ndjson");
    if (existsSync(bordbuchPath)) {
      await fs.mkdir(path.join(stagingDir, "bordbuch"), { recursive: true });
      await fs.copyFile(bordbuchPath, path.join(stagingDir, "bordbuch", "events.ndjson"));
    }

    // Copy pin — convert JSON to YAML (RFC-0376)
    const pinSrcPath = path.join(cacheDir, "system.pin.json");
    if (existsSync(pinSrcPath)) {
      const pinJson = JSON.parse(await fs.readFile(pinSrcPath, "utf8"));
      await atomicWriteFile(
        path.join(stagingDir, "system.pin.yaml"),
        stringifyYaml(pinJson) + "\n",
      );
    }

    // Copy behavior snapshots
    const snapshotsDir = path.join(stagingDir, "behavior-snapshots");
    await fs.mkdir(snapshotsDir, { recursive: true });
    for (const snapshot of [
      "readable-snapshot.json",
      "production-snapshot.json",
      "snapshot-diff.json",
    ]) {
      const src = path.join(releaseDir, snapshot);
      if (existsSync(src)) {
        await fs.copyFile(src, path.join(snapshotsDir, snapshot));
      }
    }

    // Write README
    const readme = `# Notausgang Export: ${systemId}

This package contains the complete site for ${systemId} as of release ${releaseId}.

## Serving the site immediately

The \`dist/\` directory contains the pre-built production output. Serve it with any static file server:

    npx serve dist/

Or upload the contents of \`dist/\` to any static hosting provider.

## Rebuilding the site

The \`site/\` directory contains the authored content and configuration. To rebuild, you need the Warpgogol platform (not included in this export).

## History

The \`bordbuch/events.ndjson\` file contains the complete mission and release history.
`;
    await atomicWriteFile(path.join(stagingDir, "README.md"), readme);

    // Compute hashes using @warpgogol/fingerprint (DNA-53)
    const distHash = (await fingerprintTree(path.join(stagingDir, "dist"), { mode: "byte" })).value;
    const siteHash = (await fingerprintTree(path.join(stagingDir, "site"), { mode: "semantic" }))
      .value;
    const bordbuchHash = (
      await fingerprintFile(path.join(stagingDir, "bordbuch", "events.ndjson"), {
        mode: "semantic",
      })
    ).hash;
    const behaviorSnapshotHash = (
      await fingerprintTree(path.join(stagingDir, "behavior-snapshots"), { mode: "semantic" })
    ).value;
    const artifactManifestHash = existsSync(artifactManifestDestPath)
      ? (await fingerprintFile(artifactManifestDestPath, { mode: "byte" })).hash
      : "sha256:absent";

    // Integration nulling
    const allIntegrations = ["matomo", "uchat", "supabase-crm", "stripe"];
    const nulled = allIntegrations.filter((name) => !keepIntegrations.includes(name));
    const exceptions = keepIntegrations.map((name, i) => ({
      name,
      reason: reasons[i] ?? "No reason provided",
    }));

    // Write manifest as YAML (RFC-0376)
    const manifest = {
      schemaVersion: "1.0.0",
      systemId,
      cosmicStar: config.cosmicStar,
      releaseId,
      exportedAt: new Date().toISOString(),
      platformVersion: releaseManifest.platformVersion ?? "unknown",
      platformSemanticHash: releaseManifest.platformSemanticHash ?? "sha256:unknown",
      semver: releaseManifest.semver ?? "0.0.0",
      source: {
        releaseManifestHash: await byteHashFile(releaseManifestPath),
        artifactManifestHash,
        distArtifactHash: releaseManifest.distArtifactHash ?? "sha256:unknown",
        siteContentHash: releaseManifest.siteContentHash ?? "sha256:unknown",
        behaviorSnapshotHash,
      },
      integrationNulling: { nulled, exceptions },
      distHash,
      siteHash,
      bordbuchHash,
    };

    await atomicWriteFile(
      path.join(stagingDir, "notausgang-manifest.yaml"),
      stringifyYaml(manifest) + "\n",
    );

    // Atomic publish
    await atomicMoveDir(stagingDir, outputPath, { replace: true });

    logger.success(`[notausgang.export] ${systemId} exported to ${outputFlag}`);

    return {
      data: {
        systemId,
        releaseId,
        outputPath,
        integrationNulling: { nulled, exceptions },
        distHash,
        siteHash,
        bordbuchHash,
      },
      summary: `[notausgang.export] ${systemId} exported to ${outputFlag} (${nulled.length} integrations nulled, ${exceptions.length} exceptions)`,
      nextSteps: [
        {
          action: `Validate the export: pnpm exec werkstatt run notausgang.validate --site ${systemId}`,
          kind: "optional",
        },
      ],
    };
  } catch (error) {
    // Cleanup staging on failure
    if (existsSync(stagingDir)) {
      await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    }
    throw error;
  }
}

// §5.2: notausgang.validate — deep integrity verification (RFC-0380)
export type CheckStatus = "valid" | "invalid" | "missing";

export interface NotausgangViolation {
  rule: string;
  message: string;
  file?: string;
}

export interface NotausgangValidateData {
  path: string;
  manifest: CheckStatus;
  site: CheckStatus;
  dist: CheckStatus;
  bordbuch: CheckStatus;
  pin: CheckStatus;
  snapshots: CheckStatus;
  artifactManifest: CheckStatus;
  runtimeFilesAbsent: boolean;
  distHashMatch: boolean;
  siteHashMatch: boolean;
  bordbuchHashMatch: boolean;
  snapshotHashMatch: boolean;
  artifactHashMatch: boolean;
  liveKeyScan: string;
  violations: NotausgangViolation[];
}

const BORDBUCH_REQUIRED_FIELDS = ["id", "kind", "occurredAt", "systemId"] as const;

async function validateBordbuch(
  bordbuchPath: string,
  expectedSystemId: string,
): Promise<NotausgangViolation[]> {
  const violations: NotausgangViolation[] = [];
  const content = await fs.readFile(bordbuchPath, "utf8");
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "") continue;
    const lineNum = i + 1;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line);
    } catch {
      violations.push({
        rule: "bordbuch-line-parse",
        message: `Line ${lineNum} is not valid JSON`,
        file: "bordbuch/events.ndjson",
      });
      continue;
    }

    // Report each missing field individually — one violation per missing field per line.
    for (const field of BORDBUCH_REQUIRED_FIELDS) {
      if (!(field in parsed) || parsed[field] === undefined || parsed[field] === null) {
        violations.push({
          rule: "bordbuch-field-missing",
          message: `Line ${lineNum} missing required field '${field}'`,
          file: "bordbuch/events.ndjson",
        });
        continue;
      }
    }

    if (parsed.systemId !== expectedSystemId) {
      violations.push({
        rule: "bordbuch-system-id-mismatch",
        message: `Line ${lineNum} systemId '${parsed.systemId}' does not match manifest '${expectedSystemId}'`,
        file: "bordbuch/events.ndjson",
      });
    }

    if (typeof parsed.occurredAt === "string") {
      const ts = parsed.occurredAt;
      if (Number.isNaN(Date.parse(ts)) || !/^\d{4}-\d{2}-\d{2}T/.test(ts)) {
        violations.push({
          rule: "bordbuch-timestamp-invalid",
          message: `Line ${lineNum} occurredAt '${ts}' is not valid ISO 8601`,
          file: "bordbuch/events.ndjson",
        });
      }
    }
  }

  return violations;
}

export async function runNotausgangValidate(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<NotausgangValidateData>> {
  const { workspaceRoot, logger } = context;
  const exportPath = flagString(input, "path");
  if (!exportPath) throw new Error("[notausgang.validate] --path is required");

  const exportDir = path.resolve(workspaceRoot, exportPath);
  if (!existsSync(exportDir)) {
    throw new Error(`[notausgang.validate] export path '${exportPath}' not found`);
  }

  const violations: NotausgangViolation[] = [];

  // --- Manifest: parse and schema-validate ---
  const manifestYamlPath = path.join(exportDir, "notausgang-manifest.yaml");
  const manifestJsonPath = path.join(exportDir, "notausgang-manifest.json");

  let manifestStatus: CheckStatus = "missing";
  let manifest: NotausgangManifest | null = null;

  if (existsSync(manifestYamlPath)) {
    try {
      const raw = await fs.readFile(manifestYamlPath, "utf8");
      const parsed = parseYaml(raw);
      const result = notausgangManifestSchema.safeParse(parsed);
      if (result.success) {
        manifest = result.data;
        manifestStatus = "valid";
      } else {
        manifestStatus = "invalid";
        violations.push({
          rule: "manifest-schema-invalid",
          message: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
          file: "notausgang-manifest.yaml",
        });
      }
    } catch (err) {
      manifestStatus = "invalid";
      violations.push({
        rule: "manifest-parse-error",
        message: (err as Error).message,
        file: "notausgang-manifest.yaml",
      });
    }
  } else {
    manifestStatus = "missing";
    violations.push({
      rule: "manifest-missing",
      message: "notausgang-manifest.yaml not found",
    });
  }

  // Legacy JSON artifact check
  if (existsSync(manifestJsonPath)) {
    violations.push({
      rule: "legacy-json-artifact",
      message: "notausgang-manifest.json found — export must be re-generated as YAML",
      file: "notausgang-manifest.json",
    });
  }

  // --- Legacy artifact-manifest.json check ---
  const artifactManifestYamlPath = path.join(exportDir, "artifact-manifest.yaml");
  const artifactManifestJsonPath = path.join(exportDir, "artifact-manifest.json");
  if (existsSync(artifactManifestJsonPath)) {
    violations.push({
      rule: "legacy-json-artifact",
      message: "artifact-manifest.json found — export must be re-generated as YAML",
      file: "artifact-manifest.json",
    });
  }

  // --- Legacy system.pin.json check ---
  const pinYamlPath = path.join(exportDir, "system.pin.yaml");
  const pinJsonPath = path.join(exportDir, "system.pin.json");
  if (existsSync(pinJsonPath)) {
    violations.push({
      rule: "legacy-pin-format",
      message: "system.pin.json found — export must be re-generated with system.pin.yaml",
      file: "system.pin.json",
    });
  }

  // --- dist/ hash re-computation ---
  const distDir = path.join(exportDir, "dist");
  let distStatus: CheckStatus = "missing";
  let distHashMatch = false;
  if (existsSync(distDir)) {
    distStatus = "valid";
    if (manifest) {
      try {
        const recomputed = (await fingerprintTree(distDir, { mode: "byte" })).value;
        distHashMatch = recomputed === manifest.distHash;
        if (!distHashMatch) {
          violations.push({
            rule: "dist-hash-mismatch",
            message: `dist hash mismatch: expected ${manifest.distHash}, got ${recomputed}`,
          });
        }
      } catch (err) {
        distStatus = "invalid";
        violations.push({
          rule: "dist-hash-error",
          message: (err as Error).message,
        });
      }
    }
  } else {
    violations.push({
      rule: "dist-missing",
      message: "dist/ directory not found",
    });
  }

  // --- site/ hash re-computation ---
  const siteDir = path.join(exportDir, "site");
  let siteStatus: CheckStatus = "missing";
  let siteHashMatch = false;
  if (existsSync(siteDir)) {
    siteStatus = "valid";
    if (manifest) {
      try {
        const recomputed = (await fingerprintTree(siteDir, { mode: "semantic" })).value;
        siteHashMatch = recomputed === manifest.siteHash;
        if (!siteHashMatch) {
          violations.push({
            rule: "site-hash-mismatch",
            message: `site hash mismatch: expected ${manifest.siteHash}, got ${recomputed}`,
          });
        }
      } catch (err) {
        siteStatus = "invalid";
        violations.push({
          rule: "site-hash-error",
          message: (err as Error).message,
        });
      }
    }
  } else {
    violations.push({
      rule: "site-missing",
      message: "site/ directory not found",
    });
  }

  // --- Bordbuch hash + line-by-line validation ---
  const bordbuchPath = path.join(exportDir, "bordbuch", "events.ndjson");
  let bordbuchStatus: CheckStatus = "missing";
  let bordbuchHashMatch = false;
  if (existsSync(bordbuchPath)) {
    bordbuchStatus = "valid";
    if (manifest) {
      try {
        const recomputed = (await fingerprintFile(bordbuchPath, { mode: "semantic" })).hash;
        bordbuchHashMatch = recomputed === manifest.bordbuchHash;
        if (!bordbuchHashMatch) {
          violations.push({
            rule: "bordbuch-hash-mismatch",
            message: `bordbuch hash mismatch: expected ${manifest.bordbuchHash}, got ${recomputed}`,
            file: "bordbuch/events.ndjson",
          });
        }
        // Line-by-line validation
        const bordbuchViolations = await validateBordbuch(bordbuchPath, manifest.systemId);
        if (bordbuchViolations.length > 0) {
          bordbuchStatus = "invalid";
          violations.push(...bordbuchViolations);
        }
      } catch (err) {
        bordbuchStatus = "invalid";
        violations.push({
          rule: "bordbuch-error",
          message: (err as Error).message,
          file: "bordbuch/events.ndjson",
        });
      }
    }
  } else {
    violations.push({
      rule: "bordbuch-missing",
      message: "bordbuch/events.ndjson not found",
    });
  }

  // --- system.pin.yaml content validation ---
  let pinStatus: CheckStatus = "missing";
  if (existsSync(pinYamlPath)) {
    pinStatus = "valid";
    if (manifest) {
      try {
        const pinRaw = await fs.readFile(pinYamlPath, "utf8");
        const pinData = parseYaml(pinRaw) as Record<string, unknown>;
        const pinSystemId = pinData?.systemId;
        const pinPlatformVersion = (pinData?.platform as Record<string, unknown> | undefined)
          ?.version;
        if (pinSystemId !== manifest.systemId) {
          pinStatus = "invalid";
          violations.push({
            rule: "pin-content-mismatch",
            message: `systemId mismatch: manifest '${manifest.systemId}', pin '${pinSystemId}'`,
            file: "system.pin.yaml",
          });
        }
        if (pinPlatformVersion !== manifest.platformVersion) {
          pinStatus = "invalid";
          violations.push({
            rule: "pin-content-mismatch",
            message: `platformVersion mismatch: manifest '${manifest.platformVersion}', pin '${pinPlatformVersion}'`,
            file: "system.pin.yaml",
          });
        }
      } catch (err) {
        pinStatus = "invalid";
        violations.push({
          rule: "pin-parse-error",
          message: (err as Error).message,
          file: "system.pin.yaml",
        });
      }
    }
  } else {
    violations.push({
      rule: "pin-missing",
      message: "system.pin.yaml not found",
    });
  }

  // --- Behavior snapshots hash verification ---
  const snapshotsDir = path.join(exportDir, "behavior-snapshots");
  let snapshotsStatus: CheckStatus = "missing";
  let snapshotHashMatch = false;
  if (existsSync(snapshotsDir)) {
    snapshotsStatus = "valid";
    if (manifest) {
      try {
        const recomputed = (await fingerprintTree(snapshotsDir, { mode: "semantic" })).value;
        snapshotHashMatch = recomputed === manifest.source.behaviorSnapshotHash;
        if (!snapshotHashMatch) {
          violations.push({
            rule: "snapshot-hash-mismatch",
            message: `behavior snapshot hash mismatch: expected ${manifest.source.behaviorSnapshotHash}, got ${recomputed}`,
          });
        }
      } catch (err) {
        snapshotsStatus = "invalid";
        violations.push({
          rule: "snapshot-hash-error",
          message: (err as Error).message,
        });
      }
    }
  } else {
    violations.push({
      rule: "snapshots-missing",
      message: "behavior-snapshots/ directory not found",
    });
  }

  // --- Artifact manifest hash verification ---
  let artifactManifestStatus: CheckStatus = "missing";
  let artifactHashMatch = false;
  if (existsSync(artifactManifestYamlPath)) {
    artifactManifestStatus = "valid";
    if (manifest) {
      try {
        const recomputed = (await fingerprintFile(artifactManifestYamlPath, { mode: "byte" })).hash;
        artifactHashMatch = recomputed === manifest.source.artifactManifestHash;
        if (!artifactHashMatch) {
          violations.push({
            rule: "artifact-hash-mismatch",
            message: `artifact manifest hash mismatch: expected ${manifest.source.artifactManifestHash}, got ${recomputed}`,
            file: "artifact-manifest.yaml",
          });
        }
      } catch (err) {
        artifactManifestStatus = "invalid";
        violations.push({
          rule: "artifact-hash-error",
          message: (err as Error).message,
        });
      }
    }
  } else {
    if (manifest?.source?.artifactManifestHash !== "sha256:absent") {
      violations.push({
        rule: "artifact-manifest-missing",
        message: "artifact-manifest.yaml not found",
      });
    }
  }

  // --- Runtime files check ---
  let runtimeFilesAbsent = true;
  if (existsSync(siteDir)) {
    async function checkRuntime(d: string) {
      const entries = await fs.readdir(d, { withFileTypes: true });
      for (const entry of entries) {
        if (isRuntimeFile(entry.name)) {
          runtimeFilesAbsent = false;
          violations.push({
            rule: "runtime-file-present",
            message: `Runtime file '${entry.name}' found in site/`,
            file: path.relative(exportDir, path.join(d, entry.name)).replace(/\\/g, "/"),
          });
          return;
        }
        if (entry.isDirectory()) {
          await checkRuntime(path.join(d, entry.name));
        }
      }
    }
    await checkRuntime(siteDir);
  }

  // --- Secret scan ---
  const secretFindings = await scanForSecrets(exportDir);
  const liveKeyScan = secretFindings.length === 0 ? "clean" : `${secretFindings.length} findings`;

  if (secretFindings.length > 0) {
    for (const f of secretFindings) {
      violations.push({
        rule: "secret-detected",
        message: `Secret pattern '${f.pattern}' detected`,
        file: f.file,
      });
    }
  }

  const hasViolations = violations.length > 0;

  if (!hasViolations) {
    logger.success(`[notausgang.validate] export package valid, no violations detected`);
  } else {
    logger.error(
      `[notausgang.validate] ${violations.length} violation${violations.length === 1 ? "" : "s"} detected:`,
    );
    for (const v of violations) {
      logger.error(`  [${v.rule}] ${v.message}${v.file ? ` (${v.file})` : ""}`);
    }
  }

  return {
    data: {
      path: exportDir,
      manifest: manifestStatus,
      site: siteStatus,
      dist: distStatus,
      bordbuch: bordbuchStatus,
      pin: pinStatus,
      snapshots: snapshotsStatus,
      artifactManifest: artifactManifestStatus,
      runtimeFilesAbsent,
      distHashMatch,
      siteHashMatch,
      bordbuchHashMatch,
      snapshotHashMatch,
      artifactHashMatch,
      liveKeyScan,
      violations,
    },
    exitCode: hasViolations ? 1 : 0,
    summary: `[notausgang.validate] ${hasViolations ? "invalid" : "valid"} — ${violations.length} violation${violations.length === 1 ? "" : "s"}, ${liveKeyScan}`,
    nextSteps: hasViolations
      ? [
          {
            action: `Fix the ${violations.length} violation${violations.length === 1 ? "" : "s"} above, then re-run: pnpm exec werkstatt run notausgang.validate --site <system-id>`,
            kind: "required",
          },
        ]
      : undefined,
  };
}
