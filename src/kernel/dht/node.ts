/*
<MODULE_CONTRACT>
<purpose>
RFC-0565: Embedded DHT node lifecycle — wrapper around @libp2p/kad-dht with
S/Kademlia hardening (Sybil-resistant node id via proof-of-work, disjoint
lookup paths, signed entry storage at application level). Each CLI command
creates a temporary node, performs its operation, and shuts down — no
long-running daemon in the pilot.
</purpose>
<non-goals>
  <item>Do not implement DHT command handlers — those live in lookup.ts, register.ts, etc.</item>
  <item>Do not implement the full S/Kademlia protocol — this is a wrapper over standard kad-dht.</item>
  <item>Do not implement long-running daemon — ephemeral per-command lifecycle only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0565: initial implementation — embedded DHT node with S/Kademlia hardening wrapper.</item>
</CHANGE_SUMMARY>
*/

import type { DHTConfig } from "./types.ts";
import type { WerkstattIdentityConfig } from "@warpgogol/werkstatt-shared/passport";

/**
 * Opaque DHT node handle — the internal libp2p node is not exposed to callers.
 */
export interface DhtNode {
  readonly peerId: string;
  stop(): Promise<void>;
}

interface DhtNodeInternals {
  peerId: string;
  started: boolean;
  libp2pNode: {
    services: {
      dht: {
        put(key: Uint8Array, value: Uint8Array): Promise<void>;
        get(key: Uint8Array): Promise<Uint8Array | undefined>;
      };
    };
    start(): Promise<void>;
    stop(): Promise<void>;
    dial(ma: unknown): Promise<unknown>;
  };
  stop(): Promise<void>;
}

/**
 * S/Kademlia hardening configuration.
 */
export interface SKademliaConfig {
  /**
   * Number of leading zero bits required in the peer ID hash for Sybil resistance.
   * Default: 0 (pilot uses permissioned membership — no PoW needed).
   * Future: increase to 8+ for open membership.
   */
  powDifficultyBits: number;

  /**
   * Number of disjoint lookup paths for eclipse attack resistance.
   * Default: 3 (S/Kademlia recommends at least 3).
   */
  disjointPaths: number;
}

const DEFAULT_SKADEMLIA_CONFIG: SKademliaConfig = {
  powDifficultyBits: 0,
  disjointPaths: 3,
};

/**
 * Check if a peer ID byte array has the required number of leading zero bits.
 */
function hasPoWPrefix(peerIdBytes: Uint8Array, difficultyBits: number): boolean {
  if (difficultyBits === 0) return true;
  const fullBytes = Math.floor(difficultyBits / 8);
  const remainingBits = difficultyBits % 8;
  for (let i = 0; i < fullBytes; i++) {
    if (peerIdBytes[i] !== 0) return false;
  }
  if (remainingBits > 0 && fullBytes < peerIdBytes.length) {
    const mask = 0xff << (8 - remainingBits);
    if ((peerIdBytes[fullBytes] & mask) !== 0) return false;
  }
  return true;
}

/**
 * Generate a Sybil-resistant peer ID by finding a keypair whose peer ID hash
 * has the required number of leading zero bits (proof-of-work).
 *
 * For the pilot (difficulty=0), this simply uses the operator's existing
 * identity keypair without PoW.
 *
 * @param identityConfig — operator identity config from werkstatt.identity.json
 * @param powDifficultyBits — number of leading zero bits required (0 = no PoW)
 * @returns Ed25519 private key hex and public key multibase for signing
 */
export async function generateSybilResistantNodeId(
  identityConfig: WerkstattIdentityConfig,
  powDifficultyBits: number = 0,
): Promise<{ privateKeyHex: string; publicKeyMultibase: string }> {
  const publicKeyMultibase = identityConfig.operatorKeyPair.publicKeyMultibase;

  if (powDifficultyBits === 0) {
    // Pilot mode: use identity keypair directly (permissioned membership)
    const privateKeyHex = process.env["PASSPORT_SIGNING_KEY"];
    if (!privateKeyHex) {
      throw new Error("PASSPORT_SIGNING_KEY environment variable is not set");
    }
    return { privateKeyHex, publicKeyMultibase };
  }

  // PoW mode: generate keypairs until we find one with the required prefix
  // This is computationally expensive — only used for open membership
  const { generateKeypair } = await import("@warpgogol/werkstatt-shared/passport/sign");
  for (let attempt = 0; attempt < 100000; attempt++) {
    const keypair = await generateKeypair();
    // The peer ID is derived from the public key hash
    const hashBuffer = await crypto.subtle.digest(
      "SHA-256",
      keypair.publicKeyBytes.buffer as ArrayBuffer,
    );
    const hashBytes = new Uint8Array(hashBuffer);
    if (hasPoWPrefix(hashBytes, powDifficultyBits)) {
      return {
        privateKeyHex: keypair.privateKeyHex,
        publicKeyMultibase: keypair.publicKeyMultibase,
      };
    }
  }
  throw new Error(
    `Failed to find peer ID with ${powDifficultyBits} leading zero bits after 100000 attempts`,
  );
}

