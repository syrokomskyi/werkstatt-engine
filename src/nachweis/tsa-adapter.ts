/*
<MODULE_CONTRACT>
<purpose>RFC-0715: TSA adapter for RFC 3161 timestamp queries — encodes TimeStampReq via pkijs/asn1js, sends HTTP POST, returns DER-encoded TimeStampResp.</purpose>
<keywords>tsa, rfc3161, timestamp, pkijs, asn1js, freetsa</keywords>
<responsibilities>
  <item>Defines TsaAdapter interface with timestamp(message: Uint8Array) → Uint8Array.</item>
  <item>Implements FreeTsaAdapter targeting freetsa.org.</item>
  <item>Encodes TimeStampReq using pkijs + asn1js (SHA-256 messageImprint, nonce, certReq=true).</item>
  <item>Sends HTTP POST with application/timestamp-query content type.</item>
  <item>Returns DER-encoded TimeStampResp bytes.</item>
</responsibilities>
<non-goals>
  <item>Does not verify the timestamp token — that is nachweis.verify-signature.</item>
  <item>Does not implement retry logic — caller handles transient failures.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0715: initial TSA adapter with FreeTSA.org implementation.</item>
  <item>RFC-0715 review fix: use byteHash from @warpgogol/fingerprint (DNA-53). Replace FreeTsaAdapter class + createCustomTsaAdapter with HttpTsaAdapter class.</item>
</CHANGE_SUMMARY>
*/

import { byteHash } from "@warpgogol/werkstatt-engine/fingerprint";

export interface TsaAdapter {
  readonly name: string;
  readonly url: string;
  timestamp(message: Uint8Array): Promise<Uint8Array>;
}

export class HttpTsaAdapter implements TsaAdapter {
  readonly name: string;
  readonly url: string;

  constructor(name: string, url: string) {
    this.name = name;
    this.url = url;
  }

  async timestamp(message: Uint8Array): Promise<Uint8Array> {
    const reqBytes = await encodeTimestampReq(message);

    const response = await fetch(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/timestamp-query" },
      body: Buffer.from(reqBytes),
    });

    if (!response.ok) {
      throw new Error(
        `[${this.name}] TSA returned HTTP ${response.status}: ${response.statusText}`,
      );
    }

    const respBuffer = await response.arrayBuffer();
    return new Uint8Array(respBuffer);
  }
}

export const FreeTsaAdapter = new HttpTsaAdapter("FreeTSA", "https://freetsa.org/tsr");

export async function encodeTimestampReq(message: Uint8Array): Promise<Uint8Array> {
  const { default: pkijs } = await import("pkijs");
  const { default: asn1js } = await import("asn1js");

  const hashHex = byteHash(message).replace("sha256:", "");
  const hashBytes = Buffer.from(hashHex, "hex");
  const hashBuffer = hashBytes.buffer.slice(
    hashBytes.byteOffset,
    hashBytes.byteOffset + hashBytes.byteLength,
  );

  const messageImprint = new pkijs.MessageImprint({
    hashAlgorithm: new pkijs.AlgorithmIdentifier({
      algorithmId: "2.16.840.1.101.3.4.2.1",
    }),
    hashedMessage: new asn1js.OctetString({ valueHex: hashBuffer }),
  });

  const nonceBytes = new Uint8Array(10);
  crypto.getRandomValues(nonceBytes);

  const tspReq = new pkijs.TimeStampReq({
    version: 1,
    messageImprint,
    reqPolicy: "1.2.3.4.5.6",
    certReq: true,
    nonce: new asn1js.Integer({ valueHex: nonceBytes.buffer }),
  });

  const reqSchema = tspReq.toSchema();
  const reqBer = reqSchema.toBER(false);
  return new Uint8Array(reqBer);
}
