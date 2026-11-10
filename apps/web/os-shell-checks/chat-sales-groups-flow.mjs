// ONE focused check of the app-wide Chat panel and its three Sales groups, in a real browser. LOCAL STACK ONLY, fictional accounts and data only. Needs `seed/sales.sh` (reseed first:
// it expects an empty Sales database) and the isolated stack (stack.sh build + start). Run: `node os-shell-checks/chat-sales-groups-flow.mjs`.
// People (all local): emp@ = Sales in the UAE company only; mgr@ = Sales in UAE, KSA and Poland ("Europe"); pol.worker@ = Sales in Poland only; hr@ = no Sales access.
//   1. WHO SEES WHAT: the single-company person sees only "Sales — UAE"; the three-company person sees all three groups; the person with no Sales access has no Chat button and the
//      database refuses them the history and the group list.
//   2. UNREAD AND MENTION: a message that @mentions the three-company person raises the button's total and that group's own count (with the mention marker); opening the group clears it.
//   3. A SHARED ITEM THE READER CANNOT OPEN: a UAE enquiry shared into "Sales — Europe" shows the Poland-only reader only "Restricted item" (no title anywhere), while a reader with access
//      sees the title and a link.
//   4. REVOKING COMPANY ACCESS: with a Europe thread open and one unread there, removing the three-company person's Poland access closes the thread, drops the group from their list, and
//      their total unread no longer counts it; the history cannot be read.
import { chromium, newPage, login, BASE, psql as sql } from "./lib.mjs";
import { asDb, asDbTry } from "./inventory-flow-lib.mjs";

const UAE = "00000000-0000-4000-8000-00000000a001";
const PL = "00000000-0000-4000-8000-00000000a002";
const KSA = "00000000-0000-4000-8000-00000000a003";
const U = (n) => `00000000-0000-4000-8000-0000000000a${n}`;   // 2 hr, 4 mgr, 5 emp, 9 pol.worker
const browser = await chromium.launch();
let fails = 0; let page;
const step = async (name, fn) => {
  try { await fn(); console.log("PASS", name); } catch (e) {
    fails++; console.log("FAIL", name, "::", String(e.message).split("\n")[0]);
    await page?.screenshot({ path: `/tmp/chat-fail-${name.replace(/\W+/g, "_").slice(0, 50)}.png`, fullPage: true }).catch(() => {});
  }
};
const eq = (got, want, what) => { if (String(got) !== String(want)) throw new Error(`${what}: expected ${want}, got ${got}`); };
const flat = (t) => t.replace(/\s+/g, " ").trim();
const name = (n) => sql(`select coalesce(nullif(btrim(full_name), ''), split_part(email, '@', 1)) from profiles where id = '${U(n)}'`);

if (sql("select count(*) from crm_organisations") !== "0") throw new Error("reseed first (seed/sales.sh): this run expects an empty Sales database");

// ---- set-up: a KSA company; the Poland-only person; mgr gets KSA and Poland as well; one UAE enquiry to share ----
sql(`insert into countries (code, name, default_currency) values ('SA', 'Saudi Arabia', 'SAR') on conflict do nothing`);
sql(`insert into companies (id, legal_name, country_code, default_currency) values ('${KSA}', 'Enginious Local SA', 'SA', 'SAR') on conflict do nothing`);
sql(`insert into crm_company_settings (company_id, reference_code, default_quote_currency) values ('${PL}', 'PLW', 'PLN'), ('${KSA}', 'KSA', 'SAR') on conflict do nothing`);
sql(`insert into crm_company_grants (user_id, company_id, capabilities) values ('${U(9)}', '${PL}', '{}'), ('${U(4)}', '${PL}', '{}'), ('${U(4)}', '${KSA}', '{}')`);
const client = asDb(5, `select crm_create_organisation_profile(p_name => 'Fictional Chat Client', p_roles => '{client}', p_country_code => 'AE', p_company_id => '${UAE}')`);
const enquiry = asDb(5, `select crm_create_opportunity(p_company_id => '${UAE}', p_title => 'Fictional Secret Stand', p_source => 'agency_call', p_next_title => 'Call', p_next_due => now() + interval '2 days', p_client_org_id => '${client}')`);
const mgrName = name(4);

