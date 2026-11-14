// Accessibility scan (axe-core: WCAG 2.x A/AA + best practice, which includes rendered colour contrast) of the redesign concept:
// every screen and panel, desktop and phone, dark and light. Needs a running preview on port 3100 (see concept.mjs).
import { createRequire } from "module";
import fs from "fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const axeSrc = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const base = process.argv[2] ?? "http://localhost:3100/os-preview/concept";
const system = process.env.CHROMIUM_PATH ?? (fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const paths = ["", "?view=board", "?as=directory", "?as=founder", "/aurora", "/aurora?view=board", "/aurora?task=t7", "/aurora?task=t2", "/aurora?tab=timeline", "/aurora?tab=timeline&ms=m5", "/aurora?tab=timeline&ms=sb1",
  "/aurora?tab=discussion", "/aurora?tab=equipment", "/aurora?tab=equipment&eq=request", "/aurora?tab=equipment&eq=e3", "/showroom", "/harbour?tab=discussion&as=member", "/aurora?as=directory", "/desert", "/zzz"];
const browser = await chromium.launch({ args: ["--no-sandbox"], ...(system ? { executablePath: system } : {}) });
let total = 0;
for (const [vp, size] of [["desktop", { width: 1280, height: 900 }], ["phone", { width: 390, height: 844 }]]) {
  for (const theme of ["dark", "light"]) {
    const ctx = await browser.newContext({ viewport: size });
    await ctx.addInitScript((t) => { try { localStorage.setItem("theme", t); if (t === "light") document.documentElement.setAttribute("data-theme", "light"); } catch {} }, theme);
    const page = await ctx.newPage();
    for (const p of paths) {
      await page.goto(base + p, { waitUntil: "load" });
      await page.waitForFunction(() => { const el = document.querySelector("button"); return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps")); });
      await page.waitForTimeout(350);
      await page.evaluate(axeSrc);
      const res = await page.evaluate(async () => await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] }));
      for (const v of res.violations) {
        total++;
        console.log(`[${vp}/${theme}] ${p || "/"} :: ${v.id} (${v.impact}) x${v.nodes.length} :: ${v.nodes[0].target.join(" ")} :: ${(v.nodes[0].failureSummary.split("\n")[1] ?? "").slice(0, 160)}`);
      }
    }
    await ctx.close();
  }
}
console.log("violations:", total);
await browser.close();
