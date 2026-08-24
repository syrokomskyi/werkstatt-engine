/*
<MODULE_CONTRACT>
<purpose>
RFC-0564: Unit tests for the CRDT genome log — append/read round-trip,
signature verification, G-Set merge, and membership view derivation.
</purpose>
</non-goals>
  <item>Do not test command handlers — those are integration tests.</item>
  <item>Do not test config loading — those are in config.test.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0564: initial implementation — genome log unit tests.</item>
</CHANGE_SUMMARY>
*/

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendGenomeEntry,
  readGenomeLog,
  mergeGenomeLogs,
  deriveMembershipView,
  signGenomeEntry,
  verifyGenomeEntry,
  getGenomeLogSize,
  isGenomeLogSizeWarning,
  GENOME_LOG_FILENAME,
} from "./genome-log.ts";
import type { GenomeLogEntry } from "./types.ts";

describe("genome-log", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "swim-genome-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("appendGenomeEntry + readGenomeLog", () => {
    it("should append and read entries round-trip", async () => {
      const entry: GenomeLogEntry = {
        workshopId: "ws-1",
        event: "alive",
        timestamp: "2026-07-27T10:00:00Z",
        source: "ws-1",
        signature: "fake-sig",
      };

      await appendGenomeEntry(tempDir, entry);
      const { entries, skipped } = await readGenomeLog(tempDir);

      expect(entries).toHaveLength(1);
      expect(entries[0].workshopId).toBe("ws-1");
      expect(entries[0].event).toBe("alive");
      expect(skipped).toBe(0);
    });

    it("should handle empty log file", async () => {
      const { entries, skipped } = await readGenomeLog(tempDir);
      expect(entries).toHaveLength(0);
      expect(skipped).toBe(0);
    });

    it("should skip invalid JSON lines", async () => {
      const logPath = join(tempDir, GENOME_LOG_FILENAME);
      await writeFile(logPath, "not json\n{bad}\n", "utf8");

      const { entries, skipped } = await readGenomeLog(tempDir);
      expect(entries).toHaveLength(0);
      expect(skipped).toBe(2);
    });
  });

  describe("mergeGenomeLogs", () => {
    it("should union two logs with overlapping entries (deduplication)", () => {
      const entry1: GenomeLogEntry = {
        workshopId: "ws-1",
        event: "alive",
        timestamp: "2026-07-27T10:00:00Z",
        source: "ws-1",
        signature: "sig-1",
      };
      const entry2: GenomeLogEntry = {
        workshopId: "ws-2",
        event: "alive",
        timestamp: "2026-07-27T10:01:00Z",
        source: "ws-2",
        signature: "sig-2",
      };
      const entry3: GenomeLogEntry = {
        workshopId: "ws-3",
        event: "alive",
        timestamp: "2026-07-27T10:02:00Z",
        source: "ws-3",
        signature: "sig-3",
      };

      const local = [entry1, entry2];
      const peer = [entry2, entry3];
      const merged = mergeGenomeLogs(local, peer);

      expect(merged).toHaveLength(3);
      expect(merged.map((e) => e.workshopId).sort()).toEqual(["ws-1", "ws-2", "ws-3"]);
    });

    it("should handle empty logs", () => {
      expect(mergeGenomeLogs([], [])).toHaveLength(0);
      expect(
        mergeGenomeLogs(
          [],
          [
            {
              workshopId: "ws-1",
              event: "alive",
              timestamp: "2026-07-27T10:00:00Z",
              source: "ws-1",
              signature: "sig",
            },
          ],
        ),
      ).toHaveLength(1);
    });
  });

  describe("deriveMembershipView", () => {
    it("should derive membership with latest event per workshop", () => {
      const entries: GenomeLogEntry[] = [
        {
          workshopId: "ws-1",
          event: "alive",
          timestamp: "2026-07-27T10:00:00Z",
          source: "ws-1",
          signature: "s1",
        },
        {
          workshopId: "ws-1",
          event: "suspect",
          timestamp: "2026-07-27T11:00:00Z",
          source: "ws-2",
          signature: "s2",
        },
        {
          workshopId: "ws-2",
          event: "alive",
          timestamp: "2026-07-27T10:30:00Z",
          source: "ws-2",
          signature: "s3",
        },
      ];

      const view = deriveMembershipView(entries);

      expect(view.total).toBe(2);
      expect(view.alive).toBe(1);
      expect(view.suspect).toBe(1);
      expect(view.dead).toBe(0);

      const ws1 = view.members.find((m) => m.workshopId === "ws-1");
      expect(ws1?.status).toBe("suspect");
    });

    it("should handle empty log", () => {
      const view = deriveMembershipView([]);
      expect(view.total).toBe(0);
      expect(view.members).toHaveLength(0);
    });

    it("should count dead and left statuses", () => {
      const entries: GenomeLogEntry[] = [
        {
          workshopId: "ws-1",
          event: "dead",
          timestamp: "2026-07-27T10:00:00Z",
          source: "ws-2",
          signature: "s1",
        },
        {
          workshopId: "ws-2",
          event: "left",
          timestamp: "2026-07-27T10:01:00Z",
          source: "ws-2",
          signature: "s2",
        },
        {
          workshopId: "ws-3",
          event: "alive",
          timestamp: "2026-07-27T10:02:00Z",
          source: "ws-3",
          signature: "s3",
        },
      ];

      const view = deriveMembershipView(entries);
      expect(view.dead).toBe(1);
      expect(view.alive).toBe(1);
    });
  });

  describe("getGenomeLogSize", () => {
    it("should return 0 for missing file", async () => {
      const size = await getGenomeLogSize(tempDir);
      expect(size).toBe(0);
    });

    it("should return file size in bytes", async () => {
      await appendGenomeEntry(tempDir, {
        workshopId: "ws-1",
        event: "alive",
        timestamp: "2026-07-27T10:00:00Z",
        source: "ws-1",
        signature: "sig",
      });
      const size = await getGenomeLogSize(tempDir);
      expect(size).toBeGreaterThan(0);
    });
  });

  describe("isGenomeLogSizeWarning", () => {
    it("should return false for small sizes", () => {
      expect(isGenomeLogSizeWarning(1024)).toBe(false);
    });

    it("should return true for sizes over 10MB", () => {
      expect(isGenomeLogSizeWarning(11 * 1024 * 1024)).toBe(true);
    });
  });

  describe("signGenomeEntry + verifyGenomeEntry", () => {
    it("should sign and verify an entry with a real Ed25519 keypair", async () => {
      const { generateKeypair } = await import("@warpgogol/werkstatt-shared/passport/sign");
      const { privateKeyHex, publicKeyMultibase } = await generateKeypair();

      const entry = {
        workshopId: "ws-test",
        event: "alive" as const,
        timestamp: "2026-07-27T10:00:00Z",
        source: "ws-test",
      };

      const signed = await signGenomeEntry(entry, privateKeyHex);
      const valid = await verifyGenomeEntry(signed, publicKeyMultibase);
      expect(valid).toBe(true);
    });

    it("should fail verification with wrong public key", async () => {
      const { generateKeypair } = await import("@warpgogol/werkstatt-shared/passport/sign");
      const keypair1 = await generateKeypair();
      const keypair2 = await generateKeypair();

      const entry = {
        workshopId: "ws-test",
        event: "alive" as const,
        timestamp: "2026-07-27T10:00:00Z",
        source: "ws-test",
      };

      const signed = await signGenomeEntry(entry, keypair1.privateKeyHex);
      const valid = await verifyGenomeEntry(signed, keypair2.publicKeyMultibase);
      expect(valid).toBe(false);
    });
  });
});
