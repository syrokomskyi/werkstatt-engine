/*
<MODULE_CONTRACT>
<purpose>isolation broker index — re-export the broker public surface for consumers.</purpose>
<non-goals>
  <item>Do not implement broker logic here — it lives in broker.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

export type {
  BrokerPolicyV1,
  BrokerAuditEntryV1,
  BrokerHandlerV1,
  RegisteredCapabilityV1,
  CapabilityBrokerV1,
  BrokerInvocationContextV1,
  BrokerRegisterResultV1,
  BrokerRegisterFailureV1,
  BrokerRegisterOutcomeV1,
} from "./broker.ts";

export { createCapabilityBroker } from "./broker.ts";
