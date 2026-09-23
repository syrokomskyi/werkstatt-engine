/*
<MODULE_CONTRACT>
<purpose>Facilitates integrity policy management and schema file generation for path validation within the system.</purpose>
<non-goals>
  <item>Do not perform raw content parsing or validation beyond JSON schema definitions.</item>
  <item>Do not manage the orchestration of transport or configuration for policy files.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Refined Compass scaffolding to improve clarity and navigation for future modifications.</item>
</CHANGE_SUMMARY>
*/
// @ts-nocheck


/**
 * Integrity policy management and path matching.
 * Defines include/exclude patterns and JSON schemas for validation.
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
import { pathExists } from "./fs.ts";
import { readJsonFile, writeJsonFile } from "./json.ts";
import { policyPath, schemaDir } from "./paths.ts";
import type { IntegrityPolicy } from "./types.ts";
function escapeRegex(input: string): string {
  if (stryMutAct_9fa48("636")) {
    {}
  } else {
    stryCov_9fa48("636");
    return input.replace(stryMutAct_9fa48("637") ? /[^|\\{}()[\]^$+?.]/g : (stryCov_9fa48("637"), /[|\\{}()[\]^$+?.]/g), stryMutAct_9fa48("638") ? "" : (stryCov_9fa48("638"), "\\$&"));
  }
}
function globToRegExp(pattern: string): RegExp {
  if (stryMutAct_9fa48("639")) {
    {}
  } else {
    stryCov_9fa48("639");
    const normalized = pattern.replace(/\\/g, stryMutAct_9fa48("640") ? "" : (stryCov_9fa48("640"), "/"));
    const placeholder = stryMutAct_9fa48("641") ? "" : (stryCov_9fa48("641"), "__DOUBLE_STAR__");
    const source = escapeRegex(normalized).replace(/\*\*/g, placeholder).replace(/\*/g, stryMutAct_9fa48("642") ? "" : (stryCov_9fa48("642"), "[^/]*")).replace(new RegExp(placeholder, stryMutAct_9fa48("643") ? "" : (stryCov_9fa48("643"), "g")), stryMutAct_9fa48("644") ? "" : (stryCov_9fa48("644"), ".*"));
    return new RegExp(stryMutAct_9fa48("645") ? `` : (stryCov_9fa48("645"), `^${source}$`));
  }
}
const BOOTSTRAP_POLICY = (stryMutAct_9fa48("646") ? {} : (stryCov_9fa48("646"), {
  $schemaVersion: 1,
  hashAlgorithm: stryMutAct_9fa48("647") ? "" : (stryCov_9fa48("647"), "sha256"),
  include: stryMutAct_9fa48("648") ? [] : (stryCov_9fa48("648"), [stryMutAct_9fa48("649") ? "" : (stryCov_9fa48("649"), "src/**"), stryMutAct_9fa48("650") ? "" : (stryCov_9fa48("650"), "public/**"), stryMutAct_9fa48("651") ? "" : (stryCov_9fa48("651"), "*.json"), stryMutAct_9fa48("652") ? "" : (stryCov_9fa48("652"), "**/*.json"), stryMutAct_9fa48("653") ? "" : (stryCov_9fa48("653"), "*.ts"), stryMutAct_9fa48("654") ? "" : (stryCov_9fa48("654"), "**/*.ts"), stryMutAct_9fa48("655") ? "" : (stryCov_9fa48("655"), "*.js"), stryMutAct_9fa48("656") ? "" : (stryCov_9fa48("656"), "**/*.js"), stryMutAct_9fa48("657") ? "" : (stryCov_9fa48("657"), "*.astro"), stryMutAct_9fa48("658") ? "" : (stryCov_9fa48("658"), "**/*.astro"), stryMutAct_9fa48("659") ? "" : (stryCov_9fa48("659"), "*.md"), stryMutAct_9fa48("660") ? "" : (stryCov_9fa48("660"), "**/*.md"), stryMutAct_9fa48("661") ? "" : (stryCov_9fa48("661"), "*.mdx"), stryMutAct_9fa48("662") ? "" : (stryCov_9fa48("662"), "**/*.mdx")]),
  exclude: stryMutAct_9fa48("663") ? [] : (stryCov_9fa48("663"), [stryMutAct_9fa48("664") ? "" : (stryCov_9fa48("664"), ".git/**"), stryMutAct_9fa48("665") ? "" : (stryCov_9fa48("665"), "node_modules/**"), stryMutAct_9fa48("666") ? "" : (stryCov_9fa48("666"), ".astro/**"), stryMutAct_9fa48("667") ? "" : (stryCov_9fa48("667"), "dist/**"), stryMutAct_9fa48("668") ? "" : (stryCov_9fa48("668"), ".idea/**"), stryMutAct_9fa48("669") ? "" : (stryCov_9fa48("669"), ".vscode/**"), stryMutAct_9fa48("670") ? "" : (stryCov_9fa48("670"), ".integrity/**"), stryMutAct_9fa48("671") ? "" : (stryCov_9fa48("671"), "spec/**"), stryMutAct_9fa48("672") ? "" : (stryCov_9fa48("672"), "todo/**")]),
  moveDetection: stryMutAct_9fa48("673") ? {} : (stryCov_9fa48("673"), {
    enableHeuristics: stryMutAct_9fa48("674") ? true : (stryCov_9fa48("674"), false),
    similarityThreshold: 0.85,
    maxDeletedCandidateAgeHours: 72
  }),
  history: stryMutAct_9fa48("675") ? {} : (stryCov_9fa48("675"), {
    keepDeletedLog: stryMutAct_9fa48("676") ? false : (stryCov_9fa48("676"), true),
    keepBuildHistory: stryMutAct_9fa48("677") ? false : (stryCov_9fa48("677"), true)
  })
})) satisfies IntegrityPolicy;
const BOOTSTRAP_SCHEMAS = {
  "policy.schema.json": {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://example.local/integrity/policy.schema.json",
    type: "object",
    additionalProperties: false,
    required: ["$schemaVersion", "hashAlgorithm", "include", "exclude", "moveDetection", "history"],
    properties: {
      $schemaVersion: {
        const: 1
      },
      hashAlgorithm: {
        const: "sha256"
      },
      include: {
        type: "array",
        items: {
          type: "string",
          minLength: 1
        }
      },
      exclude: {
        type: "array",
        items: {
          type: "string",
          minLength: 1
        }
      },
      moveDetection: {
        type: "object",
        additionalProperties: false,
        required: ["enableHeuristics", "similarityThreshold", "maxDeletedCandidateAgeHours"],
        properties: {
          enableHeuristics: {
            type: "boolean"
          },
          similarityThreshold: {
            type: "number",
            minimum: 0,
            maximum: 1
          },
          maxDeletedCandidateAgeHours: {
            type: "integer",
            minimum: 0
          }
        }
      },
      history: {
        type: "object",
        additionalProperties: false,
        required: ["keepDeletedLog", "keepBuildHistory"],
        properties: {
          keepDeletedLog: {
            type: "boolean"
          },
          keepBuildHistory: {
            type: "boolean"
          }
        }
      }
    }
  },
  "entities.by-id.schema.json": {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://example.local/integrity/entities.by-id.schema.json",
    type: "object",
    propertyNames: {
      type: "string",
      pattern: "^[0-9a-fA-F-]{36}$"
    },
    additionalProperties: {
      type: "object",
      additionalProperties: false,
      required: ["currentPath", "createdAt", "updatedAt", "revision", "contentHash", "gitSha", "status"],
      properties: {
        currentPath: {
          type: "string",
          minLength: 1
        },
        firstPath: {
          type: "string",
          minLength: 1
        },
        createdAt: {
          type: "string",
          format: "date-time"
        },
        updatedAt: {
          type: "string",
          format: "date-time"
        },
        revision: {
          type: "integer",
          minimum: 1
        },
        contentHash: {
          type: "string",
          pattern: "^sha256:[0-9a-fA-F]{64}$"
        },
        gitSha: {
          type: "string",
          minLength: 1
        },
        status: {
          enum: ["active", "deleted"]
        },
        moves: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["from", "to", "detectedAt", "confidence", "method"],
            properties: {
              from: {
                type: "string",
                minLength: 1
              },
              to: {
                type: "string",
                minLength: 1
              },
              detectedAt: {
                type: "string",
                format: "date-time"
              },
              confidence: {
                type: "number",
                minimum: 0,
                maximum: 1
              },
              method: {
                enum: ["same-hash", "heuristic"]
              }
            }
          }
        }
      }
    }
  },
  "paths.current.schema.json": {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://example.local/integrity/paths.current.schema.json",
    type: "object",
    propertyNames: {
      type: "string",
      minLength: 1
    },
    additionalProperties: {
      type: "string",
      pattern: "^[0-9a-fA-F-]{36}$"
    }
  },
  "deleted-log.schema.json": {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://example.local/integrity/deleted-log.schema.json",
    type: "array",
    items: {
      type: "object",
      additionalProperties: false,
      required: ["entityId", "lastPath", "deletedAt", "lastRevision", "lastHash"],
      properties: {
        entityId: {
          type: "string",
          pattern: "^[0-9a-fA-F-]{36}$"
        },
        lastPath: {
          type: "string",
          minLength: 1
        },
        deletedAt: {
          type: "string",
          format: "date-time"
        },
        lastRevision: {
          type: "integer",
          minimum: 1
        },
        lastHash: {
          type: "string",
          pattern: "^sha256:[0-9a-fA-F]{64}$"
        }
      }
    }
  },
  "manifest.schema.json": {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://example.local/integrity/manifest.schema.json",
    type: "object",
    additionalProperties: false,
    required: ["$schemaVersion", "directory", "generatedAt", "files"],
    properties: {
      $schemaVersion: {
        const: 1
      },
      directory: {
        type: "string",
        minLength: 1
      },
      generatedAt: {
        type: "string",
        format: "date-time"
      },
      files: {
        type: "object",
        propertyNames: {
          type: "string",
          minLength: 1
        },
        additionalProperties: {
          type: "object",
          additionalProperties: false,
          required: ["entityId", "createdAt", "updatedAt", "revision", "contentHash", "gitSha", "status"],
          properties: {
            entityId: {
              type: "string",
              pattern: "^[0-9a-fA-F-]{36}$"
            },
            createdAt: {
              type: "string",
              format: "date-time"
            },
            updatedAt: {
              type: "string",
              format: "date-time"
            },
            revision: {
              type: "integer",
              minimum: 1
            },
            contentHash: {
              type: "string",
              pattern: "^sha256:[0-9a-fA-F]{64}$"
            },
            gitSha: {
              type: "string",
              minLength: 1
            },
            status: {
              enum: ["active", "deleted"]
            }
          }
        }
      }
    }
  },
  "outputs.schema.json": {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://example.local/integrity/outputs.schema.json",
    type: "object",
    additionalProperties: false,
    required: ["buildId", "outputs"],
    properties: {
      buildId: {
        type: "string",
        minLength: 1
      },
      outputs: {
        type: "object",
        propertyNames: {
          type: "string",
          minLength: 1
        },
        additionalProperties: {
          type: "string",
          pattern: "^sha256:[0-9a-fA-F]{64}$"
        }
      }
    }
  },
  "build-provenance.schema.json": {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://example.local/integrity/build-provenance.schema.json",
    type: "object",
    additionalProperties: false,
    required: ["buildId", "sourceRepo", "sourceCommit", "builder", "buildStartedAt", "buildFinishedAt", "inputsDigest", "outputsDigest"],
    properties: {
      buildId: {
        type: "string",
        minLength: 1
      },
      sourceRepo: {
        type: "string",
        minLength: 1
      },
      sourceCommit: {
        type: "string",
        minLength: 1
      },
      builder: {
        type: "string",
        minLength: 1
      },
      buildStartedAt: {
        type: "string",
        format: "date-time"
      },
      buildFinishedAt: {
        type: "string",
        format: "date-time"
      },
      inputsDigest: {
        type: "string",
        pattern: "^sha256:[0-9a-fA-F]{64}$"
      },
      outputsDigest: {
        type: "string",
        pattern: "^sha256:[0-9a-fA-F]{64}$"
      }
    }
  }
} as const;
async function ensureSchemaFiles(cwd: string): Promise<void> {
  if (stryMutAct_9fa48("678")) {
    {}
  } else {
    stryCov_9fa48("678");
    const root = schemaDir(cwd);
    for (const [fileName, schema] of Object.entries(BOOTSTRAP_SCHEMAS)) {
      if (stryMutAct_9fa48("679")) {
        {}
      } else {
        stryCov_9fa48("679");
        const filePath = stryMutAct_9fa48("680") ? `` : (stryCov_9fa48("680"), `${root}/${fileName}`);
        if (stryMutAct_9fa48("682") ? false : stryMutAct_9fa48("681") ? true : (stryCov_9fa48("681", "682"), await pathExists(filePath))) {
          if (stryMutAct_9fa48("683")) {
            {}
          } else {
            stryCov_9fa48("683");
            continue;
          }
        }
        await writeJsonFile(filePath, schema);
      }
    }
  }
}
export async function ensurePolicyFile(cwd: string): Promise<IntegrityPolicy> {
  if (stryMutAct_9fa48("684")) {
    {}
  } else {
    stryCov_9fa48("684");
    const filePath = policyPath(cwd);
    await ensureSchemaFiles(cwd);
    if (stryMutAct_9fa48("686") ? false : stryMutAct_9fa48("685") ? true : (stryCov_9fa48("685", "686"), await pathExists(filePath))) {
      if (stryMutAct_9fa48("687")) {
        {}
      } else {
        stryCov_9fa48("687");
        return readJsonFile<IntegrityPolicy>(filePath);
      }
    }
    await writeJsonFile(filePath, BOOTSTRAP_POLICY);
    return BOOTSTRAP_POLICY;
  }
}
export async function loadPolicy(cwd: string): Promise<IntegrityPolicy> {
  if (stryMutAct_9fa48("688")) {
    {}
  } else {
    stryCov_9fa48("688");
    return ensurePolicyFile(cwd);
  }
}
export function isManagedPath(repoPath: string, policy: IntegrityPolicy): boolean {
  if (stryMutAct_9fa48("689")) {
    {}
  } else {
    stryCov_9fa48("689");
    const normalized = repoPath.replace(/\\/g, stryMutAct_9fa48("690") ? "" : (stryCov_9fa48("690"), "/"));
    const excluded = stryMutAct_9fa48("691") ? policy.exclude.every(pattern => globToRegExp(pattern).test(normalized)) : (stryCov_9fa48("691"), policy.exclude.some(stryMutAct_9fa48("692") ? () => undefined : (stryCov_9fa48("692"), pattern => globToRegExp(pattern).test(normalized))));
    if (stryMutAct_9fa48("694") ? false : stryMutAct_9fa48("693") ? true : (stryCov_9fa48("693", "694"), excluded)) return stryMutAct_9fa48("695") ? true : (stryCov_9fa48("695"), false);
    return stryMutAct_9fa48("696") ? policy.include.every(pattern => globToRegExp(pattern).test(normalized)) : (stryCov_9fa48("696"), policy.include.some(stryMutAct_9fa48("697") ? () => undefined : (stryCov_9fa48("697"), pattern => globToRegExp(pattern).test(normalized))));
  }
}