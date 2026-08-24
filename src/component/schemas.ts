import { z } from "zod";
import type {
  ComponentContractResult,
  ComponentContractViolation,
  ComponentManifestV1,
  ResolvedComponentSetV1,
} from "./contracts.ts";

const COMPONENT_ID_RE = /^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/;
const CAPABILITY_ID_RE = /^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/;
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const COMPAT_RE = /^(?:\^|~|>=?|<=?|=)?\s*(?:0|[1-9]\d*)\.(?:0|[1-9]\d*|x)\.(?:0|[1-9]\d*|x)(?:\.\d+)?$/;

const MAX_PROVIDES = 64;
const MAX_REQUIRES = 128;
const MAX_GRANTS = 32;
const MAX_EFFECTS = 64;
const MAX_RESOURCES = 64;
const MAX_COMPONENTS = 256;
const MAX_STRING_BYTES = 4096;
const MAX_DESC_BYTES = 2048;
const MAX_PROFILE_ID_LEN = 128;

const componentIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(COMPONENT_ID_RE, "invalid componentId: must be namespace/name, lowercase alphanumeric and hyphens");

const capabilityIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(CAPABILITY_ID_RE, "invalid capability: must be namespace/name, lowercase alphanumeric and hyphens");

const semverSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(SEMVER_RE, "invalid semver version");

const sha256Schema = z
  .string()
  .min(1)
  .max(80)
  .regex(SHA256_RE, "invalid sha256 digest");

const compatSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(COMPAT_RE, "invalid compatibility range");

const boundedString = (max: number) =>
  z.string().min(1).max(max);

const effectClassSchema = z.enum([
  "revertible",
  "transactional",
  "compensatable",
  "irreversible-emission",
]);

const isolationTierSchema = z.enum([
  "trusted-in-process",
  "sandboxed",
]);

const grantScopeSchema = z.enum([
  "read",
  "append",
  "deploy",
  "certify",
  "administer",
]);

const resourceKindSchema = z.enum([
  "cpu",
  "memory",
  "disk",
  "network",
  "timer",
  "subprocess",
]);

const lifecycleScopeSchema = z.enum([
  "process",
  "request",
  "session",
  "scheduled",
]);

const capabilityProvideSchema = z.object({
  capability: capabilityIdSchema,
  version: semverSchema,
  schemaHash: sha256Schema,
}).strict();

const capabilityRequireSchema = z.object({
  capability: capabilityIdSchema,
  compatibility: compatSchema,
  schemaHash: sha256Schema.nullable(),
  optional: z.boolean(),
}).strict();

const grantRequestSchema = z.object({
  scope: grantScopeSchema,
  resource: boundedString(MAX_STRING_BYTES),
  attenuated: z.boolean(),
}).strict();

const effectDeclarationSchema = z.object({
  effectClass: effectClassSchema,
  description: boundedString(MAX_DESC_BYTES),
  recoveryCommand: z.string().max(MAX_STRING_BYTES).nullable(),
  commitMetadata: z.string().max(MAX_STRING_BYTES).nullable(),
}).strict();

const isolationRequirementSchema = z.object({
  tier: isolationTierSchema,
  adapterId: z.string().max(128).nullable(),
}).strict();

const resourceBoundSchema = z.object({
  kind: resourceKindSchema,
  limit: boundedString(MAX_STRING_BYTES),
  owner: componentIdSchema,
  lifecycle: lifecycleScopeSchema,
}).strict();

export const componentManifestV1Schema = z.object({
  schema: z.literal("werkstatt/component-manifest@1"),
  componentId: componentIdSchema,
  version: semverSchema,
  artifactHash: sha256Schema,
  provides: z.array(capabilityProvideSchema).min(1).max(MAX_PROVIDES),
  requires: z.array(capabilityRequireSchema).max(MAX_REQUIRES),
  requestedGrants: z.array(grantRequestSchema).max(MAX_GRANTS),
  effects: z.array(effectDeclarationSchema).max(MAX_EFFECTS),
  isolation: isolationRequirementSchema,
  resources: z.array(resourceBoundSchema).max(MAX_RESOURCES),
}).strict();

const resolvedComponentIdentitySchema = z.object({
  componentId: componentIdSchema,
  version: semverSchema,
  artifactHash: sha256Schema,
}).strict();

