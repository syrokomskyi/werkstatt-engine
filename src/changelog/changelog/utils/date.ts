/******************************************************************************* 
<MODULE_CONTRACT> 
<purpose>Maintains packages/os/site-kernel-changelog/src/changelog/utils/date.ts as an authored site-kernel-changelog authored module so agents can evolve it without rediscovering local boundaries.</purpose>
 
 
<non-goals> 
  <item>Do not handle user input or validation for schedule configurations.</item> 
  <item>Do not manage external dependencies or configurations related to scheduling.</item> 
</non-goals> 
</MODULE_CONTRACT> 
 
<CHANGE_SUMMARY>
  <item>Added Compass scaffolding to enhance navigability and maintainability of date utilities.</item>
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
