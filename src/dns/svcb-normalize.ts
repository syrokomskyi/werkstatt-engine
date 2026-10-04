/*
<MODULE_CONTRACT>
<purpose>
RFC-0753: SVCB/HTTPS record content normalization for declared-vs-live comparison.
Cloudflare normalizes SVCB rdata presentation (canonical target gains a trailing
dot, param values are quoted) so a literal string compare flags cosmetic drift on
every DNS-AID record. Semantics mirror agent.dns-aid.validate (AGD-05): priority
and target compare after normalization, declared params must be a subset of live
params, and a live HTTPS record satisfies a declared SVCB record (wire alias).
</purpose>
<non-goals>
  <item>Do not normalize non-SVCB record types — TXT has its own normalizer.</item>
  <item>Do not require exact param-set equality — Cloudflare-synthesized extra params (ipv4hint/ipv6hint) are tolerated by the subset rule.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0753: SVCB/HTTPS content normalization for recordsMatch — parse-compare instead of literal string compare; mirrors AGD-05 subset semantics from agent.dns-aid.validate.</item>
</CHANGE_SUMMARY>
*/

export interface ParsedSvcbContent {
  priority: string;
  target: string;
  params: Map<string, string>;
}

/** Parse an SVCB/HTTPS rdata string into priority, target and params. */
export function parseSvcbContent(content: string): ParsedSvcbContent | null {
  const tokens = content.trim().split(/\s+/);
  if (tokens.length < 2) return null;
  const [priority, rawTarget, ...paramTokens] = tokens;
  const target = rawTarget.replace(/\.$/, "");
  const params = new Map<string, string>();
  for (const token of paramTokens) {
    const eq = token.indexOf("=");
    if (eq === -1) {
      // Bare key — normalize as key="" (e.g. `mandatory` without value).
      params.set(token.replace(/"/g, ""), "");
    } else {
      params.set(token.slice(0, eq), token.slice(eq + 1).replace(/"/g, ""));
    }
  }
  return { priority, target, params };
}

/** Record types whose rdata is SVCB presentation format. */
export function isSvcbType(type: string): boolean {
  return type === "SVCB" || type === "HTTPS";
}

/**
 * Declared SVCB content matches live content when priority and target are equal
 * after normalization and every declared key=value param is present in the live
 * record (declared ⊆ live). Extra live params such as Cloudflare-synthesized
 * ipv4hint/ipv6hint are tolerated. A live HTTPS record at the same name
 * satisfies a declared SVCB record (draft-normative form vs its wire alias).
 */
export function svcbContentsMatch(
  declaredContent: string,
  liveType: string,
  liveContent: string,
): boolean {
  if (!isSvcbType(liveType)) return false;
  const d = parseSvcbContent(declaredContent);
  const l = parseSvcbContent(liveContent);
  if (!d || !l) return false;
  // Numeric comparison — "1" and "01" are the same SVCB priority.
  if (Number(d.priority) !== Number(l.priority) || d.target !== l.target) return false;
  for (const [key, value] of d.params) {
    if (l.params.get(key) !== value) return false;
  }
  return true;
}
