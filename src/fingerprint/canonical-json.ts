/*
<MODULE_CONTRACT>
<purpose>RFC-0849: Bounded canonical JSON identity bytes — object-only opaque snapshot, strict RFC 8785 JCS encoder, and SHA-256 hash delegation.</purpose>
<non-goals>
  <item>Do not import node:crypto, stableJsonHash, or any plugin module — delegate to byteHash only.</item>
  <item>Do not define certification schemas, Diagnostic, or persistence — those belong to later packets.</item>
  <item>Do not change stableJsonHash or its consumers.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0849: initial implementation of werkstatt/canonical-json@1 — bounded object-root profile of RFC 8785 JCS.</item>
</CHANGE_SUMMARY>
*/

import { byteHash, type Sha256Digest } from "./primitives.ts";

export const CANONICAL_JSON_V1 = "werkstatt/canonical-json@1" as const;

// ---------------------------------------------------------------------------
// Opaque branded type
// ---------------------------------------------------------------------------

declare const canonicalJsonObjectV1Brand: unique symbol;

export type CanonicalJsonObjectV1 = {
  readonly [canonicalJsonObjectV1Brand]: true;
};

const brandedRegistry = new WeakSet<object>();

// ---------------------------------------------------------------------------
// Path segments
// ---------------------------------------------------------------------------

export type CanonicalJsonPathSegmentV1 =
  | { readonly kind: "array-index"; readonly index: number }
  | { readonly kind: "object-key"; readonly sortedIndex: number };

// ---------------------------------------------------------------------------
// Failure types
// ---------------------------------------------------------------------------

export type CanonicalJsonFailureCodeV1 =
  | "CERT-CANONICAL-DOMAIN-01"
  | "CERT-CANONICAL-TRAVERSAL-01"
  | "CERT-CANONICAL-UNICODE-01"
  | "CERT-CANONICAL-LIMIT-01";

export interface CanonicalJsonFailureV1 {
  readonly ok: false;
  readonly code: CanonicalJsonFailureCodeV1;
  readonly path: readonly CanonicalJsonPathSegmentV1[];
  readonly omittedPathSegments: number;
  readonly message: string;
  readonly limit?:
    "bytes" | "depth" | "nodes" | "object-keys" | "array-items" | "string-bytes" | "key-bytes";
  readonly actual?: number;
  readonly maximum?: number;
}

export interface CanonicalJsonSuccessV1 {
  readonly ok: true;
  readonly value: CanonicalJsonObjectV1;
}

export type CanonicalJsonObjectSnapshotResultV1 = CanonicalJsonSuccessV1 | CanonicalJsonFailureV1;

// ---------------------------------------------------------------------------
// Invariant error
// ---------------------------------------------------------------------------

export class CanonicalJsonInvariantError extends Error {
  readonly code = "CERT-CANONICAL-BRAND-01" as const;
  constructor(message: string) {
    super(message);
    this.name = "CanonicalJsonInvariantError";
  }
}

// ---------------------------------------------------------------------------
// Hard limits
// ---------------------------------------------------------------------------

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_DEPTH = 64;
const MAX_NODES = 250_000;
const MAX_OBJECT_KEYS = 10_000;
const MAX_ARRAY_ITEMS = 100_000;
const MAX_STRING_BYTES = 1024 * 1024;
const MAX_KEY_BYTES = 1024;
const MAX_MESSAGE_BYTES = 512;
const MAX_PATH_SEGMENTS = 64;

// ---------------------------------------------------------------------------
// UTF-16 lone surrogate check
// ---------------------------------------------------------------------------

function hasLoneSurrogate(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (i + 1 >= str.length) return true;
      const next = str.charCodeAt(i + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      i++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function utf8ByteLength(str: string): number {
  return Buffer.byteLength(str, "utf8");
}

// ---------------------------------------------------------------------------
// RFC 8785 key comparator (lexicographic over UTF-16 code units)
// ---------------------------------------------------------------------------

function compareJcsKeys(a: string, b: string): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ca = a.charCodeAt(i);
    const cb = b.charCodeAt(i);
    if (ca !== cb) return ca - cb;
  }
  return a.length - b.length;
}

// ---------------------------------------------------------------------------
// RFC 8785 number serialization (§3.2.2.3 / ECMA-262 §7.1.12.1)
// ---------------------------------------------------------------------------

