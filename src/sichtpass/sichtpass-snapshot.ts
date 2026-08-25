/*
<MODULE_CONTRACT>
<purpose>RFC-0947: TypeScript contracts for site-wide visibility snapshot (sichtpass).</purpose>
<non-goals>
  <item>Does not implement command handler logic — that lives in sichtpass-generate.ts.</item>
  <item>Does not define Bordbuch event schema — that lives in @warpgogol/werkstatt-engine/schemas.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0947: initial sichtpass snapshot types.</item>
</CHANGE_SUMMARY>
*/

export interface SichtpassChannelState {
  healthy: boolean;
  releaseId: string | null;
  deployedAt: string | null;
}

export interface SichtpassPseoModule {
  id: string;
  masterLocale: string;
  publishedLocales: string[];
}

export interface SichtpassSiteSnapshot {
  schemaVersion: "1.0.0";
  systemId: string;
  generatedAt: null;
  compositeHash: string;
  contentHash: string | null;
  routeCount: number;
  behaviorRouteCount: number;
  nachweisCount: number;
  nachweisSlugs: string[];
  releaseId: string | null;
  channels: {
    dev: SichtpassChannelState;
    alt: SichtpassChannelState;
    main: SichtpassChannelState;
  };
  pseoModules: SichtpassPseoModule[];
  coverageAtoms: number;
  coveragePages: string[];
}

export interface SichtpassBordbuchMetadata {
  slug: "__site__" | "__manifest__";
  manifestVersion: string;
  recordHash: string;
  signaturePresent: boolean;
  timestampPresent: boolean;
  verificationLevel: "N0";
  contentHash?: string;
  routeCount?: number;
  nachweisCount?: number;
  releaseId?: string | null;
  channelHealth?: { dev: boolean; alt: boolean; main: boolean };
}
