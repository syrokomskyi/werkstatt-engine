/*
<MODULE_CONTRACT>
<purpose>RFC-0483: PBT test for the rfc-0483 content migrator — verifies
idempotency (f(f(x)) == f(x)) over the reference migration + stopgap removal.</purpose>
<keywords>RFC-0483, migrator, pbt, idempotency, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0483: initial PBT test for content migrator.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import fc from "fast-check";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { rfc0483Migrator } from "./rfc-0483.ts";
import type { SternsystemData, MigrationContext } from "./types.ts";

const ctx: MigrationContext = {
  systemId: "test",
  missionId: "test-mission",
  logger: { info: () => {} },
};

const SAMPLE_REFERENCES = [
  "{business.legal.companyName}",
  "{business.legal.owner.fullName}",
  "{business.legal.owner.address.street}",
  "{business.legal.owner.address.streetNumber}",
  "{business.legal.owner.address.zip}",
  "{business.legal.owner.address.city}",
  "{business.contact.email}",
  "{business.contact.supportEmail}",
  "{business.offer.price.monthly}",
  "{business.offer.price.yearly}",
  "{business.offer.price.setup}",
  "{business.offer.price.monthlyAmount}",
  "{business.offer.price.yearlyAmount}",
  "{business.offer.price.setupAmount}",
  "{business.offer.price.moduleVisibilityAmount}",
  "{business.offer.price.moduleBookingAmount}",
  "{business.offer.price.moduleTrustAmount}",
  "{business.offer.price.moduleMultilangAmount}",
  "{business.offer.price.moduleAutomationAmount}",
  "{business.offer.guarantees.delivery.label}",
  "{business.offer.guarantees.delivery.detail}",
  "{business.offer.guarantees.uptime.label}",
  "{business.offer.guarantees.uptime.detail}",
  "{business.offer.guarantees.smallChanges.label}",
  "{business.offer.guarantees.smallChanges.detail}",
  "{business.offer.guarantees.response.label}",
  "{business.offer.guarantees.response.detail}",
  "{business.offer.guarantees.dataPackage.label}",
  "{business.offer.guarantees.dataPackage.detail}",
  "{business.offer.capacity.display.label}",
  "{business.offer.capacity.display.rangeLabel}",
  "{business.offer.capacity.display.unknownAvailabilityLabel}",
  "{business.offer.growthModules.visibility.label}",
  "{business.offer.growthModules.visibility.price}",
  "{business.offer.growthModules.booking.label}",
  "{business.offer.growthModules.booking.price}",
  "{business.offer.growthModules.trust.label}",
  "{business.offer.growthModules.trust.price}",
  "{business.offer.growthModules.multilingual.label}",
  "{business.offer.growthModules.multilingual.price}",
  "{business.offer.growthModules.automation.label}",
  "{business.offer.growthModules.automation.price}",
  "{business.offer.changePrice}",
  "{business.offer.hourlyRate}",
  "{business.offer.billingDay}",
  "{business.legal.tax.taxNumber}",
  "{business.legal.tax.vatIdOrSmallBusinessNote}",
  "{business.web.domains.primary}",
  "{business.meta.agbEffectiveDate}",
  "{business.meta.agbNextReviewDate}",
  "{business.meta.datenschutzCreationDate}",
  "{business.meta.impressumLastUpdateDate}",
  "{business.meta.barrierefreiheitCreationDate}",
  "{business.meta.barrierefreiheitLastReviewDate}",
  "{business.meta.widerrufCreationDate}",
  "{business.meta.widerrufFormCreationDate}",
  "{business.platform-comparison.display.pageText}",
  "{business.platform-comparison.display.disclosure}",
  "{business.services.websiteDevelopment.backupRetentionDays}",
  "{business.external-services.chatbotPlatform}",
];

async function withTempWorkpiece(
  setup: (dir: string) => Promise<void>,
  fn: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0483-pbt-"));
  try {
    await setup(dir);
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function createBaseWorkpiece(dir: string): Promise<void> {
  const contentDir = path.join(dir, "src", "content");
  await fs.mkdir(contentDir, { recursive: true });
  await fs.writeFile(
    path.join(contentDir, "system.md"),
    `---\ni18n:\n  default: de\n  supported:\n    de:\n      name: Deutsch\n---\n`,
  );
  await fs.writeFile(
    path.join(dir, "src", "content.config.ts"),
    `// GENERATED. Do not change this line unless the file contains project specific changes.\nimport { defineCollection } from "astro:content";\nimport { fsDataCollectionLoader } from "@warpgogol/werkstatt-site/content-source";\nimport { pbpCollections } from "@warpgogol/werkstatt-site/pbp/astro";\nimport { toDataEntryId } from "@warpgogol/werkstatt-shared/share/content";\n\nconst business = defineCollection({\n  loader: fsDataCollectionLoader({\n    base: "src/content/business",\n    generateId: (entry) => toDataEntryId(entry),\n  }),\n  schema: z.object({}).catchall(z.any()),\n});\n\nexport const collections = {\n  ...pbpCollections,\n  business,\n};\n`,
  );
}

async function createLegacyBusinessFiles(dir: string): Promise<void> {
  const businessDir = path.join(dir, "src", "content", "business", "de");
  await fs.mkdir(businessDir, { recursive: true });
  await fs.writeFile(
    path.join(businessDir, "offer.md"),
    `---\nprice:\n  monthly: "70"\n  yearly: "700"\n  setup: "200"\nguarantees:\n  delivery:\n    label: "Test"\n    detail: "Test detail"\ncapacity:\n  display:\n    label: "Available"\n    rangeLabel: "1-3"\n    unknownAvailabilityLabel: "Unknown"\ngrowthModules:\n  visibility:\n    label: "Visibility"\n    price: "30"\nchangePrice: "15"\nhourlyRate: "80"\nbillingDay: "1"\n---\n`,
  );
  await fs.writeFile(
    path.join(businessDir, "legal.md"),
    `---\ncompanyName: "Test GmbH"\nowner:\n  fullName: "Test Person"\n  address:\n    street: "Test St"\n    streetNumber: "1"\n    zip: "12345"\n    city: "Test City"\ntax:\n  taxNumber: "123/456"\n  vatIdOrSmallBusinessNote: "Small business"\n---\n`,
  );
  await fs.writeFile(
    path.join(businessDir, "contact.md"),
    `---\nemail: "test@test.com"\nsupportEmail: "support@test.com"\n---\n`,
  );
  await fs.writeFile(
    path.join(businessDir, "web.md"),
    `---\ndomains:\n  primary: "test.com"\n---\n`,
  );
  await fs.writeFile(
    path.join(businessDir, "meta.md"),
    `---\nagbEffectiveDate: "2026-01-01"\ndatenschutzCreationDate: "2026-01-01"\nimpressumLastUpdateDate: "2026-01-01"\nwiderrufCreationDate: "2026-01-01"\nwiderrufFormCreationDate: "2026-01-01"\nagbNextReviewDate: "2027-01-01"\nbarrierefreiheitCreationDate: "2026-01-01"\nbarrierefreiheitLastReviewDate: "2026-01-01"\n---\n`,
  );
  await fs.writeFile(
    path.join(businessDir, "external-services.md"),
    `---\nchatbotPlatform: "TestPlatform"\n---\n`,
  );
  await fs.writeFile(
    path.join(businessDir, "company.md"),
    `---\nplatformComparison:\n  display:\n    pageText: "Test comparison"\n    disclosure: "Test disclosure"\nservices:\n  websiteDevelopment:\n    backupRetentionDays: "30"\n---\n`,
  );
}

async function createUkPbpEntities(dir: string): Promise<void> {
  const ukDir = path.join(dir, "src", "content", "business-profile", "uk");
  const subdirs = [
    "contact",
    "organization",
    "places",
    "web",
    "offerings",
    "catalog",
    "catalog/entries",
    "policies",
    "documents",
    "products",
    "trust/claims",
    "trust/disclosures",
    "trust/evidence",
  ];
  for (const sub of subdirs) {
    await fs.mkdir(path.join(ukDir, sub), { recursive: true });
  }
  await fs.writeFile(
    path.join(ukDir, "organization", "legal-identity.md"),
    `---\nschema: pbp/legal-identity@1\nid: https://test.com/id/legal-identity\ntype: legal-identity\nstatus: draft\nname: Test\nlegalName: Test\nresponsiblePerson:\n  name: "Test Person"\ngovernance:\n  authorityRef: https://test.com/id/business\n  effectiveFrom: "2026-01-01"\n---\n`,
  );
  await fs.writeFile(
    path.join(ukDir, "contact", "general-email.md"),
    `---\nschema: pbp/contact-point@1\nid: https://test.com/id/contact/general-email\ntype: contact-point\nstatus: published\nname: "Contact"\nchannel: email\nvalue: test@test.com\ngovernance:\n  authorityRef: https://test.com/id/business\n  effectiveFrom: "2026-01-01"\n---\n`,
  );
  await fs.writeFile(
    path.join(ukDir, "places", "backnang.md"),
    `---\nschema: pbp/place@1\nid: https://test.com/id/places/backnang\ntype: place\nstatus: draft\nname: "Test Place"\naddress:\n  street: Test St\n  streetNumber: "1"\n  postalCode: "12345"\n  locality: Test City\n  countryCode: DE\ngovernance:\n  authorityRef: https://test.com/id/business\n  effectiveFrom: "2026-01-01"\n---\n`,
  );
  await fs.writeFile(
    path.join(ukDir, "web", "primary.md"),
    `---\nschema: pbp/web-presence@1\nid: https://test.com/id/web/primary\ntype: web-presence\nstatus: published\nname: "Test Web"\ncanonicalUrl: https://test.com/\ngovernance:\n  authorityRef: https://test.com/id/business\n  effectiveFrom: "2026-01-01"\n---\n`,
  );
  await fs.writeFile(
    path.join(ukDir, "offerings", "digital-foundation.md"),
    `---\nschema: pbp/offering@1\nid: https://test.com/id/offerings/digital-foundation\ntype: offering\nstatus: published\nname: "Test Offering"\ngovernance:\n  authorityRef: https://test.com/id/business\n  effectiveFrom: "2026-01-01"\n---\n`,
  );
  for (const doc of ["terms", "privacy", "imprint", "legal-notice"]) {
    await fs.writeFile(
      path.join(ukDir, "documents", `${doc}.md`),
      `---\nschema: pbp/public-document@1\nid: https://test.com/id/documents/${doc}\ntype: public-document\nstatus: published\nname: "Test ${doc}"\nkind: ${doc}\ngovernance:\n  authorityRef: https://test.com/id/business\n  effectiveFrom: "2026-01-01"\n---\n`,
    );
  }
  await fs.writeFile(
    path.join(ukDir, "business.md"),
    `---\nschema: pbp/business@1\nid: https://test.com/id/business\ntype: business\nstatus: published\nname: Test\ngovernance:\n  authorityRef: https://test.com/id/business\n  effectiveFrom: "2026-01-01"\n---\n`,
  );
}

async function createOldFormatBpFiles(dir: string): Promise<void> {
  const deDir = path.join(dir, "src", "content", "business-profile", "de");
  await fs.mkdir(deDir, { recursive: true });
  await fs.writeFile(path.join(deDir, "company.md"), `---\nid: Test\nname: Test\n---\n`);
  await fs.writeFile(path.join(deDir, "contact.md"), `---\nemail: test@test.com\n---\n`);
  await fs.writeFile(path.join(deDir, "location.md"), `---\ncity:\n  name: Test\n---\n`);
  await fs.writeFile(path.join(deDir, "web.md"), `---\ndomains:\n  primary: test.com\n---\n`);
}

async function createPagesWithReferences(dir: string, references: string[]): Promise<void> {
  const pagesDir = path.join(dir, "src", "content", "pages", "de");
  await fs.mkdir(pagesDir, { recursive: true });
  const body = references.map((r) => `- ${r}`).join("\n");
  await fs.writeFile(
    path.join(pagesDir, "test-page.md"),
    `---\nkind: page\npageId: test-page\ncosmicStar: star-alpha\nblocks: []\n---\n${body}\n`,
  );
}

const refSubsetArbitrary = fc.array(fc.constantFrom(...SAMPLE_REFERENCES), {
  minLength: 1,
  maxLength: 60,
});

test("rfc-0483 migrator is idempotent: f(f(x)) == f(x) for random reference subsets", async () => {
  await fc.asyncProperty(refSubsetArbitrary, async (refs) => {
    await withTempWorkpiece(
      async (dir) => {
        await createBaseWorkpiece(dir);
        await createLegacyBusinessFiles(dir);
        await createUkPbpEntities(dir);
        await createOldFormatBpFiles(dir);
        await createPagesWithReferences(dir, refs);
      },
      async (dir) => {
        const data: SternsystemData = { rootPath: dir, dataPaths: [] };
        const once = await rfc0483Migrator.transform(data, ctx);

        const pagePath = path.join(dir, "src", "content", "pages", "de", "test-page.md");
        const content1 = await fs.readFile(pagePath, "utf8");
        expect(content1).not.toContain("{business.");
        expect(content1).toContain("{business-profile.");

        const businessDir = path.join(dir, "src", "content", "business");
        let businessExists = false;
        try {
          await fs.access(businessDir);
          businessExists = true;
        } catch {
          businessExists = false;
        }
        expect(businessExists).toBe(false);

        for (const oldFile of ["company.md", "contact.md", "location.md", "web.md"]) {
          const oldPath = path.join(dir, "src", "content", "business-profile", "de", oldFile);
          let oldExists = false;
          try {
            await fs.access(oldPath);
            oldExists = true;
          } catch {
            oldExists = false;
          }
          expect(oldExists).toBe(false);
        }

        const twice = await rfc0483Migrator.transform(once, ctx);
        const content2 = await fs.readFile(pagePath, "utf8");
        expect(content2).toEqual(content1);
        expect(twice).toEqual(once);
      },
    );
  });
});

test("rfc-0483 migrator is a no-op on already-migrated content", async () => {
  await withTempWorkpiece(
    async (dir) => {
      await createBaseWorkpiece(dir);
      await createUkPbpEntities(dir);
      const pagesDir = path.join(dir, "src", "content", "pages", "de");
      await fs.mkdir(pagesDir, { recursive: true });
      await fs.writeFile(
        path.join(pagesDir, "test-page.md"),
        `---\nkind: page\npageId: test-page\ncosmicStar: star-alpha\nblocks: []\n---\n- {business-profile.contact/general-email.value}\n`,
      );
    },
    async (dir) => {
      const data: SternsystemData = { rootPath: dir, dataPaths: [] };
      const result = await rfc0483Migrator.transform(data, ctx);
      expect(result).toEqual(data);
    },
  );
});
