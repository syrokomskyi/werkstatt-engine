import { describe, it, expect } from "vitest";
import {
  RevertibleEffectHandler,
  TransactionalEffectHandler,
  CompensatableEffectHandler,
  IrreversibleEmissionEffectHandler,
  createEffectHandler,
  buildUnwindReport,
} from "../effects.ts";
import type { EffectDeclarationV1 } from "../../component/contracts.ts";

const _VALID_SHA = "sha256:" + "a".repeat(64);

describe("RevertibleEffectHandler", () => {
  it("dispose calls disposer and succeeds", async () => {
    let disposed = false;
    const handler = new RevertibleEffectHandler(async () => { disposed = true; });
    const result = await handler.dispose();
    expect(result.ok).toBe(true);
    expect(result.outcome).toBe("aborted");
    expect(disposed).toBe(true);
  });

  it("dispose is idempotent", async () => {
    let count = 0;
    const handler = new RevertibleEffectHandler(async () => { count++; });
    await handler.dispose();
    await handler.dispose();
    expect(count).toBe(1);
  });

  it("dispose failure yields failed-rollback", async () => {
    const handler = new RevertibleEffectHandler(async () => { throw new Error("disposer failed"); });
    const result = await handler.dispose();
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe("failed-rollback");
    expect(result.error).toBe("disposer failed");
  });

  it("compensate is not supported", async () => {
    const handler = new RevertibleEffectHandler(async () => {});
    const result = await handler.compensate();
    expect(result.ok).toBe(false);
  });
});

describe("TransactionalEffectHandler", () => {
  it("prepare then commit succeeds", async () => {
    let prepared = false, committed = false;
    const handler = new TransactionalEffectHandler(
      "tx-1",
      async () => { prepared = true; },
      async () => { committed = true; },
      async () => {},
    );
    expect((await handler.prepare()).ok).toBe(true);
    expect(prepared).toBe(true);
    expect((await handler.commit()).ok).toBe(true);
    expect(committed).toBe(true);
  });

  it("commit before prepare fails", async () => {
    const handler = new TransactionalEffectHandler("tx-2", async () => {}, async () => {}, async () => {});
    const result = await handler.commit();
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe("failed-rollback");
  });

  it("abort after prepare calls abortFn", async () => {
    let aborted = false;
    const handler = new TransactionalEffectHandler(
      "tx-3",
      async () => {},
      async () => {},
      async () => { aborted = true; },
    );
    await handler.prepare();
    const result = await handler.abort();
    expect(result.ok).toBe(true);
    expect(result.outcome).toBe("aborted");
    expect(aborted).toBe(true);
  });

  it("commit is idempotent", async () => {
    let count = 0;
    const handler = new TransactionalEffectHandler("tx-4", async () => {}, async () => { count++; }, async () => {});
    await handler.prepare();
    await handler.commit();
    await handler.commit();
    expect(count).toBe(1);
  });
});

describe("CompensatableEffectHandler", () => {
  it("requires non-empty equivalence evidence", () => {
    expect(() => new CompensatableEffectHandler(async () => {}, async () => {}, "")).toThrow();
  });

  it("commit then compensate succeeds", async () => {
    let committed = false, compensated = false;
    const handler = new CompensatableEffectHandler(
      async () => { committed = true; },
      async () => { compensated = true; },
      "equivalence proof",
    );
    expect((await handler.commit()).ok).toBe(true);
    expect(committed).toBe(true);
    const result = await handler.compensate();
    expect(result.ok).toBe(true);
    expect(result.outcome).toBe("compensated");
    expect(compensated).toBe(true);
  });

  it("compensate without commit is a no-op abort", async () => {
    const handler = new CompensatableEffectHandler(async () => {}, async () => {}, "evidence");
    const result = await handler.compensate();
    expect(result.ok).toBe(true);
    expect(result.outcome).toBe("aborted");
  });

  it("compensation failure quarantines", async () => {
    const handler = new CompensatableEffectHandler(
      async () => {},
      async () => { throw new Error("compensation failed"); },
      "evidence",
    );
    await handler.commit();
    const result = await handler.compensate();
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe("quarantined");
  });
});

