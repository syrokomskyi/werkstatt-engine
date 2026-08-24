/*
<MODULE_CONTRACT>
<purpose>RFC-0508: snapshot test for the rfc-0508 migrator — verifies that
Participant fields are correctly added to Person records on a clean run.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0508: initial snapshot test for rfc-0508 migrator.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { rfc0508Migrator } from "./rfc-0508.ts";
import type { SternsystemData, MigrationContext } from "./types.ts";

const SAMPLE_PERSON_PUBLIC = `---
slug: "andrii-syrokomskyi"
name: "Andrii Syrokomskyi"
role: "Gründer"
photo: andrii-portrait
affiliations: [founder]
location: "Backnang"
lifespan:
  born: 1977
sameAs:
  - "https://linkedin.com/in/syrokomskyi"
statement: "Test statement."
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

const SAMPLE_PERSON_PRIVATE = `---
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

test("rfc-0508 migrator snapshot — public person after migration", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0508-snap-"));
  const data: SternsystemData = { rootPath: tmpDir, dataPaths: [] };
  const ctx: MigrationContext = {
    systemId: "test-system",
    missionId: "test-mission",
    logger: { info: () => {} },
  };

  try {
    const peopleDir = path.join(tmpDir, "src", "content", "people", "de");
    await fs.mkdir(peopleDir, { recursive: true });
    await fs.writeFile(
      path.join(peopleDir, "andrii-syrokomskyi.md"),
      SAMPLE_PERSON_PUBLIC,
      "utf-8",
    );

    await rfc0508Migrator.transform(data, ctx);
    const content = await fs.readFile(path.join(peopleDir, "andrii-syrokomskyi.md"), "utf-8");
    expect(content).toMatchInlineSnapshot(`
      "---
      slug: "andrii-syrokomskyi"
      name: "Andrii Syrokomskyi"
      role: "Gründer"
      photo: andrii-portrait
      affiliations: [founder]
      location: "Backnang"
      lifespan:
        born: 1977
      sameAs:
        - "https://linkedin.com/in/syrokomskyi"
      statement: "Test statement."
      cta:
        label: "Contact"
        target: contact
      page:
        enabled: true
      order: 1
      bio: |
        Test bio.
      participantType: human
      status: active
      visibility: public
      relationshipType: founder
      consent:
        consentRecordId: "consent-andrii-syrokomskyi"
        approvedFields: ["lifespan.born", "location", "bio", "photo", "sameAs"]
        consentDate: "2026-07-24"
        profileReviewer: "andrii-syrokomskyi"
      ---
      "
    `);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("rfc-0508 migrator snapshot — private person after migration", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0508-snap-"));
  const data: SternsystemData = { rootPath: tmpDir, dataPaths: [] };
  const ctx: MigrationContext = {
    systemId: "test-system",
    missionId: "test-mission",
    logger: { info: () => {} },
  };

  try {
    const peopleDir = path.join(tmpDir, "src", "content", "people", "de");
    await fs.mkdir(peopleDir, { recursive: true });
    await fs.writeFile(path.join(peopleDir, "private-person.md"), SAMPLE_PERSON_PRIVATE, "utf-8");

    await rfc0508Migrator.transform(data, ctx);
    const content = await fs.readFile(path.join(peopleDir, "private-person.md"), "utf-8");
    expect(content).toMatchInlineSnapshot(`
      "---
      slug: "private-person"
      name: "Private Person"
      affiliations: [team]
      page:
        enabled: false
      order: 2
      bio: |
        Private bio.
      participantType: human
      status: draft
      visibility: private
      relationshipType: team
      ---
      "
    `);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
