// Rendered WCAG contrast audit. usage: node audit.mjs <outfile.json> [persona] [viewport=desktop|mobile]
import { chromium, BASE, psql } from "./lib.mjs";
import fs from "node:fs";
const outFile = process.argv[2]; const persona = process.argv[3] ?? "ceo@e2e.local"; const vpName = process.argv[4] ?? "desktop";
const vp = vpName === "mobile" ? { width: 390, height: 844 } : { width: 1440, height: 900 };
const oppId = psql("select id from crm_opportunities order by created_at desc limit 1");
const projId = psql("select id from proj_projects where kind='client' limit 1");
const taskId = psql("select id from proj_tasks limit 1");
const P = projId ? `/projects/${projId}` : "";
const invItem = psql("select id from inv_items order by name limit 1"), invUnit = psql("select id from inv_units order by code limit 1"), invReq = psql("select id from inv_requests order by code limit 1");
const INV = invItem ? ["/inventory", `/inventory?open=${invItem}`, ...(invUnit ? [`/inventory?unit=${invUnit}`] : []), "/inventory?action=receive", "/inventory?action=issue", "/inventory?action=dispatch", "/inventory?action=return", "/inventory?action=transfer", "/inventory?action=scan",
  "/inventory/requests", ...(invReq ? [`/inventory/requests?open=${invReq}`] : []), "/inventory/movements", "/inventory/manage", "/inventory/access", "/inventory/scan", `/inventory/labels?item=${invItem}`, "/inventory/mine", "/inventory/employees", ...(projId ? [`${P}/equipment`] : [])] : [];
const PAGES = [...(projId ? ["/projects", "/projects?view=board", "/projects?show=finished", `/projects?open=${projId}`, "/projects/work", "/projects/work?view=board", `/projects/work?task=${taskId}`, "/projects/calendar", "/projects/handovers", "/projects/new", "/projects/access",
    P, `${P}/work`, `${P}/work?view=board`, `${P}/work?task=${taskId}`, `${P}/work/tasks/${taskId}`, `${P}/plan`, `${P}/plan?plan=site`, `${P}/plan?mode=calendar`, `${P}/plan?mode=timeline`, `${P}/discussion`, `${P}/people`, `${P}/changes`, `${P}/documents`, `${P}/history`, `${P}/complete`] : []),
  ...INV,
  "/", "/sales", "/sales/follow-ups", "/sales/follow-ups?view=done&who=all", `/sales/follow-ups?open=${oppId}`, "/sales/opportunities", "/sales/opportunities?status=all", "/sales/opportunities?view=board&status=all", `/sales/opportunities?open=${oppId}`, "/sales/opportunities?add=1", `/sales/opportunities/${oppId}`,
  "/sales/proposals", "/sales/clients", "/sales/reports", "/sales/settings", "/sales/access", "/sales/new",
  "/attendance", "/employees", "/leave", "/leave/new", "/approvals", "/alerts", "/payroll", "/reimbursements", "/performance", "/policies", "/holidays", "/profile", "/attendance-clock", "/letters", "/admin/users", "/admin/companies", "/audit-log", "/ai-suggestions", "/account/security"];

