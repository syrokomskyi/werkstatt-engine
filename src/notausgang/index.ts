/*
<MODULE_CONTRACT>
<purpose>RFC-0359 + RFC-0380: notausgang module exports and command registration. RFC-0380 adds CheckStatus and NotausgangViolation types.</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0359: initial notausgang module.</item>
  <item>RFC-0380: export CheckStatus, NotausgangViolation types; update command descriptions for deep validation.</item>
</CHANGE_SUMMARY>
*/

import type { KernelModule } from "@warpgogol/werkstatt-engine/kernel";
import { runNotausgangExport, runNotausgangValidate } from "./notausgang-commands.ts";

export {
  runNotausgangExport,
  type NotausgangExportData,
  runNotausgangValidate,
  type NotausgangValidateData,
  type CheckStatus,
  type NotausgangViolation,
} from "./notausgang-commands.ts";

export function createNotausgangModule(): KernelModule {
  return {
    name: "notausgang",
    version: "0.1.0",
    register(registry) {
      registry.registerCommand({
        name: "notausgang.export",
        modulePath: "packages/werkstatt-engine/src/notausgang/index.ts",
        generates: [],
        description:
          "Export a full site package with dist artifacts, history, and nulled integrations (RFC-0359, RFC-0380). Writes YAML manifests and uses @warpgogol/fingerprint for hashing. Flags: --system, --release, --output, [--keep-integration, --reason].",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: true,
        flags: {
          system: { kind: "string", required: true, description: "Sternsystem id." },
          release: { kind: "string", required: true, description: "Release id to export." },
          output: { kind: "string", required: true, description: "Export output directory." },
          "keep-integration": {
            kind: "string[]",
            description: "Integration names to keep rather than null.",
          },
          reason: {
            kind: "string[]",
            description: "Reasons paired with kept integrations.",
          },
        },
        writes: ["{--output}/**"],
        execute: runNotausgangExport,
      });
      registry.registerCommand({
        name: "notausgang.validate",
        contract: "notausgang",
        rules: [],
        modulePath: "packages/werkstatt-engine/src/notausgang/index.ts",
        description:
          "Deep integrity verification of a Notausgang export package (RFC-0359, RFC-0380). Re-computes hashes, validates manifest schema, Bordbuch NDJSON, pin content, behavior snapshots, and scans for secrets. Flags: --path.",
        scope: "workspace",
        supportsAllSites: false,
        flags: {
          path: { kind: "string", required: true, description: "Export package path." },
        },
        execute: runNotausgangValidate,
      });
    },
  };
}
