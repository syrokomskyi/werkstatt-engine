/*
<MODULE_CONTRACT>
  <purpose>
    RFC-0258 unit tests for writeFileAtomic, written before the workspace-shared
    writer migration per the RFC's own rollout order.
  </purpose>
  <responsibilities>
    <item>Content lands intact after a single write.</item>
    <item>A reader polling the target during many sequential writes never observes a partial file.</item>
    <item>The temp file is removed when the write ultimately fails.</item>
    <item>A simulated Windows EPERM on the first rename attempt is retried and succeeds.</item>
  </responsibilities>
  <non-goals>
    <item>Do not cover the workspace-write-boundary lint here — see workspace-write-boundary.test.ts in site-kernel-checks.</item>
  </non-goals>
</MODULE_CONTRACT>
*/

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { test, expect } from "vitest";
import { writeFileAtomic, __setRenameImplForTests } from "../fs-atomic.ts";

async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "fs-atomic-"));
}

test("writeFileAtomic: content lands intact", async () => {
  const dir = await makeTmpDir();
  try {
    const target = path.join(dir, "out.json");
    const content = JSON.stringify({ hello: "world", n: 42 }, null, 2);
    await writeFileAtomic(target, content);
    const read = await fs.readFile(target, "utf8");
    expect(read).toBe(content);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("writeFileAtomic: no leftover temp files after a successful write", async () => {
  const dir = await makeTmpDir();
  try {
    const target = path.join(dir, "out.json");
    await writeFileAtomic(target, "content");
    const entries = await fs.readdir(dir);
    expect(entries).toEqual(["out.json"]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("writeFileAtomic: a reader polling the target during 200 sequential writes never observes a partial file", async () => {
  const dir = await makeTmpDir();
  try {
    const target = path.join(dir, "shared.json");
    const totalWrites = 200;
    let stop = false;
    let observedPartial = false;
    let observedCount = 0;

    // Each write produces a distinct, fully-valid JSON payload of a known shape.
    function payloadFor(i: number): string {
      return JSON.stringify({ seq: i, marker: "X".repeat(32) }) + "\n";
    }

    const writer = (async () => {
      for (let i = 0; i < totalWrites; i++) {
        // A polling reader sharing the event loop can still collide with the
        // rename often enough to exceed the production default's 5-retry
        // budget on Windows. Widen the retry budget for this synthetic
        // worst-case poll loop only; the production default stays 5 (RFC-0258).
        await writeFileAtomic(target, payloadFor(i), { retries: 80 });
      }
      stop = true;
    })();

    const reader = (async () => {
      while (!stop) {
        let raw: string | undefined;
        try {
          raw = await fs.readFile(target, "utf8");
        } catch {
          // Target may not exist yet at the very start — not a partial-read failure.
          await new Promise((resolve) => setImmediate(resolve));
          continue;
        }
        observedCount += 1;
        try {
          const parsed = JSON.parse(raw) as { seq: number; marker: string };
          if (parsed.marker !== "X".repeat(32)) {
            observedPartial = true;
          }
        } catch {
          observedPartial = true;
        }
        // Yield once per read so this is a fast, realistic poller rather than
        // a worst-case tight spin that starves the writer's rename retries.
        await new Promise((resolve) => setImmediate(resolve));
      }
    })();

    await Promise.all([writer, reader]);

    expect(observedPartial).toBe(false);
    expect(observedCount > 0).toBeTruthy();
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("writeFileAtomic: temp file is removed when the write ultimately fails", async () => {
  const dir = await makeTmpDir();
  try {
    // Target directory does not exist -> the temp-file write itself fails,
    // and no temp file should remain in `dir`.
    const target = path.join(dir, "missing-subdir", "out.json");
    await expect(() => writeFileAtomic(target, "content")).rejects.toThrow();
    const entries = await fs.readdir(dir);
    expect(entries).toEqual([]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("writeFileAtomic: simulated EPERM on first rename attempt is retried and succeeds", async () => {
  const dir = await makeTmpDir();
  try {
    const target = path.join(dir, "out.json");
    let calls = 0;
    __setRenameImplForTests(async (...args: Parameters<typeof fs.rename>) => {
      calls += 1;
      if (calls === 1) {
        const error = new Error("simulated EPERM") as NodeJS.ErrnoException;
        error.code = "EPERM";
        throw error;
      }
      return fs.rename(...args);
    });

    await writeFileAtomic(target, "content", { retries: 5 });
    expect(calls >= 2).toBeTruthy();
    const read = await fs.readFile(target, "utf8");
    expect(read).toBe("content");
  } finally {
    __setRenameImplForTests(undefined);
    await fs.rm(dir, { recursive: true, force: true });
  }
});
