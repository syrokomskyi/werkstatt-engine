/*
<MODULE_CONTRACT>
<purpose>
Unit tests for logger covering createKernelLogger. It also guards the documented public contract and regression-sensitive edge cases.
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>Fixtures stay inline and minimal so each case states its own setup.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-1311: Compass header sweep — declares the logger suite's contract for test-file scaffold coverage.</item>
</CHANGE_SUMMARY>
*/
// @ai-invariant fixtures must not couple to kernel internals beyond the public surface under test

import { test, expect, describe } from "vitest";
import { createKernelLogger } from "../logger.ts";

describe("createKernelLogger", () => {
  test("creates a logger with all methods", () => {
    const logger = createKernelLogger("pretty");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.success).toBe("function");
    expect(typeof logger.section).toBe("function");
    expect(typeof logger.event).toBe("function");
    expect(typeof logger.getEvents).toBe("function");
  });

  test("records info events", () => {
    const logger = createKernelLogger("pretty");
    logger.info("test message");
    const events = logger.getEvents();
    expect(events).toHaveLength(1);
    expect(events[0]!.level).toBe("info");
    expect(events[0]!.message).toBe("test message");
  });

  test("records warn events", () => {
    const logger = createKernelLogger("pretty");
    logger.warn("warning");
    const events = logger.getEvents();
    expect(events[0]!.level).toBe("warn");
  });

  test("records error events", () => {
    const logger = createKernelLogger("pretty");
    logger.error("error");
    const events = logger.getEvents();
    expect(events[0]!.level).toBe("error");
  });

  test("records section events", () => {
    const logger = createKernelLogger("pretty");
    logger.section("section title");
    const events = logger.getEvents();
    expect(events[0]!.level).toBe("section");
  });

  test("records success events", () => {
    const logger = createKernelLogger("pretty");
    logger.success("done");
    const events = logger.getEvents();
    expect(events[0]!.level).toBe("success");
  });

  test("event() records with default info level", () => {
    const logger = createKernelLogger("pretty");
    logger.event({ message: "custom event" });
    const events = logger.getEvents();
    expect(events[0]!.level).toBe("info");
    expect(events[0]!.message).toBe("custom event");
  });

  test("getEvents returns empty array initially", () => {
    const logger = createKernelLogger("pretty");
    expect(logger.getEvents()).toEqual([]);
  });
});
