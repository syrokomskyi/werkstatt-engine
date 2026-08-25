/*
<MODULE_CONTRACT>
  <purpose>RFC-0583: unit tests for bordbuch.repair — orphan-mission-close detection, insertion, hash recompute, dry-run, idempotency, unrepairable rejection.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0583: initial bordbuch.repair unit tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import type { BordbuchEntry } from "@warpgogol/werkstatt-engine/schemas";
import { computeEntryHash } from "./bordbuch-io.ts";
import { runBordbuchRepair } from "./bordbuch-repair.ts";

let tmpDir: string;
const systemId = "test-system";

function mockContext(workspaceRoot: string): KernelRuntimeContext {
  return {
    workspaceRoot,
    logger: {
      info: () => {},
      success: () => {},
      error: () => {},
      warn: () => {},
      event: () => {},
      getEvents: () => [],
    },
  } as unknown as KernelRuntimeContext;
}

function makeInput(flags: Record<string, unknown>): KernelCommandInput {
  return {
    commandName: "bordbuch.repair",
    flags,
  } as unknown as KernelCommandInput;
}

function makeEntry(
  overrides: Partial<BordbuchEntry> &
    Pick<BordbuchEntry, "id" | "kind" | "missionId" | "occurredAt" | "summary">,
  prevHash: string | null,
): BordbuchEntry {
  const base: Omit<BordbuchEntry, "hash"> = {
    schemaVersion: "1.0.0",
    id: overrides.id,
    systemId,
    occurredAt: overrides.occurredAt,
    kind: overrides.kind,
    status: "done",
    missionId: overrides.missionId,
    releaseId: null,
    actor: "agent",
    summary: overrides.summary,
    previousHash: prevHash,
    metadata: overrides.metadata,
  };
  const hash = computeEntryHash(base);
  return { ...base, hash };
}

function buildValidBordbuchWithOrphan(): BordbuchEntry[] {
  const e1 = makeEntry(
    {
      id: "event-000001",
      kind: "mission-open",
      missionId: "m001",
      occurredAt: "2026-07-28T10:00:00.000Z",
      summary: "Mission m001 opened",
    },
    null,
  );
  const e2 = makeEntry(
    {
      id: "event-000002",
      kind: "mission-close",
      missionId: "m001",
      occurredAt: "2026-07-28T11:00:00.000Z",
      summary: "Mission m001 closed",
    },
    e1.hash,
  );
  const e3 = makeEntry(
    {
      id: "event-000003",
      kind: "mission-close",
      missionId: "m002",
      occurredAt: "2026-07-28T12:00:00.000Z",
      summary: "Mission m002 closed (orphan)",
    },
    e2.hash,
  );
  return [e1, e2, e3];
}

function buildValidBordbuch(): BordbuchEntry[] {
  const e1 = makeEntry(
    {
      id: "event-000001",
      kind: "mission-open",
      missionId: "m001",
      occurredAt: "2026-07-28T10:00:00.000Z",
      summary: "Mission m001 opened",
    },
    null,
  );
  const e2 = makeEntry(
    {
      id: "event-000002",
      kind: "mission-close",
      missionId: "m001",
      occurredAt: "2026-07-28T11:00:00.000Z",
      summary: "Mission m001 closed",
    },
    e1.hash,
  );
  return [e1, e2];
}

async function writeBordbuch(entries: BordbuchEntry[]): Promise<void> {
  const cacheDir = path.join(tmpDir, "..", "systems-cache", systemId);
  const bordbuchDir = path.join(cacheDir, "bordbuch");
  if (!existsSync(bordbuchDir)) mkdirSync(bordbuchDir, { recursive: true });
  const ndjson = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  await fs.writeFile(path.join(bordbuchDir, "events.ndjson"), ndjson, "utf8");
}

async function readBordbuchFile(): Promise<BordbuchEntry[]> {
  const filePath = path.join(tmpDir, "..", "systems-cache", systemId, "bordbuch", "events.ndjson");
  const raw = await fs.readFile(filePath, "utf8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  return lines.map((l) => JSON.parse(l) as BordbuchEntry);
}

let testRoot: string;

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bordbuch-repair-test-"));
  tmpDir = path.join(testRoot, "workspace");
  await fs.mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(testRoot, { recursive: true, force: true });
});

test("repairs orphan-mission-close by inserting mission-open and recomputing hashes", async () => {
  const entries = buildValidBordbuchWithOrphan();
  await writeBordbuch(entries);

  const result = await runBordbuchRepair(makeInput({ system: systemId }), mockContext(tmpDir));

  expect(result.data!.insertedEvents).toBe(1);
  expect(result.data!.recomputedHashes).toBe(4);
  expect(result.data!.dryRun).toBe(false);

  const repaired = await readBordbuchFile();
  expect(repaired).toHaveLength(4);

  expect(repaired[0].kind).toBe("mission-open");
  expect(repaired[0].missionId).toBe("m001");
  expect(repaired[0].id).toBe("event-000001");

  expect(repaired[1].kind).toBe("mission-close");
  expect(repaired[1].missionId).toBe("m001");
  expect(repaired[1].id).toBe("event-000002");

  expect(repaired[2].kind).toBe("mission-open");
  expect(repaired[2].missionId).toBe("m002");
  expect(repaired[2].summary).toBe("Mission opened (auto-repaired)");
  expect(repaired[2].id).toBe("event-000003");

  expect(repaired[3].kind).toBe("mission-close");
  expect(repaired[3].missionId).toBe("m002");
  expect(repaired[3].id).toBe("event-000004");

  for (let i = 0; i < repaired.length; i++) {
    expect(repaired[i].id).toBe(`event-${String(i + 1).padStart(6, "0")}`);
    if (i === 0) {
      expect(repaired[i].previousHash).toBeNull();
    } else {
      expect(repaired[i].previousHash).toBe(repaired[i - 1].hash);
    }
  }
});

test("dry-run shows planned repairs without writing", async () => {
  const entries = buildValidBordbuchWithOrphan();
  await writeBordbuch(entries);
  const originalContent = await fs.readFile(
    path.join(tmpDir, "..", "systems-cache", systemId, "bordbuch", "events.ndjson"),
    "utf8",
  );

  const result = await runBordbuchRepair(
    makeInput({ system: systemId, "dry-run": true }),
    mockContext(tmpDir),
  );

  expect(result.data!.dryRun).toBe(true);
  expect(result.data!.insertedEvents).toBe(0);
  expect(result.data!.orphans).toBeDefined();
  expect(result.data!.orphans).toHaveLength(1);
  expect(result.data!.orphans![0].missionId).toBe("m002");
  expect(result.data!.orphans![0].metadataSource).toBe("auto-derived");

  const contentAfter = await fs.readFile(
    path.join(tmpDir, "..", "systems-cache", systemId, "bordbuch", "events.ndjson"),
    "utf8",
  );
  expect(contentAfter).toBe(originalContent);
});

test("is idempotent — no-op on already-valid bordbuch", async () => {
  const entries = buildValidBordbuch();
  await writeBordbuch(entries);

  const result = await runBordbuchRepair(makeInput({ system: systemId }), mockContext(tmpDir));

  expect(result.data!.insertedEvents).toBe(0);
  expect(result.data!.recomputedHashes).toBe(0);
  expect(result.summary).toContain("no repairs needed");
});

test("rejects unrepairable violations", async () => {
  const entries = buildValidBordbuch();
  const tampered = [...entries];
  tampered[1] = { ...tampered[1], summary: "tampered summary", hash: "sha256:fake" };
  await writeBordbuch(tampered);

  await expect(
    runBordbuchRepair(makeInput({ system: systemId }), mockContext(tmpDir)),
  ).rejects.toThrow(/unrepairable violations found/);
});

test("--metadata overrides auto-derived metadata", async () => {
  const entries = buildValidBordbuchWithOrphan();
  await writeBordbuch(entries);

  const customMetadata = JSON.stringify({
    occurredAt: "2026-07-28T09:30:00.000Z",
    summary: "Custom repaired open",
    actor: "operator",
  });

  const result = await runBordbuchRepair(
    makeInput({ system: systemId, metadata: customMetadata }),
    mockContext(tmpDir),
  );

  expect(result.data!.insertedEvents).toBe(1);

  const repaired = await readBordbuchFile();
  const openEntry = repaired.find((e) => e.kind === "mission-open" && e.missionId === "m002");
  expect(openEntry).toBeDefined();
  expect(openEntry!.summary).toBe("Custom repaired open");
  expect(openEntry!.actor).toBe("operator");
  expect(openEntry!.occurredAt).toBe("2026-07-28T09:30:00.000Z");
});

test("--mission filters to only the specified mission; remaining orphans cause failure", async () => {
  const e1 = makeEntry(
    {
      id: "event-000001",
      kind: "mission-close",
      missionId: "m001",
      occurredAt: "2026-07-28T10:00:00.000Z",
      summary: "Orphan close m001",
    },
    null,
  );
  const e2 = makeEntry(
    {
      id: "event-000002",
      kind: "mission-close",
      missionId: "m002",
      occurredAt: "2026-07-28T11:00:00.000Z",
      summary: "Orphan close m002",
    },
    e1.hash,
  );
  await writeBordbuch([e1, e2]);

  await expect(
    runBordbuchRepair(makeInput({ system: systemId, mission: "m001" }), mockContext(tmpDir)),
  ).rejects.toThrow(/repaired bordbuch still invalid.*m002/);
});

test("auto-commits repaired bordbuch when cache clone is a git repo", async () => {
  const entries = buildValidBordbuchWithOrphan();
  await writeBordbuch(entries);

  // Initialize a git repo in the cache clone directory
  const cacheDir = path.join(tmpDir, "..", "systems-cache", systemId);
  execSync("git init", { cwd: cacheDir });
  execSync("git config user.email test@test.com", { cwd: cacheDir });
  execSync("git config user.name Test", { cwd: cacheDir });
  execSync("git add -A", { cwd: cacheDir });
  execSync('git commit -m "initial"', { cwd: cacheDir });
  execSync("git branch -M main", { cwd: cacheDir });

  // Set up a bare repo as origin to allow push
  const bareRepoDir = path.join(tmpDir, "..", "systems-git");
  const bareRepo = path.join(bareRepoDir, systemId);
  mkdirSync(bareRepo, { recursive: true });
  execSync("git init --bare", { cwd: bareRepo });
  execSync(`git remote add origin ${bareRepo}`, { cwd: cacheDir });
  execSync("git push -u origin main", { cwd: cacheDir });

  const result = await runBordbuchRepair(makeInput({ system: systemId }), mockContext(tmpDir));

  expect(result.data!.insertedEvents).toBe(1);

  // Verify the repair was committed
  const logOutput = execSync("git log --oneline -1", { cwd: cacheDir }).toString().trim();
  expect(logOutput).toContain("bordbuch.repair");

  // Verify working tree is clean (no unstaged changes)
  const status = execSync("git status --porcelain", { cwd: cacheDir }).toString().trim();
  expect(status).toBe("");
});

test("throws on auto-commit failure to prevent dirty cache clone", async () => {
  const entries = buildValidBordbuchWithOrphan();
  await writeBordbuch(entries);

  // Initialize a git repo with a pre-commit hook that always fails
  const cacheDir = path.join(tmpDir, "..", "systems-cache", systemId);
  execSync("git init", { cwd: cacheDir });
  execSync("git config user.email test@test.com", { cwd: cacheDir });
  execSync("git config user.name Test", { cwd: cacheDir });
  execSync("git add -A", { cwd: cacheDir });
  execSync('git commit -m "initial"', { cwd: cacheDir });
  execSync("git branch -M main", { cwd: cacheDir });

  // Install a pre-commit hook that rejects all commits
  const hookPath = path.join(cacheDir, ".git", "hooks", "pre-commit");
  await fs.writeFile(hookPath, "#!/bin/sh\necho 'reject' >&2\nexit 1\n");
  await fs.chmod(hookPath, 0o755);

  await expect(
    runBordbuchRepair(makeInput({ system: systemId }), mockContext(tmpDir)),
  ).rejects.toThrow(/commit failed/);
});

test("repairs unmatched-mission-open by appending mission-close", async () => {
  // Build a bordbuch with a mission-open but no matching close
  const e1 = makeEntry(
    {
      id: "event-000001",
      kind: "mission-open",
      missionId: "m003",
      occurredAt: "2026-07-28T10:00:00.000Z",
      summary: "Mission m003 opened",
    },
    null,
  );
  await writeBordbuch([e1]);

  const result = await runBordbuchRepair(makeInput({ system: systemId }), mockContext(tmpDir));

  expect(result.data!.insertedEvents).toBe(1);

  const repaired = await readBordbuchFile();
  // Should now have 2 entries: the original open + appended close
  expect(repaired.length).toBe(2);
  const closeEntry = repaired.find((e) => e.kind === "mission-close" && e.missionId === "m003");
  expect(closeEntry).toBeDefined();
  expect(closeEntry!.metadata).toEqual({ autoRepaired: true });

  // Verify hash chain is valid
  expect(repaired[1].previousHash).toBe(repaired[0].hash);
  expect(repaired[1].id).toBe("event-000002");
});
