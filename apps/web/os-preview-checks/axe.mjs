import { createRequire } from "module";
import fs from "fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const axeSrc = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const base = process.argv[2] ?? "http://localhost:3100/os-preview";
const paths = JSON.parse(fs.readFileSync(process.argv[3] ?? new URL("./paths.json", import.meta.url).pathname, "utf8"));
const browser = await chromium.launch({ args: ["--no-sandbox"] });
let total = 0;
for (const [vp, size] of [["d", { width: 1440, height: 900 }], ["m", { width: 390, height: 844 }]]) {
  for (const theme of ["dark", "light"]) {
    const ctx = await browser.newContext({ viewport: size });
    await ctx.addInitScript((t) => { try { localStorage.setItem("theme", t); } catch {} }, theme);
    const page = await ctx.newPage();
    for (const p of paths) {
      await page.goto(base + p, { waitUntil: "networkidle" });
      await page.waitForTimeout(250);
      await page.evaluate(axeSrc);
      const res = await page.evaluate(async () => await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] }));
      for (const v of res.violations) {
        // ignore Next.js dev overlay nodes
        const nodes = v.nodes.filter((n) => !n.target.join(" ").includes("nextjs-portal"));
        if (!nodes.length) continue;
        total++;
        console.log(`[${vp}/${theme}] ${p} :: ${v.id} (${v.impact}) x${nodes.length} :: ${nodes[0].target.join(" ")} :: ${nodes[0].failureSummary.split("\n")[1] ?? ""}`);
      }
    }
    await ctx.close();
  }
}
console.log("violations:", total);
await browser.close();
