/**
 * Meta-test: every tenant-scoped data route MUST call tenantScope() on
 * every Mongo read/write that touches a tenant-scoped collection.
 *
 * This is a regex pass over each route file rather than a runtime
 * assertion because the failure mode we're guarding against —
 * forgetting `tenantScope()` on a single new line — is too easy to
 * miss in code review and too dangerous to ship (cross-tenant leak).
 *
 * The check is intentionally cheap and approximate. False positives
 * are explicitly listed in `EXEMPT_LINES` below; a new exemption
 * needs a comment explaining why.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROUTES_DIR = path.resolve(
  // dirname relative to apps/api/test/routes/
  process.cwd(),
  "src/routes",
);

/**
 * Collections we treat as tenant-scoped. Operating on these without
 * a `tenantScope(req, ...)` filter is the bug we're catching.
 *
 * `dids` reads/writes from admin.routes.ts are fine because admin
 * routes use the superadmin guard, not tenantScope (admin is
 * cross-tenant by design). admin.routes.ts is therefore not in
 * `TENANT_SCOPED_ROUTES` below.
 */
const TENANT_COLLECTIONS = [
  "agents",
  "campaigns",
  "calls",
  "voice_clones",
  "dids",
];

/**
 * Routes that ARE tenant-scoped — every collection access must be
 * wrapped with tenantScope().
 */
const TENANT_SCOPED_ROUTES = [
  "agents.routes.ts",
  "calls.routes.ts",
  "campaigns.routes.ts",
  "dids.routes.ts",
  "voice-clones.routes.ts",
];

/**
 * Lines containing one of the tenant collections that are exempt from
 * the tenantScope requirement. Each entry must be commented inline
 * with WHY it's safe.
 */
const EXEMPT_LINES: Array<{ file: string; pattern: RegExp; reason: string }> = [
  {
    // campaigns.routes.ts /:id/dial-now passes the calls collection by
    // reference into the runner; the runner itself scopes by tenantId
    // explicitly. Not a direct query.
    file: "campaigns.routes.ts",
    pattern: /collection\("calls"\) as never/,
    reason: "passed by reference into runner; runner scopes internally",
  },
  {
    // Same /:id/dial-now block — campaigns and dids are passed by
    // reference into dialNextLead which does its own tenantId
    // bookkeeping. Match the literal `collection<Campaign>("campaigns")` line.
    file: "campaigns.routes.ts",
    pattern: /campaigns:\s*getDb\(\)\.collection<Campaign>\("campaigns"\)/,
    reason: "passed by reference into runner; runner scopes internally",
  },
  {
    // campaigns.routes.ts /:id/dial-now also passes the dids collection
    // into the runner without an explicit filter — the runner does the
    // tenant lookup itself.
    file: "campaigns.routes.ts",
    pattern: /collection\("dids"\),\s*$/m,
    reason: "passed by reference into runner; runner scopes internally",
  },
  {
    // agents.routes.ts checks campaign references when deleting an
    // agent. The countDocuments call uses tenantScope already; this
    // pattern picks up the literal `.collection("campaigns")` line
    // which is the targeted line of a tenantScope-scoped query.
    file: "agents.routes.ts",
    pattern: /\.collection\("campaigns"\)/,
    reason: "scoped via tenantScope() on the next line — see countDocuments call",
  },
];

interface CollectionUsage {
  line: number;
  text: string;
  collection: string;
  hasScope: boolean;
}

function findCollectionUsages(src: string): CollectionUsage[] {
  const usages: CollectionUsage[] = [];
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(
      /\.collection(?:<[^>]+>)?\(\s*"([a-zA-Z_]+)"\s*\)/,
    );
    if (!m) continue;
    const collection = m[1];
    if (!TENANT_COLLECTIONS.includes(collection)) continue;

    // Look at this line plus the next few for `tenantScope(`. Some
    // chained calls span lines, so we search a small window.
    const window = lines.slice(i, Math.min(i + 6, lines.length)).join("\n");
    if (/tenantScope\(/.test(window)) {
      usages.push({ line: i + 1, text: line.trim(), collection, hasScope: true });
      continue;
    }

    // Safe insert pattern: `.insertOne(<var>)` where the doc the var
    // refers to was constructed with `tenantId: req.tenantId` within
    // the preceding ~30 lines. We approximate by scanning backward
    // for the assignment.
    if (/\.insertOne\(/.test(line)) {
      const back = lines
        .slice(Math.max(0, i - 30), i)
        .join("\n");
      if (/tenantId:\s*req\.tenantId/.test(back)) {
        usages.push({ line: i + 1, text: line.trim(), collection, hasScope: true });
        continue;
      }
    }

    usages.push({ line: i + 1, text: line.trim(), collection, hasScope: false });
  }
  return usages;
}

describe("tenant-scope meta-test", () => {
  for (const file of TENANT_SCOPED_ROUTES) {
    it(`${file}: every tenant-collection access calls tenantScope()`, () => {
      const fullPath = path.join(ROUTES_DIR, file);
      const src = readFileSync(fullPath, "utf8");
      const usages = findCollectionUsages(src);
      const violations = usages.filter((u) => {
        if (u.hasScope) return false;
        return !EXEMPT_LINES.some(
          (e) => e.file === file && e.pattern.test(u.text),
        );
      });
      if (violations.length > 0) {
        const detail = violations
          .map(
            (v) =>
              `  ${file}:${v.line} → .collection("${v.collection}") without tenantScope()\n    ${v.text}`,
          )
          .join("\n");
        throw new Error(
          `${file} has ${violations.length} tenant-collection access(es) without tenantScope():\n${detail}\n\nIf intentional, add an entry to EXEMPT_LINES in this test with a justification.`,
        );
      }
      expect(violations).toEqual([]);
    });
  }

  it("the routes directory has no surprise files we forgot to vet", () => {
    const seen = readdirSync(ROUTES_DIR).filter((f) => f.endsWith(".routes.ts"));
    // Anything not in TENANT_SCOPED_ROUTES must be a known non-tenant
    // route. Update the lists below + run this test to confirm.
    const NON_TENANT_ROUTES = [
      "admin.routes.ts", // superadmin-only, cross-tenant by design
      "auth.routes.ts", // pre-auth flows
      "credits.routes.ts", // tenant-scoped via getLedgerPage(req.tenantId!) — no .collection() in the file
      "flows.routes.ts", // proxy to Dograh MCP, no Mongo collections
      "voices.routes.ts", // static catalog
      "webhooks.routes.ts", // tenant resolved from DID, not from req.user
    ];
    const known = new Set([...TENANT_SCOPED_ROUTES, ...NON_TENANT_ROUTES]);
    const surprises = seen.filter((f) => !known.has(f));
    expect(surprises).toEqual([]);
  });
});
