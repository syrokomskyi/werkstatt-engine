/*
<MODULE_CONTRACT>
<purpose>Facilitates JSON schema validation for integrity files using AJV, ensuring compliance with defined schemas.</purpose>
<non-goals>
  <item>Do not handle schema definition or modification logic.</item>
  <item>Do not parse raw content of JSON files outside validation context.</item>
  <item>Do not manage the lifecycle of AJV instances beyond loading and validation.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Tidied by compass.changesummary.tidy; see git history for prior entries.</item>
</CHANGE_SUMMARY>
*/
// @ts-nocheck


/**
 * JSON schema validation for integrity files using AJV.
 * Validates all integrity JSON files against their defined schemas.
 */function stryNS_9fa48() {
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
import { discoverManagedDirectories } from "./discover.ts";
import { pathExists } from "./fs.ts";
import { readJsonFile } from "./json.ts";
import { buildLatestDir, currentPathsPath, deletedLogPath, entitiesByIdPath, manifestPathForDirectory, outputsPath, policyPath, provenancePath, schemaDir } from "./paths.ts";
import type { VerifyIssue } from "./types.ts";
type AjvValidateFunction = {
  (data: unknown): boolean;
  errors?: Array<{
    instancePath?: string;
    message?: string;
  }> | null;
};
interface AjvLike {
  compile(schema: object): AjvValidateFunction;
}
interface LoadedAjv {
  ajv: AjvLike;
  addFormats: (ajv: AjvLike) => void;
}
interface SchemaTarget {
  schemaFile: string;
  dataFile: string;
  pathLabel: string;
  optional?: boolean;
}
function formatAjvErrors(errors: Array<{
  instancePath?: string;
  message?: string;
}> | null | undefined): string {
  if (stryMutAct_9fa48("1069")) {
    {}
  } else {
    stryCov_9fa48("1069");
    if (stryMutAct_9fa48("1072") ? false : stryMutAct_9fa48("1071") ? true : stryMutAct_9fa48("1070") ? errors?.length : (stryCov_9fa48("1070", "1071", "1072"), !(stryMutAct_9fa48("1073") ? errors.length : (stryCov_9fa48("1073"), errors?.length)))) return stryMutAct_9fa48("1074") ? "" : (stryCov_9fa48("1074"), "schema validation failed");
    return errors.map(stryMutAct_9fa48("1075") ? () => undefined : (stryCov_9fa48("1075"), error => stryMutAct_9fa48("1076") ? `${error.instancePath || "/"} ${error.message ?? "is invalid"}` : (stryCov_9fa48("1076"), (stryMutAct_9fa48("1077") ? `` : (stryCov_9fa48("1077"), `${stryMutAct_9fa48("1080") ? error.instancePath && "/" : stryMutAct_9fa48("1079") ? false : stryMutAct_9fa48("1078") ? true : (stryCov_9fa48("1078", "1079", "1080"), error.instancePath || (stryMutAct_9fa48("1081") ? "" : (stryCov_9fa48("1081"), "/")))} ${stryMutAct_9fa48("1082") ? error.message && "is invalid" : (stryCov_9fa48("1082"), error.message ?? (stryMutAct_9fa48("1083") ? "" : (stryCov_9fa48("1083"), "is invalid")))}`)).trim()))).join(stryMutAct_9fa48("1084") ? "" : (stryCov_9fa48("1084"), "; "));
  }
}
async function tryLoadAjv(): Promise<LoadedAjv | null> {
  if (stryMutAct_9fa48("1085")) {
    {}
  } else {
    stryCov_9fa48("1085");
    try {
      if (stryMutAct_9fa48("1086")) {
        {}
      } else {
        stryCov_9fa48("1086");
        const [{
          default: Ajv2020
        }, addFormatsModule] = await Promise.all(stryMutAct_9fa48("1087") ? [] : (stryCov_9fa48("1087"), [import("ajv/dist/2020.js"), import("ajv-formats")]));
        const ajv = new Ajv2020({
          allErrors: true,
          strict: false
        }) as AjvLike;
        const addFormats = (addFormatsModule.default ?? addFormatsModule) as unknown as (ajv: AjvLike) => void;
        if (stryMutAct_9fa48("1088")) {
          ;
        } else {
          stryCov_9fa48("1088");
          addFormats(ajv);
        }
        return stryMutAct_9fa48("1089") ? {} : (stryCov_9fa48("1089"), {
          ajv,
          addFormats
        });
      }
    } catch {
      if (stryMutAct_9fa48("1090")) {
        {}
      } else {
        stryCov_9fa48("1090");
        return null;
      }
    }
  }
}
async function loadValidator(ajv: AjvLike, root: string, schemaFile: string): Promise<AjvValidateFunction> {
  if (stryMutAct_9fa48("1091")) {
    {}
  } else {
    stryCov_9fa48("1091");
    const schema = await readJsonFile<object>(stryMutAct_9fa48("1092") ? `` : (stryCov_9fa48("1092"), `${root}/${schemaFile}`));
    return ajv.compile(schema);
  }
}
export async function validateIntegrityJsonSchemas(cwd: string): Promise<VerifyIssue[]> {
  if (stryMutAct_9fa48("1093")) {
    {}
  } else {
    stryCov_9fa48("1093");
    const issues: VerifyIssue[] = stryMutAct_9fa48("1094") ? ["Stryker was here"] : (stryCov_9fa48("1094"), []);
    const root = schemaDir(cwd);
    const loadedAjv = await tryLoadAjv();
    if (stryMutAct_9fa48("1097") ? false : stryMutAct_9fa48("1096") ? true : stryMutAct_9fa48("1095") ? loadedAjv : (stryCov_9fa48("1095", "1096", "1097"), !loadedAjv)) {
      if (stryMutAct_9fa48("1098")) {
        {}
      } else {
        stryCov_9fa48("1098");
        issues.push(stryMutAct_9fa48("1100") ? {} : (stryCov_9fa48("1100"), {
          level: stryMutAct_9fa48("1101") ? "" : (stryCov_9fa48("1101"), "warning"),
          code: stryMutAct_9fa48("1102") ? "" : (stryCov_9fa48("1102"), "SCHEMA_VALIDATION_SKIPPED"),
          message: stryMutAct_9fa48("1103") ? "" : (stryCov_9fa48("1103"), "Ajv is not installed, so Draft 2020-12 schema validation was skipped. Structural verification is still active."),
          path: stryMutAct_9fa48("1104") ? "" : (stryCov_9fa48("1104"), ".integrity/schema")
        }));
        return issues;
      }
    }
    const {
      ajv
    } = loadedAjv;
    const validatorFiles = stryMutAct_9fa48("1105") ? [] : (stryCov_9fa48("1105"), [stryMutAct_9fa48("1106") ? "" : (stryCov_9fa48("1106"), "policy.schema.json"), stryMutAct_9fa48("1107") ? "" : (stryCov_9fa48("1107"), "entities.by-id.schema.json"), stryMutAct_9fa48("1108") ? "" : (stryCov_9fa48("1108"), "paths.current.schema.json"), stryMutAct_9fa48("1109") ? "" : (stryCov_9fa48("1109"), "deleted-log.schema.json"), stryMutAct_9fa48("1110") ? "" : (stryCov_9fa48("1110"), "manifest.schema.json"), stryMutAct_9fa48("1111") ? "" : (stryCov_9fa48("1111"), "outputs.schema.json"), stryMutAct_9fa48("1112") ? "" : (stryCov_9fa48("1112"), "build-provenance.schema.json")]);
    const validators = new Map<string, AjvValidateFunction>();
    for (const schemaFile of validatorFiles) {
      if (stryMutAct_9fa48("1113")) {
        {}
      } else {
        stryCov_9fa48("1113");
        if (stryMutAct_9fa48("1114")) {
          ;
        } else {
          stryCov_9fa48("1114");
          validators.set(schemaFile, await loadValidator(ajv, root, schemaFile));
        }
      }
    }
    const targets: SchemaTarget[] = stryMutAct_9fa48("1115") ? [] : (stryCov_9fa48("1115"), [stryMutAct_9fa48("1116") ? {} : (stryCov_9fa48("1116"), {
      schemaFile: stryMutAct_9fa48("1117") ? "" : (stryCov_9fa48("1117"), "policy.schema.json"),
      dataFile: policyPath(cwd),
      pathLabel: stryMutAct_9fa48("1118") ? "" : (stryCov_9fa48("1118"), ".integrity/config/policy.json")
    }), stryMutAct_9fa48("1119") ? {} : (stryCov_9fa48("1119"), {
      schemaFile: stryMutAct_9fa48("1120") ? "" : (stryCov_9fa48("1120"), "entities.by-id.schema.json"),
      dataFile: entitiesByIdPath(cwd),
      pathLabel: stryMutAct_9fa48("1121") ? "" : (stryCov_9fa48("1121"), ".integrity/index/entities.by-id.json")
    }), stryMutAct_9fa48("1122") ? {} : (stryCov_9fa48("1122"), {
      schemaFile: stryMutAct_9fa48("1123") ? "" : (stryCov_9fa48("1123"), "paths.current.schema.json"),
      dataFile: currentPathsPath(cwd),
      pathLabel: stryMutAct_9fa48("1124") ? "" : (stryCov_9fa48("1124"), ".integrity/index/paths.current.json")
    }), stryMutAct_9fa48("1125") ? {} : (stryCov_9fa48("1125"), {
      schemaFile: stryMutAct_9fa48("1126") ? "" : (stryCov_9fa48("1126"), "deleted-log.schema.json"),
      dataFile: deletedLogPath(cwd),
      pathLabel: stryMutAct_9fa48("1127") ? "" : (stryCov_9fa48("1127"), ".integrity/state/deleted-log.json")
    }), stryMutAct_9fa48("1128") ? {} : (stryCov_9fa48("1128"), {
      schemaFile: stryMutAct_9fa48("1129") ? "" : (stryCov_9fa48("1129"), "outputs.schema.json"),
      dataFile: outputsPath(cwd),
      pathLabel: stryMutAct_9fa48("1130") ? "" : (stryCov_9fa48("1130"), ".integrity/build/latest/outputs.json"),
      optional: stryMutAct_9fa48("1131") ? false : (stryCov_9fa48("1131"), true)
    }), stryMutAct_9fa48("1132") ? {} : (stryCov_9fa48("1132"), {
      schemaFile: stryMutAct_9fa48("1133") ? "" : (stryCov_9fa48("1133"), "build-provenance.schema.json"),
      dataFile: provenancePath(cwd),
      pathLabel: stryMutAct_9fa48("1134") ? "" : (stryCov_9fa48("1134"), ".integrity/build/latest/build-provenance.json"),
      optional: stryMutAct_9fa48("1135") ? false : (stryCov_9fa48("1135"), true)
    })]);
    const managedDirs = await discoverManagedDirectories(cwd).catch(stryMutAct_9fa48("1136") ? () => undefined : (stryCov_9fa48("1136"), () => stryMutAct_9fa48("1137") ? ["Stryker was here"] : (stryCov_9fa48("1137"), [])));
    for (const repoDir of managedDirs) {
      if (stryMutAct_9fa48("1138")) {
        {}
      } else {
        stryCov_9fa48("1138");
        targets.push(stryMutAct_9fa48("1140") ? {} : (stryCov_9fa48("1140"), {
          schemaFile: stryMutAct_9fa48("1141") ? "" : (stryCov_9fa48("1141"), "manifest.schema.json"),
          dataFile: manifestPathForDirectory(cwd, repoDir),
          pathLabel: stryMutAct_9fa48("1142") ? `` : (stryCov_9fa48("1142"), `.integrity/manifests/${(stryMutAct_9fa48("1145") ? repoDir !== "." : stryMutAct_9fa48("1144") ? false : stryMutAct_9fa48("1143") ? true : (stryCov_9fa48("1143", "1144", "1145"), repoDir === (stryMutAct_9fa48("1146") ? "" : (stryCov_9fa48("1146"), ".")))) ? stryMutAct_9fa48("1147") ? "" : (stryCov_9fa48("1147"), "root") : repoDir}/versions.json`)
        }));
      }
    }
    for (const target of targets) {
      if (stryMutAct_9fa48("1148")) {
        {}
      } else {
        stryCov_9fa48("1148");
        const exists = await pathExists(target.dataFile);
        if (stryMutAct_9fa48("1151") ? false : stryMutAct_9fa48("1150") ? true : stryMutAct_9fa48("1149") ? exists : (stryCov_9fa48("1149", "1150", "1151"), !exists)) {
          if (stryMutAct_9fa48("1152")) {
            {}
          } else {
            stryCov_9fa48("1152");
            if (stryMutAct_9fa48("1154") ? false : stryMutAct_9fa48("1153") ? true : (stryCov_9fa48("1153", "1154"), target.optional)) {
              if (stryMutAct_9fa48("1155")) {
                {}
              } else {
                stryCov_9fa48("1155");
                continue;
              }
            }
            issues.push(stryMutAct_9fa48("1157") ? {} : (stryCov_9fa48("1157"), {
              level: stryMutAct_9fa48("1158") ? "" : (stryCov_9fa48("1158"), "error"),
              code: stryMutAct_9fa48("1159") ? "" : (stryCov_9fa48("1159"), "SCHEMA_TARGET_MISSING"),
              message: stryMutAct_9fa48("1160") ? "" : (stryCov_9fa48("1160"), "Required integrity JSON file is missing"),
              path: target.pathLabel
            }));
            continue;
          }
        }
        let data: unknown;
        try {
          if (stryMutAct_9fa48("1161")) {
            {}
          } else {
            stryCov_9fa48("1161");
            data = await readJsonFile<unknown>(target.dataFile);
          }
        } catch (error) {
          if (stryMutAct_9fa48("1162")) {
            {}
          } else {
            stryCov_9fa48("1162");
            issues.push(stryMutAct_9fa48("1164") ? {} : (stryCov_9fa48("1164"), {
              level: stryMutAct_9fa48("1165") ? "" : (stryCov_9fa48("1165"), "error"),
              code: stryMutAct_9fa48("1166") ? "" : (stryCov_9fa48("1166"), "INVALID_JSON"),
              message: stryMutAct_9fa48("1167") ? `` : (stryCov_9fa48("1167"), `Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`),
              path: target.pathLabel
            }));
            continue;
          }
        }
        const validator = validators.get(target.schemaFile);
        if (stryMutAct_9fa48("1170") ? false : stryMutAct_9fa48("1169") ? true : stryMutAct_9fa48("1168") ? validator : (stryCov_9fa48("1168", "1169", "1170"), !validator)) {
          if (stryMutAct_9fa48("1171")) {
            {}
          } else {
            stryCov_9fa48("1171");
            issues.push(stryMutAct_9fa48("1173") ? {} : (stryCov_9fa48("1173"), {
              level: stryMutAct_9fa48("1174") ? "" : (stryCov_9fa48("1174"), "error"),
              code: stryMutAct_9fa48("1175") ? "" : (stryCov_9fa48("1175"), "SCHEMA_VALIDATOR_MISSING"),
              message: stryMutAct_9fa48("1176") ? `` : (stryCov_9fa48("1176"), `Missing validator for ${target.schemaFile}`),
              path: target.pathLabel
            }));
            continue;
          }
        }
        if (stryMutAct_9fa48("1179") ? false : stryMutAct_9fa48("1178") ? true : stryMutAct_9fa48("1177") ? validator(data) : (stryCov_9fa48("1177", "1178", "1179"), !validator(data))) {
          if (stryMutAct_9fa48("1180")) {
            {}
          } else {
            stryCov_9fa48("1180");
            issues.push(stryMutAct_9fa48("1182") ? {} : (stryCov_9fa48("1182"), {
              level: stryMutAct_9fa48("1183") ? "" : (stryCov_9fa48("1183"), "error"),
              code: stryMutAct_9fa48("1184") ? "" : (stryCov_9fa48("1184"), "SCHEMA_VALIDATION_FAILED"),
              message: formatAjvErrors(validator.errors),
              path: target.pathLabel
            }));
          }
        }
      }
    }
    const buildDirExists = await pathExists(buildLatestDir(cwd));
    if (stryMutAct_9fa48("1186") ? false : stryMutAct_9fa48("1185") ? true : (stryCov_9fa48("1185", "1186"), buildDirExists)) {
      if (stryMutAct_9fa48("1187")) {
        {}
      } else {
        stryCov_9fa48("1187");
        const hasOutputs = await pathExists(outputsPath(cwd));
        const hasProvenance = await pathExists(provenancePath(cwd));
        if (stryMutAct_9fa48("1190") ? hasOutputs === hasProvenance : stryMutAct_9fa48("1189") ? false : stryMutAct_9fa48("1188") ? true : (stryCov_9fa48("1188", "1189", "1190"), hasOutputs !== hasProvenance)) {
          if (stryMutAct_9fa48("1191")) {
            {}
          } else {
            stryCov_9fa48("1191");
            issues.push(stryMutAct_9fa48("1193") ? {} : (stryCov_9fa48("1193"), {
              level: stryMutAct_9fa48("1194") ? "" : (stryCov_9fa48("1194"), "error"),
              code: stryMutAct_9fa48("1195") ? "" : (stryCov_9fa48("1195"), "INCOMPLETE_BUILD_LAYER"),
              message: stryMutAct_9fa48("1196") ? "" : (stryCov_9fa48("1196"), "Build layer is incomplete: outputs.json and build-provenance.json must exist together"),
              path: stryMutAct_9fa48("1197") ? "" : (stryCov_9fa48("1197"), ".integrity/build/latest")
            }));
          }
        }
      }
    }
    return issues;
  }
}