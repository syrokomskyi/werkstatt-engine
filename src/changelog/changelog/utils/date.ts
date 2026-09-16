/******************************************************************************* 
<MODULE_CONTRACT> 
<purpose>Maintains packages/os/site-kernel-changelog/src/changelog/utils/date.ts as an authored site-kernel-changelog authored module so agents can evolve it without rediscovering local boundaries.</purpose>
 
 
<non-goals> 
  <item>Do not handle user input or validation for schedule configurations.</item> 
  <item>Do not manage external dependencies or configurations related to scheduling.</item> 
</non-goals> 
</MODULE_CONTRACT> 
 
<CHANGE_SUMMARY>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY> 
******************************************************************************/

// START_BLOCK_TYPES
export type Schedule =
  { mode: "weekly"; weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6 } | { mode: "monthly"; dayOfMonth: number };
// END_BLOCK_TYPES

// START_BLOCK_RELEASE_DAY
/** [CL-SCHED][isTodayReleaseDay][CHECKED] */
export function isTodayReleaseDay(schedule: Schedule, tz: string): boolean {
  const today = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
  if (schedule.mode === "monthly") {
    const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    return today.getDate() === Math.min(schedule.dayOfMonth, lastDayOfMonth);
  }
  return today.getDay() === schedule.weekday;
}
// END_BLOCK_RELEASE_DAY

// START_BLOCK_WINDOW
/** [CL-SCHED][getPeriodWindow][WINDOW_COMPUTED] */
export function getPeriodWindow(schedule: Schedule, tz: string): { from: Date; to: Date } {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
  const to = new Date(now);
  to.setHours(23, 59, 59, 999);
  const from = new Date(now);
  if (schedule.mode === "weekly") {
    from.setDate(from.getDate() - 7);
  } else {
    from.setMonth(from.getMonth() - 1);
  }
  from.setHours(0, 0, 0, 0);
  return { from, to };
}
// END_BLOCK_WINDOW

// START_BLOCK_FORMAT
export function formatDateISO(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
// END_BLOCK_FORMAT
