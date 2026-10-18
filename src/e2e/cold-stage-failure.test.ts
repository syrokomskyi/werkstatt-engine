/*
<MODULE_CONTRACT>
  <purpose>RFC-1324 AC-5/AC-6: runStagePlan must exit non-zero naming the failing stage,
  and deploy stages must report `skipped` — never `pass` — when deploy secrets are absent.</purpose>
  <non-goals>
    <item>Does not run the real cold pipeline — stages are injected doubles.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1324: initial — injected failing stage, abort-cascade skips, secrets-absent skips, always-stage teardown.</item>
  <item>RFC-1324</item>
</CHANGE_SUMMARY>
*/

import { describe, expect, it } from "vitest";
import { runStagePlan, type ColdEnv, type ColdStage } from "./cold.ts";

const logger = {
  info: () => {},
  event: () => {},
  getEvents: () => [],
  warn: () => {},
  section: () => {},
  error: () => {},
  success: () => {},
};

function makeEnv(overrides: Partial<ColdEnv> = {}): ColdEnv {
  return {
    io: {} as ColdEnv["io"],
    logger: logger as unknown as ColdEnv["logger"],
    coldRoot: "/tmp/cold",
    cloneRoot: "/tmp/cold/werkstatt",
    cacheRoot: "/tmp/cold/systems-cache",
    gitRoot: "/tmp/cold/systems-git",
    fixture: "valid-minimal",
    systemId: "e2e-valid-minimal",
    missionId: "m000001",
    platformCommit: "abc",
    withDeploy: false,
    secrets: { accountId: undefined, apiToken: undefined },
    intake: null,
    perStepTimeout: 5000,
    ...overrides,
  };
}

const ok = (name: string): ColdStage => ({ name, run: async () => {} });

describe("runStagePlan (RFC-1324 AC-5)", () => {
  it("a failing stage fails and names itself; later stages are skipped", async () => {
    const stages: ColdStage[] = [
      ok("prepare-cold-root"),
      {
        name: "register-site",
        run: async () => {
          throw new Error("register blew up");
        },
      },
      ok("ship-closed"),
      ok("report"),
    ];
    const steps = await runStagePlan(stages, makeEnv());
    expect(steps.find((s) => s.step === "register-site")?.status).toBe("fail");
    expect(steps.find((s) => s.step === "register-site")?.error).toContain("register blew up");
    expect(steps.find((s) => s.step === "ship-closed")?.status).toBe("skipped");
    expect(steps.find((s) => s.step === "ship-closed")?.skippedReason).toContain(
      "aborted after 'register-site'",
    );
    expect(steps.find((s) => s.step === "report")?.status).toBe("skipped");
  });

  it("an `always` stage still runs after a failure (teardown semantics)", async () => {
    let teardownRan = false;
    const stages: ColdStage[] = [
      {
        name: "dev-deploy",
        run: async () => {
          throw new Error("deploy failed");
        },
      },
      {
        name: "teardown",
        always: true,
        run: async () => {
          teardownRan = true;
        },
      },
      ok("after"),
    ];
    const steps = await runStagePlan(stages, makeEnv());
    expect(teardownRan).toBe(true);
    expect(steps.find((s) => s.step === "teardown")?.status).toBe("pass");
    expect(steps.find((s) => s.step === "after")?.status).toBe("skipped");
  });

  it("requiresMission stages are skipped when register produced no mission", async () => {
    const stages: ColdStage[] = [ok("register-site"), { ...ok("compose"), requiresMission: true }];
    const steps = await runStagePlan(stages, makeEnv({ missionId: null }));
    expect(steps.find((s) => s.step === "compose")?.status).toBe("skipped");
    expect(steps.find((s) => s.step === "compose")?.skippedReason).toContain("no mission");
  });
});

describe("runStagePlan (RFC-1324 AC-6)", () => {
  it("deploy stages report skipped, never pass, when secrets are absent", async () => {
    const stages: ColdStage[] = [
      ok("ship-closed"),
      {
        name: "dev-deploy",
        requiresMission: true,
        deployOnly: true,
        skipWhen: (env) =>
          !env.secrets.accountId || !env.secrets.apiToken ? "secrets absent" : null,
        run: async () => {},
      },
      {
        name: "access-probe",
        requiresMission: true,
        deployOnly: true,
        skipWhen: (env) =>
          !env.secrets.accountId || !env.secrets.apiToken ? "secrets absent" : null,
        run: async () => {},
      },
    ];
    const steps = await runStagePlan(stages, makeEnv());
    const deploy = steps.filter((s) => s.step === "dev-deploy" || s.step === "access-probe");
    expect(deploy).toHaveLength(2);
    for (const s of deploy) {
      expect(s.status).toBe("skipped");
      expect(s.skippedReason).toBe("secrets absent");
    }
    expect(steps.find((s) => s.step === "ship-closed")?.status).toBe("pass");
  });

  it("deploy stages run when secrets are present", async () => {
    let ran = false;
    const stages: ColdStage[] = [
      {
        name: "dev-deploy",
        skipWhen: (env) => (!env.secrets.apiToken ? "secrets absent" : null),
        run: async () => {
          ran = true;
        },
      },
    ];
    const steps = await runStagePlan(
      stages,
      makeEnv({ secrets: { accountId: "a", apiToken: "t" } }),
    );
    expect(ran).toBe(true);
    expect(steps[0].status).toBe("pass");
  });
});
