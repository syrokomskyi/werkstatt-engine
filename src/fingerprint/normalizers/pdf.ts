/*
<MODULE_CONTRACT>
  <purpose>RFC-0656: PDF stable normalizer — strips non-deterministic metadata fields (/CreationDate, /ModDate, /ID) before hashing.</purpose>
  <non-goals>
    <item>Do not alter PDF content — only metadata fields that vary between builds are stripped.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0656: initial PDF stable normalizer using pdf-lib.</item>
</CHANGE_SUMMARY>
*/

import { PDFDocument } from "pdf-lib";

export async function normalizePdf(bytes: Uint8Array): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });

  pdf.setCreationDate(new Date(0));
  pdf.setModificationDate(new Date(0));
  pdf.context.trailerInfo.ID = undefined;

  return await pdf.save({ useObjectStreams: false });
}