function serializeNumber(value: number): string {
  if (Object.is(value, -0)) {
    throw new CanonicalJsonInvariantError("negative zero rejected by Werkstatt profile");
  }
  if (!Number.isFinite(value)) {
    throw new CanonicalJsonInvariantError("non-finite numbers rejected by Werkstatt profile");
  }
  if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
    throw new CanonicalJsonInvariantError("unsafe integer rejected by Werkstatt profile");
  }
  if (value === 0) return "0";
  if (Number.isInteger(value)) return value.toString();

  // Non-integer finite numbers: use ECMA-262 §7.1.12.1 Number.prototype.toString
  // which produces the shortest representation that round-trips.
  return value.toString();
}

// ---------------------------------------------------------------------------
// RFC 8785 string escaping (§3.2.2.2)
// ---------------------------------------------------------------------------

function escapeString(str: string): string {
  let out = '"';
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    switch (code) {
      case 0x22:
        out += '\\"';
        break;
      case 0x5c:
        out += "\\\\";
        break;
      case 0x08:
        out += "\\b";
        break;
      case 0x09:
        out += "\\t";
        break;
      case 0x0a:
        out += "\\n";
        break;
      case 0x0c:
        out += "\\f";
        break;
      case 0x0d:
        out += "\\r";
        break;
      default:
        if (code < 0x20) {
          out += "\\u" + code.toString(16).padStart(4, "0");
        } else if (code >= 0xd800 && code <= 0xdbff) {
          // High surrogate — must be followed by low surrogate
          const next = str.charCodeAt(i + 1);
          if (next >= 0xdc00 && next <= 0xdfff) {
            // Valid surrogate pair — emit raw UTF-16 code units
            out += String.fromCharCode(code);
            out += String.fromCharCode(next);
            i++;
          } else {
            // This should have been caught by hasLoneSurrogate, but defensive
            throw new CanonicalJsonInvariantError(
              "lone high surrogate in string — should have been rejected",
            );
          }
        } else {
          out += String.fromCharCode(code);
        }
        break;
    }
  }
  out += '"';
  return out;
}

// ---------------------------------------------------------------------------
// Traversal state
// ---------------------------------------------------------------------------

interface TraversalState {
  nodes: number;
  bytes: number;
  output: string[];
}

type FailureResult = CanonicalJsonFailureV1;

// ---------------------------------------------------------------------------
// Deep freeze
// ---------------------------------------------------------------------------

function deepFreeze(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
    Object.freeze(value);
  } else {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
}

// ---------------------------------------------------------------------------
// Snapshot builder
// ---------------------------------------------------------------------------

