/*******************************************************************************  
<MODULE_CONTRACT>  
<purpose>Implements a logging utility for kernel events with customizable output formats.</purpose>  
  
  
<non-goals>  
  <item>Do not manage log persistence beyond in-memory storage.</item>  
  <item>Do not handle raw content parsing or external configuration management.</item>  
</non-goals>  
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>Log output format is selectable — text for humans, JSON for machine consumers.</item>
</KEY_DECISIONS>  
  
<CHANGE_SUMMARY>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>  
******************************************************************************/

import type { KernelLogEvent, KernelLogLevel, KernelLogger, KernelOutputFormat } from "./types.ts";
function formatPrettyLine(level: KernelLogLevel, message: string): string {
  if (level === "section") {
    return `\n== ${message} ==`;
  }

  const prefix = {
    info: "[INFO]",
    warn: "[WARN]",
    error: "[ERROR]",
    success: "[OK]",
    section: "==",
  } satisfies Record<KernelLogLevel, string>;

  return `${prefix[level]} ${message}`;
}

export function createKernelLogger(outputFormat: KernelOutputFormat = "pretty"): KernelLogger {
  const events: KernelLogEvent[] = [];
  const dedupeCounts = new Map<string, number>();

  const write = (level: KernelLogLevel, message: string, details?: unknown) => {
    const event: KernelLogEvent = {
      level,
      message,
      details,
      timestamp: new Date().toISOString(),
    };

    events.push(event);

    if (outputFormat === "json") {
      return;
    }

    const line = formatPrettyLine(level, message);
    if (level === "error") {
      console.error(line);
      if (details !== undefined) {
        console.error(details);
      }
      return;
    }

    if (level === "warn") {
      console.warn(line);
      if (details !== undefined) {
        console.warn(details);
      }
      return;
    }

    console.log(line);
    if (details !== undefined) {
      console.log(details);
    }
  };

  const writeEvent = (
    event: Omit<KernelLogEvent, "level" | "timestamp"> & { level?: KernelLogLevel },
  ) => {
    const key = event.dedupeKey ?? `${event.kind ?? event.level ?? "info"}:${event.message}`;
    const count = (dedupeCounts.get(key) ?? 0) + 1;
    dedupeCounts.set(key, count);
    const level =
      event.level ??
      (event.severity === "error" ? "error" : event.severity === "warning" ? "warn" : "info");
    const fullEvent: KernelLogEvent = {
      ...event,
      level,
      count,
      timestamp: new Date().toISOString(),
    };
    events.push(fullEvent);

    if (outputFormat === "json" || event.severity === "debug") return;
    if (event.kind === "expected-fallback" && count > 1) return;

    const rendered =
      event.kind === "expected-fallback"
        ? `${event.message}${count > 1 ? ` (${count} occurrence(s))` : ""}`
        : event.message;
    const line = formatPrettyLine(level, rendered);
    if (level === "error") {
      console.error(line);
      if (event.details !== undefined) console.error(event.details);
      return;
    }
    if (level === "warn") {
      console.warn(line);
      if (event.details !== undefined) console.warn(event.details);
      return;
    }
    console.log(line);
    if (event.details !== undefined) console.log(event.details);
  };

  return {
    section: (message, details) => write("section", message, details),
    info: (message, details) => write("info", message, details),
    warn: (message, details) => write("warn", message, details),
    error: (message, details) => write("error", message, details),
    success: (message, details) => write("success", message, details),
    event: (event) => writeEvent(event),
    getEvents: () => [...events],
  };
}
