/*
<MODULE_CONTRACT>
<purpose>
RFC-0564: Command handlers for swim.join, swim.leave, swim.members, and
swim.status. Uses ephemeral per-command SWIM lifecycle — swim.join starts a
UDP probe to the seed node, records the alive event to the genome log, and
exits. No long-running daemon. swim.members and swim.status read from the
genome log only.
</purpose>
<non-goals>
  <item>Do not implement long-running SWIM gossip daemon — deferred to Phase 2.</item>
  <item>Do not implement genome log compaction — that is a future RFC.</item>
  <item>Do not implement key rotation — that is RFC-0558's responsibility.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0564: initial implementation — four command handlers with ephemeral SWIM lifecycle, Ed25519-signed genome log entries, and identity integration via werkstatt.identity.json.</item>
</CHANGE_SUMMARY>
*/

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createSocket, type Socket } from "node:dgram";
import { randomBytes } from "node:crypto";
import type { KernelCommandInput, KernelCommandResult, KernelRuntimeContext } from "../types.ts";
import type { SwimConfig, SwimMembershipView, SwimMember, GenomeLogEntry } from "./types.ts";
import { loadSwimConfig, loadOrCreateSwimConfig, CONFIG_FILENAME } from "./config.ts";
import {
  appendGenomeEntry,
  readGenomeLog,
  deriveMembershipView,
  signGenomeEntry,
  getGenomeLogSize,
  isGenomeLogSizeWarning,
} from "./genome-log.ts";
import {
  WerkstattIdentityConfigSchema,
  type WerkstattIdentityConfig,
} from "@warpgogol/werkstatt-shared/passport";

const IDENTITY_FILENAME = "werkstatt.identity.json";
const PASSPORT_SIGNING_KEY_ENV = "PASSPORT_SIGNING_KEY";
const PROBE_TIMEOUT_MS = 2000;

interface SwimJoinResult {
  joined: boolean;
  workshopId: string;
  seedNode: string;
  members: SwimMembershipView;
  diagnostics?: string[];
}

interface SwimLeaveResult {
  left: boolean;
  workshopId: string;
  diagnostics?: string[];
}

interface SwimStatusResult {
  configured: boolean;
  workshopId: string | null;
  bindAddr: string | null;
  genomeLogSize: number;
  genomeLogSizeWarning: boolean;
  members: SwimMembershipView;
  diagnostics?: string[];
}

async function loadIdentityConfig(workspaceRoot: string): Promise<WerkstattIdentityConfig> {
  const identityPath = join(workspaceRoot, IDENTITY_FILENAME);
  const raw = await readFile(identityPath, "utf8");
  const parsed = JSON.parse(raw);
  return WerkstattIdentityConfigSchema.parse(parsed);
}

function getSigningKey(): string {
  const key = process.env[PASSPORT_SIGNING_KEY_ENV];
  if (!key || key.length === 0) {
    throw new Error(`${PASSPORT_SIGNING_KEY_ENV} environment variable is not set`);
  }
  return key;
}

async function probeSeedNode(seedAddr: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket: Socket = createSocket("udp4");
    const message = Buffer.from(randomBytes(16));
    let settled = false;

    const cleanup = () => {
      if (!settled) {
        settled = true;
        socket.close();
      }
    };

    socket.on("error", () => {
      cleanup();
      resolve(false);
    });

    socket.on("message", () => {
      cleanup();
      resolve(true);
    });

    setTimeout(() => {
      cleanup();
      resolve(false);
    }, PROBE_TIMEOUT_MS);

    const [host, portStr] = seedAddr.split(":");
    const port = Number.parseInt(portStr, 10);
    if (!host || !Number.isFinite(port)) {
      cleanup();
      resolve(false);
      return;
    }
    socket.send(message, 0, message.length, port, host, (err) => {
      if (err) {
        cleanup();
        resolve(false);
      }
    });
  });
}

