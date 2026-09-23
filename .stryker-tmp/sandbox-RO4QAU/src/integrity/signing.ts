/*
<MODULE_CONTRACT>
  <purpose>Maintains packages/os/site-kernel-integrity/src/signing.ts as an authored site-kernel-integrity authored module so agents can evolve it without rediscovering local boundaries.</purpose>
    <non-goals>
    <item>Do not handle non-cryptographic signing methods.</item>
    <item>Avoid managing non-build related artifacts.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Migrated sha256StringHex from deleted ./hash.ts to byteHash from @warpgogol/fingerprint directly.</item>
  <item>RFC-0921: delegate signing/verification/keygen to shared signing core. Remove node:crypto sign/verify imports and canonicalJson function.</item>
  <item>RFC-0931: add signBuildIdentity, writeReleasePublicKey, verifyBuildIdentitySignature for Ed25519 signing of build-identity.json in deploy pipeline.</item>
</CHANGE_SUMMARY>

/**
 * Ed25519 cryptographic signing for build artifacts.
 * Provides key generation, payload signing, signature verification, and manifest handling.
 */
// @ts-nocheck
function stryNS_9fa48() {
  var g = typeof globalThis === 'object' && globalThis && globalThis.Math === Math && globalThis || new Function("return this")();
  var ns = g.__stryker__ || (g.__stryker__ = {});
  if (ns.activeMutant === undefined && g.process && g.process.env && g.process.env.__STRYKER_ACTIVE_MUTANT__) {
    ns.activeMutant = g.process.env.__STRYKER_ACTIVE_MUTANT__;
  }
  function retrieveNS() {
    return ns;
  }
  stryNS_9fa48 = retrieveNS;
  return retrieveNS();
}
stryNS_9fa48();
function stryCov_9fa48() {
  var ns = stryNS_9fa48();
  var cov = ns.mutantCoverage || (ns.mutantCoverage = {
    static: {},
    perTest: {}
  });
  function cover() {
    var c = cov.static;
    if (ns.currentTestId) {
      c = cov.perTest[ns.currentTestId] = cov.perTest[ns.currentTestId] || {};
    }
    var a = arguments;
    for (var i = 0; i < a.length; i++) {
      c[a[i]] = (c[a[i]] || 0) + 1;
    }
  }
  stryCov_9fa48 = cover;
  cover.apply(null, arguments);
}
function stryMutAct_9fa48(id) {
  var ns = stryNS_9fa48();
  function isActive(id) {
    if (ns.activeMutant === id) {
      if (ns.hitCount !== void 0 && ++ns.hitCount > ns.hitLimit) {
        throw new Error('Stryker: Hit count limit reached (' + ns.hitCount + ')');
      }
      return true;
    }
    return false;
  }
  stryMutAct_9fa48 = isActive;
  return isActive(id);
}
import path from "node:path";
import { byteHash } from "@warpgogol/werkstatt-engine/fingerprint";
import { generateKeyPair as signingGenerateKeyPair, toPem as signingToPem, toHex as signingToHex, getPublicKey as signingGetPublicKey, privateKeyPemToBytes, publicKeyPemToBytes, sign as signingSign, verify as signingVerify, canonicalBytes as signingCanonicalBytes, fromHex as signingFromHex } from "@warpgogol/werkstatt-engine/signing";
import { atomicWriteFile } from "../werkstatt/atomic.ts";
import { ensureDir, pathExists, readBuffer, readText, writeText } from "./fs.ts";
import { readJsonFile, stableStringify } from "./json.ts";
import { buildLatestDir, outputsPath, provenancePath, signedManifestPath, signatureBinaryPath, signatureHexPath } from "./paths.ts";
import type { BuildProvenance, OutputsFile, SignablePayload, SignedManifest } from "./types.ts";
let dotEnvLoadedForCwd: string | undefined;
export interface SigningKeyPairPem {
  privateKeyPem: string;
  publicKeyPem: string;
}
export interface ReleaseSignatureArtifacts {
  outputs: OutputsFile;
  provenance: BuildProvenance;
  payload: SignablePayload;
  payloadBytes: Buffer;
  signatureBuffer: Buffer;
  signatureHex: string;
  signedManifest: SignedManifest;
  reusedExistingSignature: boolean;
}
function pemFromBase64(label: "PRIVATE KEY" | "PUBLIC KEY", base64Value: string): string {
  if (stryMutAct_9fa48("1198")) {
    {}
  } else {
    stryCov_9fa48("1198");
    const normalized = base64Value.replace(stryMutAct_9fa48("1200") ? /\S+/g : stryMutAct_9fa48("1199") ? /\s/g : (stryCov_9fa48("1199", "1200"), /\s+/g), stryMutAct_9fa48("1201") ? "Stryker was here!" : (stryCov_9fa48("1201"), ""));
    const lines = stryMutAct_9fa48("1202") ? normalized.match(/.{1,64}/g) && [normalized] : (stryCov_9fa48("1202"), normalized.match(stryMutAct_9fa48("1203") ? /./g : (stryCov_9fa48("1203"), /.{1,64}/g)) ?? (stryMutAct_9fa48("1204") ? [] : (stryCov_9fa48("1204"), [normalized])));
    return stryMutAct_9fa48("1205") ? `` : (stryCov_9fa48("1205"), `-----BEGIN ${label}-----\n${lines.join(stryMutAct_9fa48("1206") ? "" : (stryCov_9fa48("1206"), "\n"))}\n-----END ${label}-----\n`);
  }
}
function normalizePemLikeValue(value: string, label: "PRIVATE KEY" | "PUBLIC KEY"): string {
  if (stryMutAct_9fa48("1207")) {
    {}
  } else {
    stryCov_9fa48("1207");
    const trimmed = stryMutAct_9fa48("1208") ? value : (stryCov_9fa48("1208"), value.trim());
    if (stryMutAct_9fa48("1210") ? false : stryMutAct_9fa48("1209") ? true : (stryCov_9fa48("1209", "1210"), trimmed.includes(stryMutAct_9fa48("1211") ? "" : (stryCov_9fa48("1211"), "-----BEGIN")))) {
      if (stryMutAct_9fa48("1212")) {
        {}
      } else {
        stryCov_9fa48("1212");
        return (stryMutAct_9fa48("1213") ? trimmed.startsWith("\n") : (stryCov_9fa48("1213"), trimmed.endsWith(stryMutAct_9fa48("1214") ? "" : (stryCov_9fa48("1214"), "\n")))) ? trimmed : stryMutAct_9fa48("1215") ? `` : (stryCov_9fa48("1215"), `${trimmed}\n`);
      }
    }
    return pemFromBase64(label, trimmed);
  }
}
async function loadDotEnv(cwd: string): Promise<void> {
  if (stryMutAct_9fa48("1216")) {
    {}
  } else {
    stryCov_9fa48("1216");
    if (stryMutAct_9fa48("1219") ? dotEnvLoadedForCwd !== cwd : stryMutAct_9fa48("1218") ? false : stryMutAct_9fa48("1217") ? true : (stryCov_9fa48("1217", "1218", "1219"), dotEnvLoadedForCwd === cwd)) {
      if (stryMutAct_9fa48("1220")) {
        {}
      } else {
        stryCov_9fa48("1220");
        return;
      }
    }
    const envPath = path.join(cwd, stryMutAct_9fa48("1221") ? "" : (stryCov_9fa48("1221"), ".env"));
    if (stryMutAct_9fa48("1224") ? false : stryMutAct_9fa48("1223") ? true : stryMutAct_9fa48("1222") ? await pathExists(envPath) : (stryCov_9fa48("1222", "1223", "1224"), !(await pathExists(envPath)))) {
      if (stryMutAct_9fa48("1225")) {
        {}
      } else {
        stryCov_9fa48("1225");
        dotEnvLoadedForCwd = cwd;
        return;
      }
    }
    const envText = await readText(envPath);
    for (const rawLine of envText.split(stryMutAct_9fa48("1226") ? /\r\n/u : (stryCov_9fa48("1226"), /\r?\n/u))) {
      if (stryMutAct_9fa48("1227")) {
        {}
      } else {
        stryCov_9fa48("1227");
        const line = stryMutAct_9fa48("1228") ? rawLine : (stryCov_9fa48("1228"), rawLine.trim());
        if (stryMutAct_9fa48("1231") ? !line && line.startsWith("#") : stryMutAct_9fa48("1230") ? false : stryMutAct_9fa48("1229") ? true : (stryCov_9fa48("1229", "1230", "1231"), (stryMutAct_9fa48("1232") ? line : (stryCov_9fa48("1232"), !line)) || (stryMutAct_9fa48("1233") ? line.endsWith("#") : (stryCov_9fa48("1233"), line.startsWith(stryMutAct_9fa48("1234") ? "" : (stryCov_9fa48("1234"), "#")))))) {
          if (stryMutAct_9fa48("1235")) {
            {}
          } else {
            stryCov_9fa48("1235");
            continue;
          }
        }
        const separatorIndex = line.indexOf(stryMutAct_9fa48("1236") ? "" : (stryCov_9fa48("1236"), "="));
        if (stryMutAct_9fa48("1240") ? separatorIndex > 0 : stryMutAct_9fa48("1239") ? separatorIndex < 0 : stryMutAct_9fa48("1238") ? false : stryMutAct_9fa48("1237") ? true : (stryCov_9fa48("1237", "1238", "1239", "1240"), separatorIndex <= 0)) {
          if (stryMutAct_9fa48("1241")) {
            {}
          } else {
            stryCov_9fa48("1241");
            continue;
          }
        }
        const key = stryMutAct_9fa48("1243") ? line.trim() : stryMutAct_9fa48("1242") ? line.slice(0, separatorIndex) : (stryCov_9fa48("1242", "1243"), line.slice(0, separatorIndex).trim());
        if (stryMutAct_9fa48("1246") ? !key && process.env[key] !== undefined : stryMutAct_9fa48("1245") ? false : stryMutAct_9fa48("1244") ? true : (stryCov_9fa48("1244", "1245", "1246"), (stryMutAct_9fa48("1247") ? key : (stryCov_9fa48("1247"), !key)) || (stryMutAct_9fa48("1249") ? process.env[key] === undefined : stryMutAct_9fa48("1248") ? false : (stryCov_9fa48("1248", "1249"), process.env[key] !== undefined)))) {
          if (stryMutAct_9fa48("1250")) {
            {}
          } else {
            stryCov_9fa48("1250");
            continue;
          }
        }
        let value = stryMutAct_9fa48("1252") ? line.trim() : stryMutAct_9fa48("1251") ? line.slice(separatorIndex + 1) : (stryCov_9fa48("1251", "1252"), line.slice(stryMutAct_9fa48("1253") ? separatorIndex - 1 : (stryCov_9fa48("1253"), separatorIndex + 1)).trim());
        if (stryMutAct_9fa48("1256") ? value.startsWith('"') && value.endsWith('"') && value.startsWith("'") && value.endsWith("'") : stryMutAct_9fa48("1255") ? false : stryMutAct_9fa48("1254") ? true : (stryCov_9fa48("1254", "1255", "1256"), (stryMutAct_9fa48("1258") ? value.startsWith('"') || value.endsWith('"') : stryMutAct_9fa48("1257") ? false : (stryCov_9fa48("1257", "1258"), (stryMutAct_9fa48("1259") ? value.endsWith('"') : (stryCov_9fa48("1259"), value.startsWith(stryMutAct_9fa48("1260") ? "" : (stryCov_9fa48("1260"), '"')))) && (stryMutAct_9fa48("1261") ? value.startsWith('"') : (stryCov_9fa48("1261"), value.endsWith(stryMutAct_9fa48("1262") ? "" : (stryCov_9fa48("1262"), '"')))))) || (stryMutAct_9fa48("1264") ? value.startsWith("'") || value.endsWith("'") : stryMutAct_9fa48("1263") ? false : (stryCov_9fa48("1263", "1264"), (stryMutAct_9fa48("1265") ? value.endsWith("'") : (stryCov_9fa48("1265"), value.startsWith(stryMutAct_9fa48("1266") ? "" : (stryCov_9fa48("1266"), "'")))) && (stryMutAct_9fa48("1267") ? value.startsWith("'") : (stryCov_9fa48("1267"), value.endsWith(stryMutAct_9fa48("1268") ? "" : (stryCov_9fa48("1268"), "'")))))))) {
          if (stryMutAct_9fa48("1269")) {
            {}
          } else {
            stryCov_9fa48("1269");
            value = stryMutAct_9fa48("1270") ? value : (stryCov_9fa48("1270"), value.slice(1, stryMutAct_9fa48("1271") ? +1 : (stryCov_9fa48("1271"), -1)));
          }
        }
        value = value.replace(/\\n/g, stryMutAct_9fa48("1272") ? "" : (stryCov_9fa48("1272"), "\n"));
        process.env[key] = value;
      }
    }
    dotEnvLoadedForCwd = cwd;
  }
}
export async function requireEnv(name: string, cwd = process.cwd()): Promise<string> {
  if (stryMutAct_9fa48("1273")) {
    {}
  } else {
    stryCov_9fa48("1273");
    await loadDotEnv(cwd);
    const value = process.env[name];
    if (stryMutAct_9fa48("1276") ? false : stryMutAct_9fa48("1275") ? true : stryMutAct_9fa48("1274") ? value : (stryCov_9fa48("1274", "1275", "1276"), !value)) {
      if (stryMutAct_9fa48("1277")) {
        {}
      } else {
        stryCov_9fa48("1277");
        throw new Error(stryMutAct_9fa48("1279") ? `` : (stryCov_9fa48("1279"), `Required environment variable ${name} is not set.`));
      }
    }
    return value;
  }
}
export async function optionalEnv(name: string, cwd = process.cwd()): Promise<string | undefined> {
  if (stryMutAct_9fa48("1280")) {
    {}
  } else {
    stryCov_9fa48("1280");
    await loadDotEnv(cwd);
    return stryMutAct_9fa48("1281") ? process.env[name] && undefined : (stryCov_9fa48("1281"), process.env[name] ?? undefined);
  }
}
export async function generateSigningKeyPairPemAsync(): Promise<SigningKeyPairPem> {
  if (stryMutAct_9fa48("1282")) {
    {}
  } else {
    stryCov_9fa48("1282");
    const keyPair = await signingGenerateKeyPair();
    return stryMutAct_9fa48("1283") ? {} : (stryCov_9fa48("1283"), {
      privateKeyPem: signingToPem(keyPair.privateKey, stryMutAct_9fa48("1284") ? "" : (stryCov_9fa48("1284"), "private")),
      publicKeyPem: signingToPem(keyPair.publicKey, stryMutAct_9fa48("1285") ? "" : (stryCov_9fa48("1285"), "public"))
    });
  }
}
export async function loadBuildArtifactsForSigning(cwd: string): Promise<{
  outputs: OutputsFile;
  outputsRaw: string;
  provenance: BuildProvenance;
  provenanceRaw: string;
}> {
  if (stryMutAct_9fa48("1286")) {
    {}
  } else {
    stryCov_9fa48("1286");
    const [outputsRaw, provenanceRaw, outputs, provenance] = await Promise.all(stryMutAct_9fa48("1287") ? [] : (stryCov_9fa48("1287"), [readText(outputsPath(cwd)), readText(provenancePath(cwd)), readJsonFile<OutputsFile>(outputsPath(cwd)), readJsonFile<BuildProvenance>(provenancePath(cwd))]));
    return stryMutAct_9fa48("1288") ? {} : (stryCov_9fa48("1288"), {
      outputs,
      outputsRaw,
      provenance,
      provenanceRaw
    });
  }
}
export function createSignablePayload(args: {
  buildId: string;
  outputsRaw: string;
  provenanceRaw: string;
  signedAt?: string;
}): SignablePayload {
  if (stryMutAct_9fa48("1289")) {
    {}
  } else {
    stryCov_9fa48("1289");
    return stryMutAct_9fa48("1290") ? {} : (stryCov_9fa48("1290"), {
      payloadVersion: stryMutAct_9fa48("1291") ? "" : (stryCov_9fa48("1291"), "1"),
      buildId: args.buildId,
      signedAt: stryMutAct_9fa48("1292") ? args.signedAt && new Date().toISOString() : (stryCov_9fa48("1292"), args.signedAt ?? new Date().toISOString()),
      outputsDigest: stryMutAct_9fa48("1293") ? byteHash(args.outputsRaw) : (stryCov_9fa48("1293"), byteHash(args.outputsRaw).slice((stryMutAct_9fa48("1294") ? "" : (stryCov_9fa48("1294"), "sha256:")).length)),
      provenanceDigest: stryMutAct_9fa48("1295") ? byteHash(args.provenanceRaw) : (stryCov_9fa48("1295"), byteHash(args.provenanceRaw).slice((stryMutAct_9fa48("1296") ? "" : (stryCov_9fa48("1296"), "sha256:")).length))
    });
  }
}
export async function signJsonPayloadAsync(privateKeyPem: string, payload: Record<string, unknown>): Promise<{
  payloadBytes: Buffer;
  signatureBuffer: Buffer;
  signatureHex: string;
  signatureBase64: string;
}> {
  if (stryMutAct_9fa48("1297")) {
    {}
  } else {
    stryCov_9fa48("1297");
    const privateKeyBytes = privateKeyPemToBytes(privateKeyPem);
    const payloadBytes = Buffer.from(signingCanonicalBytes(payload));
    const signatureBytes = await signingSign(privateKeyBytes, payload);
    const signatureBuffer = Buffer.from(signatureBytes);
    return stryMutAct_9fa48("1298") ? {} : (stryCov_9fa48("1298"), {
      payloadBytes,
      signatureBuffer,
      signatureHex: signatureBuffer.toString(stryMutAct_9fa48("1299") ? "" : (stryCov_9fa48("1299"), "hex")),
      signatureBase64: signatureBuffer.toString(stryMutAct_9fa48("1300") ? "" : (stryCov_9fa48("1300"), "base64"))
    });
  }
}
export async function signLatestBuildArtifacts(args: {
  cwd: string;
  privateKeyPem: string;
  publicKeyUrl?: string;
}): Promise<ReleaseSignatureArtifacts> {
  if (stryMutAct_9fa48("1301")) {
    {}
  } else {
    stryCov_9fa48("1301");
    const {
      outputs,
      outputsRaw,
      provenance,
      provenanceRaw
    } = await loadBuildArtifactsForSigning(args.cwd);
    if (stryMutAct_9fa48("1304") ? false : stryMutAct_9fa48("1303") ? true : stryMutAct_9fa48("1302") ? provenance.buildId : (stryCov_9fa48("1302", "1303", "1304"), !provenance.buildId)) {
      if (stryMutAct_9fa48("1305")) {
        {}
      } else {
        stryCov_9fa48("1305");
        throw new Error(stryMutAct_9fa48("1307") ? "" : (stryCov_9fa48("1307"), "build-provenance.json is missing buildId. Run integrity:build-record again."));
      }
    }
    const nextPayload = createSignablePayload(stryMutAct_9fa48("1308") ? {} : (stryCov_9fa48("1308"), {
      buildId: provenance.buildId,
      outputsRaw,
      provenanceRaw
    }));
    const existingManifestPath = signedManifestPath(args.cwd);
    if (stryMutAct_9fa48("1310") ? false : stryMutAct_9fa48("1309") ? true : (stryCov_9fa48("1309", "1310"), await pathExists(existingManifestPath))) {
      if (stryMutAct_9fa48("1311")) {
        {}
      } else {
        stryCov_9fa48("1311");
        const existingManifest = await readJsonFile<SignedManifest>(existingManifestPath);
        const digestsMatch = stryMutAct_9fa48("1314") ? existingManifest.buildId === nextPayload.buildId && existingManifest.payload.outputsDigest === nextPayload.outputsDigest || existingManifest.payload.provenanceDigest === nextPayload.provenanceDigest : stryMutAct_9fa48("1313") ? false : stryMutAct_9fa48("1312") ? true : (stryCov_9fa48("1312", "1313", "1314"), (stryMutAct_9fa48("1316") ? existingManifest.buildId === nextPayload.buildId || existingManifest.payload.outputsDigest === nextPayload.outputsDigest : stryMutAct_9fa48("1315") ? true : (stryCov_9fa48("1315", "1316"), (stryMutAct_9fa48("1318") ? existingManifest.buildId !== nextPayload.buildId : stryMutAct_9fa48("1317") ? true : (stryCov_9fa48("1317", "1318"), existingManifest.buildId === nextPayload.buildId)) && (stryMutAct_9fa48("1320") ? existingManifest.payload.outputsDigest !== nextPayload.outputsDigest : stryMutAct_9fa48("1319") ? true : (stryCov_9fa48("1319", "1320"), existingManifest.payload.outputsDigest === nextPayload.outputsDigest)))) && (stryMutAct_9fa48("1322") ? existingManifest.payload.provenanceDigest !== nextPayload.provenanceDigest : stryMutAct_9fa48("1321") ? true : (stryCov_9fa48("1321", "1322"), existingManifest.payload.provenanceDigest === nextPayload.provenanceDigest)));
        if (stryMutAct_9fa48("1324") ? false : stryMutAct_9fa48("1323") ? true : (stryCov_9fa48("1323", "1324"), digestsMatch)) {
          if (stryMutAct_9fa48("1325")) {
            {}
          } else {
            stryCov_9fa48("1325");
            const existingPayloadBytes = Buffer.from(signingCanonicalBytes(existingManifest.payload as unknown as Record<string, unknown>));
            const existingSignatureBuffer = Buffer.from(existingManifest.signatureHex, stryMutAct_9fa48("1326") ? "" : (stryCov_9fa48("1326"), "hex"));
            return stryMutAct_9fa48("1327") ? {} : (stryCov_9fa48("1327"), {
              outputs,
              provenance,
              payload: existingManifest.payload,
              payloadBytes: existingPayloadBytes,
              signatureBuffer: existingSignatureBuffer,
              signatureHex: existingManifest.signatureHex,
              signedManifest: existingManifest,
              reusedExistingSignature: stryMutAct_9fa48("1328") ? false : (stryCov_9fa48("1328"), true)
            });
          }
        }
      }
    }
    const signed = await signJsonPayloadAsync(args.privateKeyPem, nextPayload as unknown as Record<string, unknown>);
    const signedManifest: SignedManifest = stryMutAct_9fa48("1329") ? {} : (stryCov_9fa48("1329"), {
      buildId: nextPayload.buildId,
      signedAt: nextPayload.signedAt,
      algorithm: stryMutAct_9fa48("1330") ? "" : (stryCov_9fa48("1330"), "Ed25519"),
      payloadVersion: stryMutAct_9fa48("1331") ? "" : (stryCov_9fa48("1331"), "1"),
      payload: nextPayload,
      signatureHex: signed.signatureHex,
      signatureBase64: signed.signatureBase64,
      publicKeyUrl: args.publicKeyUrl
    });
    await ensureDir(buildLatestDir(args.cwd));
    await Promise.all(stryMutAct_9fa48("1332") ? [] : (stryCov_9fa48("1332"), [writeText(signatureHexPath(args.cwd), stryMutAct_9fa48("1333") ? `` : (stryCov_9fa48("1333"), `${signed.signatureHex}\n`)), writeText(signedManifestPath(args.cwd), stableStringify(signedManifest))]));
    await import("node:fs/promises").then(stryMutAct_9fa48("1334") ? () => undefined : (stryCov_9fa48("1334"), ({
      writeFile
    }) => writeFile(signatureBinaryPath(args.cwd), signed.signatureBuffer)));
    return stryMutAct_9fa48("1335") ? {} : (stryCov_9fa48("1335"), {
      outputs,
      provenance,
      payload: nextPayload,
      payloadBytes: signed.payloadBytes,
      signatureBuffer: signed.signatureBuffer,
      signatureHex: signed.signatureHex,
      signedManifest,
      reusedExistingSignature: stryMutAct_9fa48("1336") ? true : (stryCov_9fa48("1336"), false)
    });
  }
}
export async function loadSignedManifest(manifestSource: string): Promise<SignedManifest> {
  if (stryMutAct_9fa48("1337")) {
    {}
  } else {
    stryCov_9fa48("1337");
    if (stryMutAct_9fa48("1340") ? manifestSource.startsWith("https://") && manifestSource.startsWith("http://") : stryMutAct_9fa48("1339") ? false : stryMutAct_9fa48("1338") ? true : (stryCov_9fa48("1338", "1339", "1340"), (stryMutAct_9fa48("1341") ? manifestSource.endsWith("https://") : (stryCov_9fa48("1341"), manifestSource.startsWith(stryMutAct_9fa48("1342") ? "" : (stryCov_9fa48("1342"), "https://")))) || (stryMutAct_9fa48("1343") ? manifestSource.endsWith("http://") : (stryCov_9fa48("1343"), manifestSource.startsWith(stryMutAct_9fa48("1344") ? "" : (stryCov_9fa48("1344"), "http://")))))) {
      if (stryMutAct_9fa48("1345")) {
        {}
      } else {
        stryCov_9fa48("1345");
        const response = await fetch(manifestSource);
        if (stryMutAct_9fa48("1348") ? false : stryMutAct_9fa48("1347") ? true : stryMutAct_9fa48("1346") ? response.ok : (stryCov_9fa48("1346", "1347", "1348"), !response.ok)) {
          if (stryMutAct_9fa48("1349")) {
            {}
          } else {
            stryCov_9fa48("1349");
            throw new Error(stryMutAct_9fa48("1351") ? `` : (stryCov_9fa48("1351"), `HTTP ${response.status} while fetching signed manifest from ${manifestSource}`));
          }
        }
        return (await response.json()) as SignedManifest;
      }
    }
    return readJsonFile<SignedManifest>(manifestSource);
  }
}
export async function loadPublicKeyPem(args: {
  manifest: SignedManifest;
  publicKeyPemPath?: string;
  publicKeyUrl?: string;
}): Promise<string> {
  if (stryMutAct_9fa48("1352")) {
    {}
  } else {
    stryCov_9fa48("1352");
    if (stryMutAct_9fa48("1354") ? false : stryMutAct_9fa48("1353") ? true : (stryCov_9fa48("1353", "1354"), args.publicKeyPemPath)) {
      if (stryMutAct_9fa48("1355")) {
        {}
      } else {
        stryCov_9fa48("1355");
        return normalizePemLikeValue(await readText(path.resolve(args.publicKeyPemPath)), stryMutAct_9fa48("1356") ? "" : (stryCov_9fa48("1356"), "PUBLIC KEY"));
      }
    }
    const publicKeyUrl = stryMutAct_9fa48("1357") ? args.publicKeyUrl && args.manifest.publicKeyUrl : (stryCov_9fa48("1357"), args.publicKeyUrl ?? args.manifest.publicKeyUrl);
    if (stryMutAct_9fa48("1360") ? false : stryMutAct_9fa48("1359") ? true : stryMutAct_9fa48("1358") ? publicKeyUrl : (stryCov_9fa48("1358", "1359", "1360"), !publicKeyUrl)) {
      if (stryMutAct_9fa48("1361")) {
        {}
      } else {
        stryCov_9fa48("1361");
        throw new Error(stryMutAct_9fa48("1363") ? "" : (stryCov_9fa48("1363"), "No public key source provided. Set PUBLIC_KEY_PEM_PATH, PUBLIC_KEY_URL, or embed publicKeyUrl in signed-manifest.json."));
      }
    }
    const response = await fetch(publicKeyUrl);
    if (stryMutAct_9fa48("1366") ? false : stryMutAct_9fa48("1365") ? true : stryMutAct_9fa48("1364") ? response.ok : (stryCov_9fa48("1364", "1365", "1366"), !response.ok)) {
      if (stryMutAct_9fa48("1367")) {
        {}
      } else {
        stryCov_9fa48("1367");
        throw new Error(stryMutAct_9fa48("1369") ? `` : (stryCov_9fa48("1369"), `HTTP ${response.status} while fetching public key from ${publicKeyUrl}`));
      }
    }
    return normalizePemLikeValue(await response.text(), stryMutAct_9fa48("1370") ? "" : (stryCov_9fa48("1370"), "PUBLIC KEY"));
  }
}
export function verifyManifestSignature(args: {
  manifest: SignedManifest;
  publicKeyPem: string;
}): Promise<boolean> {
  if (stryMutAct_9fa48("1371")) {
    {}
  } else {
    stryCov_9fa48("1371");
    return verifyJsonSignatureAsync(stryMutAct_9fa48("1372") ? {} : (stryCov_9fa48("1372"), {
      payload: args.manifest.payload as unknown as Record<string, unknown>,
      signatureHex: args.manifest.signatureHex,
      publicKeyPem: args.publicKeyPem
    }));
  }
}
export async function verifyJsonSignatureAsync(args: {
  payload: Record<string, unknown>;
  signatureHex: string;
  publicKeyPem: string;
}): Promise<boolean> {
  if (stryMutAct_9fa48("1373")) {
    {}
  } else {
    stryCov_9fa48("1373");
    const publicKeyBytes = publicKeyPemToBytes(args.publicKeyPem);
    const signatureBytes = signingFromHex(args.signatureHex);
    return signingVerify(publicKeyBytes, args.payload, signatureBytes);
  }
}
export async function compareManifestWithLocalArtifacts(cwd: string, manifest: SignedManifest): Promise<{
  outputsDigestActual: string;
  provenanceDigestActual: string;
  outputsDigestMatches: boolean;
  provenanceDigestMatches: boolean;
}> {
  if (stryMutAct_9fa48("1374")) {
    {}
  } else {
    stryCov_9fa48("1374");
    const [outputsRaw, provenanceRaw] = await Promise.all(stryMutAct_9fa48("1375") ? [] : (stryCov_9fa48("1375"), [readText(outputsPath(cwd)), readText(provenancePath(cwd))]));
    const outputsDigestActual = stryMutAct_9fa48("1376") ? byteHash(outputsRaw) : (stryCov_9fa48("1376"), byteHash(outputsRaw).slice((stryMutAct_9fa48("1377") ? "" : (stryCov_9fa48("1377"), "sha256:")).length));
    const provenanceDigestActual = stryMutAct_9fa48("1378") ? byteHash(provenanceRaw) : (stryCov_9fa48("1378"), byteHash(provenanceRaw).slice((stryMutAct_9fa48("1379") ? "" : (stryCov_9fa48("1379"), "sha256:")).length));
    return stryMutAct_9fa48("1380") ? {} : (stryCov_9fa48("1380"), {
      outputsDigestActual,
      provenanceDigestActual,
      outputsDigestMatches: stryMutAct_9fa48("1383") ? outputsDigestActual !== manifest.payload.outputsDigest : stryMutAct_9fa48("1382") ? false : stryMutAct_9fa48("1381") ? true : (stryCov_9fa48("1381", "1382", "1383"), outputsDigestActual === manifest.payload.outputsDigest),
      provenanceDigestMatches: stryMutAct_9fa48("1386") ? provenanceDigestActual !== manifest.payload.provenanceDigest : stryMutAct_9fa48("1385") ? false : stryMutAct_9fa48("1384") ? true : (stryCov_9fa48("1384", "1385", "1386"), provenanceDigestActual === manifest.payload.provenanceDigest)
    });
  }
}
export async function readSignatureBinary(cwd: string): Promise<Buffer> {
  if (stryMutAct_9fa48("1387")) {
    {}
  } else {
    stryCov_9fa48("1387");
    return readBuffer(signatureBinaryPath(cwd));
  }
}

