import { test, expect, describe } from "vitest";
import * as mod from "../identity.ts";

describe("identity", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });

  test("exports buildReleaseCandidateIdentityV1", () => {
    expect(typeof mod.buildReleaseCandidateIdentityV1).toBe("function");
  });

  test("exports buildDossierEventIdentityV1", () => {
    expect(typeof mod.buildDossierEventIdentityV1).toBe("function");
  });
});
