/*
<MODULE_CONTRACT>
<purpose>
Unit tests for r2 client env prefix covering resolveR2ConfigFromEnv — envPrefix (RFC-0713).
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1311: Compass header sweep — declares the r2 suite's contract for test-file scaffold coverage.</item>
</CHANGE_SUMMARY>
*/

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resolveR2ConfigFromEnv, MissingEnvError } from "../evidence/r2-client.ts";

const ALL_R2_VARS = [
  "R2_AXIOM_ACCOUNT_ID",
  "R2_AXIOM_ACCESS_KEY_ID",
  "R2_AXIOM_SECRET_ACCESS_KEY",
  "R2_NACHWEIS_ACCOUNT_ID",
  "R2_NACHWEIS_ACCESS_KEY_ID",
  "R2_NACHWEIS_SECRET_ACCESS_KEY",
];

describe("resolveR2ConfigFromEnv — envPrefix (RFC-0713)", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ALL_R2_VARS) {
      savedEnv[key] = process.env[key];
      vi.stubEnv(key, "");
    }
  });

  afterEach(() => {
    for (const key of ALL_R2_VARS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  it("reads R2_NACHWEIS_* vars when envPrefix is provided", () => {
    vi.stubEnv("R2_NACHWEIS_ACCOUNT_ID", "nachweis-account");
    vi.stubEnv("R2_NACHWEIS_ACCESS_KEY_ID", "nachweis-key");
    vi.stubEnv("R2_NACHWEIS_SECRET_ACCESS_KEY", "nachweis-secret");

    const config = resolveR2ConfigFromEnv("nachweis", "R2_NACHWEIS");

    expect(config).toEqual({
      accountId: "nachweis-account",
      accessKeyId: "nachweis-key",
      secretAccessKey: "nachweis-secret",
      bucketName: "nachweis",
    });
  });

  it("throws MissingEnvError with prefixed var name when R2_NACHWEIS_* vars absent", () => {
    try {
      resolveR2ConfigFromEnv("nachweis", "R2_NACHWEIS");
      expect.fail("should have thrown MissingEnvError");
    } catch (err) {
      expect(err).toBeInstanceOf(MissingEnvError);
      expect((err as MissingEnvError).missingVar).toBe("R2_NACHWEIS_ACCOUNT_ID");
      expect((err as MissingEnvError).diagnostic).toBe("MISSING_ENV");
    }
  });

  it("reads R2_AXIOM_* vars by default (no envPrefix passed)", () => {
    vi.stubEnv("R2_AXIOM_ACCOUNT_ID", "evidence-account");
    vi.stubEnv("R2_AXIOM_ACCESS_KEY_ID", "evidence-key");
    vi.stubEnv("R2_AXIOM_SECRET_ACCESS_KEY", "evidence-secret");

    const config = resolveR2ConfigFromEnv("axiom-evidence");

    expect(config).toEqual({
      accountId: "evidence-account",
      accessKeyId: "evidence-key",
      secretAccessKey: "evidence-secret",
      bucketName: "axiom-evidence",
    });
  });

  it("throws MissingEnvError with R2_AXIOM_ var name when R2_AXIOM_* vars absent", () => {
    try {
      resolveR2ConfigFromEnv("axiom-evidence");
      expect.fail("should have thrown MissingEnvError");
    } catch (err) {
      expect(err).toBeInstanceOf(MissingEnvError);
      expect((err as MissingEnvError).missingVar).toBe("R2_AXIOM_ACCOUNT_ID");
      expect((err as MissingEnvError).diagnostic).toBe("MISSING_ENV");
    }
  });
});
