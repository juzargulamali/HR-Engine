// usage: node screenshots.mjs <outdir> [persona]  (BASE_URL=... to point at another local app) ; captures dashboard, sales opp, attendance register, mobile nav, dark+light
import { chromium, BASE, psql } from "./lib.mjs";
import fs from "node:fs";
const out = process.argv[2]; fs.mkdirSync(out, { recursive: true });
const persona = process.argv[3] ?? "ceo@e2e.local";
const oppId = psql("select id from crm_opportunities order by created_at desc limit 1");
const browser = await chromium.launch();
for (const theme of ["dark", "light"]) {
  for (const [vp, name] of [[{ width: 1440, height: 900 }, "desktop"], [{ width: 390, height: 844 }, "mobile"]]) {
    const ctx = await browser.newContext({ viewport: vp });
    await ctx.addInitScript((t) => { try { localStorage.setItem("theme", t); } catch {} }, theme);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/login`);
    await page.getByLabel(/email/i).fill(persona);
    await page.getByLabel(/password/i).first().fill("local-stack-password");
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
    const pages = { dashboard: "/", "sales-opportunity": `/sales/opportunities/${oppId}`, attendance: "/attendance?date=2026-10-15", "sales-list": "/sales/opportunities" };
    for (const [k, p] of Object.entries(pages)) {
      await page.goto(`${BASE}${p}`, { waitUntil: "networkidle" });
      await page.screenshot({ path: `${out}/${name}-${theme}-${k}.png`, fullPage: name === "desktop" });
    }
    if (name === "mobile") {
      await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
      const btn = page.getByRole("button", { name: /open menu|more/i }).first();
      await btn.click(); await page.waitForTimeout(400);
      await page.screenshot({ path: `${out}/mobile-${theme}-nav-open.png` });
    }
    await ctx.close();
  }
}
await browser.close();
console.log("done", out);
