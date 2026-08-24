/*
<MODULE_CONTRACT>
<purpose>
RFC-0267: the WorkspaceIO port — the single seam through which kernel commands
touch the filesystem and spawn processes. `KernelRuntimeContext.io` carries an
adapter chosen by the executor: the default fs-backed adapter, a recording
adapter (universal `--dry-run`: intercepts writes/deletes, records intents,
touches nothing), or a read-only adapter (used for `mutatesState: false`
commands; throws KERNEL-META-01 on any attempted mutation). Adoption is
ratcheted — ambient `node:fs` imports keep working in unmigrated modules;
`kernel.io.lint` (IO-01) only gates new/migrated modules.

RFC-0326: `createDefaultIO` now returns `{ io, intents }` — the io writes to
real disk AND records every mutation as a `WriteIntent` for execution-report
surfacing (`filesModified`). This unifies the dry-run and real-run paths: both
capture intents, just from different adapters.
</purpose>
<non-goals>
  <item>Do not abstract network access — filesystem and process execution only.</item>
  <item>Do not enforce IO at the module-import level — that is kernel.io.lint's static check.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0267: initial implementation.</item>
  <item>RFC-0267 follow-up: add readdir(path): Promise&lt;DirEntry[]&gt; to complete the port so directory-listing commands (e.g. sitemap.generate) migrate mechanically without importing node:fs for Dirent.</item>
  <item>RFC-0326: createDefaultIO returns { io, intents } — writes touch real disk AND record WriteIntent[] for filesModified reporting.</item>
</CHANGE_SUMMARY>
*/

import {
  readFile as fsReadFile,
  mkdir as fsMkdir,
  rm as fsRm,
  readdir as fsReaddir,
  stat,
} from "node:fs/promises";
import { glob as fsGlob } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { writeFileAtomic } from "./fs-atomic.ts";

export interface ExecOptions {
  cwd?: string;
  timeoutMs?: number;
}

export interface ExecResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/**
 * A directory entry in a port-neutral shape — no `node:fs` `Dirent` leaks
 * through the port, so command modules never need to import `node:fs` just to
 * type a listing. `isFile`/`isDirectory` are plain booleans (not methods).
 */
export interface DirEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
}

export interface WorkspaceIO {
  readFile(path: string): Promise<string>;
  readFileBytes(path: string): Promise<Uint8Array>;
  exists(path: string): Promise<boolean>;
  glob(pattern: string, opts?: { cwd?: string }): Promise<string[]>;
  /** List a directory's immediate entries. Read-only; throws if the path is not a directory. */
  readdir(path: string): Promise<DirEntry[]>;
  /** Atomic by contract (rfc-0258). */
  writeFile(path: string, content: string | Uint8Array): Promise<void>;
  mkdir(path: string): Promise<void>;
  rm(path: string, opts?: { recursive?: boolean }): Promise<void>;
  exec(command: string, args: string[], opts?: ExecOptions): Promise<ExecResult>;
}

async function execImpl(command: string, args: string[], opts?: ExecOptions): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: opts?.cwd });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    const timer = opts?.timeoutMs
      ? setTimeout(() => {
          child.kill();
        }, opts.timeoutMs)
      : undefined;
    timer?.unref?.();
    child.on("close", (exitCode) => {
      if (timer) clearTimeout(timer);
      resolve({ exitCode, stdout, stderr });
    });
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });
  });
}

/**
 * RFC-0326: the default, real fs-backed adapter. `writeFile` is atomic
 * (rfc-0258). Now returns `{ io, intents }` matching `createRecordingIO`'s
 * shape — the io writes to real disk; intents captures every mutation for
 * `filesModified` reporting on execution reports.
 */
