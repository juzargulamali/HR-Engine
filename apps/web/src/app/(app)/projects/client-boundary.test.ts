import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A server component cannot read a constant or helper that is exported from a "use client" module: it receives a client reference, so `FILE_PURPOSES.find(...)` throws
 * "find is not a function" and the page says "This page couldn't load" (this broke Files & client plan for every project that had a file).
 * This guard scans the Projects routes and fails when a server module imports a non-component export from a client module.
 */
const ROOT = path.join(__dirname, "..", "..", "..");           // apps/web/src
const PROJECTS = __dirname;

const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = path.join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f) ? [p] : [];
});
const isClient = (src: string) => /^\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']/.test(src.slice(0, 2000));
const resolve = (from: string, spec: string): string | null => {
  const base = spec.startsWith("@/") ? path.join(ROOT, spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(from), spec) : null;
  if (!base) return null;
  return [".tsx", ".ts", "/index.tsx", "/index.ts"].map((e) => base + e).find((f) => { try { return statSync(f).isFile(); } catch { return false; } }) ?? null;
};
/** Exports a server module must not read from a client module: constants and lower-case helpers (components start with a capital letter and are rendered, not read). */
const nonComponentExports = (src: string) => [
  ...[...src.matchAll(/export (?:const|let) ([A-Za-z_0-9]+)/g)].map((m) => m[1]!).filter((n) => !/^[A-Z][a-z]/.test(n) || /^[A-Z0-9_]+$/.test(n)),
  ...[...src.matchAll(/export (?:async )?function ([a-z][A-Za-z0-9_]*)/g)].map((m) => m[1]!),
];

describe("Projects routes: server modules never read constants or helpers exported from client modules", () => {
  const files = walk(PROJECTS);
  it("finds the Projects route files", () => expect(files.length).toBeGreaterThan(20));
  it("has no such import", () => {
    const offences: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      if (isClient(src)) continue;
      for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*"([^"]+)"/g)) {
        const target = resolve(file, m[2]!);
        if (!target) continue;
        const tsrc = readFileSync(target, "utf8");
        if (!isClient(tsrc)) continue;
        const bad = new Set(nonComponentExports(tsrc));
        const names = m[1]!.split(",").map((x) => x.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]!).filter(Boolean);
        for (const n of names) if (bad.has(n) && !/^\s*type\s/.test(m[1]!.split(",").find((x) => x.includes(n)) ?? "")) offences.push(`${path.relative(ROOT, file)} imports ${n} from ${path.relative(ROOT, target)}`);
      }
    }
    expect(offences).toEqual([]);
  });
});
