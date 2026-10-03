// ============================================================================
// COMPASS MODULE HEADER
// ============================================================================
// - Module: packages/werkstatt-engine/src/leitstand/tests/wba-signer.test.ts
// - Summary: RFC-1188 Leitstand outbound-signing tests — identity resolution,
//   degraded unsigned fallback, and signature validity of signed fetches.
// - Author: Devin (AI agent)
// - Date: 2026-10-03
// - Scope: test
// - Dependencies: vitest, leitstand/wba-signer.ts, werkstatt-shared/agent,
//   werkstatt-shared/passport
// - Consumers: test suite
// - Last updated: 2026-10-03
// ============================================================================

import { getPublicKeyAsync } from "@noble/ed25519";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { toMultibase } from "@warpgogol/werkstatt-shared/passport/sign";
import { verifyBytes } from "@warpgogol/werkstatt-shared/signing";
import {
  jwkToPublicKeyBytes,
  passportKeyToJwk,
  type WbaJwk,
} from "@warpgogol/werkstatt-shared/agent";
import { resolveOutboundAgentClient } from "../wba-signer.ts";

const TEST_PRIVATE_HEX = "b3f84ddb6973a143c4b2fc6b0b8d6b3cb33863b2e30dca94241029111e81e14f";
const TEST_PRIVATE_KEY = new Uint8Array(
  TEST_PRIVATE_HEX.match(/.{2}/g)!.map((b) => parseInt(b, 16)),
);

let workspaceRoot = "";

const SYSTEM_ID = "testsys";
const CHANNEL_ORIGIN = "https://main.testsys.example";
const DIRECTORY_URL = `${CHANNEL_ORIGIN}/.well-known/http-message-signatures-directory`;

async function writeFixture(options: { keyFile: boolean; envKey: boolean }): Promise<void> {
  const appDir = resolve(workspaceRoot, "..", "systems-cache", SYSTEM_ID);
  await mkdir(join(appDir, "public", ".well-known"), { recursive: true });
  const pub = await getPublicKeyAsync(TEST_PRIVATE_KEY);
  await writeFile(
    join(appDir, "system-config.yaml"),
    [
      "schemaVersion: 1.0.0",
      `id: ${SYSTEM_ID}`,
      "cosmicStar: Vega",
      "mirrors:",
      "  - path: ../systems-git/testsys",
      "    storageType: bare",
      "pinnedPlatform: 6.0.0",
      "status: active",
      "registeredAt: 2026-01-01T00:00:00.000Z",
      "deployment:",
      "  adapter: cloudflare-workers",
      "  channels:",
      "    dev:",
      "      workerName: dev-testsys",
      "      url: https://dev.testsys.example",
      "    alt:",
      "      workerName: alt-testsys",
      "      url: https://alt.testsys.example",
      "    main:",
      "      workerName: testsys",
      `      url: ${CHANNEL_ORIGIN}`,
      "",
    ].join("\n"),
  );
  if (options.keyFile) {
    await writeFile(
      join(appDir, "public", ".well-known", "cosmic-passport-key.json"),
      JSON.stringify(
        {
          schemaVersion: "1.0",
          appId: SYSTEM_ID,
          keys: [
            {
              version: "v1",
              active: true,
              type: "Ed25519VerificationKey2020",
              publicKeyMultibase: toMultibase(pub),
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        },
        null,
        2,
      ),
    );
  }
  if (options.envKey) {
    await writeFile(join(appDir, ".env"), `PASSPORT_SIGNING_KEY=${TEST_PRIVATE_HEX}\n`);
  }
}

beforeEach(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), "wba-signer-"));
  delete process.env.PASSPORT_SIGNING_KEY;
  delete process.env.WBA_IDENTITY_SITE;
});

afterEach(async () => {
  await rm(workspaceRoot, { recursive: true, force: true });
  await rm(resolve(workspaceRoot, "..", "systems-cache"), {
    recursive: true,
    force: true,
  });
  delete process.env.PASSPORT_SIGNING_KEY;
  delete process.env.WBA_IDENTITY_SITE;
});

function capturedFetch(): {
  impl: typeof fetch;
  request: () => Request | null;
} {
  let seen: Request | null = null;
  const impl: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen = input instanceof Request ? input : new Request(input, init);
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  return { impl, request: () => seen };
}

