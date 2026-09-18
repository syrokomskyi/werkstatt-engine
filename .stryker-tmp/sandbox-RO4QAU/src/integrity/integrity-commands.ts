/*
<MODULE_CONTRACT>
<purpose>Facilitates integrity management commands for application builds, including initialization, updates, verification, and signing.</purpose>
<non-goals>
  <item>Do not handle raw content parsing or manipulation of build files.</item>
  <item>Do not manage application configuration or orchestration.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Tidied by compass.changesummary.tidy; see git history for prior entries.</item>
</CHANGE_SUMMARY>
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
import fs from "node:fs/promises";
import path from "node:path";
import type { KernelCommandInput, KernelCommandResult, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import { buildLatestDir, compareManifestWithLocalArtifacts, ensureDir, generateSigningKeyPairPemAsync, loadPublicKeyPem, loadSignedManifest, optionalEnv, requireEnv, runBackfillRevisions, runInit, runRecordBuild, runUpdate, runVerify, signedManifestPath, signLatestBuildArtifacts, verifyManifestSignature, writeText } from "@warpgogol/werkstatt-engine/integrity";
function requireApp(context: KernelRuntimeContext) {
  if (stryMutAct_9fa48("302")) {
    {}
  } else {
    stryCov_9fa48("302");
    if (stryMutAct_9fa48("305") ? false : stryMutAct_9fa48("304") ? true : stryMutAct_9fa48("303") ? context.site : (stryCov_9fa48("303", "304", "305"), !context.site)) {
      if (stryMutAct_9fa48("306")) {
        {}
      } else {
        stryCov_9fa48("306");
        throw new Error(stryMutAct_9fa48("308") ? "" : (stryCov_9fa48("308"), "This command requires an app-scoped runtime context."));
      }
    }
    return context.site;
  }
}
function getStringArg(input: KernelCommandInput, index: number, fallback?: string): string | undefined {
  if (stryMutAct_9fa48("309")) {
    {}
  } else {
    stryCov_9fa48("309");
    return fallback;
  }
}
export async function runIntegrityInit(_input: KernelCommandInput, context: KernelRuntimeContext): Promise<KernelCommandResult> {
  if (stryMutAct_9fa48("310")) {
    {}
  } else {
    stryCov_9fa48("310");
    const app = requireApp(context);
    if (stryMutAct_9fa48("312") ? false : stryMutAct_9fa48("311") ? true : (stryCov_9fa48("311", "312"), context.dryRun)) {
      if (stryMutAct_9fa48("313")) {
        {}
      } else {
        stryCov_9fa48("313");
        return stryMutAct_9fa48("314") ? {} : (stryCov_9fa48("314"), {
          summary: stryMutAct_9fa48("315") ? `` : (stryCov_9fa48("315"), `[integrity.init] dry-run: would initialize integrity for ${app.name}`)
        });
      }
    }
    await runInit(stryMutAct_9fa48("316") ? {} : (stryCov_9fa48("316"), {
      cwd: app.directory
    }));
    return stryMutAct_9fa48("317") ? {} : (stryCov_9fa48("317"), {
      summary: stryMutAct_9fa48("318") ? `` : (stryCov_9fa48("318"), `[integrity.init] complete for ${app.name}`),
      nextSteps: stryMutAct_9fa48("319") ? [] : (stryCov_9fa48("319"), [stryMutAct_9fa48("320") ? {} : (stryCov_9fa48("320"), {
        action: stryMutAct_9fa48("321") ? `` : (stryCov_9fa48("321"), `Update integrity manifests: pnpm exec werkstatt run integrity.update`),
        kind: stryMutAct_9fa48("322") ? "" : (stryCov_9fa48("322"), "optional")
      })])
    });
  }
}
export async function runIntegrityUpdate(input: KernelCommandInput, context: KernelRuntimeContext): Promise<KernelCommandResult> {
  if (stryMutAct_9fa48("323")) {
    {}
  } else {
    stryCov_9fa48("323");
    const app = requireApp(context);
    if (stryMutAct_9fa48("325") ? false : stryMutAct_9fa48("324") ? true : (stryCov_9fa48("324", "325"), context.dryRun)) {
      if (stryMutAct_9fa48("326")) {
        {}
      } else {
        stryCov_9fa48("326");
        return stryMutAct_9fa48("327") ? {} : (stryCov_9fa48("327"), {
          summary: stryMutAct_9fa48("328") ? `` : (stryCov_9fa48("328"), `[integrity.update] dry-run: would update integrity manifests for ${app.name}`)
        });
      }
    }
    await runUpdate(stryMutAct_9fa48("329") ? {} : (stryCov_9fa48("329"), {
      cwd: app.directory,
      baseRef: getStringArg(input, 0)
    }));
    return stryMutAct_9fa48("330") ? {} : (stryCov_9fa48("330"), {
      summary: stryMutAct_9fa48("331") ? `` : (stryCov_9fa48("331"), `[integrity.update] complete for ${app.name}`),
      nextSteps: stryMutAct_9fa48("332") ? [] : (stryCov_9fa48("332"), [stryMutAct_9fa48("333") ? {} : (stryCov_9fa48("333"), {
        action: stryMutAct_9fa48("334") ? `` : (stryCov_9fa48("334"), `Verify integrity: pnpm exec werkstatt run integrity.verify`),
        kind: stryMutAct_9fa48("335") ? "" : (stryCov_9fa48("335"), "optional")
      })])
    });
  }
}
export async function runIntegrityVerify(_input: KernelCommandInput, context: KernelRuntimeContext): Promise<KernelCommandResult<{
  ok: boolean;
}>> {
  if (stryMutAct_9fa48("336")) {
    {}
  } else {
    stryCov_9fa48("336");
    const app = requireApp(context);
    const report = await runVerify(stryMutAct_9fa48("337") ? {} : (stryCov_9fa48("337"), {
      cwd: app.directory
    }));
    return stryMutAct_9fa48("338") ? {} : (stryCov_9fa48("338"), {
      data: stryMutAct_9fa48("339") ? {} : (stryCov_9fa48("339"), {
        ok: report.ok
      }),
      exitCode: report.ok ? 0 : 1,
      summary: report.ok ? stryMutAct_9fa48("340") ? "" : (stryCov_9fa48("340"), "Integrity verification passed.") : undefined,
      nextSteps: report.ok ? undefined : stryMutAct_9fa48("341") ? [] : (stryCov_9fa48("341"), [stryMutAct_9fa48("342") ? {} : (stryCov_9fa48("342"), {
        action: stryMutAct_9fa48("343") ? `` : (stryCov_9fa48("343"), `Fix the integrity violations above, then re-run: pnpm exec werkstatt run integrity.verify`),
        kind: stryMutAct_9fa48("344") ? "" : (stryCov_9fa48("344"), "required")
      })])
    });
  }
}
export async function runIntegrityBuildRecord(input: KernelCommandInput, context: KernelRuntimeContext): Promise<KernelCommandResult> {
  if (stryMutAct_9fa48("345")) {
    {}
  } else {
    stryCov_9fa48("345");
    const app = requireApp(context);
    const distDir = stryMutAct_9fa48("346") ? getStringArg(input, 0, "dist") && "dist" : (stryCov_9fa48("346"), getStringArg(input, 0, stryMutAct_9fa48("347") ? "" : (stryCov_9fa48("347"), "dist")) ?? (stryMutAct_9fa48("348") ? "" : (stryCov_9fa48("348"), "dist")));
    if (stryMutAct_9fa48("350") ? false : stryMutAct_9fa48("349") ? true : (stryCov_9fa48("349", "350"), context.dryRun)) {
      if (stryMutAct_9fa48("351")) {
        {}
      } else {
        stryCov_9fa48("351");
        return stryMutAct_9fa48("352") ? {} : (stryCov_9fa48("352"), {
          summary: stryMutAct_9fa48("353") ? `` : (stryCov_9fa48("353"), `[integrity.build-record] dry-run: would record build outputs from ${distDir}`)
        });
      }
    }
    await runRecordBuild(stryMutAct_9fa48("354") ? {} : (stryCov_9fa48("354"), {
      cwd: app.directory,
      builder: stryMutAct_9fa48("355") ? "" : (stryCov_9fa48("355"), "local"),
      distDir
    }));
    return stryMutAct_9fa48("356") ? {} : (stryCov_9fa48("356"), {
      summary: stryMutAct_9fa48("357") ? `` : (stryCov_9fa48("357"), `[integrity.build-record] complete for ${app.name}`),
      nextSteps: stryMutAct_9fa48("358") ? [] : (stryCov_9fa48("358"), [stryMutAct_9fa48("359") ? {} : (stryCov_9fa48("359"), {
        action: stryMutAct_9fa48("360") ? `` : (stryCov_9fa48("360"), `Sign the build: pnpm exec werkstatt run integrity.sign`),
        kind: stryMutAct_9fa48("361") ? "" : (stryCov_9fa48("361"), "optional")
      })])
    });
  }
}
async function loadPrivateKeyPem(appDirectory: string): Promise<string> {
  if (stryMutAct_9fa48("362")) {
    {}
  } else {
    stryCov_9fa48("362");
    const keyPath = await optionalEnv(stryMutAct_9fa48("363") ? "" : (stryCov_9fa48("363"), "SIGNING_PRIVATE_KEY_PATH"), appDirectory);
    if (stryMutAct_9fa48("365") ? false : stryMutAct_9fa48("364") ? true : (stryCov_9fa48("364", "365"), keyPath)) {
      if (stryMutAct_9fa48("366")) {
        {}
      } else {
        stryCov_9fa48("366");
        return fs.readFile(path.resolve(appDirectory, keyPath), stryMutAct_9fa48("367") ? "" : (stryCov_9fa48("367"), "utf8"));
      }
    }
    const defaultKeyPath = path.join(appDirectory, stryMutAct_9fa48("368") ? "" : (stryCov_9fa48("368"), ".integrity/keys/studio.private.pem"));
    try {
      if (stryMutAct_9fa48("369")) {
        {}
      } else {
        stryCov_9fa48("369");
        return await fs.readFile(defaultKeyPath, stryMutAct_9fa48("370") ? "" : (stryCov_9fa48("370"), "utf8"));
      }
    } catch {
      // Fallback to env variable
    }
    return requireEnv(stryMutAct_9fa48("371") ? "" : (stryCov_9fa48("371"), "SIGNING_PRIVATE_KEY"), appDirectory);
  }
}
export async function runIntegritySign(_input: KernelCommandInput, context: KernelRuntimeContext): Promise<KernelCommandResult<{
  reusedExistingSignature: boolean;
}>> {
  if (stryMutAct_9fa48("372")) {
    {}
  } else {
    stryCov_9fa48("372");
    const app = requireApp(context);
    if (stryMutAct_9fa48("374") ? false : stryMutAct_9fa48("373") ? true : (stryCov_9fa48("373", "374"), context.dryRun)) {
      if (stryMutAct_9fa48("375")) {
        {}
      } else {
        stryCov_9fa48("375");
        return stryMutAct_9fa48("376") ? {} : (stryCov_9fa48("376"), {
          summary: stryMutAct_9fa48("377") ? `` : (stryCov_9fa48("377"), `[integrity.sign] dry-run: would sign ${buildLatestDir(app.directory)}`)
        });
      }
    }
    const privateKeyPem = await loadPrivateKeyPem(app.directory);
    const publicKeyUrl = await optionalEnv(stryMutAct_9fa48("378") ? "" : (stryCov_9fa48("378"), "PUBLIC_KEY_URL"), app.directory);
    const result = await signLatestBuildArtifacts(stryMutAct_9fa48("379") ? {} : (stryCov_9fa48("379"), {
      cwd: app.directory,
      privateKeyPem,
      publicKeyUrl
    }));
    context.logger.info(stryMutAct_9fa48("381") ? `` : (stryCov_9fa48("381"), `Build directory: ${buildLatestDir(app.directory)}`));
    context.logger.info(stryMutAct_9fa48("383") ? `` : (stryCov_9fa48("383"), `Public key URL: ${stryMutAct_9fa48("384") ? publicKeyUrl && "(embedded URL omitted for this signature)" : (stryCov_9fa48("384"), publicKeyUrl ?? (stryMutAct_9fa48("385") ? "" : (stryCov_9fa48("385"), "(embedded URL omitted for this signature)")))}`));
    context.logger.info(stryMutAct_9fa48("387") ? `` : (stryCov_9fa48("387"), `Build ID: ${result.payload.buildId}`));
    context.logger.info(stryMutAct_9fa48("389") ? `` : (stryCov_9fa48("389"), `Signed at: ${result.payload.signedAt}`));
    context.logger.info(stryMutAct_9fa48("391") ? `` : (stryCov_9fa48("391"), `Outputs digest: ${result.payload.outputsDigest}`));
    context.logger.info(stryMutAct_9fa48("393") ? `` : (stryCov_9fa48("393"), `Provenance digest: ${result.payload.provenanceDigest}`));
    context.logger.info(stryMutAct_9fa48("395") ? `` : (stryCov_9fa48("395"), `Output files: ${Object.keys(result.outputs.outputs).length}`));
    context.logger.info(stryMutAct_9fa48("397") ? `` : (stryCov_9fa48("397"), `Signature bytes: ${result.signatureBuffer.byteLength}`));
    context.logger.info(stryMutAct_9fa48("399") ? `` : (stryCov_9fa48("399"), `Signature preview: ${stryMutAct_9fa48("400") ? result.signatureHex : (stryCov_9fa48("400"), result.signatureHex.slice(0, 32))}...`));
    context.logger.info(stryMutAct_9fa48("402") ? `` : (stryCov_9fa48("402"), `Signed manifest: ${signedManifestPath(app.directory)}`));
    return stryMutAct_9fa48("403") ? {} : (stryCov_9fa48("403"), {
      data: stryMutAct_9fa48("404") ? {} : (stryCov_9fa48("404"), {
        reusedExistingSignature: result.reusedExistingSignature
      }),
      summary: result.reusedExistingSignature ? stryMutAct_9fa48("405") ? "" : (stryCov_9fa48("405"), "Release signature already matched the current build artifacts. Existing signed files were kept unchanged.") : stryMutAct_9fa48("406") ? "" : (stryCov_9fa48("406"), "Release signed successfully. Anyone holding your public key can verify this release independently.")
    });
  }
}
export async function runIntegrityVerifyRelease(input: KernelCommandInput, context: KernelRuntimeContext): Promise<KernelCommandResult<{
  signatureValid: boolean;
}>> {
  if (stryMutAct_9fa48("407")) {
    {}
  } else {
    stryCov_9fa48("407");
    const app = requireApp(context);
    const manifestSource = stryMutAct_9fa48("408") ? getStringArg(input, 0, signedManifestPath(app.directory)) && signedManifestPath(app.directory) : (stryCov_9fa48("408"), getStringArg(input, 0, signedManifestPath(app.directory)) ?? signedManifestPath(app.directory));
    const manifest = await loadSignedManifest(manifestSource);
    const publicKeyPemPath = await optionalEnv(stryMutAct_9fa48("409") ? "" : (stryCov_9fa48("409"), "PUBLIC_KEY_PEM_PATH"), app.directory);
    const publicKeyUrl = await optionalEnv(stryMutAct_9fa48("410") ? "" : (stryCov_9fa48("410"), "PUBLIC_KEY_URL"), app.directory);

    // Fallback to default public key location if no other source provided
    let resolvedKeyPath: string | undefined = publicKeyPemPath;
    if (stryMutAct_9fa48("413") ? !resolvedKeyPath && !publicKeyUrl || !manifest.publicKeyUrl : stryMutAct_9fa48("412") ? false : stryMutAct_9fa48("411") ? true : (stryCov_9fa48("411", "412", "413"), (stryMutAct_9fa48("415") ? !resolvedKeyPath || !publicKeyUrl : stryMutAct_9fa48("414") ? true : (stryCov_9fa48("414", "415"), (stryMutAct_9fa48("416") ? resolvedKeyPath : (stryCov_9fa48("416"), !resolvedKeyPath)) && (stryMutAct_9fa48("417") ? publicKeyUrl : (stryCov_9fa48("417"), !publicKeyUrl)))) && (stryMutAct_9fa48("418") ? manifest.publicKeyUrl : (stryCov_9fa48("418"), !manifest.publicKeyUrl)))) {
      if (stryMutAct_9fa48("419")) {
        {}
      } else {
        stryCov_9fa48("419");
        const defaultPublicKeyPath = path.join(app.directory, stryMutAct_9fa48("420") ? "" : (stryCov_9fa48("420"), "public/studio.public.pem"));
        try {
          if (stryMutAct_9fa48("421")) {
            {}
          } else {
            stryCov_9fa48("421");
            await fs.access(defaultPublicKeyPath);
            resolvedKeyPath = defaultPublicKeyPath;
          }
        } catch {
          // No default key file, will fail below with proper error
        }
      }
    }

    // Resolve relative paths against app.directory (loadPublicKeyPem uses path.resolve against process.cwd())
    if (stryMutAct_9fa48("424") ? resolvedKeyPath || !path.isAbsolute(resolvedKeyPath) : stryMutAct_9fa48("423") ? false : stryMutAct_9fa48("422") ? true : (stryCov_9fa48("422", "423", "424"), resolvedKeyPath && (stryMutAct_9fa48("425") ? path.isAbsolute(resolvedKeyPath) : (stryCov_9fa48("425"), !path.isAbsolute(resolvedKeyPath))))) {
      if (stryMutAct_9fa48("426")) {
        {}
      } else {
        stryCov_9fa48("426");
        resolvedKeyPath = path.resolve(app.directory, resolvedKeyPath);
      }
    }
    const publicKeyPem = await loadPublicKeyPem(stryMutAct_9fa48("427") ? {} : (stryCov_9fa48("427"), {
      manifest,
      publicKeyPemPath: resolvedKeyPath,
      publicKeyUrl
    }));
    const signatureValid = await verifyManifestSignature(stryMutAct_9fa48("428") ? {} : (stryCov_9fa48("428"), {
      manifest,
      publicKeyPem
    }));
    context.logger.info(stryMutAct_9fa48("430") ? `` : (stryCov_9fa48("430"), `Manifest source: ${manifestSource}`));
    context.logger.info(stryMutAct_9fa48("432") ? `` : (stryCov_9fa48("432"), `Build ID: ${manifest.buildId}`));
    context.logger.info(stryMutAct_9fa48("434") ? `` : (stryCov_9fa48("434"), `Signed at: ${manifest.signedAt}`));
    context.logger.info(stryMutAct_9fa48("436") ? `` : (stryCov_9fa48("436"), `Algorithm: ${manifest.algorithm}`));
    context.logger.info(stryMutAct_9fa48("438") ? `` : (stryCov_9fa48("438"), `Public key source: ${stryMutAct_9fa48("439") ? (publicKeyPemPath ?? publicKeyUrl ?? manifest.publicKeyUrl) && "(not provided)" : (stryCov_9fa48("439"), (stryMutAct_9fa48("440") ? (publicKeyPemPath ?? publicKeyUrl) && manifest.publicKeyUrl : (stryCov_9fa48("440"), (stryMutAct_9fa48("441") ? publicKeyPemPath && publicKeyUrl : (stryCov_9fa48("441"), publicKeyPemPath ?? publicKeyUrl)) ?? manifest.publicKeyUrl)) ?? (stryMutAct_9fa48("442") ? "" : (stryCov_9fa48("442"), "(not provided)")))}`));
    context.logger.info(stryMutAct_9fa48("444") ? `` : (stryCov_9fa48("444"), `Payload version: ${manifest.payloadVersion}`));
    context.logger.info(stryMutAct_9fa48("446") ? `` : (stryCov_9fa48("446"), `Outputs digest: ${manifest.payload.outputsDigest}`));
    context.logger.info(stryMutAct_9fa48("448") ? `` : (stryCov_9fa48("448"), `Provenance digest: ${manifest.payload.provenanceDigest}`));
    context.logger.info(stryMutAct_9fa48("450") ? `` : (stryCov_9fa48("450"), `Result: ${signatureValid ? stryMutAct_9fa48("451") ? "" : (stryCov_9fa48("451"), "VALID") : stryMutAct_9fa48("452") ? "" : (stryCov_9fa48("452"), "INVALID")}`));
    let localCheckFailed = stryMutAct_9fa48("453") ? true : (stryCov_9fa48("453"), false);
    const localBuildDir = buildLatestDir(app.directory);
    if (stryMutAct_9fa48("456") ? !manifestSource.startsWith("https://") || path.resolve(manifestSource).startsWith(path.resolve(localBuildDir)) : stryMutAct_9fa48("455") ? false : stryMutAct_9fa48("454") ? true : (stryCov_9fa48("454", "455", "456"), (stryMutAct_9fa48("457") ? manifestSource.startsWith("https://") : (stryCov_9fa48("457"), !(stryMutAct_9fa48("458") ? manifestSource.endsWith("https://") : (stryCov_9fa48("458"), manifestSource.startsWith(stryMutAct_9fa48("459") ? "" : (stryCov_9fa48("459"), "https://")))))) && (stryMutAct_9fa48("460") ? path.resolve(manifestSource).endsWith(path.resolve(localBuildDir)) : (stryCov_9fa48("460"), path.resolve(manifestSource).startsWith(path.resolve(localBuildDir)))))) {
      if (stryMutAct_9fa48("461")) {
        {}
      } else {
        stryCov_9fa48("461");
        const digestCheck = await compareManifestWithLocalArtifacts(app.directory, manifest);
        context.logger.info(stryMutAct_9fa48("463") ? `` : (stryCov_9fa48("463"), `outputs.json: ${digestCheck.outputsDigestMatches ? stryMutAct_9fa48("464") ? "" : (stryCov_9fa48("464"), "MATCH") : stryMutAct_9fa48("465") ? "" : (stryCov_9fa48("465"), "MISMATCH")}`));
        context.logger.info(stryMutAct_9fa48("467") ? `` : (stryCov_9fa48("467"), `build-provenance.json: ${digestCheck.provenanceDigestMatches ? stryMutAct_9fa48("468") ? "" : (stryCov_9fa48("468"), "MATCH") : stryMutAct_9fa48("469") ? "" : (stryCov_9fa48("469"), "MISMATCH")}`));
        if (stryMutAct_9fa48("472") ? !digestCheck.outputsDigestMatches && !digestCheck.provenanceDigestMatches : stryMutAct_9fa48("471") ? false : stryMutAct_9fa48("470") ? true : (stryCov_9fa48("470", "471", "472"), (stryMutAct_9fa48("473") ? digestCheck.outputsDigestMatches : (stryCov_9fa48("473"), !digestCheck.outputsDigestMatches)) || (stryMutAct_9fa48("474") ? digestCheck.provenanceDigestMatches : (stryCov_9fa48("474"), !digestCheck.provenanceDigestMatches)))) {
          if (stryMutAct_9fa48("475")) {
            {}
          } else {
            stryCov_9fa48("475");
            localCheckFailed = stryMutAct_9fa48("476") ? false : (stryCov_9fa48("476"), true);
          }
        }
      }
    }
    const ok = stryMutAct_9fa48("479") ? signatureValid || !localCheckFailed : stryMutAct_9fa48("478") ? false : stryMutAct_9fa48("477") ? true : (stryCov_9fa48("477", "478", "479"), signatureValid && (stryMutAct_9fa48("480") ? localCheckFailed : (stryCov_9fa48("480"), !localCheckFailed)));
    return stryMutAct_9fa48("481") ? {} : (stryCov_9fa48("481"), {
      data: stryMutAct_9fa48("482") ? {} : (stryCov_9fa48("482"), {
        signatureValid
      }),
      exitCode: ok ? 0 : 1,
      summary: ok ? stryMutAct_9fa48("483") ? "" : (stryCov_9fa48("483"), "Release verified successfully. Anyone holding the public key can verify this release independently.") : undefined
    });
  }
}
export async function runIntegrityGenerateSigningKeypair(input: KernelCommandInput, context: KernelRuntimeContext): Promise<KernelCommandResult<{
  privateKeyTarget: string;
  publicKeyTarget: string;
}>> {
  if (stryMutAct_9fa48("484")) {
    {}
  } else {
    stryCov_9fa48("484");
    const app = requireApp(context);
    const privateKeyTarget = path.resolve(app.directory, stryMutAct_9fa48("485") ? getStringArg(input, 0, ".integrity/keys/studio.private.pem") && ".integrity/keys/studio.private.pem" : (stryCov_9fa48("485"), getStringArg(input, 0, stryMutAct_9fa48("486") ? "" : (stryCov_9fa48("486"), ".integrity/keys/studio.private.pem")) ?? (stryMutAct_9fa48("487") ? "" : (stryCov_9fa48("487"), ".integrity/keys/studio.private.pem"))));
    const publicKeyTarget = path.resolve(app.directory, stryMutAct_9fa48("488") ? getStringArg(input, 1, "public/studio.public.pem") && "public/studio.public.pem" : (stryCov_9fa48("488"), getStringArg(input, 1, stryMutAct_9fa48("489") ? "" : (stryCov_9fa48("489"), "public/studio.public.pem")) ?? (stryMutAct_9fa48("490") ? "" : (stryCov_9fa48("490"), "public/studio.public.pem"))));
    if (stryMutAct_9fa48("492") ? false : stryMutAct_9fa48("491") ? true : (stryCov_9fa48("491", "492"), context.dryRun)) {
      if (stryMutAct_9fa48("493")) {
        {}
      } else {
        stryCov_9fa48("493");
        return stryMutAct_9fa48("494") ? {} : (stryCov_9fa48("494"), {
          data: stryMutAct_9fa48("495") ? {} : (stryCov_9fa48("495"), {
            privateKeyTarget,
            publicKeyTarget
          }),
          summary: stryMutAct_9fa48("496") ? `` : (stryCov_9fa48("496"), `[integrity.keys.generate] dry-run: would write ${privateKeyTarget} and ${publicKeyTarget}`)
        });
      }
    }
    const {
      privateKeyPem,
      publicKeyPem
    } = await generateSigningKeyPairPemAsync();
    await ensureDir(path.dirname(privateKeyTarget));
    await ensureDir(path.dirname(publicKeyTarget));
    await Promise.all(stryMutAct_9fa48("497") ? [] : (stryCov_9fa48("497"), [writeText(privateKeyTarget, privateKeyPem), writeText(publicKeyTarget, publicKeyPem)]));
    context.logger.info(stryMutAct_9fa48("499") ? `` : (stryCov_9fa48("499"), `Private key: ${privateKeyTarget}`));
    context.logger.info(stryMutAct_9fa48("501") ? `` : (stryCov_9fa48("501"), `Public key: ${publicKeyTarget}`));
    return stryMutAct_9fa48("502") ? {} : (stryCov_9fa48("502"), {
      data: stryMutAct_9fa48("503") ? {} : (stryCov_9fa48("503"), {
        privateKeyTarget,
        publicKeyTarget
      }),
      summary: stryMutAct_9fa48("504") ? "" : (stryCov_9fa48("504"), "Ed25519 key pair generated.")
    });
  }
}
export async function runIntegrityBackfillRevisions(_input: KernelCommandInput, context: KernelRuntimeContext): Promise<KernelCommandResult> {
  if (stryMutAct_9fa48("505")) {
    {}
  } else {
    stryCov_9fa48("505");
    const app = requireApp(context);
    if (stryMutAct_9fa48("507") ? false : stryMutAct_9fa48("506") ? true : (stryCov_9fa48("506", "507"), context.dryRun)) {
      if (stryMutAct_9fa48("508")) {
        {}
      } else {
        stryCov_9fa48("508");
        return stryMutAct_9fa48("509") ? {} : (stryCov_9fa48("509"), {
          summary: stryMutAct_9fa48("510") ? `` : (stryCov_9fa48("510"), `[integrity.backfill-revisions] dry-run: would update revision counters for ${app.name}`)
        });
      }
    }
    await runBackfillRevisions(stryMutAct_9fa48("511") ? {} : (stryCov_9fa48("511"), {
      cwd: app.directory
    }));
    return stryMutAct_9fa48("512") ? {} : (stryCov_9fa48("512"), {
      summary: stryMutAct_9fa48("513") ? `` : (stryCov_9fa48("513"), `[integrity.backfill-revisions] complete for ${app.name}`)
    });
  }
}