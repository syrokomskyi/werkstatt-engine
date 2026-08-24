/*
<MODULE_CONTRACT>
<purpose>
RFC-0686: Dependency-aware pipeline scheduler. Translates KernelPipelineStep[]
into a ScheduledStep[] with resolved dependency indices, then executes them
concurrently up to a configurable concurrency limit. Steps whose dependencies
are all completed start concurrently; failed steps cause transitive dependents
to be skipped.
</purpose>
<non-goals>
  <item>Does not handle cache reads/writes, telemetry, or context creation — those remain in execute-pipeline.ts via the executeStep callback.</item>
  <item>Does not handle cross-pipeline dependencies — each pipeline invocation gets its own scheduler instance.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0686: created — buildSchedule, executeScheduledSteps, ScheduledStep interface.</item>
</CHANGE_SUMMARY>
*/

import type { KernelExecutionReport, KernelPipelineStep } from "../types.ts";

export interface ScheduledStep {
  step: KernelPipelineStep;
  stepIndex: number;
  /** Indices of steps this step depends on (resolved from dependsOn command names or implicit sequential ordering). */
  dependencies: Set<number>;
}

export class ScheduleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScheduleError";
  }
}

/**
 * Build a schedule from pipeline steps.
 *
 * For steps WITHOUT `dependsOn`: an implicit dependency on the previous
 * non-skipped step's index is added (backward-compatible sequential behavior).
 *
 * For steps WITH `dependsOn: []`: no dependencies are added (start immediately).
 *
 * For steps WITH `dependsOn: ["cmd.a", "cmd.b"]`: command names are translated
 * to step indices by finding the first step with a matching `command` name
 * that appears before the current step in the array.
 *
 * Throws ScheduleError on:
 * - Forward references (dependsOn references a command that appears later)
 * - Missing references (dependsOn references a command not in the pipeline)
 * - Circular dependencies
 * - Duplicate command names (would make dependsOn ambiguous)
 */
export function buildSchedule(steps: KernelPipelineStep[]): ScheduledStep[] {
  // Detect duplicate command names.
  const commandToFirstIndex = new Map<string, number>();
  for (let i = 0; i < steps.length; i++) {
    const cmd = steps[i]!.command;
    if (commandToFirstIndex.has(cmd)) {
      throw new ScheduleError(
        `Duplicate command name \`${cmd}\` at step index ${i} (first occurrence at index ${commandToFirstIndex.get(cmd)}). dependsOn is ambiguous with duplicate command names.`,
      );
    }
    commandToFirstIndex.set(cmd, i);
  }

  const scheduled: ScheduledStep[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const dependencies = new Set<number>();

    if (step.dependsOn !== undefined) {
      // Explicit dependsOn — resolve command names to indices.
      for (const depName of step.dependsOn) {
        const depIndex = commandToFirstIndex.get(depName);
        if (depIndex === undefined) {
          throw new ScheduleError(
            `Step ${i} (\`${step.command}\`) depends on \`${depName}\` which is not in the pipeline.`,
          );
        }
        if (depIndex >= i) {
          throw new ScheduleError(
            `Step ${i} (\`${step.command}\`) depends on \`${depName}\` which appears at index ${depIndex} (forward reference). Dependencies must appear before the dependent step.`,
          );
        }
        dependencies.add(depIndex);
      }
    } else {
      // Implicit dependency on the previous non-skipped step.
      // Skipped steps (step.skip === true) are treated as completed and
      // don't create implicit dependencies — we look backward for the
      // last non-skipped step.
      for (let j = i - 1; j >= 0; j--) {
        if (!steps[j]!.skip) {
          dependencies.add(j);
          break;
        }
      }
    }

    scheduled.push({ step, stepIndex: i, dependencies });
  }

  // Detect circular dependencies via topological sort (Kahn's algorithm).
  detectCycles(scheduled);

  return scheduled;
}

/**
 * Detect circular dependencies in the schedule using Kahn's algorithm.
 * Throws ScheduleError if a cycle is found.
 */
function detectCycles(scheduled: ScheduledStep[]): void {
  const n = scheduled.length;
  const inDegree = new Array<number>(n).fill(0);
  const adjacency: number[][] = Array.from({ length: n }, () => []);

  for (const s of scheduled) {
    for (const dep of s.dependencies) {
      adjacency[dep]!.push(s.stepIndex);
      inDegree[s.stepIndex]!++;
    }
  }

  const queue: number[] = [];
  for (let i = 0; i < n; i++) {
    if (inDegree[i] === 0) queue.push(i);
  }

  let visited = 0;
  while (queue.length > 0) {
    const node = queue.shift()!;
    visited++;
    for (const neighbor of adjacency[node]!) {
      inDegree[neighbor]!--;
      if (inDegree[neighbor] === 0) queue.push(neighbor);
    }
  }

  if (visited !== n) {
    // Find a node in a cycle for the error message.
    const inCycle = [];
    for (let i = 0; i < n; i++) {
      if (inDegree[i]! > 0) inCycle.push(scheduled[i]!.step.command);
    }
    throw new ScheduleError(`Circular dependency detected involving: ${inCycle.join(" → ")}`);
  }
}

/**
 * Result of executing a single scheduled step.
 * Contains the step index for correlation and the execution report.
 */
export interface StepExecutionResult {
  stepIndex: number;
  report: KernelExecutionReport;
  /** When true, this step was skipped due to a failed dependency (not executed). */
  dependencySkipped: boolean;
}

