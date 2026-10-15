/*
<MODULE_CONTRACT>
<purpose>RFC-1301 parity test — every fixture entity gets the same accept/reject
verdict from the canonical pbpSchemaById Zod schema and from the exported
werkstatt:intake/v1 JSON Schema $defs (Ajv draft 2020-12), so external
producers can validate pbp[] entities without the werkstatt checkout.</purpose>
</MODULE_CONTRACT>
*/

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import YAML from "yaml";

import { pbpSchemaById } from "@warpgogol/pbp/entities";
import {
  INTAKE_PBP_SCHEMA_ALLOWLIST,
  intakePbpDefKey,
  renderIntakeSchemaExport,
} from "@warpgogol/werkstatt-shared/onboarding/intake";

import { renderIntakePbpEntityJsonSchemas } from "./intake-schema-export.ts";

const base = (type: string, id: string) => ({
  schema: `pbp/${type}@1`,
  id,
  type,
  status: "published",
});

const VALID: Record<string, unknown>[] = [
  {
    ...base("business", "business/dp7"),
    name: "DP7",
    legalIdentityRef: { ref: "pbp/legal-identity@1:legal-identity/dp7" },
  },
  { ...base("legal-identity", "legal-identity/dp7"), legalName: "DP7 Digitalprojekt GmbH" },
  {
    ...base("offering", "offering/seo-audit"),
    name: "SEO Audit Standard",
    businessRef: { ref: "pbp/business@1:business/dp7" },
    availability: { mode: "declared" },
    pricing: { currency: "EUR" },
  },
  {
    ...base("claim", "claim/european-quality"),
    claimClass: "factual",
    claimKind: "fact",
    subject: { kind: "business", name: "DP7" },
    statement: "European quality",
    statementLang: "en",
    governance: { authorityRef: "pbp/business@1:business/dp7" },
  },
  {
    ...base("evidence-source", "evidence-source/src-01"),
    name: "Client interview",
    kind: "client-statement",
    authority: { kind: "client" },
    slug: "client-interview",
    display: { document: "visible", screenshot: "hidden", websiteLink: "hidden" },
    items: { src: { sha256: "a".repeat(64), mediaType: "text/markdown", storage: "private" } },
  },
  {
    ...base("disclosure", "disclosure/cdn"),
    kind: "technology-dependency",
    name: "Cloudflare Dependency",
    statement: "Site uses Cloudflare CDN",
    materiality: "informative",
    publication: { required: true },
  },
  {
    ...base("contact-point", "contact-point/email"),
    name: "General Email",
    channel: "email",
    value: "hello@example.com",
  },
  {
    ...base("brand", "brand/dp7"),
    name: "DP7",
    ownerBusinessRef: { ref: "pbp/business@1:business/dp7" },
  },
];

/** Structural violations — both validators must reject. */
const INVALID: Record<string, unknown>[] = [
  { ...VALID[0], name: undefined },
  { ...VALID[0], unknownField: 1 },
  { ...VALID[1], status: "archived" },
  { ...VALID[2], businessRef: undefined },
  { ...VALID[2], presentation: { price: { monthly: "70 € / Monat" } } },
  { ...VALID[3], claimClass: 42 },
  { ...VALID[4], items: "src" },
  { ...VALID[5], publication: { required: "yes" } },
  { ...VALID[6], channel: "fax" },
  { ...VALID[7], ownerBusinessRef: undefined },
].map((e) => JSON.parse(JSON.stringify(e)) as Record<string, unknown>);

function exportedValidators() {
  const doc = YAML.parse(
    renderIntakeSchemaExport({ pbpEntitySchemas: renderIntakePbpEntityJsonSchemas() }),
  ) as Record<string, unknown>;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  ajv.addSchema(doc);
  const id = doc["$id"] as string;
  return (schemaId: string) => ajv.getSchema(`${id}#/$defs/${intakePbpDefKey(schemaId)}`)!;
}

describe("RFC-1301 intake pbp entity JSON Schema parity", () => {
  const exported = exportedValidators();

  it("exports a $defs entry for every v1 allow-listed entity type", () => {
    for (const id of INTAKE_PBP_SCHEMA_ALLOWLIST) expect(exported(id)).toBeTypeOf("function");
  });

  it("covers every allow-listed type in the valid fixture set", () => {
    expect(new Set(VALID.map((e) => e["schema"]))).toEqual(new Set(INTAKE_PBP_SCHEMA_ALLOWLIST));
  });

  for (const entity of [...VALID, ...INVALID]) {
    const label = `${String(entity["schema"])} ${JSON.stringify(entity).slice(0, 80)}`;
    it(`agrees with pbpSchemaById: ${label}`, () => {
      const schemaId = entity["schema"] as string;
      const zodOk = pbpSchemaById[schemaId]!.safeParse(entity).success;
      const jsonOk = exported(schemaId)(entity) as boolean;
      expect(jsonOk).toBe(zodOk);
    });
  }

  it("accepts every valid fixture and rejects every invalid one", () => {
    for (const e of VALID)
      expect(pbpSchemaById[e["schema"] as string]!.safeParse(e).success).toBe(true);
    for (const e of INVALID)
      expect(pbpSchemaById[e["schema"] as string]!.safeParse(e).success, JSON.stringify(e)).toBe(
        false,
      );
  });
});
