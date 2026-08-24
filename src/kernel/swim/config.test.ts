/*
<MODULE_CONTRACT>
<purpose>
RFC-0564: Unit tests for SWIM config loading, validation, and creation.
</purpose>
<non-goals>
  <item>Do not test genome log operations — those are in genome-log.test.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0564: initial implementation — config unit tests.</item>
</CHANGE_SUMMARY>
*/

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadSwimConfig,
  createSwimConfig,
  loadOrCreateSwimConfig,
  validateSwimConfig,
  validateConfig,
  CONFIG_FILENAME,
} from "./config.ts";
import type { SwimConfig } from "./types.ts";

describe("swim config", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "swim-config-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("createSwimConfig", () => {
    it("should create a valid config with seed and UUID v7 workshopId", async () => {
      const config = await createSwimConfig(tempDir, "10.0.0.1:7946");

      expect(config.workshopId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(config.bindAddr).toBe("0.0.0.0:7946");
      expect(config.seedNodes).toEqual(["10.0.0.1:7946"]);
      expect(config.probeIntervalMs).toBeGreaterThan(0);
      expect(config.probeTimeoutMs).toBeGreaterThan(0);
      expect(config.suspicionTimeoutMs).toBeGreaterThan(0);
      expect(config.indirectChecks).toBeGreaterThanOrEqual(0);

      const raw = await readFile(join(tempDir, CONFIG_FILENAME), "utf8");
      const parsed = JSON.parse(raw);
      expect(parsed.workshopId).toBe(config.workshopId);
    });
  });

  describe("loadSwimConfig", () => {
    it("should load a valid config", async () => {
      const config: SwimConfig = {
        workshopId: "0197a3b0-1234-7567-89ab-cdef01234567",
        bindAddr: "0.0.0.0:7946",
        seedNodes: ["10.0.0.1:7946"],
        probeIntervalMs: 5000,
        probeTimeoutMs: 500,
        suspicionTimeoutMs: 15000,
        indirectChecks: 3,
      };
      await writeFile(join(tempDir, CONFIG_FILENAME), JSON.stringify(config, null, 2), "utf8");

      const loaded = await loadSwimConfig(tempDir);
      expect(loaded.workshopId).toBe(config.workshopId);
      expect(loaded.bindAddr).toBe(config.bindAddr);
    });

    it("should throw for missing file", async () => {
      await expect(loadSwimConfig(tempDir)).rejects.toThrow();
    });

    it("should throw for invalid config (missing required fields)", async () => {
      await writeFile(
        join(tempDir, CONFIG_FILENAME),
        JSON.stringify({ workshopId: "test" }),
        "utf8",
      );
      await expect(loadSwimConfig(tempDir)).rejects.toThrow();
    });
  });

  describe("validateConfig", () => {
    it("should validate a correct config", () => {
      const config: SwimConfig = {
        workshopId: "0197a3b0-1234-7567-89ab-cdef01234567",
        bindAddr: "0.0.0.0:7946",
        seedNodes: ["10.0.0.1:7946"],
        probeIntervalMs: 5000,
        probeTimeoutMs: 500,
        suspicionTimeoutMs: 15000,
        indirectChecks: 3,
      };
      expect(() => validateConfig(config)).not.toThrow();
    });

    it("should throw for non-object config", () => {
      expect(() => validateConfig(null)).toThrow("must be an object");
      expect(() => validateConfig("string")).toThrow("must be an object");
    });

    it("should throw for empty workshopId", () => {
      const config = {
        workshopId: "",
        bindAddr: "0.0.0.0:7946",
        seedNodes: [],
        probeIntervalMs: 5000,
        probeTimeoutMs: 500,
        suspicionTimeoutMs: 15000,
        indirectChecks: 3,
      };
      expect(() => validateConfig(config)).toThrow("workshopId");
    });

    it("should throw for non-array seedNodes", () => {
      const config = {
        workshopId: "test",
        bindAddr: "0.0.0.0:7946",
        seedNodes: "not-array",
        probeIntervalMs: 5000,
        probeTimeoutMs: 500,
        suspicionTimeoutMs: 15000,
        indirectChecks: 3,
      };
      expect(() => validateConfig(config)).toThrow("seedNodes");
    });
  });

  describe("loadOrCreateSwimConfig", () => {
    it("should load existing config", async () => {
      const config = await createSwimConfig(tempDir, "10.0.0.1:7946");
      const loaded = await loadOrCreateSwimConfig(tempDir, "10.0.0.2:7946");
      expect(loaded.workshopId).toBe(config.workshopId);
    });

    it("should create new config when missing and seed provided", async () => {
      const config = await loadOrCreateSwimConfig(tempDir, "10.0.0.1:7946");
      expect(config.workshopId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
      expect(config.seedNodes).toEqual(["10.0.0.1:7946"]);
    });

    it("should throw when missing and no seed provided", async () => {
      await expect(loadOrCreateSwimConfig(tempDir)).rejects.toThrow();
    });
  });

  describe("validateSwimConfig", () => {
    it("should return true for valid config", async () => {
      await createSwimConfig(tempDir, "10.0.0.1:7946");
      expect(await validateSwimConfig(tempDir)).toBe(true);
    });

    it("should return false for missing config", async () => {
      expect(await validateSwimConfig(tempDir)).toBe(false);
    });
  });
});
