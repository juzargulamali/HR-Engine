// Real-browser check: the "Files & client plan" shortcut on Work, as the Project Manager and as a member. LOCAL STACK ONLY; seed first with `seed/budget.sh` (it creates the fictional client
// project "Floor projection delivery" with mgr@ as Project Manager). The link must open THAT project's Files & client plan page (not bounce back), and a person without access must not get it.
import { chromium, newPage, login, BASE, psql as sql } from "./lib.mjs";
const browser = await chromium.launch();
const P = sql(`select id from proj_projects where kind='client' order by created_at limit 1`);
let fails = 0, passes = 0;
const A4 = "00000000-0000-4000-8000-0000000000a4";
const one = (q) => sql(q).split("\n")[0];
// Data the page crashed on: any project with a file or link made "This page couldn't load" (the page read a constant from a client module). Fictional rows: a link, a restricted unnamed link,
// completion evidence, and an issued client timeline with a client-facing site activity.
sql(`insert into proj_files (project_id, kind, purpose, label, url, restricted, uploaded_by) values ('${P}','link','document','Fictional brief','https://docs.example.com/brief',false,'${A4}'), ('${P}','link','other',null,'https://docs.example.com/restricted-x',true,'${A4}'), ('${P}','link','completion_evidence','Fictional evidence','https://docs.example.com/evidence',false,'${A4}')`);
sql(`insert into proj_plan_items (project_id, plan, title, start_date, end_date, client_facing, status, activity_kind, run_label, activity_state, created_by) values ('${P}','site','Fictional client-facing show', current_date+9, current_date+10, true, 'planned', 'show', 'Run 1', 'tentative', '${A4}')`);
console.log("issued:", one(`begin; set local role authenticated; select set_config('request.jwt.claims', jsonb_build_object('sub','${A4}','role','authenticated')::text, true); select proj_issue_plan('${P}', 'FICTIONAL-REF-1', null); commit`));
const step = async (name, fn) => { try { await fn(); passes++; console.log("PASS", name); } catch (e) { fails++; console.log("FAIL", name, "::", String(e.message).split("\n")[0]); } };
for (const [who, label] of [["mgr", "the Project Manager"], ["lead", "a project member"]]) {
  await step(`${label}: the Work shortcut opens this project's Files & client plan and stays there`, async () => {
    const page = await newPage(browser, { width: 1280, height: 900 }, "dark"); await login(page, `${who}@e2e.local`);
    await page.goto(`${BASE}/projects/${P}/work`, { waitUntil: "networkidle" });
    const link = page.getByTestId("work-shortcuts").getByRole("link", { name: /Files & client plan/ });
    if ((await link.count()) !== 1) throw new Error("the shortcut is not on the Work page");
    if ((await link.getAttribute("href")) !== `/projects/${P}/documents`) throw new Error(`wrong target: ${await link.getAttribute("href")}`);
    await link.click();
    await page.waitForURL(`**/projects/${P}/documents`, { timeout: 10000 });
    await page.waitForLoadState("networkidle"); await page.waitForTimeout(1500);
    if (!page.url().endsWith(`/projects/${P}/documents`)) throw new Error(`bounced to ${page.url()}`);
    const txt = await page.locator("main").innerText();
    if (!/Files and links/.test(txt)) throw new Error("the Files page did not render");
    if (!/Fictional brief/.test(txt) || !/Completion evidence/.test(txt)) throw new Error("the files are not listed");
    const restrictedShown = /Restricted/.test(txt);
    if (who === "mgr" && !restrictedShown) throw new Error("the Project Manager cannot see the restricted link");
    if (who !== "mgr" && restrictedShown) throw new Error("a member can see a restricted link");
    if (!/Version 1/.test(txt) || !/FICTIONAL-REF-1/.test(txt)) throw new Error("the issued client timeline is not shown");
    if (who === "mgr" && !(await page.getByRole("button", { name: /Issue|new version/i }).count())) throw new Error("the Project Manager cannot issue a timeline");
    await page.context().close();
  });
}
await step("a person with no access to the project gets neither the shortcut nor the page", async () => {
  const page = await newPage(browser, { width: 1280, height: 900 }, "dark"); await login(page, "emp@e2e.local");
  await page.goto(`${BASE}/projects/${P}/documents`, { waitUntil: "networkidle" });
  if (/Files and links/.test(await page.locator("main").innerText())) throw new Error("the Files page opened for someone without access");
  await page.context().close();
});
console.log(`${passes} passed, ${fails} failed`);
await browser.close();
process.exit(fails ? 1 : 0);