/* --- RFC-0931: build-identity.json signing --- */

const SIGNATURE_FIELDS = ["signature", "publicKeyUrl", "signedAt"] as const;
export interface BuildIdentitySignResult {
  signatureHex: string;
  publicKeyHex: string;
  publicKeyUrl: string | null;
  signedAt: string;
  reusedExistingSignature: boolean;
}
export async function signBuildIdentity(args: {
  buildIdentityPath: string;
  privateKeyBytes: Uint8Array;
  publicKeyUrl?: string;
}): Promise<BuildIdentitySignResult> {
  if (stryMutAct_9fa48("1388")) {
    {}
  } else {
    stryCov_9fa48("1388");
    const raw = await readText(args.buildIdentityPath);
    const identity = JSON.parse(raw) as Record<string, unknown>;
    const signablePayload: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(identity)) {
      if (stryMutAct_9fa48("1389")) {
        {}
      } else {
        stryCov_9fa48("1389");
        if (stryMutAct_9fa48("1392") ? false : stryMutAct_9fa48("1391") ? true : stryMutAct_9fa48("1390") ? SIGNATURE_FIELDS.includes(key as typeof SIGNATURE_FIELDS[number]) : (stryCov_9fa48("1390", "1391", "1392"), !SIGNATURE_FIELDS.includes(key as typeof SIGNATURE_FIELDS[number]))) {
          if (stryMutAct_9fa48("1393")) {
            {}
          } else {
            stryCov_9fa48("1393");
            signablePayload[key] = value;
          }
        }
      }
    }
    const existingSignature = (stryMutAct_9fa48("1396") ? typeof identity.signature !== "string" : stryMutAct_9fa48("1395") ? false : stryMutAct_9fa48("1394") ? true : (stryCov_9fa48("1394", "1395", "1396"), typeof identity.signature === (stryMutAct_9fa48("1397") ? "" : (stryCov_9fa48("1397"), "string")))) ? identity.signature : null;
    const existingSignedAt = (stryMutAct_9fa48("1400") ? typeof identity.signedAt !== "string" : stryMutAct_9fa48("1399") ? false : stryMutAct_9fa48("1398") ? true : (stryCov_9fa48("1398", "1399", "1400"), typeof identity.signedAt === (stryMutAct_9fa48("1401") ? "" : (stryCov_9fa48("1401"), "string")))) ? identity.signedAt : null;
    const existingPublicKeyUrl = (stryMutAct_9fa48("1404") ? typeof identity.publicKeyUrl !== "string" : stryMutAct_9fa48("1403") ? false : stryMutAct_9fa48("1402") ? true : (stryCov_9fa48("1402", "1403", "1404"), typeof identity.publicKeyUrl === (stryMutAct_9fa48("1405") ? "" : (stryCov_9fa48("1405"), "string")))) ? identity.publicKeyUrl : null;
    if (stryMutAct_9fa48("1408") ? existingSignature || existingSignedAt : stryMutAct_9fa48("1407") ? false : stryMutAct_9fa48("1406") ? true : (stryCov_9fa48("1406", "1407", "1408"), existingSignature && existingSignedAt)) {
      if (stryMutAct_9fa48("1409")) {
        {}
      } else {
        stryCov_9fa48("1409");
        const publicKeyBytes = await signingGetPublicKey(args.privateKeyBytes);
        const signatureBytes = signingFromHex(existingSignature);
        const isValid = await signingVerify(publicKeyBytes, signablePayload, signatureBytes);
        if (stryMutAct_9fa48("1411") ? false : stryMutAct_9fa48("1410") ? true : (stryCov_9fa48("1410", "1411"), isValid)) {
          if (stryMutAct_9fa48("1412")) {
            {}
          } else {
            stryCov_9fa48("1412");
            const publicKeyHex = signingToHex(publicKeyBytes);
            return stryMutAct_9fa48("1413") ? {} : (stryCov_9fa48("1413"), {
              signatureHex: existingSignature,
              publicKeyHex,
              publicKeyUrl: stryMutAct_9fa48("1414") ? (existingPublicKeyUrl ?? args.publicKeyUrl) && null : (stryCov_9fa48("1414"), (stryMutAct_9fa48("1415") ? existingPublicKeyUrl && args.publicKeyUrl : (stryCov_9fa48("1415"), existingPublicKeyUrl ?? args.publicKeyUrl)) ?? null),
              signedAt: existingSignedAt,
              reusedExistingSignature: stryMutAct_9fa48("1416") ? false : (stryCov_9fa48("1416"), true)
            });
          }
        }
      }
    }
    const signatureBytes = await signingSign(args.privateKeyBytes, signablePayload);
    const signatureHex = Buffer.from(signatureBytes).toString(stryMutAct_9fa48("1417") ? "" : (stryCov_9fa48("1417"), "hex"));
    const publicKeyHex = signingToHex(await signingGetPublicKey(args.privateKeyBytes));
    const signedAt = new Date().toISOString();
    const signed: Record<string, unknown> = stryMutAct_9fa48("1418") ? {} : (stryCov_9fa48("1418"), {
      ...signablePayload,
      signature: signatureHex,
      publicKeyUrl: stryMutAct_9fa48("1419") ? args.publicKeyUrl && null : (stryCov_9fa48("1419"), args.publicKeyUrl ?? null),
      signedAt
    });
    await atomicWriteFile(args.buildIdentityPath, JSON.stringify(signed, null, 2));
    return stryMutAct_9fa48("1420") ? {} : (stryCov_9fa48("1420"), {
      signatureHex,
      publicKeyHex,
      publicKeyUrl: stryMutAct_9fa48("1421") ? args.publicKeyUrl && null : (stryCov_9fa48("1421"), args.publicKeyUrl ?? null),
      signedAt,
      reusedExistingSignature: stryMutAct_9fa48("1422") ? true : (stryCov_9fa48("1422"), false)
    });
  }
}
export async function writeReleasePublicKey(args: {
  distDir: string;
  publicKeyHex: string;
}): Promise<string> {
  if (stryMutAct_9fa48("1423")) {
    {}
  } else {
    stryCov_9fa48("1423");
    const wellKnownDir = path.join(args.distDir, stryMutAct_9fa48("1424") ? "" : (stryCov_9fa48("1424"), "client"), stryMutAct_9fa48("1425") ? "" : (stryCov_9fa48("1425"), ".well-known"));
    await ensureDir(wellKnownDir);
    const pubKeyPath = path.join(wellKnownDir, stryMutAct_9fa48("1426") ? "" : (stryCov_9fa48("1426"), "release-pubkey.json"));
    const keyId = stryMutAct_9fa48("1427") ? byteHash(args.publicKeyHex) : (stryCov_9fa48("1427"), byteHash(args.publicKeyHex).slice((stryMutAct_9fa48("1428") ? "" : (stryCov_9fa48("1428"), "sha256:")).length));
    const content = stryMutAct_9fa48("1429") ? {} : (stryCov_9fa48("1429"), {
      keyId,
      publicKeyHex: args.publicKeyHex,
      algorithm: stryMutAct_9fa48("1430") ? "" : (stryCov_9fa48("1430"), "Ed25519"),
      createdAt: new Date().toISOString()
    });
    await atomicWriteFile(pubKeyPath, JSON.stringify(content, null, 2));
    return pubKeyPath;
  }
}
export async function verifyBuildIdentitySignature(args: {
  buildIdentity: Record<string, unknown>;
  publicKeyHex: string;
}): Promise<boolean> {
  if (stryMutAct_9fa48("1431")) {
    {}
  } else {
    stryCov_9fa48("1431");
    const signature = (stryMutAct_9fa48("1434") ? typeof args.buildIdentity.signature !== "string" : stryMutAct_9fa48("1433") ? false : stryMutAct_9fa48("1432") ? true : (stryCov_9fa48("1432", "1433", "1434"), typeof args.buildIdentity.signature === (stryMutAct_9fa48("1435") ? "" : (stryCov_9fa48("1435"), "string")))) ? args.buildIdentity.signature : null;
    if (stryMutAct_9fa48("1438") ? false : stryMutAct_9fa48("1437") ? true : stryMutAct_9fa48("1436") ? signature : (stryCov_9fa48("1436", "1437", "1438"), !signature)) return stryMutAct_9fa48("1439") ? true : (stryCov_9fa48("1439"), false);
    const signablePayload: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args.buildIdentity)) {
      if (stryMutAct_9fa48("1440")) {
        {}
      } else {
        stryCov_9fa48("1440");
        if (stryMutAct_9fa48("1443") ? false : stryMutAct_9fa48("1442") ? true : stryMutAct_9fa48("1441") ? SIGNATURE_FIELDS.includes(key as typeof SIGNATURE_FIELDS[number]) : (stryCov_9fa48("1441", "1442", "1443"), !SIGNATURE_FIELDS.includes(key as typeof SIGNATURE_FIELDS[number]))) {
          if (stryMutAct_9fa48("1444")) {
            {}
          } else {
            stryCov_9fa48("1444");
            signablePayload[key] = value;
          }
        }
      }
    }
    const publicKeyBytes = signingFromHex(args.publicKeyHex);
    const signatureBytes = signingFromHex(signature);
    return signingVerify(publicKeyBytes, signablePayload, signatureBytes);
  }
}