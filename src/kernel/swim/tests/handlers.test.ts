import { test, expect, describe } from "vitest";
import * as mod from "../handlers.ts";

describe("swim/handlers", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });

  test("exports runSwimJoin", () => {
    expect(typeof mod.runSwimJoin).toBe("function");
  });

  test("exports runSwimLeave", () => {
    expect(typeof mod.runSwimLeave).toBe("function");
  });

  test("exports runSwimMembers", () => {
    expect(typeof mod.runSwimMembers).toBe("function");
  });

  test("exports runSwimStatus", () => {
    expect(typeof mod.runSwimStatus).toBe("function");
  });
});
