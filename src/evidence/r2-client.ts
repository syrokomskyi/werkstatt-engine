/*
<MODULE_CONTRACT>
<purpose>S3-compatible R2 client wrapper for evidence sync and fetch commands (RFC-0651).</purpose>


<non-goals>
  <item>Does not implement Iceberg REST catalog — deferred to a future RFC.</item>
  <item>Does not implement multipart uploads — individual files are under the 5 MB threshold.</item>
  <item>Does not implement retry logic — the operator re-runs the command on failure.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0651: initial R2 client wrapper with putObject, getObject, listObjectsV2.</item>
  <item>RFC-0713: added envPrefix parameter to resolveR2ConfigFromEnv for per-bucket credential isolation. Default prefix changed from R2_ to R2_AXIOM_ for symmetry with R2_NACHWEIS_.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";

export interface R2ClientConfig {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
}

export interface R2PutObjectInput {
  key: string;
  body: Uint8Array;
  contentType?: string;
}

export interface R2GetObjectOutput {
  key: string;
  body: Uint8Array;
}

export interface R2ListObject {
  key: string;
  size: number;
}

export class MissingEnvError extends Error {
  readonly diagnostic: string;
  readonly missingVar: string;

  constructor(missingVar: string) {
    super(`${missingVar} environment variable is required`);
    this.name = "MissingEnvError";
    this.diagnostic = "MISSING_ENV";
    this.missingVar = missingVar;
  }
}

export function resolveR2ConfigFromEnv(
  bucketName = "axiom-evidence",
  envPrefix = "R2_AXIOM",
): R2ClientConfig {
  const prefix = `${envPrefix}_`;
  const accountId = process.env[`${prefix}ACCOUNT_ID`];
  if (!accountId) {
    throw new MissingEnvError(`${prefix}ACCOUNT_ID`);
  }
  const accessKeyId = process.env[`${prefix}ACCESS_KEY_ID`];
  if (!accessKeyId) {
    throw new MissingEnvError(`${prefix}ACCESS_KEY_ID`);
  }
  const secretAccessKey = process.env[`${prefix}SECRET_ACCESS_KEY`];
  if (!secretAccessKey) {
    throw new MissingEnvError(`${prefix}SECRET_ACCESS_KEY`);
  }
  return { accountId, accessKeyId, secretAccessKey, bucketName };
}

export function createR2Client(config: R2ClientConfig): {
  putObject: (input: R2PutObjectInput) => Promise<void>;
  getObject: (key: string) => Promise<R2GetObjectOutput>;
  listObjectsV2: (prefix: string) => Promise<R2ListObject[]>;
  rawClient: S3Client;
} {
  const clientConfig: S3ClientConfig = {
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  };
  const client = new S3Client(clientConfig);

  async function putObject(input: R2PutObjectInput): Promise<void> {
    await client.send(
      new PutObjectCommand({
        Bucket: config.bucketName,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
      }),
    );
  }

  async function getObject(key: string): Promise<R2GetObjectOutput> {
    const response = await client.send(
      new GetObjectCommand({
        Bucket: config.bucketName,
        Key: key,
      }),
    );
    if (!response.Body) {
      throw new Error(`[r2-client] getObject: empty body for key '${key}'`);
    }
    const body = await response.Body.transformToByteArray();
    return { key, body: new Uint8Array(body) };
  }

  async function listObjectsV2(prefix: string): Promise<R2ListObject[]> {
    const objects: R2ListObject[] = [];
    let continuationToken: string | undefined;
    do {
      const response = await client.send(
        new ListObjectsV2Command({
          Bucket: config.bucketName,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      for (const obj of response.Contents ?? []) {
        if (obj.Key) {
          objects.push({ key: obj.Key, size: obj.Size ?? 0 });
        }
      }
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);
    return objects;
  }

  return { putObject, getObject, listObjectsV2, rawClient: client };
}
