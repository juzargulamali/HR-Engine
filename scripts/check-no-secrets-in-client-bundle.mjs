#!/usr/bin/env node
// Phase 7 hardening (docs/06-implementation-phases.md): "confirm
// SUPABASE_SERVICE_ROLE_KEY never appears in any client bundle (automated
// CI check, not just code review)". `import "server-only"` in
// lib/supabase/admin.ts already makes an accidental import from a Client
// Component a build-time error, but that only catches the import path —
// this catches the actual output: it builds with a known, unique value for
// the secret and then greps every file Next.js ships to the browser
// (apps/web/.next/static) for that exact string. Anything server-only
// (`.next/server/**`) is expected to contain it and is not scanned.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const STATIC_DIR = path.join(REPO_ROOT, "apps/web/.next/static");
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!secret) {
  console.error("SUPABASE_SERVICE_ROLE_KEY is not set — build with it set to a known value before running this check.");
  process.exit(1);
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

let files;
try {
  files = walk(STATIC_DIR);
} catch (err) {
  console.error(`Could not read ${STATIC_DIR} — run "npm run build -w @enginious-hr/web" first.`, err.message);
  process.exit(1);
}

const offenders = files.filter((f) => readFileSync(f, "utf8").includes(secret));

if (offenders.length > 0) {
  console.error("SUPABASE_SERVICE_ROLE_KEY leaked into the client bundle:");
  for (const f of offenders) console.error(`  ${path.relative(REPO_ROOT, f)}`);
  process.exit(1);
}

console.log(`OK: SUPABASE_SERVICE_ROLE_KEY not found in any of ${files.length} client-bundle files under apps/web/.next/static.`);
