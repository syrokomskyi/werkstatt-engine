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
  <item>RFC-1198: cookie-free referral attribution — /r/<slug> partner landings + voluntary referrer field

Replace the RFC-1191 wg_ref cookie capture with URL+form attribution:
static /r/<slug> and /<lang>/r/<slug> partner landings (noindex, zero JS,
consent-gated via publicNameConsentRef), ?ref prefill on the existing
referrerField rail, server-side slug resolution against the bundled
partners.yaml, referral_partner_slug/name on the Lagebild ingress contract,
legacy /?ref -> /r/<slug> 302 in the generated worker, and full removal of
the cookie capture module (wg_ref, referral.attribution entitlement,
payload.attribution).</item>
</CHANGE_SUMMARY>
*/

import type { ModuleExport } from "@warpgogol/werkstatt-shared/kernel";

export async function createLagebildModule(): Promise<ModuleExport> {
  const { runLagebildConnect } = await import("./lagebild-connect.ts");
  const { runLagebildValidate } = await import("./lagebild-validate.ts");
  const { runLagebildStatus } = await import("./lagebild-status.ts");
  const { runLagebildReferralIssue, runLagebildReferralList } =
    await import("./lagebild-referral.ts");
  return {
    name: "lagebild",
    version: "0.1.0",
    declarations: [],
    commands: [
      {
        name: "lagebild.connect",
        modulePath: "packages/werkstatt-engine/src/lagebild/lagebild.module.ts",
        description:
          "Push 4 LAGEBILD_* secrets to a channel's Cloudflare Worker, health check, record connection state in system-state.yaml, merge into .env (RFC-1065). Required flags: `--site`, `--api-url`, `--api-key`, `--tenant-id`.",
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
        // Truth lives remotely (Worker secrets + API health) — a cached hit would
        // replay "pushed" without calling the API.
        cacheable: false,
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
          "Check 4 LAGEBILD_* secrets via wrangler secret list, verify .env key presence, best-effort GET /health (RFC-1065). Required flags: `--site`.",
        contract: "lagebild",
        rules: [],
        scope: "workspace",
        flags: {
          site: { kind: "string", required: true, description: "Sternsystem ID." },
          channel: { kind: "string", description: "Deployment channel (default: main)." },
        },
        mutatesState: false,
        execOnReadOnly: true,
        // Remote state (wrangler secret list + /health) is not covered by reads.
        cacheable: false,
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
          "Read lagebild connection state from system-state.yaml. No network calls (RFC-1065). Required flags: `--site`.",
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
      {
        name: "lagebild.referral.issue",
        modulePath: "packages/werkstatt-engine/src/lagebild/lagebild.module.ts",
        description:
          "Register a referral-partner slug via POST /v1/referrals and return the shareable <site-origin>/r/<slug> link (RFC-1198). The public page also needs the site-side partners.yaml entry. Required flags: `--site`, `--slug`, `--name`.",
        scope: "workspace",
        flags: {
          site: { kind: "string", required: true, description: "Sternsystem ID." },
          slug: {
            kind: "string",
            required: true,
            description:
              "Human-readable partner slug (kebab-case, 3–32 chars) — becomes /r/<slug>.",
          },
          name: {
            kind: "string",
            required: true,
            description: "Partner display name (public on /r/<slug> — consent required).",
          },
          contact: {
            kind: "string",
            description: "Partner contact email for CRM notifications (optional).",
          },
          channel: {
            kind: "string",
            description: "Deployment channel for the URL origin (default: main).",
          },
        },
        // Mutates the remote Lagebild registry (creates a code) — not a local
        // file write, but not read-only either.
        mutatesState: true,
        // A cached hit would replay the refCode without issuing it remotely.
        cacheable: false,
        writes: [],
        generates: [],
        reads: [
          "../systems-cache/{system}/system-config.yaml",
          "../systems-cache/{system}/system-state.yaml",
          "../systems-cache/{system}/.env",
        ],
        requiresNetwork: true,
        execute: runLagebildReferralIssue,
      },
      {
        name: "lagebild.referral.list",
        modulePath: "packages/werkstatt-engine/src/lagebild/lagebild.module.ts",
        description:
          "List the Lagebild referral registry rows via GET /v1/referrals (RFC-1191). Required flags: `--site`.",
        scope: "workspace",
        flags: {
          site: { kind: "string", required: true, description: "Sternsystem ID." },
        },
        mutatesState: false,
        // The registry is remote — reads cannot invalidate on new rows.
        cacheable: false,
        writes: [],
        generates: [],
        reads: ["../systems-cache/{system}/system-state.yaml", "../systems-cache/{system}/.env"],
        requiresNetwork: true,
        execute: runLagebildReferralList,
      },
    ],
    pipelines: [],
  };
}
