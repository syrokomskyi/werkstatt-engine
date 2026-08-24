/*
<MODULE_CONTRACT>
<purpose>
  RFC-0258: atomic file-write primitive for workspace-shared kernel-command
  outputs. Every kernel command that writes a file outside its target app
  directory (workspace root, docs/, packages/ontology/) MUST write through
  writeFileAtomic instead of node:fs/promises writeFile, so that a reader
  polling the target path never observes a torn/partial file when Turborepo
  runs multiple app builds in parallel.
</purpose>
<non-goals>
  <item>Do not provide cross-process mutual exclusion (locks) — outputs are deterministic (RFC-0087), so convergent atomic writes are sufficient.</item>
  <item>Do not fall back to a non-atomic write when retries are exhausted — fail loudly instead.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0258: initial implementation.</item>
</CHANGE_SUMMARY>
*/

import { writeFile, rename as fsRename, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { randomBytes } from "node:crypto";

export interface WriteFileAtomicOptions {
  /** Max rename retries on transient EPERM/EBUSY. Default 10, linear 50ms backoff. */
  retries?: number;
}

// Indirection seam so unit tests can simulate a transient EPERM/EBUSY
// on the first rename attempt without monkey-patching the frozen node:fs/promises
// module namespace (ESM named exports are read-only bindings). Production code
// always goes through fsRename; only tests in this package call the setter.
let renameImpl: typeof fsRename = fsRename;

/** @internal test-only seam — do not call from production code. */
export function __setRenameImplForTests(impl: typeof fsRename | undefined): void {
  renameImpl = impl ?? fsRename;
}

const DEFAULT_RETRIES = 10;
const RETRY_BACKOFF_MS = 50;

const RETRYABLE_CODES = new Set(["EPERM", "EBUSY"]);

function isRetryableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as NodeJS.ErrnoException).code;
  return typeof code === "string" && RETRYABLE_CODES.has(code);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeTempPath(filePath: string): string {
  const dir = dirname(filePath);
  const name = basename(filePath);
  const random = randomBytes(6).toString("hex");
  return join(dir, `${name}.${random}.tmp`);
}

/**
 * Write `content` to `filePath` atomically: write to a temp file in the same
 * directory, then rename over the target. Rename within one directory is
 * atomic on POSIX; a bounded retry loop absorbs transient EPERM/EBUSY
 * (e.g. a reader briefly holding the file handle during overwrite).
 *
 * On failure (write or all rename retries exhausted), the temp file is
 * unlinked in a finally block and the original error is rethrown — this
 * helper never falls back to a non-atomic write.
 */
export async function writeFileAtomic(
  filePath: string,
  content: string | Uint8Array,
  options?: WriteFileAtomicOptions,
): Promise<void> {
  const retries = options?.retries ?? DEFAULT_RETRIES;
  const tempPath = makeTempPath(filePath);
  let tempWritten = false;

  try {
    await writeFile(tempPath, content);
    tempWritten = true;

    let attempt = 0;
    // Bounded retry loop: attempt 0 is the first try, then up to `retries` more.
    for (;;) {
      try {
        await renameImpl(tempPath, filePath);
        return;
      } catch (error) {
        if (attempt >= retries || !isRetryableError(error)) {
          throw error;
        }
        attempt += 1;
        // EPERM on rename-over-existing: try unlinking the target
        // first (it may have been briefly locked by a reader that has since
        // released it), then retry the rename on the next iteration.
        if (existsSync(filePath)) {
          try {
            await unlink(filePath);
          } catch {
            // If unlink also fails, the retry loop will try again.
          }
        }
        await sleep(RETRY_BACKOFF_MS * attempt);
      }
    }
  } finally {
    if (tempWritten) {
      try {
        // If rename succeeded, the temp file no longer exists — unlink is a no-op error we swallow.
        await unlink(tempPath);
      } catch {
        // Expected in the success path (temp file already renamed away) — ignore.
      }
    }
  }
}