function isPlainObjectRoot(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isPlainObject(value: unknown): boolean {
  return isPlainObjectRoot(value);
}

function buildSnapshot(input: unknown): CanonicalJsonObjectSnapshotResultV1 {
  // Root must be a plain object
  if (!isPlainObjectRoot(input)) {
    return fail("CERT-CANONICAL-DOMAIN-01", [], 0, "root must be a plain object");
  }

  const visited = new Set<object>();
  const state: TraversalState = { nodes: 1, bytes: 0, output: [] };

  if (state.nodes > MAX_NODES) {
    return failLimit("nodes", [], 0, state.nodes, MAX_NODES);
  }

  const result = traverseObject(input as Record<string, unknown>, [], 0, state, visited);
  if (result) return result;

  const outputStr = state.output.join("");
  const outputBytes = Buffer.byteLength(outputStr, "utf8");
  if (outputBytes > MAX_BYTES) {
    return failLimit("bytes", [], 0, outputBytes, MAX_BYTES);
  }

  // Build the detached frozen copy
  const detached = buildDetached(input);
  deepFreeze(detached);
  const root = detached as unknown as CanonicalJsonObjectV1;
  brandedRegistry.add(detached as object);

  return { ok: true, value: root };
}

function traverseObject(
  obj: Record<string, unknown>,
  path: CanonicalJsonPathSegmentV1[],
  depth: number,
  state: TraversalState,
  visited: Set<object>,
): FailureResult | null {
  if (depth > MAX_DEPTH) {
    return failLimit("depth", path, 0, depth, MAX_DEPTH);
  }

  // Cycle/alias detection
  if (visited.has(obj)) {
    return fail("CERT-CANONICAL-TRAVERSAL-01", path, 0, "cycle or repeated reference detected");
  }
  visited.add(obj);

  // Capture own keys
  let ownKeys: string[];
  try {
    ownKeys = Reflect.ownKeys(obj) as string[];
  } catch {
    return fail("CERT-CANONICAL-TRAVERSAL-01", path, 0, "Reflect.ownKeys threw during capture");
  }

  // Check for symbol keys
  const symbols = Object.getOwnPropertySymbols(obj);
  if (symbols.length > 0) {
    return fail("CERT-CANONICAL-DOMAIN-01", path, 0, "symbol keys are not permitted");
  }

  // Check all descriptors are enumerable data descriptors
  for (const key of ownKeys) {
    let desc: PropertyDescriptor;
    try {
      desc = Object.getOwnPropertyDescriptor(obj, key)!;
    } catch {
      return fail("CERT-CANONICAL-TRAVERSAL-01", path, 0, "getOwnPropertyDescriptor threw");
    }
    if (!desc) {
      return fail("CERT-CANONICAL-DOMAIN-01", path, 0, `missing descriptor for key`);
    }
    if (!desc.enumerable) {
      return fail("CERT-CANONICAL-DOMAIN-01", path, 0, "non-enumerable property is not permitted");
    }
    if (desc.get !== undefined || desc.set !== undefined) {
      return fail("CERT-CANONICAL-DOMAIN-01", path, 0, "accessor property is not permitted");
    }
  }

  // Check key count
  if (ownKeys.length > MAX_OBJECT_KEYS) {
    return failLimit("object-keys", path, 0, ownKeys.length, MAX_OBJECT_KEYS);
  }

  // Check key bytes and lone surrogates
  for (const key of ownKeys) {
    const keyBytes = utf8ByteLength(key);
    if (keyBytes > MAX_KEY_BYTES) {
      return failLimit("key-bytes", path, 0, keyBytes, MAX_KEY_BYTES);
    }
    if (hasLoneSurrogate(key)) {
      return fail("CERT-CANONICAL-UNICODE-01", path, 0, "lone surrogate in object key");
    }
  }

  // Sort keys by JCS comparator
  const sortedKeys = [...ownKeys].sort(compareJcsKeys);

  // Verify key list didn't change during capture
  let postKeys: string[];
  try {
    postKeys = Reflect.ownKeys(obj) as string[];
  } catch {
    return fail(
      "CERT-CANONICAL-TRAVERSAL-01",
      path,
      0,
      "Reflect.ownKeys threw during post-capture",
    );
  }
  if (postKeys.length !== ownKeys.length || !postKeys.every((k, i) => k === ownKeys[i])) {
    return fail("CERT-CANONICAL-TRAVERSAL-01", path, 0, "own-key shape changed during capture");
  }

  // Emit object
  state.output.push("{");

  for (let i = 0; i < sortedKeys.length; i++) {
    const key = sortedKeys[i];
    if (i > 0) state.output.push(",");

    // Emit key
    state.output.push(escapeString(key));

    state.output.push(":");

    // Read value once
    let value: unknown;
    try {
      value = (obj as Record<string, unknown>)[key];
    } catch {
      const seg: CanonicalJsonPathSegmentV1 = { kind: "object-key", sortedIndex: i };
      const newPath = pushPath(path, seg);
      return fail(
        "CERT-CANONICAL-TRAVERSAL-01",
        newPath.path,
        newPath.omitted,
        "property read threw",
      );
    }

    const seg: CanonicalJsonPathSegmentV1 = { kind: "object-key", sortedIndex: i };
    const newPath = pushPath(path, seg);
    const result = traverseValue(value, newPath.path, newPath.omitted, depth + 1, state, visited);
    if (result) return result;
  }

  state.output.push("}");
  return null;
}

function traverseArray(
  arr: unknown[],
  path: CanonicalJsonPathSegmentV1[],
  omitted: number,
  depth: number,
  state: TraversalState,
  visited: Set<object>,
): FailureResult | null {
  if (depth > MAX_DEPTH) {
    return failLimit("depth", path, omitted, depth, MAX_DEPTH);
  }

  if (visited.has(arr)) {
    return fail(
      "CERT-CANONICAL-TRAVERSAL-01",
      path,
      omitted,
      "cycle or repeated reference detected",
    );
  }
  visited.add(arr);

  // Check array is dense (no holes)
  const len = arr.length;
  for (let i = 0; i < len; i++) {
    if (!(i in arr)) {
      const seg: CanonicalJsonPathSegmentV1 = { kind: "array-index", index: i };
      const newPath = pushPath(path, seg);
      return fail(
        "CERT-CANONICAL-DOMAIN-01",
        newPath.path,
        newPath.omitted,
        "sparse array hole detected",
      );
    }
  }

  // Check for extra own keys beyond indices
  const arrKeys = Object.keys(arr);
  for (const k of arrKeys) {
    if (!/^(?:0|[1-9]\d*)$/.test(k) || Number(k) >= len) {
      return fail("CERT-CANONICAL-DOMAIN-01", path, omitted, "array has extra own keys");
    }
  }

  // Check symbol keys
  const symbols = Object.getOwnPropertySymbols(arr);
  if (symbols.length > 0) {
    return fail("CERT-CANONICAL-DOMAIN-01", path, omitted, "array has symbol keys");
  }

  if (len > MAX_ARRAY_ITEMS) {
    return failLimit("array-items", path, omitted, len, MAX_ARRAY_ITEMS);
  }

  state.output.push("[");
  for (let i = 0; i < len; i++) {
    if (i > 0) state.output.push(",");
    const seg: CanonicalJsonPathSegmentV1 = { kind: "array-index", index: i };
    const newPath = pushPath(path, seg);
    const result = traverseValue(arr[i], newPath.path, newPath.omitted, depth + 1, state, visited);
    if (result) return result;
  }
  state.output.push("]");
  return null;
}

function traverseValue(
  value: unknown,
  path: CanonicalJsonPathSegmentV1[],
  omitted: number,
  depth: number,
  state: TraversalState,
  visited: Set<object>,
): FailureResult | null {
  state.nodes++;
  if (state.nodes > MAX_NODES) {
    return failLimit("nodes", path, omitted, state.nodes, MAX_NODES);
  }

  if (value === null) {
    state.output.push("null");
    return null;
  }

  if (value === undefined) {
    return fail("CERT-CANONICAL-DOMAIN-01", path, omitted, "undefined is not permitted");
  }

  const type = typeof value;

  if (type === "boolean") {
    state.output.push(value ? "true" : "false");
    return null;
  }

  if (type === "number") {
    const num = value as number;
    if (Object.is(num, NaN)) {
      return fail("CERT-CANONICAL-DOMAIN-01", path, omitted, "NaN is not permitted");
    }
    if (!Number.isFinite(num)) {
      return fail("CERT-CANONICAL-DOMAIN-01", path, omitted, "Infinity is not permitted");
    }
    if (Object.is(num, -0)) {
      return fail("CERT-CANONICAL-DOMAIN-01", path, omitted, "negative zero is not permitted");
    }
    if (Number.isInteger(num) && !Number.isSafeInteger(num)) {
      return fail("CERT-CANONICAL-DOMAIN-01", path, omitted, "unsafe integer is not permitted");
    }
    try {
      state.output.push(serializeNumber(num));
    } catch (e) {
      if (e instanceof CanonicalJsonInvariantError) {
        return fail("CERT-CANONICAL-DOMAIN-01", path, omitted, e.message);
      }
      throw e;
    }
    return null;
  }

  if (type === "bigint") {
    return fail("CERT-CANONICAL-DOMAIN-01", path, omitted, "bigint is not permitted");
  }

  if (type === "symbol") {
    return fail("CERT-CANONICAL-DOMAIN-01", path, omitted, "symbol is not permitted");
  }

  if (type === "function") {
    return fail("CERT-CANONICAL-DOMAIN-01", path, omitted, "function is not permitted");
  }

  if (type === "string") {
    const strBytes = utf8ByteLength(value as string);
    if (strBytes > MAX_STRING_BYTES) {
      return failLimit("string-bytes", path, omitted, strBytes, MAX_STRING_BYTES);
    }
    if (hasLoneSurrogate(value as string)) {
      return fail("CERT-CANONICAL-UNICODE-01", path, omitted, "lone surrogate in string value");
    }
    state.output.push(escapeString(value as string));
    return null;
  }

  if (type === "object") {
    // Reject host objects and class instances
    if (!isPlainObject(value) && !Array.isArray(value)) {
      // Check for toJSON
      if (typeof (value as { toJSON?: unknown }).toJSON === "function") {
        return fail(
          "CERT-CANONICAL-DOMAIN-01",
          path,
          omitted,
          "toJSON customization is not permitted",
        );
      }
      // Check for Date, Map, Set, RegExp, Error, typed arrays, etc.
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        const ctor = proto?.constructor?.name ?? "unknown";
        return fail("CERT-CANONICAL-DOMAIN-01", path, omitted, `non-plain object type: ${ctor}`);
      }
      // null-prototype object — treat as plain
    }

    if (Array.isArray(value)) {
      return traverseArray(value, path, omitted, depth, state, visited);
    }

    return traverseObject(value as Record<string, unknown>, path, depth, state, visited);
  }

  return fail("CERT-CANONICAL-DOMAIN-01", path, omitted, `unsupported value type: ${type}`);
}

