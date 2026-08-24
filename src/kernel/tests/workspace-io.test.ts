import { test, expect } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDefaultIO,
  createRecordingIO,
  createReadOnlyIO,
  KernelMetaError,
} from "../workspace-io.ts";

/*
<MODULE_CONTRACT>
<purpose>
  RFC-0267: port + adapter tests, written before wiring into the executor.
  Recording adapter captures intents and never touches disk (fs spy via a
  real temp directory). Read-only adapter throws KERNEL-META-01 naming the
  command and path on any mutation. Default adapter writes atomically
  (delegates to writeFileAtomic, rfc-0258 — proven by "no partial content"
  and "no leftover temp file" after a successful write).
</purpose>
</MODULE_CONTRACT>
*/

test("createDefaultIO: writeFile creates the file with exact content, no leftover temp file", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspace-io-default-"));
  try {
    const { io } = createDefaultIO();
    const target = join(root, "nested", "file.txt");
    await io.writeFile(target, "hello world");

    const content = await readFile(target, "utf8");
    expect(content).toBe("hello world");

    const entries = await import("node:fs/promises").then((fs) => fs.readdir(join(root, "nested")));
    expect(entries).toEqual(["file.txt"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("createDefaultIO: exists/readFile/mkdir/rm round-trip", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspace-io-default2-"));
  try {
    const { io } = createDefaultIO();
    expect(await io.exists(join(root, "missing.txt"))).toBe(false);

    await io.mkdir(join(root, "dir"));
    expect(await io.exists(join(root, "dir"))).toBe(true);

    await io.writeFile(join(root, "dir", "a.txt"), "a");
    expect(await io.readFile(join(root, "dir", "a.txt"))).toBe("a");

    await io.rm(join(root, "dir"), { recursive: true });
    expect(await io.exists(join(root, "dir"))).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("createDefaultIO: readdir returns port-neutral DirEntry[] with isFile/isDirectory booleans", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspace-io-readdir-"));
  try {
    const { io } = createDefaultIO();
    await io.writeFile(join(root, "a.md"), "content");
    await io.mkdir(join(root, "subdir"));

    const entries = (await io.readdir(root)).sort((x, y) => x.name.localeCompare(y.name));
    expect(entries).toEqual([
      { name: "a.md", isFile: true, isDirectory: false },
      { name: "subdir", isFile: false, isDirectory: true },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("createReadOnlyIO and createRecordingIO: readdir passes through (a read, not a mutation)", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspace-io-readdir-passthrough-"));
  try {
    const { io: base } = createDefaultIO();
    await base.writeFile(join(root, "x.txt"), "x");

    const readOnly = createReadOnlyIO(base, "fixture.readonly.command");
    expect((await readOnly.readdir(root))[0]?.name).toBe("x.txt");

    const { io: recording } = createRecordingIO(base);
    expect((await recording.readdir(root))[0]?.name).toBe("x.txt");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("createRecordingIO: captures write/mkdir/rm intents and never touches disk", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspace-io-recording-"));
  try {
    const { io: base } = createDefaultIO();
    const { io, intents } = createRecordingIO(base);

    const target = join(root, "would-write.txt");
    await io.writeFile(target, "some content");
    await io.mkdir(join(root, "would-mkdir"));
    await io.rm(join(root, "would-rm"));

    expect(intents.length).toBe(3);
    expect(intents.map((i) => i.kind)).toEqual(["write", "mkdir", "rm"]);
    expect(intents[0]?.path).toBe(target);
    expect(intents[0]?.bytes).toBe(Buffer.byteLength("some content", "utf8"));

    // Nothing was actually written.
    await expect(() => stat(target)).rejects.toThrow();
    const rootEntries = await import("node:fs/promises").then((fs) => fs.readdir(root));
    expect(rootEntries).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("createRecordingIO: reads pass through to the base adapter", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspace-io-recording-reads-"));
  try {
    const { io: base } = createDefaultIO();
    await base.writeFile(join(root, "existing.txt"), "real content");

    const { io } = createRecordingIO(base);
    expect(await io.exists(join(root, "existing.txt"))).toBe(true);
    expect(await io.readFile(join(root, "existing.txt"))).toBe("real content");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("createReadOnlyIO: throws KERNEL-META-01 naming the command and path on writeFile", async () => {
  const io = createReadOnlyIO(createDefaultIO().io, "fixture.readonly.command");
  try {
    await io.writeFile("/tmp/should-not-write.txt", "x");
    expect.fail("should have thrown");
  } catch (error) {
    expect(error).toBeInstanceOf(KernelMetaError);
    expect((error as Error).message).toMatch(/KERNEL-META-01/);
    expect((error as Error).message).toMatch(/fixture\.readonly\.command/);
    expect((error as Error).message).toMatch(/should-not-write\.txt/);
  }
});

test("createReadOnlyIO: throws on mkdir, rm, and exec too", async () => {
  const io = createReadOnlyIO(createDefaultIO().io, "fixture.readonly.command");
  await expect(() => io.mkdir("/tmp/nope")).rejects.toThrow(KernelMetaError);
  await expect(() => io.rm("/tmp/nope")).rejects.toThrow(KernelMetaError);
  await expect(() => io.exec("rm", ["-rf", "/tmp/nope"])).rejects.toThrow(KernelMetaError);
});

test("createReadOnlyIO: reads still work", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspace-io-readonly-reads-"));
  try {
    const { io: base } = createDefaultIO();
    await base.writeFile(join(root, "readable.txt"), "readable content");

    const io = createReadOnlyIO(base, "fixture.readonly.command");
    expect(await io.exists(join(root, "readable.txt"))).toBe(true);
    expect(await io.readFile(join(root, "readable.txt"))).toBe("readable content");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// RFC-0326: createDefaultIO now returns { io, intents } — the intents array
// captures every mutation (write/mkdir/rm) for filesModified reporting.
test("createDefaultIO: captures write/mkdir/rm intents while writing to real disk (RFC-0326)", async () => {
  const root = await mkdtemp(join(tmpdir(), "workspace-io-default-intents-"));
  try {
    const { io, intents } = createDefaultIO();

    await io.writeFile(join(root, "file.txt"), "content");
    await io.mkdir(join(root, "subdir"));
    await io.rm(join(root, "subdir"), { recursive: true });

    expect(intents.length).toBe(3);
    expect(intents.map((i) => i.kind)).toEqual(["write", "mkdir", "rm"]);
    expect(intents[0]?.bytes).toBe(Buffer.byteLength("content", "utf8"));

    // File was actually written to disk (this is the real adapter, not recording).
    expect(await io.readFile(join(root, "file.txt"))).toBe("content");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
