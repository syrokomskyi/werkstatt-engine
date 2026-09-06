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
