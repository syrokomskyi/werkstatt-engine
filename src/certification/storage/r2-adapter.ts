/*
<MODULE_CONTRACT>
<purpose>RFC-0865: R2 durable storage adapter implementing CertificationStorageAdapterV1 via Cloudflare R2 REST API using fetch() with Bearer token auth. No SDK dependency — engine is stack-agnostic.</purpose>
<non-goals>
  <item>Do not implement retention GC, dossier events, or root hash recomputation — those live in repository.ts and retention.ts.</item>
  <item>Do not depend on @aws-sdk/* or any external SDK — use fetch() with Bearer token.</item>
  <item>Do not log, echo, or serialize secret values.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
<item>RFC-0865: initial R2 durable storage adapter for propagate-alt and promote-main gates.</item>
<item>ADR-0032: Switch from S3 SigV4 signing to Cloudflare R2 REST API with Bearer token — simpler, no SigV4 bugs.</item>
</CHANGE_SUMMARY>
*/

import type { Sha256Digest } from "../../fingerprint/primitives.ts";
import type {
  CertificationStorageAdapterV1,
  StoragePutInputV1,
  StoragePutResultV1,
  StorageHeadResultV1,
} from "./adapter.ts";

export interface R2StorageConfig {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  apiToken?: string;
}

const R2_API_BASE = (accountId: string) =>
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2`;

async function r2ApiFetch(
  config: R2StorageConfig,
  method: string,
  key: string,
  extraHeaders: Record<string, string> = {},
  body?: Buffer,
): Promise<Response> {
  const encodedKey = encodeURIComponent(key);
  const url = `${R2_API_BASE(config.accountId)}/buckets/${config.bucketName}/objects/${encodedKey}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiToken}`,
    ...extraHeaders,
  };
  if (body) {
    headers["Content-Length"] = String(body.byteLength);
  }
  return fetch(url, {
    method,
    headers,
    body: body ? new Uint8Array(body) : undefined,
  });
}

export function createR2StorageAdapter(config: R2StorageConfig): CertificationStorageAdapterV1 {
  const adapterId = `r2:${config.bucketName}`;

  return {
    id: adapterId,

    async putObject(input: StoragePutInputV1): Promise<StoragePutResultV1> {
      const body = Buffer.from(input.bytes);
      const response = await r2ApiFetch(
        config,
        "PUT",
        input.digest,
        {
          "Content-Type": input.mediaType,
        },
        body,
      );

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(
          `CERT-R2-01: putObject failed for digest "${input.digest}" — HTTP ${response.status}: ${text.slice(0, 500)}`,
        );
      }

      const etag = response.headers.get("etag") ?? "";
      return {
        locator: `r2://${config.bucketName}/${input.digest}#${etag}`,
        sizeBytes: body.byteLength,
      };
    },

    async headObject(digest: Sha256Digest): Promise<StorageHeadResultV1> {
      const response = await r2ApiFetch(config, "GET", digest, {
        Range: "bytes=0-0",
      });

      if (response.status === 404) {
        return { exists: false };
      }

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(
          `CERT-R2-02: headObject failed for digest "${digest}" — HTTP ${response.status}: ${text.slice(0, 500)}`,
        );
      }

      const contentRange = response.headers.get("content-range") ?? "";
      const sizeMatch = contentRange.match(/\/(\d+)$/);
      const contentLength = response.headers.get("content-length");
      const etag = response.headers.get("etag") ?? "";
      return {
        exists: true,
        sizeBytes: sizeMatch
          ? Number(sizeMatch[1])
          : contentLength
            ? Number(contentLength)
            : undefined,
        digest,
        locator: `r2://${config.bucketName}/${digest}#${etag}`,
      };
    },

    async getObject(digest: Sha256Digest): Promise<Uint8Array> {
      const response = await r2ApiFetch(config, "GET", digest);

      if (response.status === 404) {
        throw new Error(`CERT-STORAGE-01: object "${digest}" not found in adapter "${adapterId}"`);
      }

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(
          `CERT-R2-03: getObject failed for digest "${digest}" — HTTP ${response.status}: ${text.slice(0, 500)}`,
        );
      }

      const buf = Buffer.from(await response.arrayBuffer());
      return new Uint8Array(buf);
    },

    async appendAuditRecord(record: Uint8Array): Promise<{ locator: string }> {
      const timestamp = Date.now();
      const key = `audit/${timestamp}-${Math.random().toString(36).slice(2, 10)}`;
      const body = Buffer.from(record);

      const response = await r2ApiFetch(
        config,
        "PUT",
        key,
        {
          "Content-Type": "application/octet-stream",
        },
        body,
      );

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(
          `CERT-R2-04: appendAuditRecord failed — HTTP ${response.status}: ${text.slice(0, 500)}`,
        );
      }

      const etag = response.headers.get("etag") ?? "";
      return {
        locator: `r2://${config.bucketName}/${key}#${etag}`,
      };
    },
  };
}
