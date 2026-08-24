import type {
  ActionTaskV1,
  ActionAnchorV1,
  ActionDependencyV1,
  CertificationActionPackV1,
} from "./contracts/index.ts";
import type { RequirementEvaluationV1 } from "./aggregation.ts";

export type CertificationActionPackFailureV1 = {
  readonly ok: false;
  readonly code: "CERT-ACTION-01" | "CERT-LIMIT-03";
  readonly message: string;
};

export type CertificationActionPackInputV1 = {
  readonly actionPackId: string;
  readonly candidateId: string;
  readonly decisionId: string;
  readonly requirements: readonly RequirementEvaluationV1[];
  readonly remediationMetadata: ReadonlyMap<string, RemediationMetadataV1>;
  readonly createdAt: string;
};

export type RemediationMetadataV1 = {
  readonly remediationClass: "product-fix" | "infrastructure-retry" | "policy-defect";
  readonly description: string;
  readonly verificationCommand: string;
  readonly anchors: readonly ActionAnchorV1[];
  readonly dependencies: readonly ActionDependencyV1[];
};

const MAX_TASKS = 1000;

function topologicalSort(
  tasks: readonly ActionTaskV1[],
): ActionTaskV1[] | { cycle: true } {
  const taskMap = new Map<string, ActionTaskV1>();
  for (const t of tasks) taskMap.set(t.taskId, t);

  const visited = new Map<string, "visiting" | "done">();
  const result: ActionTaskV1[] = [];

  function visit(id: string): boolean {
    const state = visited.get(id);
    if (state === "done") return true;
    if (state === "visiting") return false;
    visited.set(id, "visiting");
    const task = taskMap.get(id);
    if (task) {
      for (const dep of task.dependencies) {
        if (!visit(dep.dependsOn)) return false;
      }
    }
    visited.set(id, "done");
    const t = taskMap.get(id);
    if (t) result.push(t);
    return true;
  }

  const sortedIds = [...taskMap.keys()].sort();
  for (const id of sortedIds) {
    if (!visit(id)) return { cycle: true };
  }

  return result;
}

export function buildCertificationActionPack(
  input: CertificationActionPackInputV1,
): CertificationActionPackV1 | CertificationActionPackFailureV1 {
  const actionableReqs = input.requirements.filter(
    (r) => r.status !== "pass" && r.status !== "not-applicable",
  );

  const tasks: ActionTaskV1[] = [];

  for (const req of actionableReqs) {
    const meta = input.remediationMetadata.get(req.requirementId);
    if (!meta) {
      return {
        ok: false,
        code: "CERT-ACTION-01",
        message: `requirement ${req.requirementId} has non-pass status but no remediation metadata`,
      };
    }

    if (meta.anchors.length === 0) {
      return {
        ok: false,
        code: "CERT-ACTION-01",
        message: `requirement ${req.requirementId} remediation has no anchors`,
      };
    }

    if (meta.description.length === 0) {
      return {
        ok: false,
        code: "CERT-ACTION-01",
        message: `requirement ${req.requirementId} remediation has empty description`,
      };
    }

    if (meta.verificationCommand.length === 0) {
      return {
        ok: false,
        code: "CERT-ACTION-01",
        message: `requirement ${req.requirementId} remediation has empty verification command`,
      };
    }

    const taskId = `act-${req.requirementId}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");

    tasks.push({
      taskId,
      remediationClass: meta.remediationClass,
      description: meta.description,
      verificationCommand: meta.verificationCommand,
      anchors: [...meta.anchors].sort((a, b) =>
        a.anchorId < b.anchorId ? -1 : a.anchorId > b.anchorId ? 1 : 0,
      ),
      dependencies: [...meta.dependencies].sort((a, b) =>
        a.dependsOn < b.dependsOn ? -1 : a.dependsOn > b.dependsOn ? 1 : 0,
      ),
    });
  }

  if (tasks.length > MAX_TASKS) {
    return {
      ok: false,
      code: "CERT-LIMIT-03",
      message: `action tasks count ${tasks.length} exceeds hard limit ${MAX_TASKS}`,
    };
  }

  const sorted = topologicalSort(tasks);
  if ("cycle" in sorted) {
    return {
      ok: false,
      code: "CERT-ACTION-01",
      message: "dependency cycle detected in action pack tasks",
    };
  }

  return {
    schema: "werkstatt/certification-action-pack@1",
    actionPackId: input.actionPackId,
    candidateId: input.candidateId,
    decisionId: input.decisionId,
    tasks: sorted,
    createdAt: input.createdAt,
  };
}

export const ACTION_PACK_LIMITS = {
  MAX_TASKS,
} as const;