export const resolvedComponentSetV1Schema = z.object({
  schema: z.literal("werkstatt/resolved-component-set@1"),
  profileId: boundedString(MAX_PROFILE_ID_LEN),
  components: z.array(resolvedComponentIdentitySchema).min(1).max(MAX_COMPONENTS),
  dependencyGraphHash: sha256Schema,
  grantSetHash: sha256Schema,
  effectPolicyHash: sha256Schema,
  isolationPolicyHash: sha256Schema,
  setHash: sha256Schema,
}).strict();

const LAW_KERNEL_GRANT_SCOPES = new Set(["certify", "administer"]);

function checkDuplicateProvides(
  manifest: z.infer<typeof componentManifestV1Schema>,
  violations: ComponentContractViolation[],
): void {
  const seen = new Set<string>();
  for (let i = 0; i < manifest.provides.length; i++) {
    const p = manifest.provides[i]!;
    const key = `${p.capability}@${p.version}`;
    if (seen.has(key)) {
      violations.push({
        rule: "COMPONENT-CONTRACT-03",
        path: `provides[${i}].capability`,
        message: "duplicate capability provide identity",
      });
    }
    seen.add(key);
  }
}

function checkLawKernelAuthorityReservation(
  manifest: z.infer<typeof componentManifestV1Schema>,
  violations: ComponentContractViolation[],
): void {
  for (let i = 0; i < manifest.requestedGrants.length; i++) {
    const g = manifest.requestedGrants[i]!;
    if (LAW_KERNEL_GRANT_SCOPES.has(g.scope)) {
      violations.push({
        rule: "COMPONENT-CONTRACT-06",
        path: `requestedGrants[${i}].scope`,
        message: `manifest cannot request Law Kernel reserved scope: ${g.scope}`,
      });
    }
  }
}

function checkResourceOwners(
  manifest: z.infer<typeof componentManifestV1Schema>,
  violations: ComponentContractViolation[],
): void {
  for (let i = 0; i < manifest.resources.length; i++) {
    const r = manifest.resources[i]!;
    if (r.owner !== manifest.componentId) {
      violations.push({
        rule: "COMPONENT-CONTRACT-05",
        path: `resources[${i}].owner`,
        message: `resource owner must be the manifest componentId, got ${r.owner}`,
      });
    }
  }
}

export function parseComponentManifestV1(
  input: unknown,
): ComponentContractResult<ComponentManifestV1> {
  const violations: ComponentContractViolation[] = [];

  const parsed = componentManifestV1Schema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      violations.push({
        rule: "COMPONENT-CONTRACT-01",
        path: issue.path.join(".") || "(root)",
        message: issue.message,
      });
    }
    return { status: "fail", data: null, violations };
  }

  const manifest = parsed.data;

  checkDuplicateProvides(manifest, violations);
  checkLawKernelAuthorityReservation(manifest, violations);
  checkResourceOwners(manifest, violations);

  if (violations.length > 0) {
    return { status: "fail", data: null, violations };
  }

  return { status: "pass", data: manifest as ComponentManifestV1, violations: [] };
}

export function parseResolvedComponentSetV1(
  input: unknown,
): ComponentContractResult<ResolvedComponentSetV1> {
  const violations: ComponentContractViolation[] = [];

  const parsed = resolvedComponentSetV1Schema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      violations.push({
        rule: "COMPONENT-CONTRACT-01",
        path: issue.path.join(".") || "(root)",
        message: issue.message,
      });
    }
    return { status: "fail", data: null, violations };
  }

  const set = parsed.data;

  const seenComponents = new Set<string>();
  for (let i = 0; i < set.components.length; i++) {
    const c = set.components[i]!;
    const key = `${c.componentId}@${c.version}`;
    if (seenComponents.has(key)) {
      violations.push({
        rule: "COMPONENT-CONTRACT-04",
        path: `components[${i}].componentId`,
        message: "duplicate resolved component identity",
      });
    }
    seenComponents.add(key);
  }

  if (violations.length > 0) {
    return { status: "fail", data: null, violations };
  }

  return { status: "pass", data: set as ResolvedComponentSetV1, violations: [] };
}
