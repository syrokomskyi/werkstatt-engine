/*
<MODULE_CONTRACT>
<purpose>Facilitates integrity verification of managed files against their manifests and registry records.</purpose>
<non-goals>
  <item>Do not handle file content parsing or transformation.</item>
  <item>Do not manage the lifecycle of registry entities.</item>
  <item>Do not perform network operations for data retrieval.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Migrated sha256FileHex from deleted ./hash.ts to byteHashFile from @warpgogol/fingerprint directly.</item>
</CHANGE_SUMMARY>
*/
// @ts-nocheck


/**
 * Core integrity verification logic.
 * Validates file hashes against manifests and checks registry consistency.
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
import path from "node:path";
import { byteHashFile } from "@warpgogol/werkstatt-engine/fingerprint";
import { discoverManagedDirectories, discoverManagedFiles } from "./discover.ts";
import { pathExists } from "./fs.ts";
import { getManifestFileName, loadDirectoryManifest } from "./manifests.ts";
import { loadEntitiesById, loadPathsCurrent } from "./registry.ts";
import { validateIntegrityJsonSchemas } from "./schema-validation.ts";
import type { DirectoryManifest, ManifestFileRecord, RegistryEntity, VerifyIssue, VerifyReport, VerifyStats } from "./types.ts";
function isIsoDateTime(value: string): boolean {
  if (stryMutAct_9fa48("1445")) {
    {}
  } else {
    stryCov_9fa48("1445");
    if (stryMutAct_9fa48("1448") ? false : stryMutAct_9fa48("1447") ? true : stryMutAct_9fa48("1446") ? value : (stryCov_9fa48("1446", "1447", "1448"), !value)) return stryMutAct_9fa48("1449") ? true : (stryCov_9fa48("1449"), false);
    return stryMutAct_9fa48("1450") ? Number.isNaN(Date.parse(value)) : (stryCov_9fa48("1450"), !Number.isNaN(Date.parse(value)));
  }
}
function isHexSha256(value: string): boolean {
  if (stryMutAct_9fa48("1451")) {
    {}
  } else {
    stryCov_9fa48("1451");
    return (stryMutAct_9fa48("1455") ? /^sha256:[^0-9a-f]{64}$/i : stryMutAct_9fa48("1454") ? /^sha256:[0-9a-f]$/i : stryMutAct_9fa48("1453") ? /^sha256:[0-9a-f]{64}/i : stryMutAct_9fa48("1452") ? /sha256:[0-9a-f]{64}$/i : (stryCov_9fa48("1452", "1453", "1454", "1455"), /^sha256:[0-9a-f]{64}$/i)).test(value);
  }
}
function pushIssue(issues: VerifyIssue[], level: "error" | "warning", code: string, message: string, extras: Pick<VerifyIssue, "path" | "entityId"> = {}): void {
  if (stryMutAct_9fa48("1456")) {
    {}
  } else {
    stryCov_9fa48("1456");
    issues.push(stryMutAct_9fa48("1458") ? {} : (stryCov_9fa48("1458"), {
      level,
      code,
      message,
      ...extras
    }));
  }
}
function validateRecordShape(issues: VerifyIssue[], scope: "manifest" | "registry", record: ManifestFileRecord | RegistryEntity, filePath: string, entityId?: string): void {
  if (stryMutAct_9fa48("1459")) {
    {}
  } else {
    stryCov_9fa48("1459");
    if (stryMutAct_9fa48("1462") ? false : stryMutAct_9fa48("1461") ? true : stryMutAct_9fa48("1460") ? isIsoDateTime(record.createdAt) : (stryCov_9fa48("1460", "1461", "1462"), !isIsoDateTime(record.createdAt))) {
      if (stryMutAct_9fa48("1463")) {
        {}
      } else {
        stryCov_9fa48("1463");
        pushIssue(issues, stryMutAct_9fa48("1465") ? "" : (stryCov_9fa48("1465"), "error"), stryMutAct_9fa48("1466") ? "" : (stryCov_9fa48("1466"), "INVALID_CREATED_AT"), stryMutAct_9fa48("1467") ? `` : (stryCov_9fa48("1467"), `${scope} has invalid createdAt`), stryMutAct_9fa48("1468") ? {} : (stryCov_9fa48("1468"), {
          path: filePath,
          entityId
        }));
      }
    }
    if (stryMutAct_9fa48("1471") ? false : stryMutAct_9fa48("1470") ? true : stryMutAct_9fa48("1469") ? isIsoDateTime(record.updatedAt) : (stryCov_9fa48("1469", "1470", "1471"), !isIsoDateTime(record.updatedAt))) {
      if (stryMutAct_9fa48("1472")) {
        {}
      } else {
        stryCov_9fa48("1472");
        pushIssue(issues, stryMutAct_9fa48("1474") ? "" : (stryCov_9fa48("1474"), "error"), stryMutAct_9fa48("1475") ? "" : (stryCov_9fa48("1475"), "INVALID_UPDATED_AT"), stryMutAct_9fa48("1476") ? `` : (stryCov_9fa48("1476"), `${scope} has invalid updatedAt`), stryMutAct_9fa48("1477") ? {} : (stryCov_9fa48("1477"), {
          path: filePath,
          entityId
        }));
      }
    }
    if (stryMutAct_9fa48("1480") ? isIsoDateTime(record.createdAt) && isIsoDateTime(record.updatedAt) || record.createdAt > record.updatedAt : stryMutAct_9fa48("1479") ? false : stryMutAct_9fa48("1478") ? true : (stryCov_9fa48("1478", "1479", "1480"), (stryMutAct_9fa48("1482") ? isIsoDateTime(record.createdAt) || isIsoDateTime(record.updatedAt) : stryMutAct_9fa48("1481") ? true : (stryCov_9fa48("1481", "1482"), isIsoDateTime(record.createdAt) && isIsoDateTime(record.updatedAt))) && (stryMutAct_9fa48("1485") ? record.createdAt <= record.updatedAt : stryMutAct_9fa48("1484") ? record.createdAt >= record.updatedAt : stryMutAct_9fa48("1483") ? true : (stryCov_9fa48("1483", "1484", "1485"), record.createdAt > record.updatedAt)))) {
      if (stryMutAct_9fa48("1486")) {
        {}
      } else {
        stryCov_9fa48("1486");
        pushIssue(issues, stryMutAct_9fa48("1488") ? "" : (stryCov_9fa48("1488"), "error"), stryMutAct_9fa48("1489") ? "" : (stryCov_9fa48("1489"), "INVALID_TIMESTAMP_ORDER"), stryMutAct_9fa48("1490") ? `` : (stryCov_9fa48("1490"), `${scope} createdAt is greater than updatedAt`), stryMutAct_9fa48("1491") ? {} : (stryCov_9fa48("1491"), {
          path: filePath,
          entityId
        }));
      }
    }
    if (stryMutAct_9fa48("1494") ? !Number.isInteger(record.revision) && record.revision < 1 : stryMutAct_9fa48("1493") ? false : stryMutAct_9fa48("1492") ? true : (stryCov_9fa48("1492", "1493", "1494"), (stryMutAct_9fa48("1495") ? Number.isInteger(record.revision) : (stryCov_9fa48("1495"), !Number.isInteger(record.revision))) || (stryMutAct_9fa48("1498") ? record.revision >= 1 : stryMutAct_9fa48("1497") ? record.revision <= 1 : stryMutAct_9fa48("1496") ? false : (stryCov_9fa48("1496", "1497", "1498"), record.revision < 1)))) {
      if (stryMutAct_9fa48("1499")) {
        {}
      } else {
        stryCov_9fa48("1499");
        pushIssue(issues, stryMutAct_9fa48("1501") ? "" : (stryCov_9fa48("1501"), "error"), stryMutAct_9fa48("1502") ? "" : (stryCov_9fa48("1502"), "INVALID_REVISION"), stryMutAct_9fa48("1503") ? `` : (stryCov_9fa48("1503"), `${scope} revision must be an integer >= 1`), stryMutAct_9fa48("1504") ? {} : (stryCov_9fa48("1504"), {
          path: filePath,
          entityId
        }));
      }
    }
    if (stryMutAct_9fa48("1507") ? false : stryMutAct_9fa48("1506") ? true : stryMutAct_9fa48("1505") ? isHexSha256(record.contentHash) : (stryCov_9fa48("1505", "1506", "1507"), !isHexSha256(record.contentHash))) {
      if (stryMutAct_9fa48("1508")) {
        {}
      } else {
        stryCov_9fa48("1508");
        pushIssue(issues, stryMutAct_9fa48("1510") ? "" : (stryCov_9fa48("1510"), "error"), stryMutAct_9fa48("1511") ? "" : (stryCov_9fa48("1511"), "INVALID_CONTENT_HASH"), stryMutAct_9fa48("1512") ? `` : (stryCov_9fa48("1512"), `${scope} contentHash must match sha256:<64-hex>`), stryMutAct_9fa48("1513") ? {} : (stryCov_9fa48("1513"), {
          path: filePath,
          entityId
        }));
      }
    }
    if (stryMutAct_9fa48("1516") ? !record.gitSha && record.gitSha.length < 7 : stryMutAct_9fa48("1515") ? false : stryMutAct_9fa48("1514") ? true : (stryCov_9fa48("1514", "1515", "1516"), (stryMutAct_9fa48("1517") ? record.gitSha : (stryCov_9fa48("1517"), !record.gitSha)) || (stryMutAct_9fa48("1520") ? record.gitSha.length >= 7 : stryMutAct_9fa48("1519") ? record.gitSha.length <= 7 : stryMutAct_9fa48("1518") ? false : (stryCov_9fa48("1518", "1519", "1520"), record.gitSha.length < 7)))) {
      if (stryMutAct_9fa48("1521")) {
        {}
      } else {
        stryCov_9fa48("1521");
        pushIssue(issues, stryMutAct_9fa48("1523") ? "" : (stryCov_9fa48("1523"), "warning"), stryMutAct_9fa48("1524") ? "" : (stryCov_9fa48("1524"), "WEAK_GIT_SHA"), stryMutAct_9fa48("1525") ? `` : (stryCov_9fa48("1525"), `${scope} gitSha looks missing or too short`), stryMutAct_9fa48("1526") ? {} : (stryCov_9fa48("1526"), {
          path: filePath,
          entityId
        }));
      }
    }
  }
}
function compareManifestAndRegistry(issues: VerifyIssue[], repoPath: string, manifestRecord: ManifestFileRecord, registryRecord: RegistryEntity): void {
  if (stryMutAct_9fa48("1527")) {
    {}
  } else {
    stryCov_9fa48("1527");
    const entityId = manifestRecord.entityId;
    if (stryMutAct_9fa48("1530") ? registryRecord.status === "active" : stryMutAct_9fa48("1529") ? false : stryMutAct_9fa48("1528") ? true : (stryCov_9fa48("1528", "1529", "1530"), registryRecord.status !== (stryMutAct_9fa48("1531") ? "" : (stryCov_9fa48("1531"), "active")))) {
      if (stryMutAct_9fa48("1532")) {
        {}
      } else {
        stryCov_9fa48("1532");
        pushIssue(issues, stryMutAct_9fa48("1534") ? "" : (stryCov_9fa48("1534"), "error"), stryMutAct_9fa48("1535") ? "" : (stryCov_9fa48("1535"), "REGISTRY_ENTITY_NOT_ACTIVE"), stryMutAct_9fa48("1536") ? "" : (stryCov_9fa48("1536"), "Registry entity for managed file is not active"), stryMutAct_9fa48("1537") ? {} : (stryCov_9fa48("1537"), {
          path: repoPath,
          entityId
        }));
      }
    }
    if (stryMutAct_9fa48("1540") ? registryRecord.currentPath === repoPath : stryMutAct_9fa48("1539") ? false : stryMutAct_9fa48("1538") ? true : (stryCov_9fa48("1538", "1539", "1540"), registryRecord.currentPath !== repoPath)) {
      if (stryMutAct_9fa48("1541")) {
        {}
      } else {
        stryCov_9fa48("1541");
        pushIssue(issues, stryMutAct_9fa48("1543") ? "" : (stryCov_9fa48("1543"), "error"), stryMutAct_9fa48("1544") ? "" : (stryCov_9fa48("1544"), "CURRENT_PATH_MISMATCH"), stryMutAct_9fa48("1545") ? "" : (stryCov_9fa48("1545"), "Registry currentPath does not match managed file path"), stryMutAct_9fa48("1546") ? {} : (stryCov_9fa48("1546"), {
          path: repoPath,
          entityId
        }));
      }
    }
    if (stryMutAct_9fa48("1549") ? manifestRecord.status === "active" : stryMutAct_9fa48("1548") ? false : stryMutAct_9fa48("1547") ? true : (stryCov_9fa48("1547", "1548", "1549"), manifestRecord.status !== (stryMutAct_9fa48("1550") ? "" : (stryCov_9fa48("1550"), "active")))) {
      if (stryMutAct_9fa48("1551")) {
        {}
      } else {
        stryCov_9fa48("1551");
        pushIssue(issues, stryMutAct_9fa48("1553") ? "" : (stryCov_9fa48("1553"), "error"), stryMutAct_9fa48("1554") ? "" : (stryCov_9fa48("1554"), "MANIFEST_RECORD_NOT_ACTIVE"), stryMutAct_9fa48("1555") ? "" : (stryCov_9fa48("1555"), "Manifest record for managed file is not active"), stryMutAct_9fa48("1556") ? {} : (stryCov_9fa48("1556"), {
          path: repoPath,
          entityId
        }));
      }
    }
    if (stryMutAct_9fa48("1559") ? manifestRecord.createdAt === registryRecord.createdAt : stryMutAct_9fa48("1558") ? false : stryMutAct_9fa48("1557") ? true : (stryCov_9fa48("1557", "1558", "1559"), manifestRecord.createdAt !== registryRecord.createdAt)) {
      if (stryMutAct_9fa48("1560")) {
        {}
      } else {
        stryCov_9fa48("1560");
        pushIssue(issues, stryMutAct_9fa48("1562") ? "" : (stryCov_9fa48("1562"), "error"), stryMutAct_9fa48("1563") ? "" : (stryCov_9fa48("1563"), "CREATED_AT_MISMATCH"), stryMutAct_9fa48("1564") ? "" : (stryCov_9fa48("1564"), "Manifest and registry createdAt differ"), stryMutAct_9fa48("1565") ? {} : (stryCov_9fa48("1565"), {
          path: repoPath,
          entityId
        }));
      }
    }
    if (stryMutAct_9fa48("1568") ? manifestRecord.updatedAt === registryRecord.updatedAt : stryMutAct_9fa48("1567") ? false : stryMutAct_9fa48("1566") ? true : (stryCov_9fa48("1566", "1567", "1568"), manifestRecord.updatedAt !== registryRecord.updatedAt)) {
      if (stryMutAct_9fa48("1569")) {
        {}
      } else {
        stryCov_9fa48("1569");
        pushIssue(issues, stryMutAct_9fa48("1571") ? "" : (stryCov_9fa48("1571"), "error"), stryMutAct_9fa48("1572") ? "" : (stryCov_9fa48("1572"), "UPDATED_AT_MISMATCH"), stryMutAct_9fa48("1573") ? "" : (stryCov_9fa48("1573"), "Manifest and registry updatedAt differ"), stryMutAct_9fa48("1574") ? {} : (stryCov_9fa48("1574"), {
          path: repoPath,
          entityId
        }));
      }
    }
    if (stryMutAct_9fa48("1577") ? manifestRecord.revision === registryRecord.revision : stryMutAct_9fa48("1576") ? false : stryMutAct_9fa48("1575") ? true : (stryCov_9fa48("1575", "1576", "1577"), manifestRecord.revision !== registryRecord.revision)) {
      if (stryMutAct_9fa48("1578")) {
        {}
      } else {
        stryCov_9fa48("1578");
        pushIssue(issues, stryMutAct_9fa48("1580") ? "" : (stryCov_9fa48("1580"), "error"), stryMutAct_9fa48("1581") ? "" : (stryCov_9fa48("1581"), "REVISION_MISMATCH"), stryMutAct_9fa48("1582") ? "" : (stryCov_9fa48("1582"), "Manifest and registry revision differ"), stryMutAct_9fa48("1583") ? {} : (stryCov_9fa48("1583"), {
          path: repoPath,
          entityId
        }));
      }
    }
    if (stryMutAct_9fa48("1586") ? manifestRecord.contentHash === registryRecord.contentHash : stryMutAct_9fa48("1585") ? false : stryMutAct_9fa48("1584") ? true : (stryCov_9fa48("1584", "1585", "1586"), manifestRecord.contentHash !== registryRecord.contentHash)) {
      if (stryMutAct_9fa48("1587")) {
        {}
      } else {
        stryCov_9fa48("1587");
        pushIssue(issues, stryMutAct_9fa48("1589") ? "" : (stryCov_9fa48("1589"), "error"), stryMutAct_9fa48("1590") ? "" : (stryCov_9fa48("1590"), "CONTENT_HASH_MISMATCH_BETWEEN_INDEXES"), stryMutAct_9fa48("1591") ? "" : (stryCov_9fa48("1591"), "Manifest and registry contentHash differ"), stryMutAct_9fa48("1592") ? {} : (stryCov_9fa48("1592"), {
          path: repoPath,
          entityId
        }));
      }
    }
    if (stryMutAct_9fa48("1595") ? manifestRecord.gitSha === registryRecord.gitSha : stryMutAct_9fa48("1594") ? false : stryMutAct_9fa48("1593") ? true : (stryCov_9fa48("1593", "1594", "1595"), manifestRecord.gitSha !== registryRecord.gitSha)) {
      if (stryMutAct_9fa48("1596")) {
        {}
      } else {
        stryCov_9fa48("1596");
        pushIssue(issues, stryMutAct_9fa48("1598") ? "" : (stryCov_9fa48("1598"), "warning"), stryMutAct_9fa48("1599") ? "" : (stryCov_9fa48("1599"), "GIT_SHA_MISMATCH_BETWEEN_INDEXES"), stryMutAct_9fa48("1600") ? "" : (stryCov_9fa48("1600"), "Manifest and registry gitSha differ"), stryMutAct_9fa48("1601") ? {} : (stryCov_9fa48("1601"), {
          path: repoPath,
          entityId
        }));
      }
    }
  }
}
async function loadExpectedManifests(cwd: string, managedDirectories: string[], issues: VerifyIssue[]): Promise<Map<string, DirectoryManifest>> {
  if (stryMutAct_9fa48("1602")) {
    {}
  } else {
    stryCov_9fa48("1602");
    const manifests = new Map<string, DirectoryManifest>();
    for (const repoDir of managedDirectories) {
      if (stryMutAct_9fa48("1603")) {
        {}
      } else {
        stryCov_9fa48("1603");
        const manifest = await loadDirectoryManifest(cwd, repoDir);
        if (stryMutAct_9fa48("1606") ? false : stryMutAct_9fa48("1605") ? true : stryMutAct_9fa48("1604") ? manifest : (stryCov_9fa48("1604", "1605", "1606"), !manifest)) {
          if (stryMutAct_9fa48("1607")) {
            {}
          } else {
            stryCov_9fa48("1607");
            pushIssue(issues, stryMutAct_9fa48("1609") ? "" : (stryCov_9fa48("1609"), "error"), stryMutAct_9fa48("1610") ? "" : (stryCov_9fa48("1610"), "MISSING_DIRECTORY_MANIFEST"), stryMutAct_9fa48("1611") ? "" : (stryCov_9fa48("1611"), "Managed directory is missing versions.json"), stryMutAct_9fa48("1612") ? {} : (stryCov_9fa48("1612"), {
              path: repoDir
            }));
            continue;
          }
        }
        if (stryMutAct_9fa48("1613")) {
          ;
        } else {
          stryCov_9fa48("1613");
          manifests.set(repoDir, manifest);
        }
        if (stryMutAct_9fa48("1616") ? manifest.$schemaVersion === 1 : stryMutAct_9fa48("1615") ? false : stryMutAct_9fa48("1614") ? true : (stryCov_9fa48("1614", "1615", "1616"), manifest.$schemaVersion !== 1)) {
          if (stryMutAct_9fa48("1617")) {
            {}
          } else {
            stryCov_9fa48("1617");
            pushIssue(issues, stryMutAct_9fa48("1619") ? "" : (stryCov_9fa48("1619"), "error"), stryMutAct_9fa48("1620") ? "" : (stryCov_9fa48("1620"), "INVALID_MANIFEST_SCHEMA_VERSION"), stryMutAct_9fa48("1621") ? "" : (stryCov_9fa48("1621"), "Manifest has unsupported $schemaVersion"), stryMutAct_9fa48("1622") ? {} : (stryCov_9fa48("1622"), {
              path: repoDir
            }));
          }
        }
        if (stryMutAct_9fa48("1625") ? manifest.directory === repoDir : stryMutAct_9fa48("1624") ? false : stryMutAct_9fa48("1623") ? true : (stryCov_9fa48("1623", "1624", "1625"), manifest.directory !== repoDir)) {
          if (stryMutAct_9fa48("1626")) {
            {}
          } else {
            stryCov_9fa48("1626");
            pushIssue(issues, stryMutAct_9fa48("1628") ? "" : (stryCov_9fa48("1628"), "error"), stryMutAct_9fa48("1629") ? "" : (stryCov_9fa48("1629"), "MANIFEST_DIRECTORY_MISMATCH"), stryMutAct_9fa48("1630") ? "" : (stryCov_9fa48("1630"), "Manifest directory field does not match directory path"), stryMutAct_9fa48("1631") ? {} : (stryCov_9fa48("1631"), {
              path: repoDir
            }));
          }
        }
        if (stryMutAct_9fa48("1634") ? false : stryMutAct_9fa48("1633") ? true : stryMutAct_9fa48("1632") ? isIsoDateTime(manifest.generatedAt) : (stryCov_9fa48("1632", "1633", "1634"), !isIsoDateTime(manifest.generatedAt))) {
          if (stryMutAct_9fa48("1635")) {
            {}
          } else {
            stryCov_9fa48("1635");
            pushIssue(issues, stryMutAct_9fa48("1637") ? "" : (stryCov_9fa48("1637"), "error"), stryMutAct_9fa48("1638") ? "" : (stryCov_9fa48("1638"), "INVALID_MANIFEST_GENERATED_AT"), stryMutAct_9fa48("1639") ? "" : (stryCov_9fa48("1639"), "Manifest generatedAt is invalid"), stryMutAct_9fa48("1640") ? {} : (stryCov_9fa48("1640"), {
              path: repoDir
            }));
          }
        }
      }
    }
    return manifests;
  }
}
export async function verifyIntegrity(cwd: string): Promise<VerifyReport> {
  if (stryMutAct_9fa48("1641")) {
    {}
  } else {
    stryCov_9fa48("1641");
    const issues: VerifyIssue[] = stryMutAct_9fa48("1642") ? ["Stryker was here"] : (stryCov_9fa48("1642"), []);
    if (stryMutAct_9fa48("1643")) {
      ;
    } else {
      stryCov_9fa48("1643");
      issues.push(...(await validateIntegrityJsonSchemas(cwd)));
    }
    const managedFiles = await discoverManagedFiles(cwd);
    const managedDirectories = await discoverManagedDirectories(cwd);
    const entities = await loadEntitiesById(cwd);
    const paths = await loadPathsCurrent(cwd);
    const manifests = await loadExpectedManifests(cwd, managedDirectories, issues);
    const activeEntities = stryMutAct_9fa48("1644") ? Object.entries(entities) : (stryCov_9fa48("1644"), Object.entries(entities).filter(stryMutAct_9fa48("1645") ? () => undefined : (stryCov_9fa48("1645"), ([, entity]) => stryMutAct_9fa48("1648") ? entity.status !== "active" : stryMutAct_9fa48("1647") ? false : stryMutAct_9fa48("1646") ? true : (stryCov_9fa48("1646", "1647", "1648"), entity.status === (stryMutAct_9fa48("1649") ? "" : (stryCov_9fa48("1649"), "active"))))));
    const duplicateEntityIds = new Set<string>();
    const seenEntityIds = new Set<string>();
    for (const [repoPath, entityId] of Object.entries(paths)) {
      if (stryMutAct_9fa48("1650")) {
        {}
      } else {
        stryCov_9fa48("1650");
        if (stryMutAct_9fa48("1653") ? false : stryMutAct_9fa48("1652") ? true : stryMutAct_9fa48("1651") ? managedFiles.includes(repoPath) : (stryCov_9fa48("1651", "1652", "1653"), !managedFiles.includes(repoPath))) {
          if (stryMutAct_9fa48("1654")) {
            {}
          } else {
            stryCov_9fa48("1654");
            const exists = await pathExists(path.join(cwd, repoPath));
            pushIssue(issues, exists ? stryMutAct_9fa48("1656") ? "" : (stryCov_9fa48("1656"), "warning") : stryMutAct_9fa48("1657") ? "" : (stryCov_9fa48("1657"), "error"), stryMutAct_9fa48("1658") ? "" : (stryCov_9fa48("1658"), "UNEXPECTED_PATH_BINDING"), exists ? stryMutAct_9fa48("1659") ? "" : (stryCov_9fa48("1659"), "paths.current contains a binding for a file outside managed scope") : stryMutAct_9fa48("1660") ? "" : (stryCov_9fa48("1660"), "paths.current contains a binding for a missing file"), stryMutAct_9fa48("1661") ? {} : (stryCov_9fa48("1661"), {
              path: repoPath,
              entityId
            }));
          }
        }
        if (stryMutAct_9fa48("1663") ? false : stryMutAct_9fa48("1662") ? true : (stryCov_9fa48("1662", "1663"), seenEntityIds.has(entityId))) {
          if (stryMutAct_9fa48("1664")) {
            {}
          } else {
            stryCov_9fa48("1664");
            if (stryMutAct_9fa48("1665")) {
              ;
            } else {
              stryCov_9fa48("1665");
              duplicateEntityIds.add(entityId);
            }
          }
        }
        if (stryMutAct_9fa48("1666")) {
          ;
        } else {
          stryCov_9fa48("1666");
          seenEntityIds.add(entityId);
        }
      }
    }
    for (const entityId of duplicateEntityIds) {
      if (stryMutAct_9fa48("1667")) {
        {}
      } else {
        stryCov_9fa48("1667");
        pushIssue(issues, stryMutAct_9fa48("1669") ? "" : (stryCov_9fa48("1669"), "error"), stryMutAct_9fa48("1670") ? "" : (stryCov_9fa48("1670"), "DUPLICATE_ACTIVE_ENTITY_ID"), stryMutAct_9fa48("1671") ? "" : (stryCov_9fa48("1671"), "The same entityId is bound to multiple current paths"), stryMutAct_9fa48("1672") ? {} : (stryCov_9fa48("1672"), {
          entityId
        }));
      }
    }
    for (const file of managedFiles) {
      if (stryMutAct_9fa48("1673")) {
        {}
      } else {
        stryCov_9fa48("1673");
        const entityId = paths[file];
        const absPath = path.join(cwd, file);
        const repoDir = path.posix.dirname(file);
        const fileName = getManifestFileName(file);
        const manifest = manifests.get(repoDir);
        if (stryMutAct_9fa48("1676") ? false : stryMutAct_9fa48("1675") ? true : stryMutAct_9fa48("1674") ? entityId : (stryCov_9fa48("1674", "1675", "1676"), !entityId)) {
          if (stryMutAct_9fa48("1677")) {
            {}
          } else {
            stryCov_9fa48("1677");
            pushIssue(issues, stryMutAct_9fa48("1679") ? "" : (stryCov_9fa48("1679"), "error"), stryMutAct_9fa48("1680") ? "" : (stryCov_9fa48("1680"), "MISSING_PATH_BINDING"), stryMutAct_9fa48("1681") ? "" : (stryCov_9fa48("1681"), "Managed file is missing from paths.current index"), stryMutAct_9fa48("1682") ? {} : (stryCov_9fa48("1682"), {
              path: file
            }));
            continue;
          }
        }
        const entity = entities[entityId];
        if (stryMutAct_9fa48("1685") ? false : stryMutAct_9fa48("1684") ? true : stryMutAct_9fa48("1683") ? entity : (stryCov_9fa48("1683", "1684", "1685"), !entity)) {
          if (stryMutAct_9fa48("1686")) {
            {}
          } else {
            stryCov_9fa48("1686");
            pushIssue(issues, stryMutAct_9fa48("1688") ? "" : (stryCov_9fa48("1688"), "error"), stryMutAct_9fa48("1689") ? "" : (stryCov_9fa48("1689"), "MISSING_REGISTRY_ENTITY"), stryMutAct_9fa48("1690") ? "" : (stryCov_9fa48("1690"), "Path binding points to absent registry entity"), stryMutAct_9fa48("1691") ? {} : (stryCov_9fa48("1691"), {
              path: file,
              entityId
            }));
            continue;
          }
        }
        validateRecordShape(issues, stryMutAct_9fa48("1693") ? "" : (stryCov_9fa48("1693"), "registry"), entity, file, entityId);
        if (stryMutAct_9fa48("1696") ? false : stryMutAct_9fa48("1695") ? true : stryMutAct_9fa48("1694") ? manifest : (stryCov_9fa48("1694", "1695", "1696"), !manifest)) continue;
        const manifestRecord = manifest.files[fileName];
        if (stryMutAct_9fa48("1699") ? false : stryMutAct_9fa48("1698") ? true : stryMutAct_9fa48("1697") ? manifestRecord : (stryCov_9fa48("1697", "1698", "1699"), !manifestRecord)) {
          if (stryMutAct_9fa48("1700")) {
            {}
          } else {
            stryCov_9fa48("1700");
            pushIssue(issues, stryMutAct_9fa48("1702") ? "" : (stryCov_9fa48("1702"), "error"), stryMutAct_9fa48("1703") ? "" : (stryCov_9fa48("1703"), "MISSING_MANIFEST_RECORD"), stryMutAct_9fa48("1704") ? "" : (stryCov_9fa48("1704"), "Managed file is missing from its directory manifest"), stryMutAct_9fa48("1705") ? {} : (stryCov_9fa48("1705"), {
              path: file,
              entityId
            }));
            continue;
          }
        }
        validateRecordShape(issues, stryMutAct_9fa48("1707") ? "" : (stryCov_9fa48("1707"), "manifest"), manifestRecord, file, entityId);
        if (stryMutAct_9fa48("1710") ? manifestRecord.entityId === entityId : stryMutAct_9fa48("1709") ? false : stryMutAct_9fa48("1708") ? true : (stryCov_9fa48("1708", "1709", "1710"), manifestRecord.entityId !== entityId)) {
          if (stryMutAct_9fa48("1711")) {
            {}
          } else {
            stryCov_9fa48("1711");
            pushIssue(issues, stryMutAct_9fa48("1713") ? "" : (stryCov_9fa48("1713"), "error"), stryMutAct_9fa48("1714") ? "" : (stryCov_9fa48("1714"), "ENTITY_ID_MISMATCH"), stryMutAct_9fa48("1715") ? "" : (stryCov_9fa48("1715"), "Manifest record entityId differs from paths.current binding"), stryMutAct_9fa48("1716") ? {} : (stryCov_9fa48("1716"), {
              path: file,
              entityId
            }));
          }
        }
        if (stryMutAct_9fa48("1717")) {
          ;
        } else {
          stryCov_9fa48("1717");
          compareManifestAndRegistry(issues, file, manifestRecord, entity);
        }
        const actualHash = await byteHashFile(absPath);
        if (stryMutAct_9fa48("1720") ? actualHash === entity.contentHash : stryMutAct_9fa48("1719") ? false : stryMutAct_9fa48("1718") ? true : (stryCov_9fa48("1718", "1719", "1720"), actualHash !== entity.contentHash)) {
          if (stryMutAct_9fa48("1721")) {
            {}
          } else {
            stryCov_9fa48("1721");
            pushIssue(issues, stryMutAct_9fa48("1723") ? "" : (stryCov_9fa48("1723"), "error"), stryMutAct_9fa48("1724") ? "" : (stryCov_9fa48("1724"), "HASH_MISMATCH_REGISTRY"), stryMutAct_9fa48("1725") ? "" : (stryCov_9fa48("1725"), "Actual file hash differs from registry hash"), stryMutAct_9fa48("1726") ? {} : (stryCov_9fa48("1726"), {
              path: file,
              entityId
            }));
          }
        }
        if (stryMutAct_9fa48("1729") ? actualHash === manifestRecord.contentHash : stryMutAct_9fa48("1728") ? false : stryMutAct_9fa48("1727") ? true : (stryCov_9fa48("1727", "1728", "1729"), actualHash !== manifestRecord.contentHash)) {
          if (stryMutAct_9fa48("1730")) {
            {}
          } else {
            stryCov_9fa48("1730");
            pushIssue(issues, stryMutAct_9fa48("1732") ? "" : (stryCov_9fa48("1732"), "error"), stryMutAct_9fa48("1733") ? "" : (stryCov_9fa48("1733"), "HASH_MISMATCH_MANIFEST"), stryMutAct_9fa48("1734") ? "" : (stryCov_9fa48("1734"), "Actual file hash differs from manifest hash"), stryMutAct_9fa48("1735") ? {} : (stryCov_9fa48("1735"), {
              path: file,
              entityId
            }));
          }
        }
      }
    }
    for (const [repoDir, manifest] of manifests) {
      if (stryMutAct_9fa48("1736")) {
        {}
      } else {
        stryCov_9fa48("1736");
        for (const [fileName, manifestRecord] of Object.entries(manifest.files)) {
          if (stryMutAct_9fa48("1737")) {
            {}
          } else {
            stryCov_9fa48("1737");
            const repoPath = path.posix.join(repoDir, fileName);
            const entity = entities[manifestRecord.entityId];
            const hasFile = managedFiles.includes(repoPath);
            validateRecordShape(issues, stryMutAct_9fa48("1739") ? "" : (stryCov_9fa48("1739"), "manifest"), manifestRecord, repoPath, manifestRecord.entityId);
            if (stryMutAct_9fa48("1742") ? false : stryMutAct_9fa48("1741") ? true : stryMutAct_9fa48("1740") ? hasFile : (stryCov_9fa48("1740", "1741", "1742"), !hasFile)) {
              if (stryMutAct_9fa48("1743")) {
                {}
              } else {
                stryCov_9fa48("1743");
                const exists = await pathExists(path.join(cwd, repoPath));
                pushIssue(issues, exists ? stryMutAct_9fa48("1745") ? "" : (stryCov_9fa48("1745"), "warning") : stryMutAct_9fa48("1746") ? "" : (stryCov_9fa48("1746"), "error"), stryMutAct_9fa48("1747") ? "" : (stryCov_9fa48("1747"), "STALE_MANIFEST_RECORD"), exists ? stryMutAct_9fa48("1748") ? "" : (stryCov_9fa48("1748"), "Manifest record points to an existing file outside managed scope") : stryMutAct_9fa48("1749") ? "" : (stryCov_9fa48("1749"), "Manifest record points to a missing file"), stryMutAct_9fa48("1750") ? {} : (stryCov_9fa48("1750"), {
                  path: repoPath,
                  entityId: manifestRecord.entityId
                }));
              }
            }
            if (stryMutAct_9fa48("1753") ? false : stryMutAct_9fa48("1752") ? true : stryMutAct_9fa48("1751") ? entity : (stryCov_9fa48("1751", "1752", "1753"), !entity)) {
              if (stryMutAct_9fa48("1754")) {
                {}
              } else {
                stryCov_9fa48("1754");
                pushIssue(issues, stryMutAct_9fa48("1756") ? "" : (stryCov_9fa48("1756"), "error"), stryMutAct_9fa48("1757") ? "" : (stryCov_9fa48("1757"), "MANIFEST_ENTITY_MISSING_IN_REGISTRY"), stryMutAct_9fa48("1758") ? "" : (stryCov_9fa48("1758"), "Manifest record points to missing registry entity"), stryMutAct_9fa48("1759") ? {} : (stryCov_9fa48("1759"), {
                  path: repoPath,
                  entityId: manifestRecord.entityId
                }));
              }
            }
          }
        }
      }
    }
    for (const [entityId, entity] of activeEntities) {
      if (stryMutAct_9fa48("1760")) {
        {}
      } else {
        stryCov_9fa48("1760");
        validateRecordShape(issues, stryMutAct_9fa48("1762") ? "" : (stryCov_9fa48("1762"), "registry"), entity, entity.currentPath, entityId);
        if (stryMutAct_9fa48("1765") ? false : stryMutAct_9fa48("1764") ? true : stryMutAct_9fa48("1763") ? managedFiles.includes(entity.currentPath) : (stryCov_9fa48("1763", "1764", "1765"), !managedFiles.includes(entity.currentPath))) {
          if (stryMutAct_9fa48("1766")) {
            {}
          } else {
            stryCov_9fa48("1766");
            const exists = await pathExists(path.join(cwd, entity.currentPath));
            pushIssue(issues, exists ? stryMutAct_9fa48("1768") ? "" : (stryCov_9fa48("1768"), "warning") : stryMutAct_9fa48("1769") ? "" : (stryCov_9fa48("1769"), "error"), stryMutAct_9fa48("1770") ? "" : (stryCov_9fa48("1770"), "ACTIVE_ENTITY_OUTSIDE_SCOPE"), exists ? stryMutAct_9fa48("1771") ? "" : (stryCov_9fa48("1771"), "Active registry entity points to a file outside managed scope") : stryMutAct_9fa48("1772") ? "" : (stryCov_9fa48("1772"), "Active registry entity points to a missing file"), stryMutAct_9fa48("1773") ? {} : (stryCov_9fa48("1773"), {
              path: entity.currentPath,
              entityId
            }));
          }
        }
        if (stryMutAct_9fa48("1776") ? paths[entity.currentPath] === entityId : stryMutAct_9fa48("1775") ? false : stryMutAct_9fa48("1774") ? true : (stryCov_9fa48("1774", "1775", "1776"), paths[entity.currentPath] !== entityId)) {
          if (stryMutAct_9fa48("1777")) {
            {}
          } else {
            stryCov_9fa48("1777");
            pushIssue(issues, stryMutAct_9fa48("1779") ? "" : (stryCov_9fa48("1779"), "error"), stryMutAct_9fa48("1780") ? "" : (stryCov_9fa48("1780"), "REGISTRY_PATH_NOT_BOUND"), stryMutAct_9fa48("1781") ? "" : (stryCov_9fa48("1781"), "Active registry entity currentPath is not correctly bound in paths.current"), stryMutAct_9fa48("1782") ? {} : (stryCov_9fa48("1782"), {
              path: entity.currentPath,
              entityId
            }));
          }
        }
      }
    }
    const collator = new Intl.Collator(stryMutAct_9fa48("1783") ? "" : (stryCov_9fa48("1783"), "en"));
    stryMutAct_9fa48("1785") ? issues : (stryCov_9fa48("1785"), issues.sort((a, b) => {
      if (stryMutAct_9fa48("1786")) {
        {}
      } else {
        stryCov_9fa48("1786");
        if (stryMutAct_9fa48("1789") ? a.level === b.level : stryMutAct_9fa48("1788") ? false : stryMutAct_9fa48("1787") ? true : (stryCov_9fa48("1787", "1788", "1789"), a.level !== b.level)) return (stryMutAct_9fa48("1792") ? a.level !== "error" : stryMutAct_9fa48("1791") ? false : stryMutAct_9fa48("1790") ? true : (stryCov_9fa48("1790", "1791", "1792"), a.level === (stryMutAct_9fa48("1793") ? "" : (stryCov_9fa48("1793"), "error")))) ? stryMutAct_9fa48("1794") ? +1 : (stryCov_9fa48("1794"), -1) : 1;
        if (stryMutAct_9fa48("1797") ? (a.code ?? "") === (b.code ?? "") : stryMutAct_9fa48("1796") ? false : stryMutAct_9fa48("1795") ? true : (stryCov_9fa48("1795", "1796", "1797"), (stryMutAct_9fa48("1798") ? a.code && "" : (stryCov_9fa48("1798"), a.code ?? (stryMutAct_9fa48("1799") ? "Stryker was here!" : (stryCov_9fa48("1799"), "")))) !== (stryMutAct_9fa48("1800") ? b.code && "" : (stryCov_9fa48("1800"), b.code ?? (stryMutAct_9fa48("1801") ? "Stryker was here!" : (stryCov_9fa48("1801"), "")))))) return collator.compare(stryMutAct_9fa48("1802") ? a.code && "" : (stryCov_9fa48("1802"), a.code ?? (stryMutAct_9fa48("1803") ? "Stryker was here!" : (stryCov_9fa48("1803"), ""))), stryMutAct_9fa48("1804") ? b.code && "" : (stryCov_9fa48("1804"), b.code ?? (stryMutAct_9fa48("1805") ? "Stryker was here!" : (stryCov_9fa48("1805"), ""))));
        if (stryMutAct_9fa48("1808") ? (a.path ?? "") === (b.path ?? "") : stryMutAct_9fa48("1807") ? false : stryMutAct_9fa48("1806") ? true : (stryCov_9fa48("1806", "1807", "1808"), (stryMutAct_9fa48("1809") ? a.path && "" : (stryCov_9fa48("1809"), a.path ?? (stryMutAct_9fa48("1810") ? "Stryker was here!" : (stryCov_9fa48("1810"), "")))) !== (stryMutAct_9fa48("1811") ? b.path && "" : (stryCov_9fa48("1811"), b.path ?? (stryMutAct_9fa48("1812") ? "Stryker was here!" : (stryCov_9fa48("1812"), "")))))) return collator.compare(stryMutAct_9fa48("1813") ? a.path && "" : (stryCov_9fa48("1813"), a.path ?? (stryMutAct_9fa48("1814") ? "Stryker was here!" : (stryCov_9fa48("1814"), ""))), stryMutAct_9fa48("1815") ? b.path && "" : (stryCov_9fa48("1815"), b.path ?? (stryMutAct_9fa48("1816") ? "Stryker was here!" : (stryCov_9fa48("1816"), ""))));
        return collator.compare(stryMutAct_9fa48("1817") ? a.entityId && "" : (stryCov_9fa48("1817"), a.entityId ?? (stryMutAct_9fa48("1818") ? "Stryker was here!" : (stryCov_9fa48("1818"), ""))), stryMutAct_9fa48("1819") ? b.entityId && "" : (stryCov_9fa48("1819"), b.entityId ?? (stryMutAct_9fa48("1820") ? "Stryker was here!" : (stryCov_9fa48("1820"), ""))));
      }
    }));
    const stats: VerifyStats = stryMutAct_9fa48("1821") ? {} : (stryCov_9fa48("1821"), {
      managedFiles: managedFiles.length,
      managedDirectories: managedDirectories.length,
      manifestsLoaded: manifests.size,
      activeEntities: activeEntities.length,
      activePathBindings: Object.keys(paths).length,
      errors: stryMutAct_9fa48("1822") ? issues.length : (stryCov_9fa48("1822"), issues.filter(stryMutAct_9fa48("1823") ? () => undefined : (stryCov_9fa48("1823"), issue => stryMutAct_9fa48("1826") ? issue.level !== "error" : stryMutAct_9fa48("1825") ? false : stryMutAct_9fa48("1824") ? true : (stryCov_9fa48("1824", "1825", "1826"), issue.level === (stryMutAct_9fa48("1827") ? "" : (stryCov_9fa48("1827"), "error"))))).length),
      warnings: stryMutAct_9fa48("1828") ? issues.length : (stryCov_9fa48("1828"), issues.filter(stryMutAct_9fa48("1829") ? () => undefined : (stryCov_9fa48("1829"), issue => stryMutAct_9fa48("1832") ? issue.level !== "warning" : stryMutAct_9fa48("1831") ? false : stryMutAct_9fa48("1830") ? true : (stryCov_9fa48("1830", "1831", "1832"), issue.level === (stryMutAct_9fa48("1833") ? "" : (stryCov_9fa48("1833"), "warning"))))).length)
    });
    return stryMutAct_9fa48("1834") ? {} : (stryCov_9fa48("1834"), {
      ok: stryMutAct_9fa48("1837") ? stats.errors !== 0 : stryMutAct_9fa48("1836") ? false : stryMutAct_9fa48("1835") ? true : (stryCov_9fa48("1835", "1836", "1837"), stats.errors === 0),
      issues,
      stats
    });
  }
}