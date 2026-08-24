import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test, expect } from "vitest";
import { runAdrValidate } from "../adr/index.ts";
import type { KernelCommandInput, KernelLogger, KernelRuntimeContext } from "../types.ts";
import { createDefaultIO } from "../workspace-io.ts";

/*
<MODULE_CONTRACT>
  <purpose>
    Regression coverage for ADR validation rules that need both docs/adrs and
    docs/rfcs fixture state.
  </purpose>
  <responsibilities>
    <item>Assert an ADR can be superseded by a broader RFC decision.</item>
    <item>Assert a missing RFC superseder is still reported.</item>
  </responsibilities>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Post-refactor hardening: cover cross-domain ADR supersession by RFC id.</item>
</CHANGE_SUMMARY>
*/

const noopLogger: KernelLogger = {
  section() {},
  info() {},
  warn() {},
  error() {},
  success() {},
  event() {},
  getEvents() {
    return [];
  },
};

function ctx(workspaceRoot: string): KernelRuntimeContext {
  return {
    workspaceRoot,
    siteExplicit: false,
    logger: noopLogger,
    dryRun: false,
    outputFormat: "json",
    io: createDefaultIO().io,
  };
}

const input: KernelCommandInput = { argv: [], flags: {} };

function adr(supersededBy: string): string {
  return `---
id: ADR-9001
title: "Fixture ADR"
status: superseded
scope: workspace
decider: architecture
createdAt: 2026-07-09
updatedAt: 2026-07-09
implementedAt: 2026-07-09
closedAt: 2026-07-09
supersedes: []
supersededBy: ${supersededBy}
related: []
reviewers:
  - human:andrii-syrokomskyi
---

# ADR-9001: Fixture ADR

## Context
x

## Decision
x

## Justification
x

## Consequences
x

## Evolution
x
`;
}

function rfc(id: string): string {
  return `---
id: ${id}
title: "Fixture RFC"
status: implemented
kind: architecture
scope: workspace
owners:
  - architecture
reviewers:
  - human:andrii-syrokomskyi
createdAt: 2026-07-09
updatedAt: 2026-07-09
implementedAt: 2026-07-09
closedAt:
supersedes: []
supersededBy:
amends: []
amendedBy: []
related: []
satisfies:
  - DNA-35
commands:
  proposed: []
  added: []
  changed: []
  removed: []
appsImpacted: []
packagesImpacted: []
successSignals: []
nonGoals: []
---

# ${id}: Fixture RFC

## Context
x

## Problem
x

## Decision
x

## Architectural fit
x

## Design
x

## Rollout
x

## Alternatives considered
x

## Risks
x

## Acceptance criteria
- [ ] a
- [ ] b
- [ ] c

## Implementation notes for agents
x
`;
}

async function setup(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "adr-validate-"));
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(root, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
  }
  return root;
}

test("adr.validate allows a superseded ADR to point at an existing RFC", async () => {
  const root = await setup({
    "docs/adrs/adr-9001-fixture-adr.md": adr("RFC-9002"),
    "docs/rfcs/rfc-9002-fixture-rfc.md": rfc("RFC-9002"),
  });
  try {
    const result = await runAdrValidate(input, ctx(root));
    expect(result.data?.violations ?? []).toEqual([]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("adr.validate rejects a superseded ADR pointing at a missing RFC", async () => {
  const root = await setup({
    "docs/adrs/adr-9001-fixture-adr.md": adr("RFC-9999"),
  });
  try {
    const result = await runAdrValidate(input, ctx(root));
    expect((result.data?.violations ?? []).some((v: { rule?: string }) => v.rule === "AV-09")).toBe(
      true,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