export function createDefaultIO(): { io: WorkspaceIO; intents: WriteIntent[] } {
  const intents: WriteIntent[] = [];
  const io: WorkspaceIO = {
    async readFile(path) {
      return fsReadFile(path, "utf8");
    },
    async readFileBytes(path) {
      return fsReadFile(path);
    },
    async exists(path) {
      try {
        await stat(path);
        return true;
      } catch {
        return false;
      }
    },
    async glob(pattern, opts) {
      const results: string[] = [];
      for await (const entry of fsGlob(pattern, { cwd: opts?.cwd })) {
        results.push(entry);
      }
      return results;
    },
    async readdir(path) {
      const entries = await fsReaddir(path, { withFileTypes: true });
      return entries.map((entry) => ({
        name: entry.name,
        isFile: entry.isFile(),
        isDirectory: entry.isDirectory(),
      }));
    },
    async writeFile(path, content) {
      await fsMkdir(dirname(path), { recursive: true });
      await writeFileAtomic(path, content);
      const bytes =
        typeof content === "string" ? Buffer.byteLength(content, "utf8") : content.byteLength;
      intents.push({ kind: "write", path, bytes });
    },
    async mkdir(path) {
      await fsMkdir(path, { recursive: true });
      intents.push({ kind: "mkdir", path });
    },
    async rm(path, opts) {
      await fsRm(path, { recursive: opts?.recursive ?? false, force: true });
      intents.push({ kind: "rm", path });
    },
    exec: execImpl,
  };
  return { io, intents };
}

export interface WriteIntent {
  kind: "write" | "mkdir" | "rm";
  path: string;
  bytes?: number;
}

/**
 * Wraps a base adapter for universal `--dry-run`: reads pass through to the
 * base adapter (so a command can still make write decisions based on real
 * state), but writes/mkdir/rm are intercepted, recorded, and never touch disk.
 */
export function createRecordingIO(base: WorkspaceIO): { io: WorkspaceIO; intents: WriteIntent[] } {
  const intents: WriteIntent[] = [];
  const io: WorkspaceIO = {
    readFile: base.readFile.bind(base),
    readFileBytes: base.readFileBytes.bind(base),
    exists: base.exists.bind(base),
    glob: base.glob.bind(base),
    readdir: base.readdir.bind(base),
    async writeFile(path, content) {
      const bytes =
        typeof content === "string" ? Buffer.byteLength(content, "utf8") : content.byteLength;
      intents.push({ kind: "write", path, bytes });
    },
    async mkdir(path) {
      intents.push({ kind: "mkdir", path });
    },
    async rm(path) {
      intents.push({ kind: "rm", path });
    },
    async exec() {
      throw new Error("createRecordingIO: exec() is not supported under --dry-run.");
    },
  };
  return { io, intents };
}

export class KernelMetaError extends Error {
  constructor(
    readonly commandName: string,
    readonly attemptedPath: string,
  ) {
    super(
      `KERNEL-META-01: command "${commandName}" declares mutatesState: false but attempted to write "${attemptedPath}". ` +
        `Fix the command, or if the write is legitimate, set mutatesState: true and declare the path in writes (RFC-0266).`,
    );
    this.name = "KernelMetaError";
  }
}

/**
 * Wraps a base adapter so every mutation throws KERNEL-META-01 naming the
 * command and the attempted path. Used for every `mutatesState: false`
 * command (proves the metadata trustworthy) and by the test harness.
 */
export function createReadOnlyIO(base: WorkspaceIO, commandName: string): WorkspaceIO {
  return {
    readFile: base.readFile.bind(base),
    readFileBytes: base.readFileBytes.bind(base),
    exists: base.exists.bind(base),
    glob: base.glob.bind(base),
    readdir: base.readdir.bind(base),
    async writeFile(path) {
      throw new KernelMetaError(commandName, path);
    },
    async mkdir(path) {
      throw new KernelMetaError(commandName, path);
    },
    async rm(path) {
      throw new KernelMetaError(commandName, path);
    },
    async exec(command, args) {
      throw new KernelMetaError(commandName, `${command} ${args.join(" ")}`);
    },
  };
}
