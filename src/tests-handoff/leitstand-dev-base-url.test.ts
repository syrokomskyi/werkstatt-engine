import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { resolveDevBaseUrl } from "../leitstand/certify.ts";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dev-base-url-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function writeOpRecord(
  cacheCloneDir: string,
  name: string,
  record: Record<string, unknown>,
): Promise<void> {
  const dir = path.join(cacheCloneDir, "deployment-operations");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${name}.json`), JSON.stringify(record));
}

describe("resolveDevBaseUrl", () => {
  it("returns undefined when no deployment-operations records exist", async () => {
    expect(await resolveDevBaseUrl(tmpDir, undefined)).toBeUndefined();
  });

  it("ignores failed deploy records — failed deploys never made the URL live", async () => {
    // Regression: a failed dev-deploy writes a record carrying deploymentUrl.
    // If the resolver trusted it, the next certify-dev would crawl a hostname
    // that was never deployed (ENOTFOUND) — a permanent first-deploy deadlock.
    await writeOpRecord(tmpDir, "op-a", {
      channel: "dev",
      state: "failed",
      timestamp: "2026-10-01T13:57:28.479Z",
      deploymentUrl: "https://dev.example.com",
    });
    expect(await resolveDevBaseUrl(tmpDir, undefined)).toBeUndefined();
  });

  it("prefers the latest succeeded dev record over older failed ones", async () => {
    await writeOpRecord(tmpDir, "op-fail", {
      channel: "dev",
      state: "failed",
      timestamp: "2026-10-01T14:15:00.000Z",
      deploymentUrl: "https://dev.example.com",
    });
    await writeOpRecord(tmpDir, "op-ok", {
      channel: "dev",
      state: "succeeded",
      timestamp: "2026-10-01T13:00:00.000Z",
      deploymentUrl: "https://dev-live.example.com",
    });
    expect(await resolveDevBaseUrl(tmpDir, undefined)).toBe("https://dev-live.example.com");
  });

  it("ignores non-dev channels", async () => {
    await writeOpRecord(tmpDir, "op-alt", {
      channel: "alt",
      state: "succeeded",
      timestamp: "2026-10-01T13:00:00.000Z",
      deploymentUrl: "https://alt.example.com",
    });
    expect(await resolveDevBaseUrl(tmpDir, undefined)).toBeUndefined();
  });

  it("falls back to the --base-url flag when no succeeded dev record exists", async () => {
    await writeOpRecord(tmpDir, "op-fail", {
      channel: "dev",
      state: "failed",
      timestamp: "2026-10-01T14:15:00.000Z",
      deploymentUrl: "https://dev.example.com",
    });
    expect(await resolveDevBaseUrl(tmpDir, "https://preview.example.com")).toBe(
      "https://preview.example.com",
    );
  });
});
