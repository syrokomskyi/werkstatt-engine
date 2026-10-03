/*
<MODULE_CONTRACT>
<purpose>astro-env.d.ts — ambient type declarations for the Astro environment bindings used by the engine.</purpose>
<non-goals>
  <item>Do not implement runtime code — this file only declares ambient types.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
  <item>RFC-1187: phases 1-3 — contracts, Redis registry, AS core + Bearer pipeline</item>
</CHANGE_SUMMARY>
*/

declare module "astro:env/server" {
  export const UPSTASH_QSTASH_TOKEN: string | undefined;
  export const UPSTASH_REDIS_REST_URL: string | undefined;
  export const UPSTASH_REDIS_REST_TOKEN: string | undefined;
  /** RFC-1187: dynamic secret lookup — SIGNING_PRIVATE_KEY resolves only when the app schema declares it. */
  export const getSecret: (key: string) => string | undefined;
}
