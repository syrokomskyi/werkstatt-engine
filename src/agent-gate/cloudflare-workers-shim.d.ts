/*
<MODULE_CONTRACT>
<purpose>Ambient declaration for the Cloudflare Workers runtime module so that
agent-gate API route factories typecheck outside a Cloudflare Workers environment.
The real module is only available in the Workers runtime; dynamic import() is the
sanctioned pattern (CF-IMPORT-01).</purpose>
<non-goals>
  <item>Do not model app-specific env schemas — this is a loose shim for compile-time only.</item>
  <item>Do not introduce runtime behavior — declarations only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0954: add ambient cloudflare:workers declaration for agent-gate search route typechecking.</item>
</CHANGE_SUMMARY>
*/

declare module "cloudflare:workers" {
  export const env: Record<string, unknown>;
}