/**
 * Independent verifier — rebuilds the RFC 9421 signature base from the
 * emitted headers (no shared code path with the signer) and verifies with
 * the published JWK material. Mirrors the AC-3 verifier in
 * werkstatt-shared's wba-sign.test.ts.
 */
async function independentVerify(request: Request, jwk: WbaJwk): Promise<boolean> {
  const signatureInput = request.headers.get("Signature-Input")!;
  const signature = request.headers.get("Signature")!;
  const m = signatureInput.match(
    /^sig1=\(([^)]*)\);keyid="([^"]+)";alg=ed25519;created=(\d+);expires=(\d+)$/,
  );
  if (!m) return false;
  const covered = m[1].split(" ").map((s) => s.replaceAll('"', ""));
  const url = new URL(request.url);
  const lines: string[] = [];
  for (const comp of covered) {
    if (comp === "@method") lines.push(`"@method": ${request.method.toUpperCase()}`);
    else if (comp === "@authority") lines.push(`"@authority": ${url.host}`);
    else if (comp === "@path") lines.push(`"@path": ${url.pathname}`);
    else if (comp === "signature-agent")
      lines.push(`"signature-agent": ${request.headers.get("Signature-Agent")}`);
    else if (comp === "content-digest")
      lines.push(`"content-digest": ${request.headers.get("Content-Digest")}`);
    else return false;
  }
  const params = signatureInput.slice("sig1=".length);
  lines.push(`"@signature-params": ${params}`);
  const sigB64 = signature.match(/^sig1=:([A-Za-z0-9+/=]+):$/)?.[1];
  if (!sigB64) return false;
  const sigBytes = new Uint8Array([...atob(sigB64)].map((c) => c.charCodeAt(0)));
  return verifyBytes(
    jwkToPublicKeyBytes(jwk),
    new TextEncoder().encode(lines.join("\n")),
    sigBytes,
  );
}

describe("resolveOutboundAgentClient", () => {
  it("returns a signing client that produces RFC-9421 headers", async () => {
    await writeFixture({ keyFile: true, envKey: true });
    const capture = capturedFetch();
    const outbound = await resolveOutboundAgentClient(workspaceRoot, SYSTEM_ID, capture.impl);

    expect(outbound.mode).toBe("signed");
    expect(outbound.reason).toBeUndefined();

    await outbound.client.fetch(`${CHANNEL_ORIGIN}/agent`, { method: "GET" });

    const req = capture.request()!;
    expect(req.headers.get("Signature-Agent")).toBe(DIRECTORY_URL);
    expect(req.headers.get("Signature-Input")).toContain(
      'sig1=("@method" "@authority" "@path" "signature-agent")',
    );
    expect(req.headers.get("Signature-Input")).toContain('keyid="v1"');
    expect(req.headers.get("Signature")).toMatch(/^sig1=:[A-Za-z0-9+/=]+:$/);
    expect(req.headers.get("User-Agent")).toContain("WarpgogolBot/");
    expect(req.headers.get("User-Agent")).toContain("http-message-signatures-directory");

    // Independent verification against the fixture public key — same path a
    // verifier takes after resolving our published directory JWK.
    const pub = await getPublicKeyAsync(TEST_PRIVATE_KEY);
    const jwk = passportKeyToJwk(pub, "v1");
    expect(await independentVerify(req, jwk)).toBe(true);
  });

  it("degrades to unsigned pass-through without a private key", async () => {
    await writeFixture({ keyFile: true, envKey: false });
    const capture = capturedFetch();
    const outbound = await resolveOutboundAgentClient(workspaceRoot, SYSTEM_ID, capture.impl);

    expect(outbound.mode).toBe("degraded");
    expect(outbound.reason).toContain("PASSPORT_SIGNING_KEY");
    await outbound.client.fetch(`${CHANNEL_ORIGIN}/agent`, { method: "GET" });
    expect(capture.request()!.headers.get("Signature")).toBeNull();
    expect(capture.request()!.headers.get("User-Agent")).toContain("WarpgogolBot/");
  });

  it("degrades to unsigned when no channel origin resolves", async () => {
    const capture = capturedFetch();
    const outbound = await resolveOutboundAgentClient(
      workspaceRoot,
      "unknown-system",
      capture.impl,
    );
    expect(outbound.mode).toBe("degraded");
    await outbound.client.fetch("https://anything.example/x", {
      method: "GET",
    });
    expect(capture.request()!.headers.get("Signature")).toBeNull();
  });
});
