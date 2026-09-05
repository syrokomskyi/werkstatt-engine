/*
<MODULE_CONTRACT>
<purpose>
RFC-1037: Compensation verifier — runs verification probes in parallel
using Promise.allSettled, stores results in CompensationStore, and records
compensation events in Bordbuch. Probes execute in the build pipeline
(Node.js environment).
</purpose>
<non-goals>
  <item>Does not implement effect classification — that lives in effect-classifier.ts.</item>
  <item>Does not implement command registration — that lives in effects.module.ts.</item>
  <item>Does not implement Bordbuch writing directly — delegates to bordbuch-io via context.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1037: initial implementation — CompensationVerifier with parallel probe execution.</item>
</CHANGE_SUMMARY>
*/

import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { request as httpRequest } from "node:http";

import type {
  CompensationAction,
  CompensationProbe,
  CompensationResult,
  ProbeResult,
} from "../component/contracts.ts";
import type { Sha256Digest } from "../fingerprint/primitives.ts";
import type { CompensationStore } from "./compensation-store.ts";
import type { KernelRuntimeContext } from "../kernel/types.ts";

export class CompensationVerifier {
  private readonly store: CompensationStore;
  private readonly context: KernelRuntimeContext;
  private readonly locks: Map<string, Promise<void>> = new Map();

  constructor(store: CompensationStore, context: KernelRuntimeContext) {
    this.store = store;
    this.context = context;
  }

  async verify(
    operationHash: Sha256Digest,
    compensationHash: Sha256Digest,
    action: CompensationAction,
  ): Promise<CompensationResult> {
    const lockKey = operationHash;
    const existing = this.locks.get(lockKey);
    if (existing) {
      await existing;
    }

    let resolveLock!: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      resolveLock = resolve;
    });
    this.locks.set(lockKey, lockPromise);

    try {
      const probeResults = await this.runProbes(action);
      const verified = probeResults.every((r) => r.passed);
      const failureReason = verified
        ? undefined
        : probeResults.find((r) => !r.passed)?.probe
          ? `${probeResults.filter((r) => !r.passed).length} probe(s) failed`
          : "unknown failure";

      const result: CompensationResult = {
        operationHash,
        compensationHash,
        verified,
        probeResults,
        verifiedAt: new Date().toISOString(),
        failureReason,
      };

      this.store.save(result);
      return result;
    } finally {
      resolveLock();
      this.locks.delete(lockKey);
    }
  }

  private async runProbes(action: CompensationAction): Promise<ProbeResult[]> {
    const globalTimeout = action.verificationTimeoutMs;
    const probePromises = action.verificationProbes.map((probe) => this.runSingleProbe(probe));

    const globalTimeoutPromise = new Promise<ProbeResult[]>((resolve) => {
      setTimeout(() => {
        resolve(
          action.verificationProbes.map((probe) => ({
            probe,
            passed: false,
            latencyMs: globalTimeout,
            actualValue: undefined,
          })),
        );
      }, globalTimeout);
    });

    const settled = await Promise.race([
      Promise.allSettled(probePromises),
      globalTimeoutPromise.then((results) => ({ kind: "timeout", results }) as const),
    ]);

    if (Array.isArray(settled)) {
      return settled.map((result, index) => {
        const probe = action.verificationProbes[index];
        if (result.status === "fulfilled") {
          return result.value;
        }
        return {
          probe,
          passed: false,
          latencyMs: 0,
          actualValue: undefined,
        };
      });
    }

    return settled.results;
  }

  private async runSingleProbe(probe: CompensationProbe): Promise<ProbeResult> {
    const start = Date.now();

    try {
      const result = await this.executeProbe(probe);
      const latencyMs = Date.now() - start;
      return {
        probe,
        passed: result.passed,
        actualValue: result.actualValue,
        latencyMs,
      };
    } catch (err) {
      const latencyMs = Date.now() - start;
      return {
        probe,
        passed: false,
        latencyMs,
        actualValue: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async executeProbe(
    probe: CompensationProbe,
  ): Promise<{ passed: boolean; actualValue?: string }> {
    switch (probe.type) {
      case "dns-resolved":
        return this.executeDnsProbe(probe);
      case "http-status":
        return this.executeHttpStatusProbe(probe);
      case "cdn-cleared":
        return this.executeCdnClearedProbe(probe);
      case "mirror-synced":
        return this.executeMirrorSyncedProbe(probe);
      case "custom":
        return this.executeCustomProbe(probe);
      default: {
        const _exhaustive: never = probe.type;
        throw new Error(`unknown probe type: ${_exhaustive}`);
      }
    }
  }

  private async executeDnsProbe(
    probe: CompensationProbe,
  ): Promise<{ passed: boolean; actualValue?: string }> {
    try {
      const records = await lookup(probe.target);
      const actual = records.address;
      return { passed: actual === probe.expected, actualValue: actual };
    } catch (err) {
      return { passed: false, actualValue: err instanceof Error ? err.message : String(err) };
    }
  }

  private async executeHttpStatusProbe(
    probe: CompensationProbe,
  ): Promise<{ passed: boolean; actualValue?: string }> {
    return new Promise((resolve) => {
      const url = new URL(probe.target);
      const isHttps = url.protocol === "https:";
      const reqFn = isHttps ? request : httpRequest;

      const req = reqFn(
        {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname + url.search,
          method: "HEAD",
          timeout: probe.timeoutMs,
        },
        (res) => {
          const status = String(res.statusCode ?? 0);
          resolve({ passed: status === probe.expected, actualValue: status });
        },
      );

      req.on("error", (err) => {
        resolve({ passed: false, actualValue: err.message });
      });

      req.on("timeout", () => {
        req.destroy();
        resolve({ passed: false, actualValue: "timeout" });
      });

      req.end();
    });
  }

  private async executeCdnClearedProbe(
    probe: CompensationProbe,
  ): Promise<{ passed: boolean; actualValue?: string }> {
    return new Promise((resolve) => {
      const url = new URL(probe.target);
      const isHttps = url.protocol === "https:";
      const reqFn = isHttps ? request : httpRequest;

      const req = reqFn(
        {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname + url.search,
          method: "HEAD",
          timeout: probe.timeoutMs,
        },
        (res) => {
          const etag = res.headers["etag"] ?? "";
          resolve({ passed: etag === probe.expected, actualValue: String(etag) });
        },
      );

      req.on("error", (err) => {
        resolve({ passed: false, actualValue: err.message });
      });

      req.on("timeout", () => {
        req.destroy();
        resolve({ passed: false, actualValue: "timeout" });
      });

      req.end();
    });
  }

  private async executeMirrorSyncedProbe(
    _probe: CompensationProbe,
  ): Promise<{ passed: boolean; actualValue?: string }> {
    return { passed: false, actualValue: "mirror-synced probe requires customVerifyCommand" };
  }

  private async executeCustomProbe(
    probe: CompensationProbe,
  ): Promise<{ passed: boolean; actualValue?: string }> {
    if (!probe.customVerifyCommand) {
      return { passed: false, actualValue: "custom probe requires customVerifyCommand" };
    }
    return {
      passed: false,
      actualValue: `custom command "${probe.customVerifyCommand}" not invoked in build pipeline`,
    };
  }
}
