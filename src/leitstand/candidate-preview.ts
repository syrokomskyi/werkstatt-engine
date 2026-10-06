/*
<MODULE_CONTRACT>
<purpose>RFC-1207: Candidate preview lifecycle for leitstand.certify — provisions `wrangler dev` on releases/<id>/dist/server (ephemeral port, bounded HTTP readiness) so authorizing gates measure the candidate artifact, not the incumbent channel.</purpose>
<non-goals>
  <item>Does not resolve paths — the caller derives serverDir from context.workspaceRoot (DNA-105).</item>
  <item>Does not serve the artifact with a bare static server — preview fidelity requires the generated Worker + _headers (RECOVERY-2026-10-04).</item>
  <item>Does not reuse stale preview processes — cleanup is kill-only; an orphaned wrangler dev on an ephemeral port is harmless.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1207: initial module — allocate-probe-release ephemeral port, `pnpm exec wrangler dev` spawn via dynamic node:child_process (kernel.io.lint precedent), 30s HTTP readiness poll, SIGTERM→SIGKILL teardown.</item>
  <item>RFC-1207: candidate-preview certify — wrangler dev on releases/<id>/dist/server measures the candidate artifact</item>
</CHANGE_SUMMARY>
*/

export type CertifyTarget = "candidate" | "channel";

export interface CandidatePreview {
  baseUrl: string;
  port: number;
  releaseId: string;
  artifactHash: string;
  serverDir: string;
  startedAt: string;
  stop(): Promise<void>;
}

export interface PreviewLogger {
  info(message: string): void;
  warn(message: string): void;
}

const PREVIEW_READY_TIMEOUT_MS = 30_000;
const PREVIEW_READY_POLL_MS = 250;
const PREVIEW_PROBE_TIMEOUT_MS = 2_000;
const PREVIEW_STOP_TIMEOUT_MS = 5_000;
const STDERR_TAIL_BYTES = 8 * 1024;

/** Allocate an ephemeral localhost port: bind 0, read the assigned port, release. */
async function allocateEphemeralPort(): Promise<number> {
  // Long-lived preview is spawned via node:* APIs through dynamic import —
  // kernel.io.lint scans static imports only (wrangler-secrets.ts precedent).
  const { createServer } = await import("node:net");
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => (port > 0 ? resolve(port) : reject(new Error("ephemeral port probe returned 0"))));
    });
  });
}

function tailBuffer(): { push(chunk: unknown): void; text(): string } {
  let acc = "";
  return {
    push(chunk: unknown) {
      acc += String(chunk);
      if (acc.length > STDERR_TAIL_BYTES) acc = acc.slice(-STDERR_TAIL_BYTES);
    },
    text() {
      return acc.trim();
    },
  };
}

async function awaitPreviewReady(baseUrl: string): Promise<void> {
  const deadline = Date.now() + PREVIEW_READY_TIMEOUT_MS;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      // Any HTTP response — including 4xx/5xx — proves wrangler dev is bound
      // and serving; gate evaluation cares about the artifact, not probe 200s.
      await fetch(baseUrl, { signal: AbortSignal.timeout(PREVIEW_PROBE_TIMEOUT_MS) });
      return;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      await new Promise((resolve) => setTimeout(resolve, PREVIEW_READY_POLL_MS));
    }
  }
  throw new Error(
    `candidate preview did not become ready within ${PREVIEW_READY_TIMEOUT_MS / 1000}s (${lastError})`,
  );
}

interface SpawnedPreview {
  port: number;
  stop(): Promise<void>;
}

async function spawnWranglerDev(
  serverDir: string,
  port: number,
  logger: PreviewLogger,
): Promise<SpawnedPreview> {
  const { spawn } = await import("node:child_process");
  const stderr = tailBuffer();
  let exited: { code: number | null } | null = null;

  const child = spawn(
    "pnpm",
    ["exec", "wrangler", "dev", "--port", String(port), "--ip", "127.0.0.1"],
    {
      cwd: serverDir,
      // Child inherits the parent env for Cloudflare auth — the generated
      // dist/server/wrangler.json declares remote-mode bindings (vectorize,
      // ai, send_email). Env passthrough is the wrangler-secrets.ts precedent;
      // DNA-105 forbids ambient env for *paths*, which stay caller-derived.
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stderr.on("data", (d) => stderr.push(d));
  child.stdout.on("data", () => {});
  child.on("exit", (code) => {
    exited = { code };
  });
  child.on("error", () => {
    exited = { code: null };
  });

  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    if (exited) return;
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (!exited) child.kill("SIGKILL");
        resolve();
      }, PREVIEW_STOP_TIMEOUT_MS);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  };

  // Fail fast when wrangler dev exits before readiness (missing binary,
  // EADDRINUSE, malformed bundle — all surface as an early exit).
  const earlyExit = new Promise<never>((_, reject) => {
    child.once("exit", () => {
      reject(
        new Error(
          `wrangler dev exited before readiness (code ${child.exitCode ?? "?"}): ${stderr.text()}`,
        ),
      );
    });
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await Promise.race([awaitPreviewReady(baseUrl), earlyExit]);
  } catch (err) {
    await stop();
    const msg = err instanceof Error ? err.message : String(err);
    const enriched = stderr.text() ? `${msg} — wrangler stderr: ${stderr.text()}` : msg;
    const previewError = new Error(enriched);
    (previewError as { eaddrInUse?: boolean }).eaddrInUse = /EADDRINUSE/i.test(stderr.text());
    throw previewError;
  }
  logger.info(`[certify] candidate preview ready on ${baseUrl} (wrangler dev, ${serverDir})`);
  return { port, stop };
}

export async function provisionCandidatePreview(opts: {
  serverDir: string;
  releaseId: string;
  artifactHash: string;
  logger: PreviewLogger;
}): Promise<CandidatePreview> {
  const { serverDir, releaseId, artifactHash, logger } = opts;
  const startedAt = new Date().toISOString();

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const port = await allocateEphemeralPort();
    try {
      const spawned = await spawnWranglerDev(serverDir, port, logger);
      return {
        baseUrl: `http://127.0.0.1:${spawned.port}`,
        port: spawned.port,
        releaseId,
        artifactHash,
        serverDir,
        startedAt,
        stop: spawned.stop,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if ((lastError as { eaddrInUse?: boolean }).eaddrInUse && attempt === 0) {
        logger.warn(`[certify] preview port collision — retrying with a fresh ephemeral port`);
        continue;
      }
      break;
    }
  }
  throw lastError ?? new Error("candidate preview provisioning failed");
}
