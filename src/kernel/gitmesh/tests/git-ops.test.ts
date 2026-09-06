import { test, expect, describe } from "vitest";
import * as mod from "../git-ops.ts";

describe("gitmesh/git-ops", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });

  test("exports gitFetch", () => {
    expect(typeof mod.gitFetch).toBe("function");
  });

  test("exports gitRevParseHead", () => {
    expect(typeof mod.gitRevParseHead).toBe("function");
  });

  test("exports gitRemoteList", () => {
    expect(typeof mod.gitRemoteList).toBe("function");
  });

  test("exports gitLogSignatureStatus", () => {
    expect(typeof mod.gitLogSignatureStatus).toBe("function");
  });
});