const emp = await newPage(browser, { width: 1280, height: 900 }, "light"); await login(emp, "emp@e2e.local");
const mgr = await newPage(browser, { width: 1280, height: 900 }, "light"); await login(mgr, "mgr@e2e.local");
const pol = await newPage(browser, { width: 1280, height: 900 }, "light"); await login(pol, "pol.worker@e2e.local");
const hr = await newPage(browser, { width: 1280, height: 900 }, "light"); await login(hr, "hr@e2e.local");
const go = (p, path = "/sales/follow-ups") => p.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
const openPanel = async (p) => { await p.getByTestId("chat-launcher").click(); await p.getByTestId("chat-panel").waitFor(); };
const groupKeys = async (p) => (await p.locator('[data-testid^="chat-group-sales_"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid").replace("chat-group-", ""))));
const total = async (p) => ((await p.getByTestId("chat-total-unread").count()) ? flat(await p.getByTestId("chat-total-unread").innerText()) : "0");
const send = async (p, groupKey, text, { mention } = {}) => {
  await p.getByTestId(`chat-group-${groupKey}`).click();
  const box = p.getByRole("textbox", { name: /^Message Sales/ });
  await box.waitFor();
  if (mention) {
    await box.pressSequentially(`Hello @${mention.slice(0, 2)}`);
    await p.getByTestId("chat-mention-list").getByRole("option", { name: new RegExp(mention) }).click();
    await box.pressSequentially(text);
  } else await box.pressSequentially(text);
  await p.getByRole("button", { name: "Send message" }).click();
  await p.getByTestId("chat-messages").getByText(text).first().waitFor();
};

await step("WHO SEES WHAT: one company -> one group; three companies -> three groups; no Sales access -> no button and the database refuses the history and the list", async () => {
  page = emp; await go(emp); await openPanel(emp);
  eq((await groupKeys(emp)).join(","), "sales_uae", "the single-company person's groups");
  page = mgr; await go(mgr); await openPanel(mgr);
  eq((await groupKeys(mgr)).join(","), "sales_uae,sales_ksa,sales_europe", "the three-company person's groups");
  const names = flat(await mgr.getByTestId("chat-group-list").innerText());
  for (const n of ["Sales — UAE", "Sales — KSA", "Sales — Europe"]) if (!names.includes(n)) throw new Error(`group ${n} is not listed: ${names}`);
  page = hr; await go(hr);
  eq(await hr.getByTestId("chat-launcher").count(), 0, "a Chat button for a person with no Sales access");
  const uaeGroup = sql(`select id from chat_groups where key = 'sales_uae'`);
  const list = asDbTry(2, `select count(*) from chat_my_groups()`);
  if (!list.ok || list.out.trim() !== "0") throw new Error(`the person with no Sales access got groups: ${list.out}`);
  const hist = asDbTry(2, `select chat_messages('${uaeGroup}')`);
  if (hist.ok) throw new Error("the person with no Sales access could read a group's history");
  const post = asDbTry(2, `select chat_post('${uaeGroup}', 'hi')`);
  if (post.ok) throw new Error("the person with no Sales access could post");
  if (!/not a member/i.test(hist.out)) throw new Error(`unexpected refusal: ${hist.out.slice(0, 160)}`);
});

await step("UNREAD AND MENTION: an @mention raises the button total and the group's own count; opening the group clears them; the other groups stay at zero", async () => {
  page = mgr; await go(mgr);                                       // mgr is on a page with no unread yet
  eq(await total(mgr), "0", "mgr's total before the message");
  page = emp;
  await send(emp, "sales_uae", " welcome to the team", { mention: mgrName });
  await emp.getByTestId("chat-mention-list").waitFor({ state: "detached" }).catch(() => {});
  // the mention was stored: mgr's own database view counts it for that group only
  eq(sql(`select count(*) from chat_message_mentions where user_id = '${U(4)}'`), 1, "stored mentions of mgr");
  page = mgr; await go(mgr);                                       // a reload (the panel also refreshes on its own every 30 s)
  eq(await total(mgr), "1", "mgr's total unread on the button");
  await openPanel(mgr);
  eq(flat(await mgr.getByTestId("chat-group-sales_uae").getByTestId("chat-group-unread").innerText()), "1", "the UAE group's unread");
  eq(await mgr.getByTestId("chat-group-sales_uae").getByTestId("chat-group-mention").count(), 1, "the mention marker on the UAE group");
  eq(await mgr.getByTestId("chat-group-sales_ksa").getByTestId("chat-group-unread").count(), 0, "unread on the KSA group");
  await mgr.getByTestId("chat-group-sales_uae").click();
  await mgr.getByTestId("chat-mention-me").first().waitFor();
  if (!(await mgr.getByTestId("chat-new-divider").count())) throw new Error("no 'New messages' line before the unread message");
  await mgr.getByRole("button", { name: "Back to groups" }).click();
  await mgr.getByTestId("chat-group-sales_uae").waitFor();
  await mgr.waitForFunction(() => !document.querySelector('[data-testid="chat-total-unread"]'), null, { timeout: 15000 });
  eq(await total(mgr), "0", "total after reading");
});

await step("A SHARED ITEM THE READER CANNOT OPEN: the Poland-only reader sees only 'Restricted item'; a reader with access sees the title and a link", async () => {
  page = mgr; await go(mgr); await openPanel(mgr);
  await mgr.getByTestId("chat-group-sales_europe").click();
  await mgr.getByTestId("chat-share-button").click();
  await mgr.getByTestId("chat-share-picker").waitFor();
  const search = mgr.getByRole("combobox", { name: "Search" });
  await search.click(); await search.pressSequentially("Secret");
  await mgr.getByRole("option", { name: /Fictional Secret Stand/ }).click();
  await mgr.getByTestId("chat-share-chip").waitFor();
  await mgr.getByRole("button", { name: "Send message" }).click();
  await mgr.getByTestId("chat-shared-item").waitFor();
  if (!/Fictional Secret Stand/.test(await mgr.getByTestId("chat-shared-item").innerText())) throw new Error("a reader with access does not see the title");
  eq(await mgr.getByTestId("chat-shared-item").getAttribute("href"), `/sales/opportunities/${enquiry}`, "the link a reader with access gets");
  // the Poland-only reader
  page = pol; await go(pol); await openPanel(pol);
  eq((await groupKeys(pol)).join(","), "sales_europe", "the Poland-only person's groups");
  await pol.getByTestId("chat-group-sales_europe").click();
  await pol.getByTestId("chat-restricted").waitFor();
  const text = flat(await pol.getByTestId("chat-panel").innerText());
  if (!/Restricted item/.test(text)) throw new Error("no 'Restricted item' placeholder");
  if (/Secret Stand|OPP-|UAE-/i.test(text)) throw new Error(`the restricted item leaked into the panel: ${text.slice(0, 300)}`);
  eq(await pol.getByTestId("chat-shared-item").count(), 0, "a link to the restricted item");
  // nothing of the item in what the server returned to the Poland-only person (group preview included)
  const europeId = sql(`select id from chat_groups where key = 'sales_europe'`);   // the signed-in role cannot read the tables, only call the functions
  const payload = asDb(9, `select chat_messages('${europeId}')::text`);
  if (/Secret Stand|crm_|\/sales\/opportunities/.test(payload)) throw new Error(`the server payload for the Poland-only person leaks the item: ${payload.slice(0, 300)}`);
  const preview = asDb(9, `select last_preview from chat_my_groups() where gkey = 'sales_europe'`);
  eq(preview, "Shared an item", "the group preview for the Poland-only person");
});

await step("REVOKING COMPANY ACCESS: the open Europe thread closes, the group leaves the list, its unread no longer counts and its history cannot be read", async () => {
  // mgr has the Europe thread open; the Poland person posts, so mgr has one unread there
  page = mgr; await go(mgr); await openPanel(mgr);
  await mgr.getByTestId("chat-group-sales_europe").click();
  await mgr.getByRole("textbox", { name: /^Message Sales — Europe/ }).waitFor();
  page = pol;
  await pol.getByRole("textbox", { name: /^Message Sales — Europe/ }).pressSequentially("Anyone from the Europe team there?");
  await pol.getByRole("button", { name: "Send message" }).click();
  await pol.getByTestId("chat-messages").getByText("Anyone from the Europe team there?").first().waitFor();
  // a second tab for mgr that is NOT looking at Europe sees the unread there
  const mgr2 = await newPage(browser, { width: 1280, height: 900 }, "light"); await login(mgr2, "mgr@e2e.local");
  await go(mgr2);
  eq(await total(mgr2), "1", "mgr's total with one unread in Europe");
  // revoke mgr's Poland access (People & Access removes the Sales grant for that company)
  sql(`update crm_company_grants set revoked_at = now() where user_id = '${U(4)}' and company_id = '${PL}'`);
  page = mgr;
  // the open thread notices on its next poll (or the group list refresh does first): either way the person is told and the group is gone
  await mgr.locator('[data-testid="chat-gone"], [data-testid="chat-notice"]').first().waitFor({ timeout: 40000 });
  if (await mgr.getByTestId("chat-gone").count()) await mgr.getByRole("button", { name: "Back to groups" }).click();
  await mgr.getByTestId("chat-group-sales_uae").waitFor();
  eq((await groupKeys(mgr)).join(","), "sales_uae,sales_ksa", "the groups after revoking Poland");
  await go(mgr2);
  eq(await total(mgr2), "0", "mgr's total unread after revoking Poland (the Europe unread no longer counts)");
  await mgr2.close();
  const europe = sql(`select id from chat_groups where key = 'sales_europe'`);
  const hist = asDbTry(4, `select chat_messages('${europe}')`);
  if (hist.ok) throw new Error("the history of a group they lost access to can still be read");
  const posted = asDbTry(4, `select chat_post('${europe}', 'still here?')`);
  if (posted.ok) throw new Error("they can still post to a group they lost access to");
  const rows = asDb(4, `select count(*) from chat_my_groups() where gkey = 'sales_europe'`);
  eq(rows, "0", "the Europe group in their list");
  const pollerStillSees = asDb(9, `select count(*) from chat_my_groups() where gkey = 'sales_europe'`);
  eq(pollerStillSees, "1", "the Poland-only person still has the group");
});

for (const p of [emp, mgr, pol, hr]) await p.context().close();
await browser.close();
console.log(fails ? `\n${fails} check(s) FAILED` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
