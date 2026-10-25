// Finds menus and dialogs that run out of their panel or the screen, and text that is cut off by the box around it, on the Inventory screens
// and the pages that carry Inventory menus (LOCAL stack only; needs seed/inventory.sh). It only OPENS menus and dialogs; it never submits one.
//   node os-shell-checks/overflow-audit.mjs            (desktop 1280 and phone 390)
// What it checks:
//   * every "..." menu: once open, all of the list is inside the screen AND inside the panel / table that holds it (nothing cut off)
//   * every dialog a menu opens: nothing wider than the dialog, no text outside it
//   * every visible text on the page: not outside the screen, and not cut off by a box that hides what sticks out of it
// A self-test first proves the detector sees a cut-off box and a cut-off menu, so a clean result means something.
import { chromium, newPage, login, BASE, psql as sql } from "./lib.mjs";

const browser = await chromium.launch();
const SHORT = 6000; // one slow or vanished element must not hold the whole audit for 30 s
const ITEM = sql("select id from inv_items where name='Laptop 14 inch'");
const UNIT = sql("select id from inv_units order by code limit 1");
const PRJ = sql("select id from proj_projects where name='Showroom refresh'");
const REQ = sql("select id from inv_requests order by created_at limit 1");
const OPP = sql("select id from crm_opportunities order by created_at limit 1");
const EMP = sql("select id from employees order by created_at limit 1");

const PAGES = [
  ["/inventory", "stock table"], [`/inventory?open=${ITEM}`, "item panel"], [`/inventory?unit=${UNIT}`, "unit panel"],
  ["/inventory?action=transfer", "transfer panel"], ["/inventory?action=receive", "receive panel"],
  ["/inventory/requests", "requests"], [`/inventory/requests?open=${REQ}`, "request panel"], ["/inventory/movements", "movements"],
  ["/inventory/manage", "setup"], ["/inventory/access", "access"], ["/inventory/employees", "employees' equipment"],
  [`/projects/${PRJ}/equipment`, "project equipment"], [`/sales/opportunities?open=${OPP}`, "enquiry panel"], [`/employees/${EMP}?tab=assets`, "HR assets tab"],
].filter(([p]) => !/undefined|=\s*$|\/$/.test(p));

// ---- the detector, run inside the page -----------------------------------------------------------------------------------------------------
const detector = () => {
  const out = [];
  const vw = window.innerWidth;
  const visible = (el) => el.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) ?? true;
  const clips = (el) => { const s = getComputedStyle(el); return { x: s.overflowX, y: s.overflowY }; };
  // text nodes
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n = 0;
  while (walker.nextNode() && n < 6000) {
    const t = walker.currentNode; const text = (t.textContent ?? "").trim();
    if (!text) continue;
    const el = t.parentElement; if (!el || !visible(el)) continue;
    if (el.closest("script,style,noscript,[inert],[hidden],[aria-hidden='true'],option,.sr-only,[class*='sr-only']")) continue;
    if (el.closest("dialog:not([open])")) continue;
    n++;
    const range = document.createRange(); range.selectNodeContents(t);
    const r = range.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const label = text.slice(0, 50);
    const scrollsX = (() => { for (let a = el; a && a !== document.documentElement; a = a.parentElement) { const s = getComputedStyle(a); if (/(auto|scroll)/.test(s.overflowX) && a.scrollWidth > a.clientWidth + 1) return true; } return false; })();
    if ((r.right > vw + 1 || r.left < -1) && !scrollsX) { out.push({ kind: "outside the screen", text: label }); continue; }
    for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
      const { x } = clips(a); if (x === "visible") continue;
      // text shortened with an ellipsis on purpose (a long title in a narrow bar) is not a defect
      if (getComputedStyle(a).textOverflow === "ellipsis" || getComputedStyle(el).textOverflow === "ellipsis") break;
      const c = a.getBoundingClientRect(); if (c.width === 0) continue;
      const scrolls = x === "auto" || x === "scroll";
      // a scrolling box may hide the far side (the person scrolls to it) but never the near side; a clipping box hides both
      const cutLeft = r.left < c.left - 1.5;
      const cutRight = !scrolls && r.right > c.right + 1.5;
      if (cutLeft || cutRight) { out.push({ kind: cutLeft ? "cut off on the left" : "cut off on the right", text: label }); break; }
    }
  }
  return out;
};

