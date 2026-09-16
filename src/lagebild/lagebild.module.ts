/*
<MODULE_CONTRACT>
  <purpose>RFC-1065: Lazy-loading kernel module for lagebild commands: lagebild.connect, lagebild.validate, lagebild.status.</purpose>
  <non-goals>
    <item>Do not re-export types or utilities — this module is a command registration point only.</item>
    <item>Do not register sternsystem, mission, or leitstand commands here.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1065: initial lagebild module — lagebild.connect, lagebild.validate, lagebild.status commands.</item>
</CHANGE_SUMMARY>
*/

import type { ModuleExport } from "../runtime/desired-state.ts";

export async function createLagebildModule(): Promise<ModuleExport> {
  const { runLagebildConnect } = await import("./lagebild-connect.ts");
  const { runLagebildValidate } = await import("./lagebild-validate.ts");
  const { runLagebildStatus } = await import("./lagebild-status.ts");
  return {
    name: "lagebild",
    version: "0.1.0",
    declarations: [],
    commands: [
      {
        name: "lagebild.connect",
        modulePath: "packages/werkstatt-engine/src/lagebild/lagebild.module.ts",
        description:
          "Push 4 LAGEBILD_* secrets to a channel's Cloudflare Worker, health check, record connection state in system-state.yaml, merge into .env (RFC-1065).",
        scope: "workspace",
        flags: {
          site: { kind: "string", required: true, description: "Sternsystem ID." },
          "api-url": { kind: "string", required: true, description: "Lagebild API URL." },
          "api-key": {
            kind: "string",
            required: true,
            description: "Lagebild API key (piped to stdin, never logged).",
          },
          "tenant-id": { kind: "string", required: true, description: "Lagebild tenant ID." },
          "source-system-id": {
            kind: "string",
            description: "Source system ID (default: site_<id>).",
          },
          channel: { kind: "string", description: "Deployment channel (default: main)." },
        },
        mutatesState: true,
        writes: ["../systems-cache/{system}/system-state.yaml", "../systems-cache/{system}/.env"],
        generates: [],
        reads: [
          "../systems-cache/{system}/system-config.yaml",
          "../systems-cache/{system}/system-state.yaml",
        ],
        requiresNetwork: true,
        execute: runLagebildConnect,
      },
      {
        name: "lagebild.validate",
        modulePath: "packages/werkstatt-engine/src/lagebild/lagebild.module.ts",
        description:
          "Check 4 LAGEBILD_* secrets via wrangler secret list, verify .env key presence, best-effort GET /health (RFC-1065).",
        contract: "lagebild",
        rules: [],
        scope: "workspace",
        flags: {
          site: { kind: "string", required: true, description: "Sternsystem ID." },
          channel: { kind: "string", description: "Deployment channel (default: main)." },
        },
        mutatesState: false,
        writes: [],
        generates: [],
        reads: [
          "../systems-cache/{system}/system-config.yaml",
          "../systems-cache/{system}/system-state.yaml",
          "../systems-cache/{system}/.env",
        ],
        requiresNetwork: true,
        execute: runLagebildValidate,
      },
      {
        name: "lagebild.status",
        modulePath: "packages/werkstatt-engine/src/lagebild/lagebild.module.ts",
        description:
          "Read lagebild connection state from system-state.yaml. No network calls (RFC-1065).",
        scope: "workspace",
        flags: {
          site: { kind: "string", required: true, description: "Sternsystem ID." },
        },
        mutatesState: false,
        writes: [],
        generates: [],
        reads: ["../systems-cache/{system}/system-state.yaml"],
        requiresNetwork: false,
        execute: runLagebildStatus,
      },
    ],
    pipelines: [],
  };
}
