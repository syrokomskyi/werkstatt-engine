/*
<MODULE_CONTRACT>
  <purpose>RFC-1051: load verification tests for nachweis modules.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1051: initial nachweis load verification tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import * as assessmentIngest from "../nachweis-assessment-ingest.ts";
import * as cloudflareReadiness from "../nachweis-cloudflare-agent-readiness-measure.ts";
import * as consent from "../nachweis-consent.ts";
import * as ingest from "../nachweis-ingest.ts";
import * as lighthouse from "../nachweis-lighthouse-measure.ts";
import * as manifest from "../nachweis-manifest.ts";
import * as n3Types from "../nachweis-n3-types.ts";
import * as publicDerivative from "../nachweis-public-derivative.ts";
import * as publish from "../nachweis-publish.ts";
import * as screenshotProcess from "../nachweis-screenshot-process.ts";
import * as screenshotUpload from "../nachweis-screenshot-upload.ts";
import * as validate from "../nachweis-validate.ts";
import * as withdraw from "../nachweis-withdraw.ts";

test("nachweis-assessment-ingest module loads", () => {
  expect(assessmentIngest).toBeDefined();
});

test("nachweis-cloudflare-agent-readiness-measure module loads", () => {
  expect(cloudflareReadiness).toBeDefined();
});

test("nachweis-consent module loads", () => {
  expect(consent).toBeDefined();
});

test("nachweis-ingest module loads", () => {
  expect(ingest).toBeDefined();
});

test("nachweis-lighthouse-measure module loads", () => {
  expect(lighthouse).toBeDefined();
});

test("nachweis-manifest module loads", () => {
  expect(manifest).toBeDefined();
});

test("nachweis-n3-types module loads", () => {
  expect(n3Types).toBeDefined();
});

test("nachweis-public-derivative module loads", () => {
  expect(publicDerivative).toBeDefined();
});

test("nachweis-publish module loads", () => {
  expect(publish).toBeDefined();
});

test("nachweis-screenshot-process module loads", () => {
  expect(screenshotProcess).toBeDefined();
});

test("nachweis-screenshot-upload module loads", () => {
  expect(screenshotUpload).toBeDefined();
});

test("nachweis-validate module loads", () => {
  expect(validate).toBeDefined();
});

test("nachweis-withdraw module loads", () => {
  expect(withdraw).toBeDefined();
});
