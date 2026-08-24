/*
<MODULE_CONTRACT>
<purpose>RFC-0479: types for the RFC-id-keyed migrator registry — pure, idempotent
transforms over SternsystemData (file-system rooted). Replaces the old RFC-0221
SemVer-based Migrator type that operated on in-memory AuthoredSet.</purpose>
<non-goals>
  <item>Do not implement registry logic or file IO — types only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0479: new Migrator, SternsystemData, MigrationContext, MigrationError, MigrationViolation types.</item>
</CHANGE_SUMMARY>
*/

export interface SternsystemData {
  rootPath: string;
  dataPaths: string[];
}

export interface MigrationContext {
  systemId: string;
  missionId: string;
  logger: { info: (msg: string) => void };
}

export interface Migrator {
  id: string;
  fromVersion: string;
  toVersion: string;
  description: string;
  transform: (data: SternsystemData, ctx: MigrationContext) => Promise<SternsystemData>;
}

export class MigrationError extends Error {
  constructor(
    public migratorId: string,
    public filePath: string,
    public fieldPath: string,
    public reason: string,
  ) {
    super(`[migrator ${migratorId}] ${filePath}:${fieldPath} — ${reason}`);
    this.name = "MigrationError";
  }
}

export interface MigrationViolation {
  migratorId: string;
  filePath: string;
  fieldPath: string;
  reason: string;
}