const menuCheck = async (page) => {
  // opens each menu, checks the list sits inside the screen and inside its clipping ancestor, closes it
  const problems = [];
  const triggers = page.locator('[aria-haspopup="menu"]:visible');
  const count = await triggers.count();
  const home = page.url();
  for (let i = 0; i < count; i++) {
    if (page.url() !== home) { problems.push("a step moved away from the page (a panel closed or a link was followed)"); await page.goto(home, { waitUntil: "networkidle" }); }
    const t = triggers.nth(i);
    const label = ((await t.innerText().catch(() => "")) || "menu").trim().slice(0, 30);
    await t.scrollIntoViewIfNeeded().catch(() => {}); await t.click({ timeout: 3000, force: true }).catch(() => {}); await page.waitForTimeout(260);
    const res = await t.evaluate((btn) => {
      const wrap = btn.parentElement; const menu = wrap?.querySelector('[role="menu"]');
      if (!menu || menu.hasAttribute("inert")) return { opened: false };
      const r = menu.getBoundingClientRect();
      let box = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
      for (let a = wrap.parentElement; a && a !== document.body; a = a.parentElement) {
        const s = getComputedStyle(a);
        if (/(auto|scroll|hidden|clip)/.test(s.overflowX + s.overflowY)) { const c = a.getBoundingClientRect(); box = { left: Math.max(box.left, c.left), right: Math.min(box.right, c.right), top: Math.max(box.top, c.top), bottom: Math.min(box.bottom, c.bottom) }; break; }
      }
      const left = r.left < box.left - 1, right = r.right > box.right + 1;
      return { opened: true, left, right, w: Math.round(r.width), over: Math.round(Math.max(box.left - r.left, r.right - box.right, 0)) };
    });
    if (res.opened && (res.left || res.right)) problems.push(`menu "${label}" runs ${res.left ? "off the left" : "off the right"} by ${res.over}px`);
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(120);
  }
  return problems;
};

const dialogCheck = async (page) => {
  // for every menu item that is a button (it opens a dialog), open the dialog and look at it, then close it without saving
  const problems = [];
  const triggers = page.locator('[aria-haspopup="menu"]:visible');
  const count = await triggers.count();
  const home = page.url();
  for (let i = 0; i < Math.min(count, 14); i++) {
    if (page.url() !== home) await page.goto(home, { waitUntil: "networkidle" });
    const t = triggers.nth(i);
    await t.scrollIntoViewIfNeeded().catch(() => {}); await t.click({ timeout: 3000, force: true }).catch(() => {}); await page.waitForTimeout(220);
    const items = await t.evaluate((btn) => Array.from(btn.parentElement?.querySelectorAll('[role="menuitem"]:not(a):not([disabled])') ?? []).map((b) => (b.textContent ?? "").trim().slice(0, 40)));
    await page.keyboard.press("Escape").catch(() => {});
    for (let k = 0; k < Math.min(items.length, 5); k++) {
      await t.click({ timeout: 3000, force: true }).catch(() => {}); await page.waitForTimeout(200);
      const item = t.locator("xpath=..").locator('[role="menuitem"]:not(a):not([disabled])').nth(k);
      const name = items[k];
      const before = page.url();
      await item.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(450);
      if (page.url() !== before) { await page.goto(before, { waitUntil: "networkidle" }); break; }
      const dlg = page.locator("dialog[open]").first();
      if (await dlg.count()) {
        const m = await dlg.evaluate((d) => {
          const r = d.getBoundingClientRect();
          const wide = d.scrollWidth > d.clientWidth + 1;
          const stray = [];
          const w = document.createTreeWalker(d, NodeFilter.SHOW_TEXT);
          while (w.nextNode()) { const t2 = w.currentNode; if (!(t2.textContent ?? "").trim()) continue; const rr = document.createRange(); rr.selectNodeContents(t2); const b = rr.getBoundingClientRect(); if (b.width && (b.left < r.left - 1.5 || b.right > r.right + 1.5)) stray.push((t2.textContent ?? "").trim().slice(0, 40)); }
          return { wide, stray: stray.slice(0, 3), ws: getComputedStyle(d).whiteSpace };
        });
        if (m.wide || m.stray.length) problems.push(`dialog "${name}": ${m.wide ? "content wider than the dialog" : ""}${m.stray.length ? ` text outside it: ${m.stray.join(" | ")}` : ""} (white-space: ${m.ws})`);
        await page.keyboard.press("Escape").catch(() => {}); await page.waitForTimeout(200);
      } else { await page.keyboard.press("Escape").catch(() => {}); }
    }
  }
  return problems;
};