describe("IrreversibleEmissionEffectHandler", () => {
  it("withholds until commit", async () => {
    let emitted = false;
    const handler = new IrreversibleEmissionEffectHandler(async () => { emitted = true; });
    expect(handler.isWithheld).toBe(true);
    const prepResult = await handler.prepare();
    expect(prepResult.outcome).toBe("withheld");
    expect(emitted).toBe(false);

    const result = await handler.commit();
    expect(result.ok).toBe(true);
    expect(result.outcome).toBe("committed");
    expect(emitted).toBe(true);
  });

  it("abort before emit succeeds", async () => {
    let emitted = false;
    const handler = new IrreversibleEmissionEffectHandler(async () => { emitted = true; });
    const result = await handler.abort();
    expect(result.ok).toBe(true);
    expect(result.outcome).toBe("aborted");
    expect(emitted).toBe(false);
  });

  it("abort after emit quarantines", async () => {
    const handler = new IrreversibleEmissionEffectHandler(async () => {});
    await handler.commit();
    const result = await handler.abort();
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe("quarantined");
  });

  it("compensate after emit quarantines", async () => {
    const handler = new IrreversibleEmissionEffectHandler(async () => {});
    await handler.commit();
    const result = await handler.compensate();
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe("quarantined");
  });
});

describe("createEffectHandler", () => {
  function makeDecl(effectClass: EffectDeclarationV1["effectClass"]): EffectDeclarationV1 {
    return {
      effectClass,
      description: "test",
      recoveryCommand: null,
      commitMetadata: null,
    };
  }

  it("creates revertible handler", () => {
    const h = createEffectHandler(makeDecl("revertible"), { disposer: async () => {} });
    expect(h.effectClass).toBe("revertible");
  });

  it("creates transactional handler", () => {
    const h = createEffectHandler(makeDecl("transactional"), {
      prepare: async () => {}, commit: async () => {}, abort: async () => {},
    });
    expect(h.effectClass).toBe("transactional");
  });

  it("creates compensatable handler", () => {
    const h = createEffectHandler(makeDecl("compensatable"), {
      commit: async () => {}, compensate: async () => {}, equivalenceEvidence: "proof",
    });
    expect(h.effectClass).toBe("compensatable");
  });

  it("creates irreversible-emission handler", () => {
    const h = createEffectHandler(makeDecl("irreversible-emission"), { emit: async () => {} });
    expect(h.effectClass).toBe("irreversible-emission");
  });
});

describe("buildUnwindReport", () => {
  it("allSucceeded when all entries are clean", () => {
    const report = buildUnwindReport([
      { componentId: "a/b" as const, effectClass: "revertible", outcome: "aborted", error: null },
      { componentId: "a/b" as const, effectClass: "transactional", outcome: "committed", error: null },
    ]);
    expect(report.allSucceeded).toBe(true);
    expect(report.quarantined).toBe(false);
  });

  it("quarantined when any entry is quarantined", () => {
    const report = buildUnwindReport([
      { componentId: "a/b" as const, effectClass: "revertible", outcome: "aborted", error: null },
      { componentId: "a/b" as const, effectClass: "irreversible-emission", outcome: "quarantined", error: "oops" },
    ]);
    expect(report.allSucceeded).toBe(false);
    expect(report.quarantined).toBe(true);
  });

  it("not allSucceeded when any entry is failed-rollback", () => {
    const report = buildUnwindReport([
      { componentId: "a/b" as const, effectClass: "revertible", outcome: "failed-rollback", error: "fail" },
    ]);
    expect(report.allSucceeded).toBe(false);
    expect(report.quarantined).toBe(true);
  });
});
