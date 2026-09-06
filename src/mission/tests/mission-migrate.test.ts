import { test, expect, describe } from "vitest";
import * as mod from "../mission-migrate.ts";

describe("mission-migrate", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });

  test("exports runMissionMigrate", () => {
    expect(typeof mod.runMissionMigrate).toBe("function");
  });
});