// ---- self-test: the detector must see a cut-off box and a cut-off menu --------------------------------------------------------------------
{
  const p = await newPage(browser); await login(p, "ceo@e2e.local"); await p.goto(`${BASE}/inventory`, { waitUntil: "networkidle" });
  await p.evaluate(() => {
    const box = document.createElement("div"); box.id = "selftest-box"; box.style.cssText = "width:60px;overflow:hidden;white-space:nowrap;position:fixed;top:120px;left:300px;z-index:99;background:#222;color:#fff";
    box.textContent = "A long sentence that is cut off by its box"; document.body.append(box);
    const panel = document.createElement("div"); panel.style.cssText = "position:fixed;top:200px;left:400px;width:300px;overflow:auto;z-index:99;background:#222;padding:8px";
    const wrap = document.createElement("div"); wrap.style.cssText = "position:relative;width:60px";
    const btn = document.createElement("button"); btn.setAttribute("aria-haspopup", "menu"); btn.textContent = "Selftest"; btn.onclick = () => { menu.removeAttribute("inert"); };
    const menu = document.createElement("div"); menu.setAttribute("role", "menu"); menu.setAttribute("inert", ""); menu.style.cssText = "position:absolute;right:0;top:100%;min-width:15rem;background:#333;color:#fff";
    menu.textContent = "A menu that opens to the left"; wrap.append(btn, menu); panel.append(wrap); document.body.append(panel);
  });
  const seen = await p.evaluate(detector);
  const menuProblems = await menuCheck(p);
  const okBox = seen.some((s) => /cut off/.test(s.kind) && /long sentence/.test(s.text));
  const okMenu = menuProblems.some((m) => /Selftest/.test(m));
  console.log(okBox ? "PASS self-test: a cut-off box is seen" : "FAIL self-test: a cut-off box was NOT seen");
  console.log(okMenu ? "PASS self-test: a cut-off menu is seen" : "FAIL self-test: a cut-off menu was NOT seen");
  await p.context().close();
  if (!okBox || !okMenu) { await browser.close(); process.exit(2); }
}

let fails = 0;
for (const [label, viewport] of [["desktop 1280", { width: 1280, height: 900 }], ["phone 390", { width: 390, height: 844 }]]) {
  const page = await newPage(browser, viewport); await login(page, "ceo@e2e.local");
  for (const [path, name] of PAGES) {
    try {
      page.setDefaultTimeout(SHORT);
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 45000 });
      const text = await page.evaluate(detector);
      const problems = [...text.slice(0, 4).map((s) => `${s.kind}: "${s.text}"`), ...(await menuCheck(page)), ...(await dialogCheck(page))];
      if (problems.length) { fails++; console.log(`FAIL [${label}] ${name} ${path}\n   - ${problems.slice(0, 8).join("\n   - ")}`); } else console.log(`PASS [${label}] ${name}`);
    } catch (e) { fails++; console.log(`FAIL [${label}] ${name} ${path} :: ${String(e.message).split("\n")[0]}`); }
  }
  await page.context().close();
}
await browser.close();
console.log(fails ? `\n${fails} PAGE(S) WITH PROBLEMS` : "\nNOTHING CUT OFF ON ANY CHECKED PAGE");
process.exit(fails ? 1 : 0);
