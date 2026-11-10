#!/usr/bin/env node
/**
 * Publishes the approved staff guidance of the Enginious Map to JARVIS.
 *
 *   source  docs/enginious-os/staff-guidance/*.md   (the Map: reviewed in a pull request like every other Map change)
 *   output  apps/web/src/lib/jarvis/knowledge/published.generated.ts   (what JARVIS answers from; committed)
 *
 * Only topics marked `status: published` become shared knowledge; a `draft` topic stays in the Map and is not given to JARVIS. Publication is the normal process: edit the
 * Map file, run `npm run build:jarvis-knowledge`, open a pull request, review, merge, deploy. No model is retrained: JARVIS reads this file.
 *
 *   node scripts/build-jarvis-knowledge.mjs           writes the output
 *   node scripts/build-jarvis-knowledge.mjs --check   fails if the output is not what the Map says (run by the web tests, so CI catches a stale file)
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SOURCE_DIR = path.join(ROOT, "docs", "enginious-os", "staff-guidance");
export const OUTPUT = path.join(ROOT, "apps", "web", "src", "lib", "jarvis", "knowledge", "published.generated.ts");
const AREAS = ["sales", "projects", "inventory", "people", "finance", "general"];

/** One Map file -> its topics (published or not). Throws on anything it does not understand, so a malformed topic can never be half-published. */
export function parseGuidance(markdown, file = "guidance") {
  const topics = [];
  const blocks = markdown.split(/^## /m).slice(1);
  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const title = lines.shift().trim();
    const meta = {}; const steps = []; const summary = [];
    for (const raw of lines) {
      const line = raw.trim();
      const m = /^- (id|area|status|keywords|links|screens):\s*(.*)$/.exec(line);
      const s = /^\d+\.\s+(.*)$/.exec(line);
      if (m) meta[m[1]] = m[2].trim();
      else if (s) steps.push(s[1].trim());
      else if (line && !line.startsWith("<!--")) summary.push(line);
    }
    const fail = (why) => { throw new Error(`${file}: topic "${title}": ${why}`); };
    if (!/^[a-z][a-z0-9-]{2,60}$/.test(meta.id ?? "")) fail("needs an id (lower-case words joined by hyphens)");
    if (!AREAS.includes(meta.area)) fail(`area must be one of ${AREAS.join(", ")}`);
    if (!["published", "draft"].includes(meta.status)) fail("status must be published or draft");
    const keywords = (meta.keywords ?? "").split(";").map((k) => k.trim()).filter(Boolean);
    const links = (meta.links ?? "").split(";").map((l) => l.trim()).filter(Boolean).map((l) => {
      const p = /^(.+?)\s*->\s*(\/\S*)$/.exec(l);
      if (!p) fail(`link "${l}" must be "Label -> /path"`);
      return { label: p[1].trim(), href: p[2] };
    });
    // The screens this topic is the guide FOR (route patterns as the app has them, e.g. /sales/events/[id]): lets JARVIS answer "what can I do here?" for that screen.
    const screens = (meta.screens ?? "").split(";").map((x) => x.trim()).filter(Boolean);
    for (const sc of screens) if (!/^\/[A-Za-z0-9\-/\[\]]*$/.test(sc)) fail(`screen "${sc}" must be a route such as /sales/events or /sales/events/[id]`);
    if (keywords.length === 0 || summary.length === 0) fail("needs keywords and a summary");
    topics.push({ id: meta.id, area: meta.area, status: meta.status, title, keywords, summary: summary.join(" "), steps, links, screens });
  }
  return topics;
}

export function readMap(dir = SOURCE_DIR) {
  const all = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".md") && x !== "README.md").sort()) all.push(...parseGuidance(readFileSync(path.join(dir, f), "utf8"), f));
  const seen = new Set();
  for (const t of all) { if (seen.has(t.id)) throw new Error(`Topic id used twice: ${t.id}`); seen.add(t.id); }
  return all;
}

export function render(topics) {
  const published = topics.filter((t) => t.status === "published").map(({ status: _s, ...t }) => t);
  return `// GENERATED from docs/enginious-os/staff-guidance/*.md by scripts/build-jarvis-knowledge.mjs. Do not edit: change the Map and run \`npm run build:jarvis-knowledge\`.\n// Only topics marked "published" are here.\nimport type { GuidanceEntry } from "../help/guidance";\n\nexport const PUBLISHED_GUIDANCE: GuidanceEntry[] = ${JSON.stringify(published, null, 2)};\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const next = render(readMap());
  if (process.argv.includes("--check")) {
    let current = "";
    try { current = readFileSync(OUTPUT, "utf8"); } catch { /* missing */ }
    if (current !== next) { console.error("JARVIS knowledge is out of date with the Map. Run: npm run build:jarvis-knowledge"); process.exit(1); }
    console.log("JARVIS knowledge matches the Map.");
  } else { writeFileSync(OUTPUT, next); console.log(`Published ${next.match(/"id":/g)?.length ?? 0} topics to JARVIS.`); }
}
