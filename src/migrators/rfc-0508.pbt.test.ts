/*
<MODULE_CONTRACT>
<purpose>RFC-0508: PBT test for the rfc-0508 migrator — verifies idempotency
(f(f(x)) == f(x)) and that Participant fields are correctly added to Person records.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0508: initial PBT test for rfc-0508 migrator idempotency and field addition.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { rfc0508Migrator } from "./rfc-0508.ts";
import type { SternsystemData, MigrationContext } from "./types.ts";

function makeCtx(): MigrationContext {
  return {
    systemId: "test-system",
    missionId: "test-mission",
    logger: { info: () => {} },
  };
}

function makeData(tmpDir: string): SternsystemData {
  return {
    rootPath: tmpDir,
    dataPaths: [],
  };
}

const SAMPLE_PERSON = `---
slug: "test-person"
name: "Test Person"
role: "Developer"
photo: test-portrait
affiliations: [founder]
location: "Berlin"
lifespan:
  born: 1980
sameAs:
  - "https://linkedin.com/in/test"
statement: "A test person."
stats:
  - label: "Years"
    value: "10"
cta:
  label: "Contact"
  target: contact
page:
  enabled: true
order: 1
bio: |
  Test bio.
---
`;

const SAMPLE_PERSON_NO_PAGE = `---
slug: "private-person"
name: "Private Person"
affiliations: [team]
page:
  enabled: false
order: 2
bio: |
  Private bio.
---
`;

test("rfc-0508 migrator is idempotent — f(f(x)) == f(x)", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0508-pbt-"));
  const data = makeData(tmpDir);
  const ctx = makeCtx();

  try {
    const peopleDir = path.join(tmpDir, "src", "content", "people", "de");
    await fs.mkdir(peopleDir, { recursive: true });
    await fs.writeFile(path.join(peopleDir, "test-person.md"), SAMPLE_PERSON, "utf-8");
    await fs.writeFile(path.join(peopleDir, "private-person.md"), SAMPLE_PERSON_NO_PAGE, "utf-8");

    // First run
    await rfc0508Migrator.transform(data, ctx);
    const after1a = await fs.readFile(path.join(peopleDir, "test-person.md"), "utf-8");
    const after1b = await fs.readFile(path.join(peopleDir, "private-person.md"), "utf-8");

    // Second run
    await rfc0508Migrator.transform(data, ctx);
    const after2a = await fs.readFile(path.join(peopleDir, "test-person.md"), "utf-8");
    const after2b = await fs.readFile(path.join(peopleDir, "private-person.md"), "utf-8");

    expect(after1a).toBe(after2a);
    expect(after1b).toBe(after2b);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("rfc-0508 migrator adds participantType: human", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0508-pbt-"));
  const data = makeData(tmpDir);
  const ctx = makeCtx();

  try {
    const peopleDir = path.join(tmpDir, "src", "content", "people", "de");
    await fs.mkdir(peopleDir, { recursive: true });
    await fs.writeFile(path.join(peopleDir, "test-person.md"), SAMPLE_PERSON, "utf-8");

    await rfc0508Migrator.transform(data, ctx);

    const content = await fs.readFile(path.join(peopleDir, "test-person.md"), "utf-8");
    expect(content).toMatch(/^participantType:\s*human/m);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("rfc-0508 migrator adds status and visibility based on page.enabled", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0508-pbt-"));
  const data = makeData(tmpDir);
  const ctx = makeCtx();

  try {
    const peopleDir = path.join(tmpDir, "src", "content", "people", "de");
    await fs.mkdir(peopleDir, { recursive: true });
    await fs.writeFile(path.join(peopleDir, "test-person.md"), SAMPLE_PERSON, "utf-8");
    await fs.writeFile(path.join(peopleDir, "private-person.md"), SAMPLE_PERSON_NO_PAGE, "utf-8");

    await rfc0508Migrator.transform(data, ctx);

    const publicContent = await fs.readFile(path.join(peopleDir, "test-person.md"), "utf-8");
    expect(publicContent).toMatch(/^status:\s*active/m);
    expect(publicContent).toMatch(/^visibility:\s*public/m);

    const privateContent = await fs.readFile(path.join(peopleDir, "private-person.md"), "utf-8");
    expect(privateContent).toMatch(/^status:\s*draft/m);
    expect(privateContent).toMatch(/^visibility:\s*private/m);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("rfc-0508 migrator derives relationshipType from affiliations", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0508-pbt-"));
  const data = makeData(tmpDir);
  const ctx = makeCtx();

  try {
    const peopleDir = path.join(tmpDir, "src", "content", "people", "de");
    await fs.mkdir(peopleDir, { recursive: true });
    await fs.writeFile(path.join(peopleDir, "test-person.md"), SAMPLE_PERSON, "utf-8");

    await rfc0508Migrator.transform(data, ctx);

    const content = await fs.readFile(path.join(peopleDir, "test-person.md"), "utf-8");
    expect(content).toMatch(/^relationshipType:\s*founder/m);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("rfc-0508 migrator adds consent for public humans with page.enabled", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0508-pbt-"));
  const data = makeData(tmpDir);
  const ctx = makeCtx();

  try {
    const peopleDir = path.join(tmpDir, "src", "content", "people", "de");
    await fs.mkdir(peopleDir, { recursive: true });
    await fs.writeFile(path.join(peopleDir, "test-person.md"), SAMPLE_PERSON, "utf-8");

    await rfc0508Migrator.transform(data, ctx);

    const content = await fs.readFile(path.join(peopleDir, "test-person.md"), "utf-8");
    expect(content).toMatch(/^consent:/m);
    expect(content).toMatch(/consentRecordId:\s*"consent-test-person"/);
    expect(content).toMatch(/profileReviewer:\s*"test-person"/);
    expect(content).toMatch(/consentDate:\s*"2026-07-24"/);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("rfc-0508 migrator does not add consent for private persons", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0508-pbt-"));
  const data = makeData(tmpDir);
  const ctx = makeCtx();

  try {
    const peopleDir = path.join(tmpDir, "src", "content", "people", "de");
    await fs.mkdir(peopleDir, { recursive: true });
    await fs.writeFile(path.join(peopleDir, "private-person.md"), SAMPLE_PERSON_NO_PAGE, "utf-8");

    await rfc0508Migrator.transform(data, ctx);

    const content = await fs.readFile(path.join(peopleDir, "private-person.md"), "utf-8");
    expect(content).not.toMatch(/^consent:/m);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("rfc-0508 migrator handles empty people directory gracefully", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0508-pbt-"));
  const data = makeData(tmpDir);
  const ctx = makeCtx();

  try {
    // No people directory at all
    await rfc0508Migrator.transform(data, ctx);
    // Should not throw
    expect(true).toBe(true);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