// ---------------------------------------------------------------------------
// Detached copy builder
// ---------------------------------------------------------------------------

function buildDetached(input: unknown): unknown {
  if (input === null || typeof input !== "object") return input;
  if (Array.isArray(input)) {
    const arr: unknown[] = [];
    for (const item of input) arr.push(buildDetached(item));
    return arr;
  }
  const obj: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(input as Record<string, unknown>)) {
    obj[key] = buildDetached((input as Record<string, unknown>)[key]);
  }
  return obj;
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function pushPath(
  path: CanonicalJsonPathSegmentV1[],
  seg: CanonicalJsonPathSegmentV1,
): { path: CanonicalJsonPathSegmentV1[]; omitted: number } {
  if (path.length >= MAX_PATH_SEGMENTS) {
    return { path, omitted: 1 };
  }
  return { path: [...path, seg], omitted: 0 };
}

// ---------------------------------------------------------------------------
// Failure helpers
// ---------------------------------------------------------------------------

function truncateMessage(msg: string): string {
  const buf = Buffer.from(msg, "utf8");
  if (buf.length <= MAX_MESSAGE_BYTES) return msg;
  return buf.subarray(0, MAX_MESSAGE_BYTES).toString("utf8");
}

function fail(
  code: CanonicalJsonFailureCodeV1,
  path: CanonicalJsonPathSegmentV1[],
  omitted: number,
  message: string,
): CanonicalJsonFailureV1 {
  return {
    ok: false,
    code,
    path,
    omittedPathSegments: omitted,
    message: truncateMessage(message),
  };
}