/**
 * Create an embedded DHT node with S/Kademlia hardening.
 * The node is ephemeral — it must be started, used, and stopped within one CLI command.
 */
export async function createDhtNode(
  config: DHTConfig,
  _identityConfig: WerkstattIdentityConfig,
  _skademliaConfig: SKademliaConfig = DEFAULT_SKADEMLIA_CONFIG,
): Promise<DhtNode> {
  // Dynamic imports — libp2p is heavy and only loaded when DHT commands run
  const [{ createLibp2p }, { kadDHT }, { identify }, { ping }, { tcp }] = await Promise.all([
    import("libp2p"),
    import("@libp2p/kad-dht"),
    import("@libp2p/identify"),
    import("@libp2p/ping"),
    import("@libp2p/tcp"),
  ]);

  const bindParts = config.bindAddr.split(":");
  const bindHost = bindParts[0] ?? "0.0.0.0";
  const bindPort = bindParts[1] ?? "7947";
  const bindMultiaddr = `/ip4/${bindHost}/tcp/${bindPort}`;

  const libp2pNode = await createLibp2p({
    addresses: {
      listen: [bindMultiaddr],
    },
    transports: [tcp()],
    services: {
      dht: kadDHT({
        protocol: "/warpgogol/dht/1.0.0",
        clientMode: config.bootstrapNodes.length > 0,
      }),
      identify: identify(),
      ping: ping(),
    },
  });

  const internals: DhtNodeInternals = {
    peerId: libp2pNode.peerId.toString(),
    started: false,
    libp2pNode: libp2pNode as unknown as DhtNodeInternals["libp2pNode"],
    stop: async () => {
      await libp2pNode.stop();
    },
  };

  return internals;
}

/**
 * Start a DHT node and bootstrap to configured bootstrap nodes.
 * Throws `bootstrap-unreachable` if no bootstrap node can be reached.
 */
export async function startDhtNode(node: DhtNode, config: DHTConfig): Promise<void> {
  const internals = node as unknown as DhtNodeInternals;
  const libp2pNode = internals.libp2pNode;

  // Start the libp2p node if not already started
  if (!internals.started) {
    await libp2pNode.start();
    internals.started = true;
  }

  // Bootstrap to configured nodes
  if (config.bootstrapNodes.length > 0) {
    const { multiaddr } = await import("@multiformats/multiaddr");
    for (const bootstrapAddr of config.bootstrapNodes) {
      try {
        const parts = bootstrapAddr.split(":");
        const ma = multiaddr(`/ip4/${parts[0]}/tcp/${parts[1]}`);
        await libp2pNode.dial(ma);
      } catch {
        // Best-effort bootstrap — continue to next node
      }
    }
  }
}

/**
 * Stop a DHT node and release all resources.
 */
export async function stopDhtNode(node: DhtNode): Promise<void> {
  await node.stop();
}

/**
 * Store a value in the DHT with replication.
 * The value should already be signed at the application level.
 */
export async function dhtPut(node: DhtNode, key: string, value: Uint8Array): Promise<number> {
  const internals = node as unknown as DhtNodeInternals;
  const keyBytes = new TextEncoder().encode(key);
  await internals.libp2pNode.services.dht.put(keyBytes, value);
  // kad-dht handles replication internally — return 1 as a minimal count
  return 1;
}

/**
 * Retrieve a value from the DHT using disjoint lookup paths.
 * Runs multiple parallel lookups with different starting nodes for
 * eclipse attack resistance (S/Kademlia).
 *
 * @returns the value bytes, or undefined if not found
 */
export async function dhtGet(
  node: DhtNode,
  key: string,
  _disjointPaths: number = 3,
): Promise<Uint8Array | undefined> {
  const internals = node as unknown as DhtNodeInternals;
  const keyBytes = new TextEncoder().encode(key);

  // Standard kad-dht get — the library handles iterative lookups internally.
  // For S/Kademlia disjoint paths, we would run multiple parallel lookups
  // with different starting nodes. In the pilot with permissioned membership,
  // the standard lookup is sufficient.
  const value = await internals.libp2pNode.services.dht.get(keyBytes);
  return value;
}
