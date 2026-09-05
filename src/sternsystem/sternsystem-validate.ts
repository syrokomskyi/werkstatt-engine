/*
<MODULE_CONTRACT>
<purpose>RFC-0354 §7.3: sternsystem.validate — validate registry invariants and bundle contract.</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0354: initial validate command handler.</item>
  <item>RFC-0480: add Bordbuch-vs-git-log consistency check for external edit detection.</item>
  <item>RFC-0520: extract Bordbuch-vs-git-log check into evaluateExternalEditGate pure function.</item>
  <item>RFC-0561: add owner-format-invalid check and missing-owner notice warning.</item>
  <item>RFC-0648: add branch-convention rule enforcing main as default branch for cache clone and bare repo.</item>
  <item>RFC-0792: add yaml-syntax-error rule for top-level YAML file syntax checking in systems-cache.</item>
  <item>RFC-0822: add ENV-PERSIST-01 warning when cache clone lacks .env* but active workpiece has them.</item>
  <item>RFC-0870: add STERN-MANIFEST-01 check for missing committed generated manifests in cache clone HEAD.</item>
  <item>RFC-0902: add STERN-ID-TLD rule rejecting IDs ending in a known TLD suffix.</item>
  <item>RFC-0966: add PASSPORT-01 (missing passport), PASSPORT-02 (invalid signature), PASSPORT-03 (resource drift) rules.</item>
  <item>RFC-0968: add HANDOVER-01/02/03/04/05 rules for sternsystem handover protocol.</item>
  <item>Fix: checkBundleContract uses git ls-files instead of filesystem scan, excludes COMMITTED_MANIFEST_PATHS from generated file check.</item>
</CHANGE_SUMMARY>
*/

import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { StarCatalog } from "@warpgogol/werkstatt-shared/ontology/cosmic";
import { systemPinSchema } from "@warpgogol/werkstatt-engine/schemas";
import {
  discoverSystems,
  hasAppsCollision,
  resolveMirrors,
  resolveMirrorPath,
  resolveWorkpiecePath,
  readSystemState,
  isGitAccessible,
} from "./registry-io.ts";
import { evaluateExternalEditGate } from "./external-edit-guard.ts";
import {
  collectExternalEditInputs,
  bordbuchFileExists,
  bordbuchPathFor,
} from "./external-edit-collector.ts";
import { collectEnvFiles } from "../mission/env-persist.ts";
import { hasTldSuffix } from "../schemas/naming-policy.ts";
import { readPassport } from "./registry-io.ts";
import { verifyPassport, buildPassportPayload, computePassportHash } from "./passport.ts";
import { readAuthorization, isAuthorizationExpired } from "./handover.ts";
import { readBordbuch } from "../bordbuch/bordbuch-io.ts";

export interface SternsystemValidateData {
  validated: number;
  violations: SternsystemViolation[];
  warnings: Array<{ systemId: string; field: string; message: string }>;
  withOwner: number;
  withoutOwner: number;
}

type SternsystemViolation = { systemId: string; rule: string; message: string };

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

export const FORBIDDEN_PATTERNS = [
  "dist",
  "node_modules",
  "packages",
  "package.json",
  "pnpm-lock.yaml",
  "astro.config.mjs",
  "astro.config.ts",
  "tsconfig.json",
  "wrangler.toml",
  "wrangler.jsonc",
];

// RFC-0870: Committed generated manifest paths checked in cache clone HEAD.
// These are registry-only generated files committed to git for drift detection.
// Only checked when tracked in git — new systems without manifests are not flagged.
// Source of truth: toOwnershipEntries(context.ownershipMap ?? []) in packages/werkstatt-site/src/checks/generator-ownership.ts
// (filter for markerPolicy="registry-only", conditional=true, path starts with "src/").
// This list is hardcoded here (not dynamically imported) to respect DNA-64 —
// the engine must not statically import from the site plugin.
// When adding a new registry-only conditional manifest to toOwnershipEntries(context.ownershipMap ?? []),
// also add it here.
const COMMITTED_MANIFEST_PATHS = [
  "src/image-variants.generated.yaml",
  "src/video-manifest.generated.yaml",
  "src/live-video-manifest.generated.yaml",
];