export async function runSwimJoin(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<SwimJoinResult>> {
  const { workspaceRoot } = context;
  const seed = input.flags["seed"] as string | undefined;

  if (!seed) {
    return {
      data: {
        joined: false,
        workshopId: "",
        seedNode: "",
        members: { members: [], total: 0, alive: 0, suspect: 0, dead: 0 },
        diagnostics: ["swim.join: --seed flag is required"],
      },
      exitCode: 1,
      summary: "[swim.join] --seed flag is required",
      nextSteps: [
        { action: "Provide the --seed flag (host:port) and re-run swim.join", kind: "required" },
      ],
    };
  }

  let identity: WerkstattIdentityConfig;
  try {
    identity = await loadIdentityConfig(workspaceRoot);
  } catch {
    return {
      data: {
        joined: false,
        workshopId: "",
        seedNode: seed,
        members: { members: [], total: 0, alive: 0, suspect: 0, dead: 0 },
        diagnostics: [
          `swim.join: no ${IDENTITY_FILENAME} found — run identity.bootstrap first (RFC-0558)`,
        ],
      },
      exitCode: 1,
      summary: `[swim.join] identity not bootstrapped — run identity.bootstrap first`,
      nextSteps: [
        {
          action: "Run identity.bootstrap first (RFC-0558), then re-run swim.join",
          kind: "required",
        },
      ],
    };
  }

  let signingKey: string;
  try {
    signingKey = getSigningKey();
  } catch {
    return {
      data: {
        joined: false,
        workshopId: "",
        seedNode: seed,
        members: { members: [], total: 0, alive: 0, suspect: 0, dead: 0 },
        diagnostics: [`swim.join: ${PASSPORT_SIGNING_KEY_ENV} environment variable is not set`],
      },
      exitCode: 1,
      summary: `[swim.join] ${PASSPORT_SIGNING_KEY_ENV} not set`,
      nextSteps: [
        {
          action: `Set the ${PASSPORT_SIGNING_KEY_ENV} environment variable and re-run swim.join`,
          kind: "required",
        },
      ],
    };
  }

  const config = await loadOrCreateSwimConfig(workspaceRoot, seed);

  const seedReachable = await probeSeedNode(seed);
  if (!seedReachable) {
    return {
      data: {
        joined: false,
        workshopId: config.workshopId,
        seedNode: seed,
        members: { members: [], total: 0, alive: 0, suspect: 0, dead: 0 },
        diagnostics: [`swim.join: seed node ${seed} is unreachable`],
      },
      exitCode: 1,
      summary: `[swim.join] seed node ${seed} is unreachable`,
      nextSteps: [
        {
          action: `Check that seed node ${seed} is reachable and re-run swim.join`,
          kind: "required",
        },
      ],
    };
  }

  const timestamp = new Date().toISOString();
  const entry = await signGenomeEntry(
    {
      workshopId: config.workshopId,
      event: "alive",
      timestamp,
      source: config.workshopId,
    },
    signingKey,
  );
  await appendGenomeEntry(workspaceRoot, entry);

  const { entries } = await readGenomeLog(
    workspaceRoot,
    identity.operatorKeyPair.publicKeyMultibase,
  );
  const membershipView = deriveMembershipView(entries);

  return {
    data: {
      joined: true,
      workshopId: config.workshopId,
      seedNode: seed,
      members: membershipView,
    },
    exitCode: 0,
    summary: `[swim.join] joined as ${config.workshopId} via seed ${seed} (${membershipView.alive} alive, ${membershipView.total} total)`,
  };
}

export async function runSwimLeave(
  _input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<SwimLeaveResult>> {
  const { workspaceRoot } = context;

  let config: SwimConfig;
  try {
    config = await loadSwimConfig(workspaceRoot);
  } catch {
    return {
      data: {
        left: false,
        workshopId: "",
        diagnostics: [`swim.leave: no ${CONFIG_FILENAME} found — run swim.join first`],
      },
      exitCode: 1,
      summary: `[swim.leave] no ${CONFIG_FILENAME} found`,
      nextSteps: [
        {
          action: "Run swim.join first to configure SWIM, then re-run swim.leave",
          kind: "required",
        },
      ],
    };
  }

  let signingKey: string;
  try {
    signingKey = getSigningKey();
  } catch {
    return {
      data: {
        left: false,
        workshopId: config.workshopId,
        diagnostics: [`swim.leave: ${PASSPORT_SIGNING_KEY_ENV} environment variable is not set`],
      },
      exitCode: 1,
      summary: `[swim.leave] ${PASSPORT_SIGNING_KEY_ENV} not set`,
      nextSteps: [
        {
          action: `Set the ${PASSPORT_SIGNING_KEY_ENV} environment variable and re-run swim.leave`,
          kind: "required",
        },
      ],
    };
  }

  const timestamp = new Date().toISOString();
  const entry: GenomeLogEntry = await signGenomeEntry(
    {
      workshopId: config.workshopId,
      event: "left",
      timestamp,
      source: config.workshopId,
    },
    signingKey,
  );
  await appendGenomeEntry(workspaceRoot, entry);

  return {
    data: {
      left: true,
      workshopId: config.workshopId,
    },
    exitCode: 0,
    summary: `[swim.leave] workshop ${config.workshopId} left the network`,
  };
}

interface SwimMembersResult {
  members: SwimMember[];
  total: number;
  alive: number;
  suspect: number;
  dead: number;
  diagnostics?: string[];
}

export async function runSwimMembers(
  _input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<SwimMembersResult>> {
  const { workspaceRoot } = context;

  let _config: SwimConfig;
  try {
    _config = await loadSwimConfig(workspaceRoot);
  } catch {
    return {
      data: {
        members: [],
        total: 0,
        alive: 0,
        suspect: 0,
        dead: 0,
        diagnostics: [`swim.members: no ${CONFIG_FILENAME} found — run swim.join first`],
      },
      exitCode: 1,
      summary: `[swim.members] no ${CONFIG_FILENAME} found`,
      nextSteps: [
        {
          action: "Run swim.join first to configure SWIM, then re-run swim.members",
          kind: "required",
        },
      ],
    };
  }

  let publicKey: string | undefined;
  try {
    const identity = await loadIdentityConfig(workspaceRoot);
    publicKey = identity.operatorKeyPair.publicKeyMultibase;
  } catch {
    // Read without signature verification if identity is not available
  }

  const { entries } = await readGenomeLog(workspaceRoot, publicKey);
  const view = deriveMembershipView(entries);

  return {
    data: {
      members: view.members,
      total: view.total,
      alive: view.alive,
      suspect: view.suspect,
      dead: view.dead,
    },
    exitCode: 0,
    summary: `[swim.members] ${view.total} members (${view.alive} alive, ${view.suspect} suspect, ${view.dead} dead)`,
  };
}

export async function runSwimStatus(
  _input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<SwimStatusResult>> {
  const { workspaceRoot } = context;

  let config: SwimConfig | null = null;
  try {
    config = await loadSwimConfig(workspaceRoot);
  } catch {
    // Config not yet created
  }

  const genomeLogSize = await getGenomeLogSize(workspaceRoot);
  const sizeWarning = isGenomeLogSizeWarning(genomeLogSize);

  let publicKey: string | undefined;
  try {
    const identity = await loadIdentityConfig(workspaceRoot);
    publicKey = identity.operatorKeyPair.publicKeyMultibase;
  } catch {
    // Identity not bootstrapped
  }

  const { entries, skipped } = await readGenomeLog(workspaceRoot, publicKey);
  const view = deriveMembershipView(entries);

  const diagnostics: string[] = [];
  if (sizeWarning) {
    diagnostics.push(
      `swim.status: genome log exceeds 10MB (${Math.round(genomeLogSize / 1024 / 1024)}MB) — consider compaction`,
    );
  }
  if (skipped > 0) {
    diagnostics.push(`swim.status: ${skipped} genome log entries skipped (invalid signatures)`);
  }
  if (config && view.alive === 0) {
    diagnostics.push("swim.status: no alive members in genome log — network may be empty");
  }

  return {
    data: {
      configured: config !== null,
      workshopId: config?.workshopId ?? null,
      bindAddr: config?.bindAddr ?? null,
      genomeLogSize,
      genomeLogSizeWarning: sizeWarning,
      members: view,
      diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
    },
    exitCode: 0,
    summary: config
      ? `[swim.status] workshop ${config.workshopId}, ${view.total} members (${view.alive} alive), genome log ${Math.round(genomeLogSize / 1024)}KB`
      : `[swim.status] not configured — run swim.join --seed <addr> first`,
  };
}