const evalFn = () => {
  const cv = document.createElement("canvas"); cv.width = cv.height = 1; const cx = cv.getContext("2d", { willReadFrequently: true });
  const rgba = (str) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = "#000"; cx.fillStyle = str; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const over = (top, bot) => { const a = top[3] + bot[3] * (1 - top[3]); if (a === 0) return [0, 0, 0, 0]; return [0, 1, 2].map((i) => (top[i] * top[3] + bot[i] * bot[3] * (1 - top[3])) / a).concat([a]); };
  const lum = ([r, g, b]) => { const c = [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const rootStyle = getComputedStyle(document.documentElement);
  const token = (name) => rgba(`hsl(${rootStyle.getPropertyValue(name).trim().replace(/\s+/g, " ")})`);
  const bgOf = (el) => {
    const stack = [];
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      const bi = cs.backgroundImage;
      if (bi && bi.includes("gradient")) {
        // The rendered colour stops of this surface (a semi-transparent stop is judged over the page colour), so a surface that sets its own
        // gradient (the dark shell, the OS cards) is measured against what it really paints, not against the root theme tokens.
        // Only the layers that paint behind the content: a layer clipped to the border box (the gradient border trick) shows in the 1px border only.
        const layers = bi.split(/,\s*(?=(?:repeating-)?(?:linear|radial|conic)-gradient\(|url\()/);
        const clips = cs.backgroundClip.split(",").map((c) => c.trim());
        const paints = layers.filter((_, i) => (clips[i % clips.length] ?? "border-box") !== "border-box");
        const stops = (paints.length > 0 ? paints : layers).flatMap((l) => l.match(/rgba?\([^)]*\)/g) ?? []).map(rgba);
        if (stops.length > 0) {
          const under = e.parentElement ? bgOf(e.parentElement).colors : [rgba(getComputedStyle(document.body).backgroundColor)];
          return { grad: true, colors: stops.flatMap((s) => under.map((u) => over(s, [u[0], u[1], u[2], 1]))) };
        }
        return { grad: true, colors: [token("--brand-deep"), token("--brand-glow")] };
      }
      const c = rgba(cs.backgroundColor); stack.push(c); if (c[3] >= 0.999) break;
    }
    let acc = [0, 0, 0, 0]; for (let i = stack.length - 1; i >= 0; i--) acc = over(stack[i], acc);
    if (acc[3] < 0.999) acc = over(acc, rgba(getComputedStyle(document.body).backgroundColor));
    return { grad: false, colors: [acc] };
  };
  const results = [];
  const isHidden = (el) => { for (let e = el; e; e = e.parentElement) { if (e.hasAttribute("inert") || e.getAttribute("aria-hidden") === "true") return true; const cs = getComputedStyle(e); if (cs.display === "none" || cs.visibility === "hidden") return true; } const r = el.getBoundingClientRect(); return r.width === 0 || r.height === 0; };
  const opacityOf = (el) => { let o = 1; for (let e = el; e; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity); return o; };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  while (walker.nextNode()) {
    const n = walker.currentNode; const t = n.textContent.trim(); if (!t) continue; const el = n.parentElement; if (!el || seen.has(el)) continue;
    if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(el.tagName) || el.closest("nextjs-portal, [data-nextjs-toast], [data-nextjs-dev-tools-button]")) continue;
    if (isHidden(el)) continue; if (el.closest(".sr-only")) continue;
    seen.add(el);
    const cs = getComputedStyle(el);
    const fgRaw = rgba(cs.color); const op = opacityOf(el); if (op < 0.05) continue;
    const bgs = bgOf(el);
    const disabled = el.closest("[disabled], [aria-disabled='true']") !== null;
    const size = parseFloat(cs.fontSize); const bold = parseInt(cs.fontWeight) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    let worst = Infinity;
    for (const bg of bgs.colors) { const fg = over([fgRaw[0], fgRaw[1], fgRaw[2], fgRaw[3] * op], bg); worst = Math.min(worst, ratio(fg, bg)); }
    results.push({ text: t.slice(0, 40), tag: el.tagName.toLowerCase(), cls: (el.getAttribute("class") || "").slice(0, 60), size, large, disabled, op: +op.toFixed(2), ratio: +worst.toFixed(2), min: large ? 3 : 4.5, fg: cs.color, minSize: size });
  }
  // control boundaries: visible inputs/selects/textareas/outline buttons need 3:1 between their border and the surface behind them
  const controls = [];
  for (const el of document.querySelectorAll("input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea")) {
    if (isHidden(el)) continue; const cs = getComputedStyle(el); const b = rgba(cs.borderTopColor); const bw = parseFloat(cs.borderTopWidth);
    const parentBg = bgOf(el.parentElement).colors[0]; const fieldBg = rgba(cs.backgroundColor);
    controls.push({ kind: el.tagName.toLowerCase() + (el.type ? `[${el.type}]` : ""), name: el.getAttribute("name") || el.getAttribute("aria-label") || "", borderWidth: bw, borderVsParent: +ratio(over(b, parentBg), parentBg).toFixed(2), fieldVsParent: +ratio(over(fieldBg, parentBg), parentBg).toFixed(2) });
  }
  return { texts: results, controls };
};

const browser = await chromium.launch(); const all = {};
const ONLY = process.env.AUDIT_ONLY ? new RegExp(process.env.AUDIT_ONLY) : null; // e.g. AUDIT_ONLY="^/projects" re-checks one module only
for (const theme of ["dark", "light"]) {
  const ctx = await browser.newContext({ viewport: vp }); await ctx.addInitScript((t) => { try { localStorage.setItem("theme", t); } catch {} }, theme);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`); await page.getByLabel(/email/i).fill(persona); await page.getByLabel(/password/i).first().fill("local-stack-password"); await page.getByRole("button", { name: /sign in|log in/i }).click(); await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
  for (const p of PAGES.filter((q) => !ONLY || ONLY.test(q))) {
    const res = await page.goto(`${BASE}${p}`, { waitUntil: "networkidle" }).catch(() => null);
    await page.waitForTimeout(150);
    all[`${theme} ${p}`] = { status: res?.status(), ...(await page.evaluate(evalFn)) };
    if (p === "/") { // also the open command palette and user menu
      await page.keyboard.press("Control+k"); await page.waitForTimeout(250); all[`${theme} palette-open`] = await page.evaluate(evalFn); await page.keyboard.press("Escape");
      await page.getByRole("button", { name: /ceo@e2e.local/i }).first().click().catch(() => {}); await page.waitForTimeout(250); all[`${theme} user-menu-open`] = await page.evaluate(evalFn); await page.keyboard.press("Escape");
    }
    // Interactive states of the new workspaces: menus and dialogs opened from the list, the board and the side panel (nothing is submitted).
    if (p === "/sales/opportunities") {
      await page.getByRole("button", { name: /columns/i }).click().catch(() => {}); await page.waitForTimeout(250); all[`${theme} sales columns-menu-open`] = await page.evaluate(evalFn); await page.keyboard.press("Escape");
      await page.getByRole("button", { name: /shared lists/i }).click().catch(() => {}); await page.waitForTimeout(250); all[`${theme} sales shared-lists-open`] = await page.evaluate(evalFn); await page.keyboard.press("Escape");
    }
    if (p === "/sales/opportunities?add=1") { await page.getByText("Add more details").click().catch(() => {}); await page.waitForTimeout(250); all[`${theme} quick-add-more-details`] = await page.evaluate(evalFn); }
    if (p.startsWith("/sales/opportunities?open=")) {
      const panel = page.locator("aside[role=dialog]");
      for (const tabName of ["Updates", "Proposals & files", "Scope & dates", "Commercial"]) { await panel.getByRole("tab", { name: tabName }).click().catch(() => {}); await page.waitForTimeout(250); all[`${theme} sales panel tab ${tabName}`] = await page.evaluate(evalFn); }
      await panel.getByRole("button", { name: /more actions/i }).click().catch(() => {}); await page.waitForTimeout(250); all[`${theme} sales panel more-actions-open`] = await page.evaluate(evalFn);
      for (const item of [/move to another stage/i, /put on hold/i, /close as won/i, /edit details/i]) {
        await page.getByRole("menuitem", { name: item }).click().catch(() => {}); await page.waitForTimeout(300); all[`${theme} sales panel dialog ${item}`] = await page.evaluate(evalFn); await page.keyboard.press("Escape"); await page.waitForTimeout(150);
        await panel.getByRole("button", { name: /more actions/i }).click().catch(() => {}); await page.waitForTimeout(200);
      }
      await page.keyboard.press("Escape");
      for (const name of [/^add update$/i, /complete follow-up/i, /schedule next action/i]) { await panel.getByRole("button", { name }).first().click().catch(() => {}); await page.waitForTimeout(300); all[`${theme} sales panel dialog ${name}`] = await page.evaluate(evalFn); await page.keyboard.press("Escape"); await page.waitForTimeout(150); }
    }
    if (p === "/sales/opportunities?view=board&status=all") {
      const sel = page.getByLabel(/^Move .* to$/).first();
      if (await sel.count()) { const t = await sel.locator("option").allInnerTexts(); const hold = t.find((x) => /on hold/i.test(x)); if (hold) { await sel.selectOption({ label: hold }).catch(() => {}); await page.waitForTimeout(500); all[`${theme} board hold-dialog`] = await page.evaluate(evalFn); await page.keyboard.press("Escape"); } }
    }
    if (p === "/sales/follow-ups") {
      await page.getByRole("button", { name: /^Complete follow-up: / }).first().click().catch(() => {}); await page.waitForTimeout(300); all[`${theme} follow-up complete dialog`] = await page.evaluate(evalFn); await page.keyboard.press("Escape"); await page.waitForTimeout(150);
      await page.getByRole("button", { name: /^more$/i }).first().click().catch(() => {}); await page.waitForTimeout(250); all[`${theme} follow-up row more menu`] = await page.evaluate(evalFn); await page.keyboard.press("Escape");
    }
    if (p === "/inventory") {   // Inventory: the Add item dialog and the Issue / Dispatch menu (nothing is submitted)
      await page.getByRole("button", { name: /^Add item$/ }).first().click().catch(() => {}); await page.waitForTimeout(300); all[`${theme} inventory add-item-dialog`] = await page.evaluate(evalFn); await page.keyboard.press("Escape"); await page.waitForTimeout(150);
      await page.getByRole("button", { name: /Issue \/ Dispatch/ }).first().click().catch(() => {}); await page.waitForTimeout(250); all[`${theme} inventory issue-dispatch-menu-open`] = await page.evaluate(evalFn); await page.keyboard.press("Escape");
    }
    if (p === "/projects") {
      await page.getByRole("button", { name: /columns/i }).click().catch(() => {}); await page.waitForTimeout(250); all[`${theme} projects columns-menu-open`] = await page.evaluate(evalFn); await page.keyboard.press("Escape");
      await page.getByRole("button", { name: /new internal project|add project|new project/i }).first().click().catch(() => {}); await page.waitForTimeout(300); all[`${theme} projects quick-new-project`] = await page.evaluate(evalFn); await page.keyboard.press("Escape");
    }
    if (p.endsWith("/work") && projId && p.startsWith(`/projects/${projId}`)) {
      await page.getByRole("button", { name: /add task|new task/i }).first().click().catch(() => {}); await page.waitForTimeout(300); all[`${theme} project quick-add-task`] = await page.evaluate(evalFn); await page.keyboard.press("Escape");
    }
    if (p.startsWith("/sales/opportunities/")) {
      for (const name of [/^move stage$/i, /^close as won$/i, /^put on hold$/i, /^add a contact$/i, /^add follow-up$/i]) {
        const b = page.getByRole("button", { name }).first();
        if (await b.count()) { await b.click().catch(() => {}); await page.waitForTimeout(300); all[`${theme} dialog ${name}`] = await page.evaluate(evalFn); await page.keyboard.press("Escape"); await page.waitForTimeout(150); }
      }
    }
  }
  await ctx.close();
}
await browser.close();
fs.writeFileSync(outFile, JSON.stringify(all));
// summary
const fails = new Map();
for (const [key, v] of Object.entries(all)) for (const t of v.texts ?? []) if (!t.disabled && t.ratio < t.min) { const k = `${key.split(" ")[0]} | ${t.fg} | ratio ${t.ratio} (min ${t.min}) | ${t.tag}.${t.cls}`; const e = fails.get(k) ?? { n: 0, pages: new Set(), sample: t.text }; e.n++; e.pages.add(key.split(" ").slice(1).join(" ")); fails.set(k, e); }
console.log("pages:", Object.keys(all).length, " distinct failing combos:", fails.size);
for (const [k, e] of [...fails].sort((a, b) => b[1].n - a[1].n).slice(0, 40)) console.log(`${e.n}x ${k} :: "${e.sample}" :: ${[...e.pages].slice(0, 3).join(", ")}`);
let minRatio = 99; let nText = 0; for (const v of Object.values(all)) for (const t of v.texts ?? []) { if (!t.disabled) { nText++; minRatio = Math.min(minRatio, t.ratio / (t.min / 4.5)); } }
console.log("text nodes checked:", nText);