/**
 * RFC-0870: Check that committed generated manifests are present in the cache
 * clone git HEAD. Uses `git ls-tree HEAD -- <path>` to determine if a file is
 * tracked. Only files that ARE tracked but missing from HEAD trigger
 * STERN-MANIFEST-01 — untracked files (new systems) are not flagged.
 */
function checkManifestPresence(cacheDir: string, systemId: string): SternsystemViolation[] {
  const violations: SternsystemViolation[] = [];
  for (const manifestPath of COMMITTED_MANIFEST_PATHS) {
    try {
      // Check if the file is tracked in git history (any commit)
      const tracked = execSync(`git log --oneline -1 -- ${manifestPath}`, {
        cwd: cacheDir,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      if (!tracked) continue; // Not tracked — new system, skip

      // Check if the file exists in HEAD
      const headContent = execSync(`git ls-tree HEAD -- ${manifestPath}`, {
        cwd: cacheDir,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      if (!headContent) {
        violations.push({
          systemId,
          rule: "STERN-MANIFEST-01",
          message: `Committed generated manifest ${manifestPath} is missing from cache clone HEAD — run the generating command in a mission workpiece and commit via mission.git.commit`,
        });
      }
    } catch {
      // Git command failed — skip this manifest
    }
  }
  return violations;
}

async function checkBundleContract(
  cacheDir: string,
  systemId: string,
): Promise<SternsystemViolation[]> {
  const violations: SternsystemViolation[] = [];
  if (!existsSync(cacheDir)) return violations;

  let trackedFiles: string[] = [];
  try {
    const output = execSync("git ls-files", {
      cwd: cacheDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    trackedFiles = output.split("\n").filter(Boolean);
  } catch {
    return violations;
  }

  for (const rel of trackedFiles) {
    const name = path.basename(rel);

    if (FORBIDDEN_PATTERNS.includes(name)) {
      violations.push({
        systemId,
        rule: "bundle-contract",
        message: `${systemId}: cache clone contains forbidden file: ${rel}`,
      });
    }
    if (name.includes(".generated.") && !COMMITTED_MANIFEST_PATHS.includes(rel)) {
      violations.push({
        systemId,
        rule: "bundle-contract",
        message: `${systemId}: cache clone contains generated file: ${rel}`,
      });
    }
  }

  return violations;
}

async function validateYamlFiles(
  cacheDir: string,
  systemId: string,
): Promise<SternsystemViolation[]> {
  const violations: SternsystemViolation[] = [];
  if (!existsSync(cacheDir)) return violations;

  const entries = await fs.readdir(cacheDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".yaml") && !entry.name.endsWith(".yml")) continue;

    const filePath = path.join(cacheDir, entry.name);
    try {
      const raw = await fs.readFile(filePath, "utf8");
      parseYaml(raw);
    } catch (err) {
      violations.push({
        systemId,
        rule: "yaml-syntax-error",
        message: `${entry.name}: YAML syntax error: ${(err as Error).message}`,
      });
    }
  }

  return violations;
}

export async function runSternsystemValidate(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<SternsystemValidateData>> {
  const { workspaceRoot, logger } = context;
  const filterId = flagString(input, "id");

  const { systems: allSystems, errors: discoveryErrors } = await discoverSystems(workspaceRoot);

  const violations: SternsystemViolation[] = [];
  const warnings: Array<{ systemId: string; field: string; message: string }> = [];

  if (discoveryErrors.length > 0) {
    for (const err of discoveryErrors) {
      violations.push({
        systemId: err.id,
        rule: "discovery-error",
        message: `Failed to read system-config.yaml for '${err.id}': ${err.error}`,
      });
    }
  }

  const systems = filterId ? allSystems.filter((s) => s.id === filterId) : allSystems;

  if (filterId && systems.length === 0) {
    throw new Error(`[sternsystem.validate] id '${filterId}' not found in ../systems-cache/`);
  }

  const seenIds = new Set<string>();
  const seenStars = new Set<string>();
  let withOwner = 0;
  let withoutOwner = 0;

  for (const entry of systems) {
    // Registry invariants
    if (seenIds.has(entry.id)) {
      violations.push({
        systemId: entry.id,
        rule: "unique-id",
        message: `duplicate id '${entry.id}' in registry`,
      });
    }
    seenIds.add(entry.id);

    if (entry.owner) {
      withOwner++;
    } else {
      withoutOwner++;
      warnings.push({
        systemId: entry.id,
        field: "owner",
        message: "owner field not set; Studio Gate cannot verify ownership for this site",
      });
    }

    if (entry.status !== "archived" && seenStars.has(entry.cosmicStar)) {
      violations.push({
        systemId: entry.id,
        rule: "unique-cosmicStar",
        message: `cosmicStar '${entry.cosmicStar}' is used by multiple active/registered systems`,
      });
    }
    seenStars.add(entry.cosmicStar);

    if (!(StarCatalog as readonly string[]).includes(entry.cosmicStar)) {
      violations.push({
        systemId: entry.id,
        rule: "valid-cosmicStar",
        message: `cosmicStar '${entry.cosmicStar}' is not in StarCatalog`,
      });
    }

    // RFC-0902: TLD suffix check
    if (hasTldSuffix(entry.id)) {
      violations.push({
        systemId: entry.id,
        rule: "STERN-ID-TLD",
        message: `Sternsystem ID '${entry.id}' ends in a TLD suffix — use the business ID without domain TLD (e.g. 'warpgogol' not 'warpgogol-com')`,
      });
    }

    // apps/ collision
    if (hasAppsCollision(workspaceRoot, entry.id)) {
      violations.push({
        systemId: entry.id,
        rule: "apps-collision",
        message: `id '${entry.id}' matches existing apps/${entry.id}/ — extraction incomplete`,
      });
    }

    // Bundle contract (if cache clone exists)
    const cacheDir = resolveMirrors(workspaceRoot, entry).cachePath;
    const bundleViolations = await checkBundleContract(cacheDir, entry.id);
    violations.push(...bundleViolations);

    // Pin file validation (if cache clone exists)
    const pinPath = path.join(cacheDir, "system.pin.json");
    if (existsSync(pinPath)) {
      try {
        const raw = await fs.readFile(pinPath, "utf8");
        const parsed = JSON.parse(raw);
        systemPinSchema.parse(parsed);
        const pin = parsed as { platform: { version: string }; systemId: string };
        if (pin.platform.version !== entry.pinnedPlatform) {
          violations.push({
            systemId: entry.id,
            rule: "pin-version-mismatch",
            message: `system.pin.json platform.version '${pin.platform.version}' does not match registry pinnedPlatform '${entry.pinnedPlatform}'`,
          });
        }
        if (pin.systemId !== entry.id) {
          violations.push({
            systemId: entry.id,
            rule: "pin-id-mismatch",
            message: `system.pin.json systemId '${pin.systemId}' does not match registry id '${entry.id}'`,
          });
        }
      } catch (err) {
        violations.push({
          systemId: entry.id,
          rule: "pin-parse",
          message: `system.pin.json parse failed: ${(err as Error).message}`,
        });
      }
    } else if (entry.status === "active") {
      violations.push({
        systemId: entry.id,
        rule: "pin-missing",
        message: `active system '${entry.id}' has no system.pin.json in cache clone`,
      });
    }

    // RFC-0666: secretsFile field is removed — reject if still present in any channel
    if (entry.deployment?.channels) {
      for (const [ch, chConfig] of Object.entries(entry.deployment.channels)) {
        if (chConfig?.secretsFile) {
          violations.push({
            systemId: entry.id,
            rule: "secretsFile-removed",
            message: `channel '${ch}' still contains 'secretsFile' field — remove it. See RFC-0666.`,
          });
        }
      }
    }

    // RFC-0574: validate mirror topology — mirrors[0] is cache, mirrors[1] is bare, mirrors[2+] are external
    if (entry.mirrors.length < 1) {
      violations.push({
        systemId: entry.id,
        rule: "mirrors-empty",
        message: `system '${entry.id}' has no mirrors — at least 1 mirror (cache clone) is required`,
      });
    }

    if (entry.mirrors.length >= 1 && entry.mirrors[0].storageType !== "non-bare") {
      violations.push({
        systemId: entry.id,
        rule: "cache-must-be-non-bare",
        message: `mirrors[0] must have storageType 'non-bare' (got '${entry.mirrors[0].storageType}') — cache clone must be a working tree for git push`,
      });
    }

    for (let i = 0; i < entry.mirrors.length; i++) {
      const m = entry.mirrors[i];
      if (m.storageType === "bundle" && isGitAccessible(m.path)) {
        violations.push({
          systemId: entry.id,
          rule: "bundle-no-git-protocol",
          message: `mirrors[${i}] has storageType 'bundle' but uses git-accessible protocol '${m.path}' — bundle mirrors must not use git protocols`,
        });
      }
    }

    if (entry.mirrors.length > 1) {
      const bareMirror = entry.mirrors[1];
      const bareRepoPath = resolveMirrorPath(workspaceRoot, bareMirror.path);

      if (existsSync(bareRepoPath)) {
        try {
          const remoteUrl = execSync("git remote get-url mirror", {
            cwd: bareRepoPath,
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
          }).trim();
          if (entry.mirrors.length > 2 && remoteUrl !== entry.mirrors[2].path) {
            violations.push({
              systemId: entry.id,
              rule: "mirror-remote-mismatch",
              message: `mirror remote URL '${remoteUrl}' does not match registry mirrors[2] '${entry.mirrors[2].path}'`,
            });
          }
        } catch {
          violations.push({
            systemId: entry.id,
            rule: "mirror-remote-missing",
            message: `mirror remote not configured in bare repo at ${bareRepoPath}`,
          });
        }
      }

      if (entry.mirrors.length > 2) {
        const externalMirror = entry.mirrors[2].path;
        if (/https:\/\/[^:]+:[^@]+@/.test(externalMirror)) {
          violations.push({
            systemId: entry.id,
            rule: "mirror-credentials",
            message: `external mirror URL contains embedded credentials — use SSH URL instead`,
          });
        }
      }
    }

    // RFC-0648: branch-convention rule — cache clone and bare repo must use 'main' branch
    const cacheGitDir = path.join(cacheDir, ".git");
    if (existsSync(cacheGitDir)) {
      try {
        const cacheBranch = execSync("git symbolic-ref HEAD", {
          cwd: cacheDir,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        })
          .replace("refs/heads/", "")
          .trim();
        if (cacheBranch !== "main") {
          violations.push({
            systemId: entry.id,
            rule: "branch-convention",
            message: `cache clone branch is '${cacheBranch}', expected 'main' — run: git -C ${cacheDir} branch -m ${cacheBranch} main`,
          });
        }
      } catch {
        violations.push({
          systemId: entry.id,
          rule: "branch-convention",
          message: `cache clone at ${cacheDir} has no resolvable HEAD (detached or corrupt) — expected branch 'main'`,
        });
      }
    }

    if (entry.mirrors.length > 1) {
      const bareMirror = entry.mirrors[1];
      const bareRepoPath = resolveMirrorPath(workspaceRoot, bareMirror.path);
      if (existsSync(bareRepoPath)) {
        try {
          const bareBranch = execSync("git symbolic-ref HEAD", {
            cwd: bareRepoPath,
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
          })
            .replace("refs/heads/", "")
            .trim();
          if (bareBranch !== "main") {
            violations.push({
              systemId: entry.id,
              rule: "branch-convention",
              message: `bare repo branch is '${bareBranch}', expected 'main' — run: git -C ${bareRepoPath} symbolic-ref HEAD refs/heads/main`,
            });
          }
        } catch {
          violations.push({
            systemId: entry.id,
            rule: "branch-convention",
            message: `bare repo at ${bareRepoPath} has no resolvable HEAD (detached or corrupt) — expected branch 'main'`,
          });
        }
      }
    }

    // RFC-0520: Bordbuch-vs-git-log check delegated to evaluateExternalEditGate
    if (bordbuchFileExists(cacheDir)) {
      try {
        const bordbuchPath = bordbuchPathFor(cacheDir);
        const { bordbuchEntries, rangeShas, gitLogShas } = await collectExternalEditInputs(
          cacheDir,
          bordbuchPath,
        );
        const guardResult = evaluateExternalEditGate({
          systemId: entry.id,
          bordbuchEntries,
          gitLogShas,
          rangeShas,
        });
        if (guardResult.verdict === "fail") {
          for (const v of guardResult.violations) {
            violations.push({ systemId: v.systemId!, rule: v.rule, message: v.message });
          }
        }
      } catch {
        // Bordbuch read failed — skip
      }
    }

    // RFC-0792: YAML syntax checking for all top-level YAML files in cache clone
    const yamlViolations = await validateYamlFiles(cacheDir, entry.id);
    violations.push(...yamlViolations);

    // RFC-0870: Manifest presence check — committed generated manifests must exist in cache clone HEAD
    const manifestViolations = checkManifestPresence(cacheDir, entry.id);
    violations.push(...manifestViolations);

    // RFC-0822: ENV-PERSIST-01 warning — cache clone lacks .env* but workpiece has them
    try {
      const cacheEnvFiles = await collectEnvFiles(cacheDir);
      if (cacheEnvFiles.length === 0) {
        const state = await readSystemState(workspaceRoot, entry.id);
        if (state.currentMission) {
          const workpieceDir = resolveWorkpiecePath(workspaceRoot, state.currentMission);
          if (existsSync(workpieceDir)) {
            const workpieceEnvFiles = await collectEnvFiles(workpieceDir);
            if (workpieceEnvFiles.length > 0) {
              warnings.push({
                systemId: entry.id,
                field: "ENV-PERSIST-01",
                message: `Cache clone for system '${entry.id}' has no .env files but workpiece has ${workpieceEnvFiles.length} — run mission.close to persist secrets`,
              });
            }
          }
        }
      }
    } catch {
      // Non-fatal — env check skipped
    }

    // RFC-0966: PASSPORT-01/02/03 — signed site passport checks
    try {
      const passportDoc = await readPassport(workspaceRoot, entry.id);
      if (!passportDoc) {
        const state = await readSystemState(workspaceRoot, entry.id);
        if (state.passportRequired) {
          violations.push({
            systemId: entry.id,
            rule: "PASSPORT-01",
            message: `passport.json missing but passportRequired is true — run: pnpm exec werkstatt run sternsystem.passport.generate --id ${entry.id}`,
          });
        } else {
          warnings.push({
            systemId: entry.id,
            field: "PASSPORT-01",
            message: `passport.json not found — run: pnpm exec werkstatt run sternsystem.passport.generate --id ${entry.id}`,
          });
        }
      } else {
        const { valid, errors } = await verifyPassport(passportDoc);
        if (!valid) {
          for (const err of errors) {
            violations.push({
              systemId: entry.id,
              rule: "PASSPORT-02",
              message: err,
            });
          }
        }

        // PASSPORT-03: resource drift check (non-fatal warning)
        try {
          const freshPayload = await buildPassportPayload({
            systemId: entry.id,
            werkstattRoot: workspaceRoot,
            creatorIdentity: passportDoc.payload.creator.identity,
            creatorPublicKey: passportDoc.payload.creator.publicKey,
          });
          freshPayload.provenance.createdAt = passportDoc.payload.provenance.createdAt;
          freshPayload.provenance.generatedAt = passportDoc.payload.provenance.generatedAt;
          const freshHash = computePassportHash(freshPayload);
          if (freshHash !== passportDoc.passportHash) {
            // Tolerate stale bordbuchHead right after a handover — the passport is
            // generated before the handover bordbuch entry is appended, so the head
            // legitimately doesn't include it. Check if the only difference is the
            // bordbuch head pointing to the entry before the latest handover event.
            let isPostHandoverDrift = false;
            try {
              const entries = await readBordbuch(workspaceRoot, entry.id);
              const handoverEntries = entries.filter((e) => e.kind === "handover");
              if (
                handoverEntries.length > 0 &&
                entries.length > 0 &&
                entries[entries.length - 1].kind === "handover"
              ) {
                // The latest bordbuch entry is a handover event — check if the
                // passport's bordbuchHead matches the entry just before it
                const prevEntry = entries[entries.length - 2];
                const expectedHead = prevEntry ? prevEntry.hash : "";
                if (passportDoc.payload.provenance.bordbuchHead === expectedHead) {
                  isPostHandoverDrift = true;
                }
              }
            } catch {
              // Bordbuch read failed — can't determine, treat as real drift
            }

            if (!isPostHandoverDrift) {
              warnings.push({
                systemId: entry.id,
                field: "PASSPORT-03",
                message: `passport content drift detected — bordbuchHead or resources changed since last generation. Run: pnpm exec werkstatt run sternsystem.passport.generate --id ${entry.id}`,
              });
            }
          }
        } catch {
          // Non-fatal — drift check skipped
        }
      }
    } catch {
      // Non-fatal — passport check skipped
    }

    // RFC-0967: OWNERSHIP-01 — fleet ownership registry check
    try {
      const registryUrl = process.env.FLEET_OWNERSHIP_REGISTRY_URL;
      if (!registryUrl) {
        // Registry not configured — skip
      } else {
        const { verifyOwnership, OwnershipError } = await import("../fleet/ownership-registry.ts");
        try {
          const result = await verifyOwnership({
            systemId: entry.id,
            werkstattRoot: workspaceRoot,
            registryUrl,
          });

          if (!result.registered) {
            const state = await readSystemState(workspaceRoot, entry.id);
            if (state.ownershipRequired) {
              violations.push({
                systemId: entry.id,
                rule: "OWNERSHIP-01",
                message: `Site not registered in fleet ownership registry but ownershipRequired is true — run: pnpm exec werkstatt run fleet.ownership.register --id ${entry.id}`,
              });
            } else {
              warnings.push({
                systemId: entry.id,
                field: "OWNERSHIP-01",
                message: `Site not registered in fleet ownership registry — run: pnpm exec werkstatt run fleet.ownership.register --id ${entry.id}`,
              });
            }
          } else if (result.conflictsWith) {
            warnings.push({
              systemId: entry.id,
              field: "OWNERSHIP-01",
              message: `Ownership conflict: site registered to instance ${result.conflictsWith}, not this instance (OWNERSHIP-03)`,
            });
          }
        } catch (err) {
          if (err instanceof OwnershipError) {
            warnings.push({
              systemId: entry.id,
              field: "OWNERSHIP-01",
              message: `Registry check skipped (${err.code}): ${err.message}`,
            });
          }
        }
      }
    } catch {
      // Non-fatal — ownership check skipped
    }

    // RFC-0968: HANDOVER-01/02/03/04/05 — sternsystem handover protocol
    try {
      const authorization = await readAuthorization(workspaceRoot, entry.id);

      if (authorization) {
        // HANDOVER-01: pending handover blocks missions
        violations.push({
          systemId: entry.id,
          rule: "HANDOVER-01",
          message: `pending handover — missions blocked; run sternsystem.handover.complete or sternsystem.handover.cancel`,
        });

        // HANDOVER-02: authorization expired
        if (isAuthorizationExpired(authorization.payload.expiresAt)) {
          violations.push({
            systemId: entry.id,
            rule: "HANDOVER-02",
            message: `authorization expired at ${authorization.payload.expiresAt} — sender must re-issue`,
          });
        }

        // HANDOVER-03: passport hash mismatch
        const currentPassport = await readPassport(workspaceRoot, entry.id);
        if (currentPassport) {
          if (authorization.payload.passportHash !== currentPassport.passportHash) {
            violations.push({
              systemId: entry.id,
              rule: "HANDOVER-03",
              message: `passport changed after authorization — sender must re-issue`,
            });
          }
        }

        // HANDOVER-04: recipient key mismatch (warning, not blocking)
        const privateKeyEnv = process.env.SIGNING_PRIVATE_KEY;
        const privateKeyPath = process.env.SIGNING_PRIVATE_KEY_PATH;
        if (privateKeyEnv || privateKeyPath) {
          try {
            const { loadPrivateKey } = await import("@warpgogol/werkstatt-engine/signing");
            const { derivePublicKey } = await import("./passport.ts");
            let privateKeyBytes: Uint8Array;
            if (privateKeyEnv) {
              privateKeyBytes = await loadPrivateKey({ pem: privateKeyEnv });
            } else {
              privateKeyBytes = await loadPrivateKey({
                filePath: privateKeyPath!,
                encoding: "pem",
              });
            }
            const derivedPubKey = await derivePublicKey(privateKeyBytes);
            if (authorization.payload.recipient.publicKey !== derivedPubKey) {
              warnings.push({
                systemId: entry.id,
                field: "HANDOVER-04",
                message: `recipient key mismatch — this instance is not the authorized recipient`,
              });
            }
          } catch {
            // Non-fatal — key derivation failed
          }
        }
      } else {
        // HANDOVER-05: no authorization file but passport creator doesn't match bordbuch's latest handover event
        try {
          const entries = await readBordbuch(workspaceRoot, entry.id);
          const handoverEntries = entries.filter((e) => e.kind === "handover");
          if (handoverEntries.length > 0) {
            const latestHandover = handoverEntries[handoverEntries.length - 1];
            const currentPassport = await readPassport(workspaceRoot, entry.id);
            if (currentPassport) {
              const metadata = latestHandover.metadata as Record<string, unknown> | undefined;
              const expectedNewPassportHash = metadata?.newPassportHash as string | undefined;
              if (
                expectedNewPassportHash &&
                expectedNewPassportHash !== currentPassport.passportHash
              ) {
                violations.push({
                  systemId: entry.id,
                  rule: "HANDOVER-05",
                  message: `incomplete handover — passport regenerated but bordbuch event references a different passport hash; re-run sternsystem.handover.complete`,
                });
              }
            }
          }
        } catch {
          // Non-fatal — bordbuch read failed
        }
      }
    } catch {
      // Non-fatal — handover check skipped
    }

    // RFC-1034: STERN-CONFIG-RESOLVE-01 — check if cache clone's kernel.config.ts can be loaded
    try {
      const cachePath = resolveMirrors(workspaceRoot, entry).cachePath;
      if (cachePath) {
        const configPath = path.join(cachePath, "tools", "kernel.config.ts");
        if (existsSync(configPath)) {
          try {
            const { loadAppRuntime } = await import("../kernel/runtime/registry.ts");
            await loadAppRuntime(workspaceRoot, {
              name: entry.id,
              directory: cachePath,
              configPath: "tools/kernel.config.ts",
              toolsDirectory: path.join(cachePath, "tools"),
            });
          } catch (configErr) {
            warnings.push({
              systemId: entry.id,
              field: "STERN-CONFIG-RESOLVE-01",
              message: `cache clone kernel.config.ts failed to load: ${configErr instanceof Error ? configErr.message : String(configErr)} — run pnpm install in the cache clone or re-materialize`,
            });
          }
        }
      }
    } catch {
      // Non-fatal — config resolution check skipped
    }
  }

  const validated = systems.length;
  if (violations.length === 0) {
    logger.success(
      `[sternsystem.validate] ${validated} system${validated === 1 ? "" : "s"} validated, 0 violations`,
    );
  } else {
    logger.error(
      `[sternsystem.validate] ${validated} system${validated === 1 ? "" : "s"} validated, ${violations.length} violation${violations.length === 1 ? "" : "s"}`,
    );
    for (const v of violations) {
      logger.error(`  [${v.rule}] ${v.systemId}: ${v.message}`);
    }
  }
  for (const w of warnings) {
    logger.warn(`  [${w.field}] ${w.systemId}: ${w.message}`);
  }

  return {
    data: { validated, violations, warnings, withOwner, withoutOwner },
    exitCode: violations.length > 0 ? 1 : 0,
    summary: `[sternsystem.validate] ${validated} system${validated === 1 ? "" : "s"} validated, ${violations.length} violation${violations.length === 1 ? "" : "s"}, ${withOwner} with owner, ${withoutOwner} without owner`,
    nextSteps:
      violations.length > 0
        ? [
            {
              action: `Fix the ${violations.length} validation violation${violations.length === 1 ? "" : "s"} above, then re-run: pnpm exec werkstatt run sternsystem.validate`,
              kind: "required",
            },
          ]
        : undefined,
  };
}
