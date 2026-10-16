/*
<MODULE_CONTRACT>
<purpose>Unit tests for copyReleaseEvidence — RFC-1290: evidence/*.json copy from
the workpiece's .werkstatt/release-evidence/, plus the staged-dist htmlTreeHash
attestation that throws on stale corpora (DNA-106).</purpose>
<non-goals>
  <item>Do not test release.prepare orchestration — the wiring is exercised by e2e.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1290: initial suite.</item>
  <item>RFC-1290: rendered-text corpus + release text diff</item>
</CHANGE_SUMMARY>
*/

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDefaultIO } from "@warpgogol/werkstatt-engine/kernel";
import { computeHtmlTreeHash } from "@warpgogol/werkstatt-shared/text-corpus";
import { copyReleaseEvidence } from "./release-evidence.ts";

const HTML =
  '<!doctype html><html><head><title>T</title></head><body><p>x</p></body></html>';

function seedDist(stagingDir: string): string {
  const distClient = join(stagingDir, "dist", "client");
  mkdirSync(distClient, { recursive: true });
  writeFileSync(join(distClient, "index.html"), HTML);
  return distClient;
}

function corpusFor(distClient: string): string {
  const html = readFileSync(join(distClient, "index.html"), "utf8");
  return JSON.stringify(
    {
      schema: "werkstatt/text-corpus@1",
      systemId: "test-app",
      htmlTreeHash: computeHtmlTreeHash([{ relPath: "index.html", content: html }]),
      pages: [],
    },
    null,
    2,
  );
}

describe("copyReleaseEvidence — RFC-1290", () => {
  let dir: string;
  let workpiece: string;
  let staging: string;
  const io = createDefaultIO().io;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rfc1290-evidence-"));
    workpiece = join(dir, "workpiece");
    staging = join(dir, "staging");
    mkdirSync(workpiece, { recursive: true });
    mkdirSync(staging, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("is a no-op when the workpiece carries no release-evidence dir", async () => {
    await copyReleaseEvidence(workpiece, staging, io);
    expect(existsSync(join(staging, "evidence"))).toBe(false);
  });

  it("copies every .json into staging evidence/ and passes a fresh corpus", async () => {
    const distClient = seedDist(staging);
    const evSrc = join(workpiece, ".werkstatt", "release-evidence");
    mkdirSync(evSrc, { recursive: true });
    writeFileSync(join(evSrc, "text-corpus.json"), corpusFor(distClient));
    writeFileSync(join(evSrc, "other.json"), "{}");
    writeFileSync(join(evSrc, "note.txt"), "not copied");

    await copyReleaseEvidence(workpiece, staging, io);

    const evDest = join(staging, "evidence");
    expect(existsSync(join(evDest, "text-corpus.json"))).toBe(true);
    expect(existsSync(join(evDest, "other.json"))).toBe(true);
    expect(existsSync(join(evDest, "note.txt"))).toBe(false);
  });

  it("throws when the corpus hash does not match the staged dist", async () => {
    seedDist(staging);
    const evSrc = join(workpiece, ".werkstatt", "release-evidence");
    mkdirSync(evSrc, { recursive: true });
    // Corpus attests different bytes than the staged dist carries.
    writeFileSync(
      join(evSrc, "text-corpus.json"),
      JSON.stringify({
        schema: "werkstatt/text-corpus@1",
        systemId: "test-app",
        htmlTreeHash: computeHtmlTreeHash([{ relPath: "index.html", content: "different" }]),
        pages: [],
      }),
    );

    await expect(copyReleaseEvidence(workpiece, staging, io)).rejects.toThrow(
      "text corpus is stale for the staged dist",
    );
  });

  it("throws when the corpus fails the schema", async () => {
    seedDist(staging);
    const evSrc = join(workpiece, ".werkstatt", "release-evidence");
    mkdirSync(evSrc, { recursive: true });
    writeFileSync(join(evSrc, "text-corpus.json"), '{"schema":"wrong"}');

    await expect(copyReleaseEvidence(workpiece, staging, io)).rejects.toThrow(
      "fails schema",
    );
  });
});
