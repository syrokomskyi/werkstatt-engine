/*
<MODULE_CONTRACT>
<purpose>Dependency-free home of BUILD_IDENTITY_PATH, the well-known path of a
deployed site's build identity — shared by live-drift probes, cache purge and the
runtime agent health route.</purpose>
<non-goals>
  <item>Do not import anything — this module is reachable from the Cloudflare worker bundle (agent-gate health route); any import here drags its graph into every site build.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1297: leaf module for BUILD_IDENTITY_PATH so the worker bundle no longer pulls live-drift → registry-io → engine kernel → forge.</item>
  <item>RFC-1297: keep the worker bundle free of live-drift and engine kernel imports</item>
</CHANGE_SUMMARY>
*/

// @ai-invariant: keep this module import-free — it is part of the site worker bundle.
export const BUILD_IDENTITY_PATH = "/.well-known/build-identity.json";
