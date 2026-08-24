import type { Sha256Digest } from "../../fingerprint/primitives.ts";

export interface StoragePutInputV1 {
  digest: Sha256Digest;
  bytes: Uint8Array;
  mediaType: string;
}

export interface StoragePutResultV1 {
  locator: string;
  sizeBytes: number;
}

export interface StorageHeadResultV1 {
  exists: boolean;
  sizeBytes?: number;
  digest?: Sha256Digest;
  locator?: string;
}

export interface CertificationStorageAdapterV1 {
  readonly id: string;
  putObject(input: StoragePutInputV1): Promise<StoragePutResultV1>;
  headObject(digest: Sha256Digest): Promise<StorageHeadResultV1>;
  getObject(digest: Sha256Digest): Promise<Uint8Array>;
  appendAuditRecord(record: Uint8Array): Promise<{ locator: string }>;
}

export interface InMemoryStorageAdapterV1 extends CertificationStorageAdapterV1 {
  readonly _objects: Map<string, { bytes: Uint8Array; mediaType: string }>;
  readonly _auditRecords: Uint8Array[];
}

export function createInMemoryStorageAdapter(
  id: string,
): InMemoryStorageAdapterV1 {
  const objects = new Map<string, { bytes: Uint8Array; mediaType: string }>();
  const auditRecords: Uint8Array[] = [];

  return {
    id,
    _objects: objects,
    _auditRecords: auditRecords,
    async putObject(input: StoragePutInputV1): Promise<StoragePutResultV1> {
      const key = input.digest;
      if (!objects.has(key)) {
        objects.set(key, {
          bytes: input.bytes,
          mediaType: input.mediaType,
        });
      }
      return {
        locator: `memory://${id}/${key}`,
        sizeBytes: input.bytes.byteLength,
      };
    },
    async headObject(digest: Sha256Digest): Promise<StorageHeadResultV1> {
      const obj = objects.get(digest);
      if (!obj) {
        return { exists: false };
      }
      return {
        exists: true,
        sizeBytes: obj.bytes.byteLength,
        digest,
        locator: `memory://${id}/${digest}`,
      };
    },
    async getObject(digest: Sha256Digest): Promise<Uint8Array> {
      const obj = objects.get(digest);
      if (!obj) {
        throw new Error(`CERT-STORAGE-01: object "${digest}" not found`);
      }
      return obj.bytes;
    },
    async appendAuditRecord(record: Uint8Array): Promise<{ locator: string }> {
      auditRecords.push(record);
      return {
        locator: `memory://${id}/audit/${auditRecords.length}`,
      };
    },
  };
}

export interface StorageVerifyResultV1 {
  ok: true;
  verified: boolean;
  sizeBytes: number;
}

export interface StorageVerifyFailureV1 {
  ok: false;
  ruleId: "CERT-STORAGE-01" | "CERT-STORAGE-02";
  message: string;
}

export type StorageVerifyOutcomeV1 = StorageVerifyResultV1 | StorageVerifyFailureV1;

export async function verifyStoredObject(
  adapter: CertificationStorageAdapterV1,
  digest: Sha256Digest,
  expectedSize?: number,
): Promise<StorageVerifyOutcomeV1> {
  const head = await adapter.headObject(digest);
  if (!head.exists) {
    return {
      ok: false,
      ruleId: "CERT-STORAGE-01",
      message: `object "${digest}" not found in adapter "${adapter.id}"`,
    };
  }

  if (expectedSize !== undefined && head.sizeBytes !== expectedSize) {
    return {
      ok: false,
      ruleId: "CERT-STORAGE-02",
      message: `size mismatch: expected ${expectedSize}, got ${head.sizeBytes}`,
    };
  }

  return {
    ok: true,
    verified: true,
    sizeBytes: head.sizeBytes ?? 0,
  };
}
