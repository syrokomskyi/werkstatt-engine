import { test, expect, describe } from "vitest";
import * as mod from "../mission-journal-show.ts";

describe("mission-journal-show", () => {
  test("module loads successfully", () => {
    expect(mod).toBeDefined();
  });

  test("exports runMissionJournalShow", () => {
    expect(typeof mod.runMissionJournalShow).toBe("function");
  });
});
