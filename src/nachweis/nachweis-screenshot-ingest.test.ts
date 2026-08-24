/*
<MODULE_CONTRACT>
<purpose>Unit tests for RFC-0890 — parseCaptureXFilename, path resolvers, and schema validation for raw screenshot ingestion.</purpose>
<non-goals>
  <item>Does not test full command handler — requires R2, sharp, bordbuch, and lock mocking.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0890: established unit test coverage for parseCaptureXFilename and path resolvers.</item>
</CHANGE_SUMMARY>
*/

import { describe, it, expect } from "vitest";
import {
  parseCaptureXFilename,
  resolveNachweisRawScreenshotR2Path,
  resolveNachweisRawScreenshotLocalPath,
} from "./nachweis-io.ts";
import path from "node:path";

describe("RFC-0890: parseCaptureXFilename", () => {
  it("parses CaptureX filename with domain and extension", () => {
    const result = parseCaptureXFilename("CaptureX_2026-08-20_134440_example.com.png");
    expect(result).toEqual({ capturedAt: "2026-08-20T13:44:40Z" });
  });

  it("parses CaptureX filename with multi-part domain", () => {
    const result = parseCaptureXFilename("CaptureX_2026-08-20_134440_www.example.co.uk.png");
    expect(result).toEqual({ capturedAt: "2026-08-20T13:44:40Z" });
  });

  it("parses CaptureX filename with webp extension", () => {
    const result = parseCaptureXFilename("CaptureX_2026-08-20_090000_my-domain.webp");
    expect(result).toEqual({ capturedAt: "2026-08-20T09:00:00Z" });
  });

  it("returns null for non-matching filename", () => {
    expect(parseCaptureXFilename("manual-screenshot.png")).toBeNull();
  });

  it("returns null for filename without CaptureX prefix", () => {
    expect(parseCaptureXFilename("2026-08-20_134440_example.com.png")).toBeNull();
  });

  it("returns null for filename with wrong date format", () => {
    expect(parseCaptureXFilename("CaptureX_2026-8-20_134440_example.com.png")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseCaptureXFilename("")).toBeNull();
  });
});

describe("RFC-0890: resolveNachweisRawScreenshotR2Path", () => {
  it("builds R2 path with systemId, slug, and filename", () => {
    const result = resolveNachweisRawScreenshotR2Path(
      "warpgogol-com",
      "client-xyz",
      "CaptureX_2026-08-20_134440_example.com.png",
    );
    expect(result).toBe(
      "warpgogol-com/screenshots/client-xyz/raw/CaptureX_2026-08-20_134440_example.com.png",
    );
  });
});

describe("RFC-0890: resolveNachweisRawScreenshotLocalPath", () => {
  it("builds local path under trust/evidence/screenshots", () => {
    const cachePath = "/cache/warpgogol-com";
    const result = resolveNachweisRawScreenshotLocalPath(cachePath, "client-xyz", "screenshot.png");
    expect(result).toBe(
      path.join(
        cachePath,
        "trust",
        "evidence",
        "screenshots",
        "client-xyz",
        "raw",
        "screenshot.png",
      ),
    );
  });
});
