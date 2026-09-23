/*
<MODULE_CONTRACT>
<purpose>Facilitates Git operations for tracking file integrity and repository metadata.</purpose>
<non-goals>
  <item>Do not handle raw Git content parsing outside defined methods.</item>
  <item>Do not manage Git configuration or transport orchestration.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Tidied by compass.changesummary.tidy; see git history for prior entries.</item>
</CHANGE_SUMMARY>
*/
// @ts-nocheck


/**
 * Git operations for integrity tracking.
 * Provides file history, change detection, and repository metadata queries.
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
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ChangedPaths, GitFileHistory } from "./types.ts";
const execFileAsync = promisify(execFile);
const DEFAULT_GIT_TIMEOUT_MS = 15_000;
interface RunGitOptions {
  timeoutMs?: number;
}
async function runGit(cwd: string, args: string[], options: RunGitOptions = {}): Promise<string> {
  if (stryMutAct_9fa48("71")) {
    {}
  } else {
    stryCov_9fa48("71");
    const {
      timeoutMs = DEFAULT_GIT_TIMEOUT_MS
    } = options;
    const {
      stdout
    } = await execFileAsync(stryMutAct_9fa48("72") ? "" : (stryCov_9fa48("72"), "git"), args, stryMutAct_9fa48("73") ? {} : (stryCov_9fa48("73"), {
      cwd,
      maxBuffer: stryMutAct_9fa48("74") ? 20 * 1024 / 1024 : (stryCov_9fa48("74"), (stryMutAct_9fa48("75") ? 20 / 1024 : (stryCov_9fa48("75"), 20 * 1024)) * 1024),
      timeout: timeoutMs
    }));
    return stryMutAct_9fa48("76") ? stdout.trimStart() : (stryCov_9fa48("76"), stdout.trimEnd());
  }
}
function uniqueSorted(values: Iterable<string>): string[] {
  if (stryMutAct_9fa48("77")) {
    {}
  } else {
    stryCov_9fa48("77");
    return stryMutAct_9fa48("78") ? Array.from(new Set(values)) : (stryCov_9fa48("78"), Array.from(new Set(values)).sort(stryMutAct_9fa48("79") ? () => undefined : (stryCov_9fa48("79"), (a, b) => a.localeCompare(b))));
  }
}
export async function getTrackedFiles(cwd: string): Promise<string[]> {
  if (stryMutAct_9fa48("80")) {
    {}
  } else {
    stryCov_9fa48("80");
    const output = await runGit(cwd, stryMutAct_9fa48("81") ? [] : (stryCov_9fa48("81"), [stryMutAct_9fa48("82") ? "" : (stryCov_9fa48("82"), "ls-files")]));
    return output ? stryMutAct_9fa48("83") ? output.split("\n") : (stryCov_9fa48("83"), output.split(stryMutAct_9fa48("84") ? "" : (stryCov_9fa48("84"), "\n")).filter(Boolean)) : stryMutAct_9fa48("85") ? ["Stryker was here"] : (stryCov_9fa48("85"), []);
  }
}
export async function getFileHistory(cwd: string, repoPath: string): Promise<GitFileHistory> {
  if (stryMutAct_9fa48("86")) {
    {}
  } else {
    stryCov_9fa48("86");
    try {
      if (stryMutAct_9fa48("87")) {
        {}
      } else {
        stryCov_9fa48("87");
        const latestOutput = await runGit(cwd, stryMutAct_9fa48("88") ? [] : (stryCov_9fa48("88"), [stryMutAct_9fa48("89") ? "" : (stryCov_9fa48("89"), "log"), stryMutAct_9fa48("90") ? "" : (stryCov_9fa48("90"), "--follow"), stryMutAct_9fa48("91") ? "" : (stryCov_9fa48("91"), "-1"), stryMutAct_9fa48("92") ? "" : (stryCov_9fa48("92"), "--format=%aI%x09%H"), stryMutAct_9fa48("93") ? "" : (stryCov_9fa48("93"), "--"), repoPath]), stryMutAct_9fa48("94") ? {} : (stryCov_9fa48("94"), {
          timeoutMs: 10_000
        })).catch(stryMutAct_9fa48("95") ? () => undefined : (stryCov_9fa48("95"), () => stryMutAct_9fa48("96") ? "Stryker was here!" : (stryCov_9fa48("96"), "")));
        const [updatedAtRaw, lastCommitShaRaw] = latestOutput.split(stryMutAct_9fa48("97") ? "" : (stryCov_9fa48("97"), "\t"));
        const createdOutput = await runGit(cwd, stryMutAct_9fa48("98") ? [] : (stryCov_9fa48("98"), [stryMutAct_9fa48("99") ? "" : (stryCov_9fa48("99"), "log"), stryMutAct_9fa48("100") ? "" : (stryCov_9fa48("100"), "--follow"), stryMutAct_9fa48("101") ? "" : (stryCov_9fa48("101"), "--diff-filter=A"), stryMutAct_9fa48("102") ? "" : (stryCov_9fa48("102"), "--format=%aI"), stryMutAct_9fa48("103") ? "" : (stryCov_9fa48("103"), "--"), repoPath]), stryMutAct_9fa48("104") ? {} : (stryCov_9fa48("104"), {
          timeoutMs: 5_000
        })).catch(stryMutAct_9fa48("105") ? () => undefined : (stryCov_9fa48("105"), () => stryMutAct_9fa48("106") ? "Stryker was here!" : (stryCov_9fa48("106"), "")));
        const createdLines = createdOutput ? stryMutAct_9fa48("107") ? createdOutput.split("\n") : (stryCov_9fa48("107"), createdOutput.split(stryMutAct_9fa48("108") ? "" : (stryCov_9fa48("108"), "\n")).filter(Boolean)) : stryMutAct_9fa48("109") ? ["Stryker was here"] : (stryCov_9fa48("109"), []);
        return stryMutAct_9fa48("110") ? {} : (stryCov_9fa48("110"), {
          createdAt: createdLines.length ? createdLines[stryMutAct_9fa48("111") ? createdLines.length + 1 : (stryCov_9fa48("111"), createdLines.length - 1)] : null,
          updatedAt: stryMutAct_9fa48("114") ? updatedAtRaw && null : stryMutAct_9fa48("113") ? false : stryMutAct_9fa48("112") ? true : (stryCov_9fa48("112", "113", "114"), updatedAtRaw || null),
          lastCommitSha: stryMutAct_9fa48("117") ? lastCommitShaRaw && null : stryMutAct_9fa48("116") ? false : stryMutAct_9fa48("115") ? true : (stryCov_9fa48("115", "116", "117"), lastCommitShaRaw || null)
        });
      }
    } catch {
      if (stryMutAct_9fa48("118")) {
        {}
      } else {
        stryCov_9fa48("118");
        return stryMutAct_9fa48("119") ? {} : (stryCov_9fa48("119"), {
          createdAt: null,
          updatedAt: null,
          lastCommitSha: null
        });
      }
    }
  }
}
export async function getFileRevisionFromHistory(cwd: string, repoPath: string): Promise<number> {
  if (stryMutAct_9fa48("120")) {
    {}
  } else {
    stryCov_9fa48("120");
    try {
      if (stryMutAct_9fa48("121")) {
        {}
      } else {
        stryCov_9fa48("121");
        const output = await runGit(cwd, stryMutAct_9fa48("122") ? [] : (stryCov_9fa48("122"), [stryMutAct_9fa48("123") ? "" : (stryCov_9fa48("123"), "log"), stryMutAct_9fa48("124") ? "" : (stryCov_9fa48("124"), "--follow"), stryMutAct_9fa48("125") ? "" : (stryCov_9fa48("125"), "--diff-filter=AMT"), stryMutAct_9fa48("126") ? "" : (stryCov_9fa48("126"), "--format=%H"), stryMutAct_9fa48("127") ? "" : (stryCov_9fa48("127"), "--"), repoPath]), stryMutAct_9fa48("128") ? {} : (stryCov_9fa48("128"), {
          timeoutMs: 15_000
        })).catch(stryMutAct_9fa48("129") ? () => undefined : (stryCov_9fa48("129"), () => stryMutAct_9fa48("130") ? "Stryker was here!" : (stryCov_9fa48("130"), "")));
        if (stryMutAct_9fa48("133") ? false : stryMutAct_9fa48("132") ? true : stryMutAct_9fa48("131") ? output : (stryCov_9fa48("131", "132", "133"), !output)) {
          if (stryMutAct_9fa48("134")) {
            {}
          } else {
            stryCov_9fa48("134");
            return 1;
          }
        }
        const revisions = stryMutAct_9fa48("135") ? output.split("\n").length : (stryCov_9fa48("135"), output.split(stryMutAct_9fa48("136") ? "" : (stryCov_9fa48("136"), "\n")).filter(Boolean).length);
        return stryMutAct_9fa48("137") ? Math.min(1, revisions) : (stryCov_9fa48("137"), Math.max(1, revisions));
      }
    } catch {
      if (stryMutAct_9fa48("138")) {
        {}
      } else {
        stryCov_9fa48("138");
        return 1;
      }
    }
  }
}
function parseNameStatus(output: string): ChangedPaths {
  if (stryMutAct_9fa48("139")) {
    {}
  } else {
    stryCov_9fa48("139");
    const added = new Set<string>();
    const modified = new Set<string>();
    const deleted = new Set<string>();
    const renamed: Array<{
      from: string;
      to: string;
    }> = stryMutAct_9fa48("140") ? ["Stryker was here"] : (stryCov_9fa48("140"), []);
    for (const line of stryMutAct_9fa48("141") ? output.split("\n") : (stryCov_9fa48("141"), output.split(stryMutAct_9fa48("142") ? "" : (stryCov_9fa48("142"), "\n")).filter(Boolean))) {
      if (stryMutAct_9fa48("143")) {
        {}
      } else {
        stryCov_9fa48("143");
        const parts = line.split(stryMutAct_9fa48("144") ? "" : (stryCov_9fa48("144"), "\t"));
        const status = stryMutAct_9fa48("145") ? parts[0] && "" : (stryCov_9fa48("145"), parts[0] ?? (stryMutAct_9fa48("146") ? "Stryker was here!" : (stryCov_9fa48("146"), "")));
        if (stryMutAct_9fa48("149") ? status.startsWith("R") && parts[1] || parts[2] : stryMutAct_9fa48("148") ? false : stryMutAct_9fa48("147") ? true : (stryCov_9fa48("147", "148", "149"), (stryMutAct_9fa48("151") ? status.startsWith("R") || parts[1] : stryMutAct_9fa48("150") ? true : (stryCov_9fa48("150", "151"), (stryMutAct_9fa48("152") ? status.endsWith("R") : (stryCov_9fa48("152"), status.startsWith(stryMutAct_9fa48("153") ? "" : (stryCov_9fa48("153"), "R")))) && parts[1])) && parts[2])) {
          if (stryMutAct_9fa48("154")) {
            {}
          } else {
            stryCov_9fa48("154");
            renamed.push(stryMutAct_9fa48("156") ? {} : (stryCov_9fa48("156"), {
              from: parts[1],
              to: parts[2]
            }));
            continue;
          }
        }
        if (stryMutAct_9fa48("159") ? status === "A" || parts[1] : stryMutAct_9fa48("158") ? false : stryMutAct_9fa48("157") ? true : (stryCov_9fa48("157", "158", "159"), (stryMutAct_9fa48("161") ? status !== "A" : stryMutAct_9fa48("160") ? true : (stryCov_9fa48("160", "161"), status === (stryMutAct_9fa48("162") ? "" : (stryCov_9fa48("162"), "A")))) && parts[1])) if (stryMutAct_9fa48("163")) {
          ;
        } else {
          stryCov_9fa48("163");
          added.add(parts[1]);
        }
        if (stryMutAct_9fa48("166") ? status === "M" || status === "T" || parts[1] : stryMutAct_9fa48("165") ? false : stryMutAct_9fa48("164") ? true : (stryCov_9fa48("164", "165", "166"), (stryMutAct_9fa48("168") ? status === "M" && status === "T" : stryMutAct_9fa48("167") ? true : (stryCov_9fa48("167", "168"), (stryMutAct_9fa48("170") ? status !== "M" : stryMutAct_9fa48("169") ? false : (stryCov_9fa48("169", "170"), status === (stryMutAct_9fa48("171") ? "" : (stryCov_9fa48("171"), "M")))) || (stryMutAct_9fa48("173") ? status !== "T" : stryMutAct_9fa48("172") ? false : (stryCov_9fa48("172", "173"), status === (stryMutAct_9fa48("174") ? "" : (stryCov_9fa48("174"), "T")))))) && parts[1])) if (stryMutAct_9fa48("175")) {
          ;
        } else {
          stryCov_9fa48("175");
          modified.add(parts[1]);
        }
        if (stryMutAct_9fa48("178") ? status === "D" || parts[1] : stryMutAct_9fa48("177") ? false : stryMutAct_9fa48("176") ? true : (stryCov_9fa48("176", "177", "178"), (stryMutAct_9fa48("180") ? status !== "D" : stryMutAct_9fa48("179") ? true : (stryCov_9fa48("179", "180"), status === (stryMutAct_9fa48("181") ? "" : (stryCov_9fa48("181"), "D")))) && parts[1])) if (stryMutAct_9fa48("182")) {
          ;
        } else {
          stryCov_9fa48("182");
          deleted.add(parts[1]);
        }
      }
    }
    return stryMutAct_9fa48("183") ? {} : (stryCov_9fa48("183"), {
      added: uniqueSorted(added),
      modified: uniqueSorted(modified),
      deleted: uniqueSorted(deleted),
      renamed
    });
  }
}
function parsePorcelainStatus(output: string): ChangedPaths {
  if (stryMutAct_9fa48("184")) {
    {}
  } else {
    stryCov_9fa48("184");
    const added = new Set<string>();
    const modified = new Set<string>();
    const deleted = new Set<string>();
    const renamed: Array<{
      from: string;
      to: string;
    }> = stryMutAct_9fa48("185") ? ["Stryker was here"] : (stryCov_9fa48("185"), []);
    for (const line of stryMutAct_9fa48("186") ? output.split("\n") : (stryCov_9fa48("186"), output.split(stryMutAct_9fa48("187") ? "" : (stryCov_9fa48("187"), "\n")).filter(Boolean))) {
      if (stryMutAct_9fa48("188")) {
        {}
      } else {
        stryCov_9fa48("188");
        if (stryMutAct_9fa48("191") ? line.endsWith("?? ") : stryMutAct_9fa48("190") ? false : stryMutAct_9fa48("189") ? true : (stryCov_9fa48("189", "190", "191"), line.startsWith(stryMutAct_9fa48("192") ? "" : (stryCov_9fa48("192"), "?? ")))) {
          if (stryMutAct_9fa48("193")) {
            {}
          } else {
            stryCov_9fa48("193");
            added.add(stryMutAct_9fa48("196") ? line.trim() : stryMutAct_9fa48("195") ? line.slice(3) : (stryCov_9fa48("195", "196"), line.slice(3).trim()));
            continue;
          }
        }
        const status = stryMutAct_9fa48("197") ? line : (stryCov_9fa48("197"), line.slice(0, 2));
        const body = stryMutAct_9fa48("199") ? line.trim() : stryMutAct_9fa48("198") ? line.slice(3) : (stryCov_9fa48("198", "199"), line.slice(3).trim());
        if (stryMutAct_9fa48("202") ? body.includes(" -> ") || status.includes("R") || status.includes("C") : stryMutAct_9fa48("201") ? false : stryMutAct_9fa48("200") ? true : (stryCov_9fa48("200", "201", "202"), body.includes(stryMutAct_9fa48("203") ? "" : (stryCov_9fa48("203"), " -> ")) && (stryMutAct_9fa48("205") ? status.includes("R") && status.includes("C") : stryMutAct_9fa48("204") ? true : (stryCov_9fa48("204", "205"), status.includes(stryMutAct_9fa48("206") ? "" : (stryCov_9fa48("206"), "R")) || status.includes(stryMutAct_9fa48("207") ? "" : (stryCov_9fa48("207"), "C")))))) {
          if (stryMutAct_9fa48("208")) {
            {}
          } else {
            stryCov_9fa48("208");
            const [from, to] = body.split(stryMutAct_9fa48("209") ? "" : (stryCov_9fa48("209"), " -> "));
            if (stryMutAct_9fa48("212") ? from || to : stryMutAct_9fa48("211") ? false : stryMutAct_9fa48("210") ? true : (stryCov_9fa48("210", "211", "212"), from && to)) {
              if (stryMutAct_9fa48("213")) {
                {}
              } else {
                stryCov_9fa48("213");
                renamed.push(stryMutAct_9fa48("215") ? {} : (stryCov_9fa48("215"), {
                  from,
                  to
                }));
              }
            }
            continue;
          }
        }
        if (stryMutAct_9fa48("217") ? false : stryMutAct_9fa48("216") ? true : (stryCov_9fa48("216", "217"), status.includes(stryMutAct_9fa48("218") ? "" : (stryCov_9fa48("218"), "D")))) {
          if (stryMutAct_9fa48("219")) {
            {}
          } else {
            stryCov_9fa48("219");
            if (stryMutAct_9fa48("220")) {
              ;
            } else {
              stryCov_9fa48("220");
              deleted.add(body);
            }
            continue;
          }
        }
        if (stryMutAct_9fa48("222") ? false : stryMutAct_9fa48("221") ? true : (stryCov_9fa48("221", "222"), status.includes(stryMutAct_9fa48("223") ? "" : (stryCov_9fa48("223"), "A")))) {
          if (stryMutAct_9fa48("224")) {
            {}
          } else {
            stryCov_9fa48("224");
            if (stryMutAct_9fa48("225")) {
              ;
            } else {
              stryCov_9fa48("225");
              added.add(body);
            }
            continue;
          }
        }
        if (stryMutAct_9fa48("228") ? status.includes("M") && status.includes("T") : stryMutAct_9fa48("227") ? false : stryMutAct_9fa48("226") ? true : (stryCov_9fa48("226", "227", "228"), status.includes(stryMutAct_9fa48("229") ? "" : (stryCov_9fa48("229"), "M")) || status.includes(stryMutAct_9fa48("230") ? "" : (stryCov_9fa48("230"), "T")))) {
          if (stryMutAct_9fa48("231")) {
            {}
          } else {
            stryCov_9fa48("231");
            if (stryMutAct_9fa48("232")) {
              ;
            } else {
              stryCov_9fa48("232");
              modified.add(body);
            }
          }
        }
      }
    }
    return stryMutAct_9fa48("233") ? {} : (stryCov_9fa48("233"), {
      added: uniqueSorted(added),
      modified: uniqueSorted(modified),
      deleted: uniqueSorted(deleted),
      renamed
    });
  }
}
function hasAnyChanges(changes: ChangedPaths): boolean {
  if (stryMutAct_9fa48("234")) {
    {}
  } else {
    stryCov_9fa48("234");
    return Boolean(stryMutAct_9fa48("237") ? (changes.added.length || changes.modified.length || changes.deleted.length) && changes.renamed.length : stryMutAct_9fa48("236") ? false : stryMutAct_9fa48("235") ? true : (stryCov_9fa48("235", "236", "237"), (stryMutAct_9fa48("239") ? (changes.added.length || changes.modified.length) && changes.deleted.length : stryMutAct_9fa48("238") ? false : (stryCov_9fa48("238", "239"), (stryMutAct_9fa48("241") ? changes.added.length && changes.modified.length : stryMutAct_9fa48("240") ? false : (stryCov_9fa48("240", "241"), changes.added.length || changes.modified.length)) || changes.deleted.length)) || changes.renamed.length));
  }
}
export async function getChangedPaths(cwd: string, baseRef?: string): Promise<ChangedPaths> {
  if (stryMutAct_9fa48("242")) {
    {}
  } else {
    stryCov_9fa48("242");
    try {
      if (stryMutAct_9fa48("243")) {
        {}
      } else {
        stryCov_9fa48("243");
        if (stryMutAct_9fa48("245") ? false : stryMutAct_9fa48("244") ? true : (stryCov_9fa48("244", "245"), baseRef)) {
          if (stryMutAct_9fa48("246")) {
            {}
          } else {
            stryCov_9fa48("246");
            const output = await runGit(cwd, stryMutAct_9fa48("247") ? [] : (stryCov_9fa48("247"), [stryMutAct_9fa48("248") ? "" : (stryCov_9fa48("248"), "diff"), stryMutAct_9fa48("249") ? "" : (stryCov_9fa48("249"), "--name-status"), stryMutAct_9fa48("250") ? "" : (stryCov_9fa48("250"), "--find-renames"), stryMutAct_9fa48("251") ? `` : (stryCov_9fa48("251"), `${baseRef}...HEAD`)]), stryMutAct_9fa48("252") ? {} : (stryCov_9fa48("252"), {
              timeoutMs: 10_000
            }));
            return parseNameStatus(output);
          }
        }
        const output = await runGit(cwd, stryMutAct_9fa48("253") ? [] : (stryCov_9fa48("253"), [stryMutAct_9fa48("254") ? "" : (stryCov_9fa48("254"), "status"), stryMutAct_9fa48("255") ? "" : (stryCov_9fa48("255"), "--porcelain=1"), stryMutAct_9fa48("256") ? "" : (stryCov_9fa48("256"), "--untracked-files=normal")]), stryMutAct_9fa48("257") ? {} : (stryCov_9fa48("257"), {
          timeoutMs: 10_000
        }));
        const workingTreeChanges = parsePorcelainStatus(output);
        if (stryMutAct_9fa48("259") ? false : stryMutAct_9fa48("258") ? true : (stryCov_9fa48("258", "259"), hasAnyChanges(workingTreeChanges))) {
          if (stryMutAct_9fa48("260")) {
            {}
          } else {
            stryCov_9fa48("260");
            return workingTreeChanges;
          }
        }
        const headDiff = await runGit(cwd, stryMutAct_9fa48("261") ? [] : (stryCov_9fa48("261"), [stryMutAct_9fa48("262") ? "" : (stryCov_9fa48("262"), "diff-tree"), stryMutAct_9fa48("263") ? "" : (stryCov_9fa48("263"), "--no-commit-id"), stryMutAct_9fa48("264") ? "" : (stryCov_9fa48("264"), "--name-status"), stryMutAct_9fa48("265") ? "" : (stryCov_9fa48("265"), "--find-renames"), stryMutAct_9fa48("266") ? "" : (stryCov_9fa48("266"), "-r"), stryMutAct_9fa48("267") ? "" : (stryCov_9fa48("267"), "HEAD")]), stryMutAct_9fa48("268") ? {} : (stryCov_9fa48("268"), {
          timeoutMs: 10_000
        })).catch(stryMutAct_9fa48("269") ? () => undefined : (stryCov_9fa48("269"), () => stryMutAct_9fa48("270") ? "Stryker was here!" : (stryCov_9fa48("270"), "")));
        if (stryMutAct_9fa48("273") ? false : stryMutAct_9fa48("272") ? true : stryMutAct_9fa48("271") ? headDiff : (stryCov_9fa48("271", "272", "273"), !headDiff)) {
          if (stryMutAct_9fa48("274")) {
            {}
          } else {
            stryCov_9fa48("274");
            return workingTreeChanges;
          }
        }
        return parseNameStatus(headDiff);
      }
    } catch {
      if (stryMutAct_9fa48("275")) {
        {}
      } else {
        stryCov_9fa48("275");
        return stryMutAct_9fa48("276") ? {} : (stryCov_9fa48("276"), {
          added: stryMutAct_9fa48("277") ? ["Stryker was here"] : (stryCov_9fa48("277"), []),
          modified: stryMutAct_9fa48("278") ? ["Stryker was here"] : (stryCov_9fa48("278"), []),
          deleted: stryMutAct_9fa48("279") ? ["Stryker was here"] : (stryCov_9fa48("279"), []),
          renamed: stryMutAct_9fa48("280") ? ["Stryker was here"] : (stryCov_9fa48("280"), [])
        });
      }
    }
  }
}
export async function getRepoUrl(cwd: string): Promise<string | null> {
  if (stryMutAct_9fa48("281")) {
    {}
  } else {
    stryCov_9fa48("281");
    try {
      if (stryMutAct_9fa48("282")) {
        {}
      } else {
        stryCov_9fa48("282");
        const output = await runGit(cwd, stryMutAct_9fa48("283") ? [] : (stryCov_9fa48("283"), [stryMutAct_9fa48("284") ? "" : (stryCov_9fa48("284"), "config"), stryMutAct_9fa48("285") ? "" : (stryCov_9fa48("285"), "--get"), stryMutAct_9fa48("286") ? "" : (stryCov_9fa48("286"), "remote.origin.url")]), stryMutAct_9fa48("287") ? {} : (stryCov_9fa48("287"), {
          timeoutMs: 5_000
        }));
        return stryMutAct_9fa48("290") ? output && null : stryMutAct_9fa48("289") ? false : stryMutAct_9fa48("288") ? true : (stryCov_9fa48("288", "289", "290"), output || null);
      }
    } catch {
      if (stryMutAct_9fa48("291")) {
        {}
      } else {
        stryCov_9fa48("291");
        return null;
      }
    }
  }
}
export async function getHeadSha(cwd: string): Promise<string | null> {
  if (stryMutAct_9fa48("292")) {
    {}
  } else {
    stryCov_9fa48("292");
    try {
      if (stryMutAct_9fa48("293")) {
        {}
      } else {
        stryCov_9fa48("293");
        const output = await runGit(cwd, stryMutAct_9fa48("294") ? [] : (stryCov_9fa48("294"), [stryMutAct_9fa48("295") ? "" : (stryCov_9fa48("295"), "rev-parse"), stryMutAct_9fa48("296") ? "" : (stryCov_9fa48("296"), "HEAD")]), stryMutAct_9fa48("297") ? {} : (stryCov_9fa48("297"), {
          timeoutMs: 5_000
        }));
        return stryMutAct_9fa48("300") ? output && null : stryMutAct_9fa48("299") ? false : stryMutAct_9fa48("298") ? true : (stryCov_9fa48("298", "299", "300"), output || null);
      }
    } catch {
      if (stryMutAct_9fa48("301")) {
        {}
      } else {
        stryCov_9fa48("301");
        return null;
      }
    }
  }
}