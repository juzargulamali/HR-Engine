import { createRequire } from "module";
import fs from "fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const axeSrc = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const B = "http://localhost:3100/os-preview";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
let total = 0;
async function scan(page, label) {
  await page.evaluate(axeSrc);
  const res = await page.evaluate(async () => await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] }));
  for (const v of res.violations) { total++; console.log(`${label} :: ${v.id} (${v.impact}) x${v.nodes.length} :: ${v.nodes[0].target.join(" ")} :: ${(v.nodes[0].failureSummary.split("\n")[1] ?? "").slice(0, 160)}`); }
}
for (const [vp, size] of [["d", { width: 1440, height: 900 }], ["m", { width: 390, height: 844 }]]) {
  for (const theme of ["dark", "light"]) {
    const ctx = await browser.newContext({ viewport: size });
    await ctx.addInitScript((t) => { try { localStorage.setItem("theme", t); } catch {} }, theme);
    const p = await ctx.newPage();
    const L = (s) => `[${vp}/${theme}] ${s}`;
    await p.goto(`${B}/sales/opportunities/OPP-2026-0041?role=sales`, { waitUntil: "networkidle" });
    await p.getByRole("button", { name: "Complete follow-up" }).click(); await p.waitForTimeout(150); await scan(p, L("complete dialog")); await p.keyboard.press("Escape");
    await p.getByRole("button", { name: "Log activity" }).first().click(); await p.waitForTimeout(150); await scan(p, L("log dialog")); await p.keyboard.press("Escape");
    await p.getByRole("button", { name: "Schedule next action" }).click(); await p.waitForTimeout(150); await scan(p, L("schedule dialog")); await p.keyboard.press("Escape");
    await p.locator("main").getByRole("button", { name: "More", exact: true }).click(); await p.waitForTimeout(100); await scan(p, L("more menu")); await p.keyboard.press("Escape");
    await p.getByRole("button", { name: "More information" }).first().click().catch(() => {}); await p.waitForTimeout(100);
    await p.getByRole("tab", { name: "Proposals & Quotes" }).click(); await p.getByRole("button", { name: "More information" }).first().hover(); await scan(p, L("proposals with hint"));
    await p.getByLabel("Add link").check(); await p.getByRole("button", { name: "Add as draft" }).click(); await scan(p, L("proposal link error"));
    await p.goto(`${B}/sales/opportunities/OPP-2026-0044?role=founder&tab=proposals`, { waitUntil: "networkidle" });
    await p.getByRole("button", { name: "Request changes" }).click(); await p.waitForTimeout(150); await scan(p, L("request changes dialog")); await p.keyboard.press("Escape");
    await p.goto(`${B}/sales/opportunities?role=sales`, { waitUntil: "networkidle" });
    if (vp === "d") { await p.getByRole("button", { name: "Columns" }).click(); await scan(p, L("columns menu")); }
    await p.goto(`${B}/my-day?role=founder`, { waitUntil: "networkidle" });
    await p.locator("details summary", { hasText: "Financial summary" }).click(); await p.getByRole("button", { name: "About Actual incurred cost" }).hover(); await p.waitForTimeout(150); await scan(p, L("founder finance open"));
    await p.getByRole("button", { name: /Clocked in/ }).first().click(); await p.waitForTimeout(150); await scan(p, L("clock panel")); await p.keyboard.press("Escape");
    await p.goto(`${B}/sales/new?role=sales`, { waitUntil: "networkidle" });
    await p.fill("#e-party", "Northwind"); await p.getByRole("button", { name: "Record enquiry" }).click(); await scan(p, L("new enquiry errors + duplicate"));
    await p.goto(`${B}/sales/pipeline?role=sales`, { waitUntil: "networkidle" });
    await p.getByRole("button", { name: "Change stage" }).first().click(); await p.waitForTimeout(150); await scan(p, L("move dialog"));
    if (vp === "m") { await p.keyboard.press("Escape"); await p.getByRole("button", { name: "More", exact: true }).click(); await p.waitForTimeout(300); await scan(p, L("mobile menu drawer")); }
    await ctx.close();
  }
}
console.log("state violations:", total);
await browser.close();