/**
 * Execute scheduled steps with dependency-aware concurrency.
 *
 * - Steps whose dependencies are all completed start concurrently,
 *   up to `concurrency` parallel executions.
 * - When a step fails, all transitive dependents are skipped with
 *   `dependencySkipped: true`. Independent steps continue executing.
 * - When `concurrency` is 1, the scheduler ignores all `dependsOn` fields
 *   and treats every step as depending on the previous non-skipped step
 *   (full sequential mode with abort-on-failure semantics).
 *
 * The `executeStep` callback handles cache, telemetry, context creation,
 * and progress reporting. It receives a `ScheduledStep` and returns a
 * `KernelExecutionReport`.
 *
 * Returns results sorted by stepIndex (declaration order).
 */
export async function executeScheduledSteps(
  scheduled: ScheduledStep[],
  concurrency: number,
  executeStep: (step: ScheduledStep) => Promise<KernelExecutionReport>,
): Promise<StepExecutionResult[]> {
  const n = scheduled.length;
  const results: StepExecutionResult[] = [];
  const completed = new Set<number>();
  const failed = new Set<number>();
  const skippedDueToFailure = new Set<number>();

  // When concurrency is 1, rebuild the schedule with full sequential
  // implicit dependencies (ignoring all dependsOn fields). This gives
  // true abort-on-failure semantics identical to the current executor.
  let effectiveSchedule = scheduled;
  if (concurrency === 1) {
    effectiveSchedule = scheduled.map((s, i) => ({
      step: s.step,
      stepIndex: s.stepIndex,
      dependencies: new Set<number>(i > 0 && !s.step.skip ? [scheduled[i - 1]!.stepIndex] : []),
    }));
  }

  // Track in-flight steps.
  const inFlight = new Map<number, Promise<void>>();
  // Track which steps are ready to execute (all deps completed, not yet started).
  const readyQueue: number[] = [];

  function updateReady(): void {
    for (const s of effectiveSchedule) {
      if (
        completed.has(s.stepIndex) ||
        failed.has(s.stepIndex) ||
        skippedDueToFailure.has(s.stepIndex)
      )
        continue;
      if (inFlight.has(s.stepIndex)) continue;
      if (readyQueue.includes(s.stepIndex)) continue;

      // Check if any dependency failed or was skipped due to failure.
      let depFailed = false;
      let allDepsComplete = true;
      for (const dep of s.dependencies) {
        if (failed.has(dep) || skippedDueToFailure.has(dep)) {
          depFailed = true;
          break;
        }
        if (!completed.has(dep)) {
          allDepsComplete = false;
          break;
        }
      }

      if (depFailed) {
        // Mark this step and all its transitive dependents as skipped.
        markSkippedDueToFailure(s.stepIndex);
      } else if (allDepsComplete) {
        readyQueue.push(s.stepIndex);
      }
    }
  }

  function markSkippedDueToFailure(stepIndex: number): void {
    if (skippedDueToFailure.has(stepIndex)) return;
    skippedDueToFailure.add(stepIndex);
    // Cascade to dependents.
    for (const s of effectiveSchedule) {
      if (
        s.dependencies.has(stepIndex) &&
        !skippedDueToFailure.has(s.stepIndex) &&
        !completed.has(s.stepIndex) &&
        !failed.has(s.stepIndex)
      ) {
        markSkippedDueToFailure(s.stepIndex);
      }
    }
  }

  function processReadyQueue(): void {
    updateReady();
    while (readyQueue.length > 0 && inFlight.size < concurrency) {
      const idx = readyQueue.shift()!;
      if (completed.has(idx) || failed.has(idx) || skippedDueToFailure.has(idx)) continue;
      if (inFlight.has(idx)) continue;

      const step = effectiveSchedule[idx]!;
      const promise = (async () => {
        const report = await executeStep(step);
        if (report.ok) {
          completed.add(idx);
        } else {
          failed.add(idx);
        }
        results.push({ stepIndex: idx, report, dependencySkipped: false });
        inFlight.delete(idx);
        processReadyQueue();
      })();
      inFlight.set(idx, promise);
    }
  }

  // Process skipped steps (add them to results immediately).
  function processSkipped(): void {
    updateReady();
    // Add skipped-due-to-failure steps to results.
    for (const s of effectiveSchedule) {
      if (
        skippedDueToFailure.has(s.stepIndex) &&
        !results.some((r) => r.stepIndex === s.stepIndex)
      ) {
        results.push({
          stepIndex: s.stepIndex,
          report: {
            commandName: s.step.command,
            exitCode: 0,
            ok: true,
            summary: `Skipped: dependency failed`,
            metadata: {} as never,
            logs: [],
            timing: { durationMs: 0, exceededTimeout: false },
            filesModified: [],
          },
          dependencySkipped: true,
        });
      }
    }
  }

  processReadyQueue();

  // Wait for all in-flight steps to complete, then process again.
  while (inFlight.size > 0 || results.length < n) {
    if (inFlight.size > 0) {
      await Promise.race(inFlight.values());
    }
    processReadyQueue();
    processSkipped();

    // If nothing is in-flight and nothing is ready and we haven't processed
    // everything, we might be stuck — check for remaining steps.
    if (inFlight.size === 0 && readyQueue.length === 0) {
      // Process any remaining skipped steps.
      processSkipped();
      // Check if there are steps that should be ready but weren't picked up.
      updateReady();
      if (readyQueue.length === 0 && results.length < n) {
        // Remaining steps are all skipped due to failure — add them.
        for (const s of effectiveSchedule) {
          if (!results.some((r) => r.stepIndex === s.stepIndex)) {
            if (!skippedDueToFailure.has(s.stepIndex)) {
              markSkippedDueToFailure(s.stepIndex);
            }
          }
        }
        processSkipped();
        break;
      }
    }
  }

  // Sort results by stepIndex (declaration order).
  results.sort((a, b) => a.stepIndex - b.stepIndex);
  return results;
}