function failLimit(
  limit: NonNullable<CanonicalJsonFailureV1["limit"]>,
  path: CanonicalJsonPathSegmentV1[],
  omitted: number,
  actual: number,
  maximum: number,
): CanonicalJsonFailureV1 {
  return {
    ok: false,
    code: "CERT-CANONICAL-LIMIT-01",
    path,
    omittedPathSegments: omitted,
    message: truncateMessage(`${limit} limit exceeded: ${actual} > ${maximum}`),
    limit,
    actual,
    maximum,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function snapshotCanonicalJsonObjectV1(input: unknown): CanonicalJsonObjectSnapshotResultV1 {
  return buildSnapshot(input);
}

export function isCanonicalJsonObjectV1(value: unknown): value is CanonicalJsonObjectV1 {
  return typeof value === "object" && value !== null && brandedRegistry.has(value as object);
}

export function canonicalJsonBytesV1(value: CanonicalJsonObjectV1): Uint8Array {
  if (!isCanonicalJsonObjectV1(value)) {
    throw new CanonicalJsonInvariantError(
      "CERT-CANONICAL-BRAND-01: value is not a runtime-branded CanonicalJsonObjectV1",
    );
  }
  // Re-encode from the detached frozen copy
  const output: string[] = [];
  encodeValue(value, output);
  const str = output.join("");
  return Buffer.from(str, "utf8");
}

export function canonicalJsonHashV1(value: CanonicalJsonObjectV1): Sha256Digest {
  const bytes = canonicalJsonBytesV1(value);
  return byteHash(bytes);
}

// ---------------------------------------------------------------------------
// Encoder (operates on detached frozen copy — no caller mutation possible)
// ---------------------------------------------------------------------------

function encodeValue(value: unknown, output: string[]): void {
  if (value === null) {
    output.push("null");
    return;
  }
  if (typeof value === "boolean") {
    output.push(value ? "true" : "false");
    return;
  }
  if (typeof value === "number") {
    output.push(serializeNumber(value));
    return;
  }
  if (typeof value === "string") {
    output.push(escapeString(value));
    return;
  }
  if (Array.isArray(value)) {
    output.push("[");
    for (let i = 0; i < value.length; i++) {
      if (i > 0) output.push(",");
      encodeValue(value[i], output);
    }
    output.push("]");
    return;
  }
  // Plain object (null-prototype after detachment)
  if (typeof value === "object" && value !== null) {
    const keys = Object.keys(value as Record<string, unknown>).sort(compareJcsKeys);
    output.push("{");
    for (let i = 0; i < keys.length; i++) {
      if (i > 0) output.push(",");
      output.push(escapeString(keys[i]));
      output.push(":");
      encodeValue((value as Record<string, unknown>)[keys[i]], output);
    }
    output.push("}");
    return;
  }
}
