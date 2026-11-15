// LOCAL STACK ONLY (see README). The five Sales / Operations / Projects handover changes of migrations 20270113000100 to 20270113000500, through the real screens,
// with separate signed-in sessions. It reseeds itself (seed/sales-readiness.sh, then its own fictional rows) and WRITES to the database it drives.
//   node os-shell-checks/sales-ops-handover-gaps-flow.mjs        SHOTS_DIR=<folder> SHOT_PREFIX=pr2- for screenshots (2x)
//
//   1. Handover: emp@ reviews the agency, chooses the site contact and submits; lead@ (Operations Manager) names the Project Manager; mgr@ accepts; the project shows
//      the accepted agency, contact and notes to mgr@; hr@ (a project member) sees the agency and the notes but no contact; hr1@ (summary only) sees none of it;
//      the contact edited in Sales afterwards does not change the project; a direct job reads as that.
//   2. Operations question: lead@ asks; emp@ gets ONE notice on Follow-ups and My Day that opens the question itself; the same question again adds none; answering clears it.
//   3. Outreach: emp@ chooses the outreach's contact, Create enquiry carries account, contact and the Outreach source; a second attempt from the stale form opens the first.
//   4. A retried save: the answer to the first save is dropped on the way back; pressing Save again opens the SAME enquiry and says it was already saved.
//   5. Time zone: ceo@ sets the Polish company to Europe/Warsaw; a deadline typed there is saved on the Warsaw clock and shown with its place on the enquiry, on
//      Follow-ups (next to a Dubai company's row) and on My Day.
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BASE, chromium, login, newPage, psql } from "./lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = process.env.SHOTS_DIR ?? null;
const PREFIX = process.env.SHOT_PREFIX ?? "pr2-";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
let failed = 0;
const check = (ok, what, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${what}${ok || !detail ? "" : `  [${detail}]`}`); if (!ok) failed++; };
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${PREFIX}${name}.png`), fullPage: false }); };
const text = async (loc) => ((await loc.textContent()) ?? "").replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------------------------------------------------------------------------------------- seed (fictional)
execSync(`${HERE}/seed/sales-readiness.sh`, { stdio: "ignore", env: process.env });
const UAE = "00000000-0000-4000-8000-00000000a001", PL = "00000000-0000-4000-8000-00000000a002";
const U = (n) => `00000000-0000-4000-8000-0000000000a${n}`;
const [HR1, HR, CEO, MGR, EMP, LEAD] = [U(1), U(2), U(3), U(4), U(5), U(7)];
const as = (user, sql) => psql(`begin; set local role authenticated; select set_config('request.jwt.claims', '{\\"sub\\":\\"${user}\\",\\"role\\":\\"authenticated\\"}', true); ${sql.replace(/"/g, '\\"')}; commit;`).split("\n").filter((l) => l && !/^(BEGIN|SET|COMMIT)$/.test(l)).pop() ?? "";
psql(`update proj_company_grants set capabilities = '{operations}' where user_id = '${LEAD}' and company_id = '${UAE}'`);
psql(`insert into crm_company_grants (user_id, company_id, capabilities) values ('${CEO}', '${PL}', '{founder}'), ('${EMP}', '${PL}', '{}') on conflict do nothing`);
psql(`insert into crm_company_settings (company_id, reference_code, default_quote_currency) values ('${PL}', 'POL', 'PLN') on conflict do nothing`);
const CLIENT = psql(`select id from crm_organisations where name = 'Fictional Harbour Client'`);
const AGENCY = psql(`insert into crm_organisations (name, kind, roles) values ('Fictional Tide Agency', 'agency', '{agency}') returning id`).split("\n")[0];
const contact = (name, phone) => psql(`insert into crm_contacts (organisation_id, name, role_title, email, phone, created_by) values ('${AGENCY}', '${name}', 'Site lead', '${name.toLowerCase().replace(/ /g, ".")}@example.test', '${phone}', '${EMP}') returning id`).split("\n")[0];
const C_SITE = contact("Sara Fictional", "+971 50 000 0001");
const C_TWO = contact("Omar Fictional", "+971 50 000 0002");
const enquiry = (company, title, extra) => as(EMP, `select crm_create_opportunity(p_company_id => '${company}', p_title => '${title}', p_source => 'website', p_next_title => 'Call the client', p_next_due => now() + interval '3 days', ${extra}, p_scope => 'LED wall 6 x 4 m', p_location => 'Dubai')`);
const won = (id) => psql(`update crm_opportunities set stage = 'won', evidence_type = 'purchase_order', evidence_reference = 'PO-LOCAL-1', evidence_date = current_date, closed_at = now(), closed_by = '${EMP}', event_start = current_date + 60, event_end = current_date + 64, install_start = current_date + 55 where id = '${id}'`);
const OPP_AGENCY = enquiry(UAE, "Agency-led stand", `p_agency_org_id => '${AGENCY}', p_client_org_id => '${CLIENT}'`);
psql(`insert into crm_opportunity_contacts (opportunity_id, contact_id, company_id, role) values ('${OPP_AGENCY}', '${C_SITE}', '${UAE}', 'Site'), ('${OPP_AGENCY}', '${C_TWO}', '${UAE}', 'Buyer')`);
won(OPP_AGENCY);
const OPP_DIRECT = enquiry(UAE, "Direct stand", `p_client_org_id => '${CLIENT}'`);
won(OPP_DIRECT);
const OPP_ASK = enquiry(UAE, "Flagged for planning", `p_client_org_id => '${CLIENT}'`);
as(EMP, `select crm_set_ops_planning('${OPP_ASK}', true, '{}'::jsonb, null)`);
const OPP_PL = enquiry(PL, "Warsaw stand", `p_client_org_id => '${CLIENT}'`);
as(CEO, `select crm_assign_outreach('${UAE}', array['${AGENCY}'::uuid], '${EMP}', current_date + 7, 'Spring programme')`);
const OUTREACH = psql(`select id from crm_outreach where organisation_id = '${AGENCY}' and company_id = '${UAE}'`);

const browser = await chromium.launch();
const session = async (email, viewport = { width: 1440, height: 900 }) => { const p = await newPage(browser, viewport, "light", { deviceScaleFactor: 2 }); await login(p, email); return p; };
const emp = await session("emp@e2e.local");
const lead = await session("lead@e2e.local");
const mgr = await session("mgr@e2e.local");
const ceo = await session("ceo@e2e.local");

try {
  // ============================================================================================================================ 1. Handover
  console.log("\n# 1. Handover: agency, site contact and notes reach the project");
  await emp.goto(`${BASE}/sales/opportunities/${OPP_AGENCY}/handover`);
  check(/Fictional Tide Agency/.test(await text(emp.getByTestId("handover-agency"))), "the brief form shows the enquiry's agency, read-only");
  const transfers = await text(emp.getByTestId("handover-transfers"));
  check(/Client\s*Fictional Harbour Client \(from the enquiry\)/.test(transfers), "Ready block names the client the brief will take (not a generic phrase)", transfers.slice(0, 200));
  check(/Agency\s*Fictional Tide Agency/.test(transfers) && /Site contact\s*None chosen/.test(transfers), "Ready block lists the agency and that no site contact is chosen yet");
  const options = await emp.getByLabel("Site contact").locator("option").allInnerTexts();
  check(options.length === 3 && options[0] === "No site contact" && options.some((o) => /Sara Fictional/.test(o)), "the site contact is chosen from the enquiry's own contacts", options.join(" | "));
  await emp.getByLabel("Site contact").selectOption(C_SITE);
  await emp.getByLabel("Notes for the Project Manager").fill("Loading bay B. Call the site lead before unloading.");
  await shot(emp, "01-handover-brief-form");
  await emp.getByRole("button", { name: "Save and submit" }).click();
  await emp.getByTestId("handover-next").getByText(/Submitted\./).waitFor({ timeout: 20000 });
  const submitted = await text(emp.getByTestId("handover-transfers"));
  check(/Site contact\s*Sara Fictional, Site lead/.test(submitted) && /Notes for the Project Manager\s*Loading bay B/.test(submitted), "after submitting: the contact and the notes are in What transfers", submitted.slice(0, 300));
  check(/Sara Fictional/.test(await text(emp.getByTestId("brief-site-contact").first())), "the brief preview shows the site contact as the Project Manager will see it");
  await shot(emp, "02-handover-submitted");
  check(psql(`select job_type || '|' || agency_name from proj_handovers where crm_opportunity_id = '${OPP_AGENCY}'`) === "agency|Fictional Tide Agency", "database: the brief records agency-led and the agency's name");

  // the direct job, no contact chosen
  await emp.goto(`${BASE}/sales/opportunities/${OPP_DIRECT}/handover`);
  check(/None: a direct job/.test(await text(emp.getByTestId("handover-agency"))), "a direct job says so on the form");
  await emp.getByRole("button", { name: "Save and submit" }).click();
  await emp.getByTestId("handover-next").getByText(/Submitted\./).waitFor({ timeout: 20000 });

  // Operations Manager names the Project Manager (through the screen)
  for (const opp of [OPP_AGENCY, OPP_DIRECT]) {
    const h = psql(`select id from proj_handovers where crm_opportunity_id = '${opp}'`);
    await lead.goto(`${BASE}/projects/handovers?handover=${h}`);
    const panel = lead.getByTestId("handover-opened");
    if (opp === OPP_AGENCY) {
      check(/Fictional Tide Agency/.test(await text(panel.getByTestId("brief-agency"))) && /\+971 50 000 0001/.test(await text(panel.getByTestId("brief-site-contact"))), "the Operations Manager reads the agency and the site contact on the brief");
      await shot(lead, "03-ops-brief-with-contact");
    }
    await panel.getByLabel("Project Manager").selectOption(MGR);
    await panel.getByRole("button", { name: "Assign Project Manager" }).click();
    await lead.waitForFunction((id) => !document.querySelector(`[data-testid="handover-opened"] button[type=submit]`)?.textContent?.includes("Assign Project Manager"), h, { timeout: 20000 }).catch(() => null);
    check(psql(`select status from proj_handovers where id = '${h}'`) === "pm_assigned", `the Operations Manager named the Project Manager (${opp === OPP_AGENCY ? "agency-led" : "direct"} job)`);
  }

  // the Project Manager accepts: double click, then the project
  const H_AGENCY = psql(`select id from proj_handovers where crm_opportunity_id = '${OPP_AGENCY}'`);
  await mgr.goto(`${BASE}/projects/handovers?handover=${H_AGENCY}`);
  check(/Sara Fictional/.test(await text(mgr.getByTestId("handover-opened").getByTestId("brief-site-contact"))), "the named Project Manager reads the site contact before accepting");
  await mgr.getByTestId("handover-opened").getByRole("button", { name: "Accept handover" }).dblclick();
  await mgr.waitForURL(/\/projects\/[0-9a-f-]{36}\/delivery/, { timeout: 30000 });
  const PROJECT = psql(`select project_id from proj_handovers where id = '${H_AGENCY}'`);
  check(psql(`select count(*) from proj_projects where crm_opportunity_id = '${OPP_AGENCY}'`) === "1", "a double click on Accept creates exactly one project");
  await mgr.goto(`${BASE}/projects/${PROJECT}/work`);
  const parties = mgr.getByTestId("project-handover-parties");
  await parties.waitFor({ timeout: 20000 });
  const pmSees = await text(parties);
  check(/Fictional Tide Agency/.test(pmSees) && /Sara Fictional/.test(pmSees) && /\+971 50 000 0001/.test(pmSees) && /sara\.fictional@example\.test/.test(pmSees) && /Loading bay B/.test(pmSees), "Project Manager: the project shows the accepted agency, contact (phone, e-mail) and notes", pmSees.slice(0, 260));
  await parties.scrollIntoViewIfNeeded();
  await shot(mgr, "04-project-details-pm");

  // edited and removed in Sales afterwards: the project keeps the accepted copy
  psql(`update crm_contacts set phone = 'CHANGED-AFTER', name = 'Sara Renamed' where id = '${C_SITE}'`);
  psql(`delete from crm_opportunity_contacts where opportunity_id = '${OPP_AGENCY}' and contact_id = '${C_SITE}'`);
  await mgr.reload();
  const after = await text(mgr.getByTestId("project-handover-parties"));
  check(/Sara Fictional/.test(after) && /\+971 50 000 0001/.test(after) && !/CHANGED-AFTER|Sara Renamed/.test(after), "a contact edited and removed in Sales after acceptance does not change the project");

  // a project member who does not manage it; a summary-only person; Sales without a place on the project
  as(MGR, `select proj_add_member('${PROJECT}', '${HR}', null)`);
  const member = await session("hr@e2e.local");
  await member.goto(`${BASE}/projects/${PROJECT}/work`);
  const memberSees = await text(member.getByTestId("project-handover-parties"));
  const memberHtml = await member.content();
  check(/Fictional Tide Agency/.test(memberSees) && /Loading bay B/.test(memberSees) && /Shown to the Project Manager and Operations/.test(memberSees), "project member: agency and notes, and is told who sees the contact", memberSees.slice(0, 200));
  check(!/Sara Fictional|\+971 50 000 0001|sara\.fictional@/.test(memberHtml), "project member: no contact detail anywhere in the page");
  await member.getByTestId("project-handover-parties").scrollIntoViewIfNeeded();
  await shot(member, "05-project-details-member");
  const restricted = await session("hr1@e2e.local");
  await restricted.goto(`${BASE}/projects/${PROJECT}/work`);
  const restrictedHtml = await restricted.content();
  check(!/Fictional Tide Agency|Sara Fictional|Loading bay B|\+971 50 000 0001/.test(restrictedHtml), "summary-only person: none of the agency, contact or notes is in the page");
  await restricted.waitForLoadState("networkidle").catch(() => null);
  await restricted.goto(`${BASE}/projects/${PROJECT}`).catch(() => restricted.goto(`${BASE}/projects/${PROJECT}`));
  check(/Summary/.test(await text(restricted.locator("main"))) && !/Fictional Tide Agency|Sara Fictional/.test(await restricted.content()), "summary-only person: the project still opens as a summary");
  await shot(restricted, "06-project-summary-only");
  const refusal = (() => { try { return as(EMP, `select proj_project_handover('${PROJECT}')`); } catch (e) { return String(e.stderr ?? e.message); } })();
  check(/Project not found/.test(refusal), "Sales owner without a place on the project: the database answers 'Project not found'", refusal.slice(0, 120));
  await emp.goto(`${BASE}/projects/${PROJECT}/work`);
  check(!/Sara Fictional|\+971 50 000 0001|Loading bay B/.test(await emp.content()), "Sales owner without Projects access: nothing of the contact or notes on the project address");

  // the direct job's project
  const H_DIRECT = psql(`select id from proj_handovers where crm_opportunity_id = '${OPP_DIRECT}'`);
  await mgr.goto(`${BASE}/projects/handovers?handover=${H_DIRECT}`);
  await mgr.getByTestId("handover-opened").getByRole("button", { name: "Accept handover" }).click();
  await mgr.waitForURL(/\/projects\/[0-9a-f-]{36}\/delivery/, { timeout: 30000 });
  const P_DIRECT = psql(`select project_id from proj_handovers where id = '${H_DIRECT}'`);
  await mgr.goto(`${BASE}/projects/${P_DIRECT}/work`);
  const direct = await text(mgr.getByTestId("project-handover-parties"));
  check(/None: a direct job/.test(direct) && /None chosen at handover/.test(direct), "direct job, no contact: the project says so", direct.slice(0, 200));

  // a project accepted before the change: the recorded fields removed from one accepted brief, as an earlier handover has them
  psql(`alter table proj_handovers disable trigger user; update proj_handovers set job_type = null, agency_org_id = null, agency_name = null, parties_recorded_at = null where id = '${H_DIRECT}'; alter table proj_handovers enable trigger user`);
  await mgr.reload();
  const old = await text(mgr.getByTestId("project-handover-parties"));
  check((old.match(/Not recorded at handover/g) ?? []).length === 2 && !/direct job/.test(old), "a project accepted before the change opens and says 'Not recorded at handover' twice, never 'direct job'", old.slice(0, 200));
  await mgr.getByTestId("project-handover-parties").scrollIntoViewIfNeeded();
  await shot(mgr, "07-project-not-recorded");

  // ============================================================================================================================ 2. Operations question
  console.log("\n# 2. Operations asks a question: one notice for Sales, opening the question");
  const notices = () => psql(`select count(*) from notifications where type = 'project_ops_question' and payload ->> 'opportunity_id' = '${OPP_ASK}'`);
  const unread = () => psql(`select count(*) from notifications where type = 'project_ops_question' and read_at is null and payload ->> 'opportunity_id' = '${OPP_ASK}'`);
  as(LEAD, `select ops_set_enquiry_planning('${OPP_ASK}', '{"risk":"high"}'::jsonb)`);
  check(notices() === "0", "planning fields without a question send nothing");
  as(LEAD, `select ops_set_enquiry_planning('${OPP_ASK}', '{"question":"Is the power drop confirmed on the left side?"}'::jsonb)`);
  as(LEAD, `select ops_set_enquiry_planning('${OPP_ASK}', '{"question":"Is the power drop confirmed on the left side?","risk":"medium"}'::jsonb)`);
  check(notices() === "1" && psql(`select user_id from notifications where type = 'project_ops_question'`) === EMP, "one notice, to the enquiry's owner; saving the same question again adds none");
  await emp.goto(`${BASE}/sales/follow-ups`);
  const card = emp.getByTestId("ops-questions");
  await card.waitFor({ timeout: 20000 });
  check(/Questions from Operations \(1\)/.test(await text(card)) && /Flagged for planning/.test(await text(card)), "Follow-ups: the card lists the enquiry once");
  await shot(emp, "08-follow-ups-question-card");
  await emp.goto(`${BASE}/`);
  const myDay = emp.locator(`[data-attention-key="opp:${OPP_ASK}"]`);
  check((await myDay.count()) === 1 && /Operations asked a question/.test(await text(myDay)), "My Day: one attention item for the question");
  await shot(emp, "09-my-day-question");
  await emp.goto(`${BASE}/sales/follow-ups`);
  await emp.getByTestId("ops-question-link").click();
  await emp.waitForURL(new RegExp(`/sales/opportunities/${OPP_ASK}\\?tab=overview#ops-question`), { timeout: 20000 });
  const target = emp.locator("#ops-question");
  await target.waitFor({ timeout: 20000 });
  await emp.waitForTimeout(800);
  const inView = await target.evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.top < window.innerHeight; });
  check(inView && /Is the power drop confirmed on the left side\?/.test(await text(target)), "the notice opens the enquiry at the question itself (in view, Overview tab)");
  await shot(emp, "10-enquiry-at-question");
  await target.getByRole("textbox").first().fill("Yes, confirmed on the left by the venue.");
  await target.getByRole("button", { name: "Send answer to Operations" }).click();
  await target.getByText(/Sales answered/).waitFor({ timeout: 20000 });
  check(unread() === "0", "answering clears the notice");
  await emp.goto(`${BASE}/sales/follow-ups`);
  check((await emp.getByTestId("ops-questions").count()) === 0, "Follow-ups: the card is gone after the answer");
  as(LEAD, `select ops_set_enquiry_planning('${OPP_ASK}', '{"question":"And is rigging from the ceiling allowed?"}'::jsonb)`);
  check(notices() === "2" && unread() === "1", "a genuinely new question notifies once more");

  // ============================================================================================================================ 3. Outreach
  console.log("\n# 3. Outreach: a chosen contact, the Outreach source, one enquiry");
  await emp.goto(`${BASE}/sales/accounts/${AGENCY}?company=${UAE}#outreach`);
  const section = emp.locator(`[data-outreach="${OUTREACH}"]`);
  await section.getByLabel("Contact for this outreach").selectOption(C_TWO);
  await section.getByRole("button", { name: "Save contact" }).click();
  await emp.waitForFunction((id) => true, null);
  await emp.waitForTimeout(1500);
  check(psql(`select contact_id from crm_outreach where id = '${OUTREACH}'`) === C_TWO, "the outreach's contact is saved from the account page");
  await shot(emp, "11-outreach-contact");
  const createHref = await section.getByRole("link", { name: "Create enquiry" }).getAttribute("href");
  check(/source=outreach/.test(createHref ?? "") && new RegExp(`contact=${C_TWO}`).test(createHref ?? ""), "Create enquiry carries the contact and the Outreach source", createHref ?? "");
  const stale = await session("emp@e2e.local");
  await stale.goto(`${BASE}${createHref}`);                                                        // a second tab, opened before the first one saves
  await emp.goto(`${BASE}${createHref}`);
  check((await emp.locator("#enq-source").inputValue()) === "outreach", "the form opens with Outreach chosen as the source");
  check(await emp.locator(`input[name=contactIds][value="${C_TWO}"]`).isChecked(), "the chosen contact is ticked on the form");
  check(/Carried over from outreach/.test(await text(emp.getByTestId("enquiry-carried-over"))), "the form says what was carried over (the review step)");
  await emp.getByLabel(/What happens next|Next action/i).first().fill("Send the portfolio").catch(async () => { await emp.locator("input[name=nextTitle]").fill("Send the portfolio"); });
  await shot(emp, "12-enquiry-form-from-outreach");
  const before = Number(psql(`select count(*) from crm_opportunities`));
  await emp.getByRole("button", { name: "Record enquiry" }).click();
  await emp.waitForURL(/\/sales\/opportunities\/[0-9a-f-]{36}$/, { timeout: 30000 });
  const CONVERTED = emp.url().split("/").pop();
  check(psql(`select source from crm_opportunities where id = '${CONVERTED}'`) === "outreach" && psql(`select opportunity_id from crm_outreach where id = '${OUTREACH}'`) === CONVERTED, "the enquiry has the source Outreach and the outreach is linked to it");
  check(psql(`select contact_id from crm_opportunity_contacts where opportunity_id = '${CONVERTED}'`) === C_TWO, "the chosen contact is on the enquiry");
  check(/Outreach/.test(await text(emp.locator("main"))), "the enquiry page shows where it came from");
  // the stale tab: same outreach, a different title
  await stale.locator("input[name=nextTitle]").fill("Second attempt from a stale tab");
  await stale.getByRole("button", { name: "Record enquiry" }).click();
  await stale.getByText(/already has an enquiry, so a second one was not created/).waitFor({ timeout: 20000 });
  check(Number(psql(`select count(*) from crm_opportunities`)) === before + 1, "the stale tab creates nothing");
  const existing = await stale.getByRole("link", { name: "Open the existing enquiry" }).getAttribute("href");
  check(existing === `/sales/opportunities/${CONVERTED}`, "the stale tab is offered the existing enquiry", existing ?? "");
  await shot(stale, "13-outreach-second-attempt");
  await emp.goto(`${BASE}/sales/accounts/${AGENCY}?company=${UAE}#outreach`);
  check(/Enquiry already created/.test(await text(emp.locator(`[data-outreach="${OUTREACH}"]`))) && (await emp.locator(`[data-outreach="${OUTREACH}"]`).getByRole("link", { name: "Create enquiry" }).count()) === 0, "the outreach no longer offers Create enquiry");

  // ============================================================================================================================ 4. Retried save
  console.log("\n# 4. A save whose answer is lost, then tried again");
  const today = psql(`select (now() at time zone 'Asia/Dubai')::date + 2`);
  await emp.goto(`${BASE}/sales/new?company=${UAE}&org=${CLIENT}&title=${encodeURIComponent("Fictional retried save")}&source=website&next=${encodeURIComponent("Call back")}&due=${today}`);
  await emp.locator("input[name=submissionKey]").waitFor({ state: "attached", timeout: 20000 });
  const key = await emp.locator("input[name=submissionKey]").inputValue();
  check(/^[0-9a-f-]{36}$/.test(key), "the form carries a submission identifier made in the browser");
  const count = () => Number(psql(`select count(*) from crm_opportunities where title = 'Fictional retried save'`));
  let dropped = 0;
  await emp.route("**/sales/new**", async (route) => {
    if (route.request().method() !== "POST" || dropped > 0) return route.continue();
    dropped++;
    await route.fetch().catch(() => null);                                                         // the server receives it and saves
    await route.abort("connectionreset");                                                           // the answer never arrives
  });
  await emp.getByRole("button", { name: "Record enquiry" }).click();
  await emp.waitForFunction(() => !document.querySelector("button[type=submit][disabled]"), null, { timeout: 30000 }).catch(() => null);
  await emp.waitForTimeout(1500);
  check(dropped === 1 && count() === 1, "the first save reached the server and the answer was lost (one enquiry exists, the form is still open)", `dropped ${dropped}, enquiries ${count()}`);
  await shot(emp, "14-save-answer-lost");
  if (!/\/sales\/new/.test(emp.url())) check(false, "the form is still on screen after the lost answer", emp.url());
  await emp.getByRole("button", { name: "Record enquiry" }).click();
  await emp.waitForURL(/saved=earlier/, { timeout: 30000 });
  check(count() === 1, "pressing Save again creates no second enquiry");
  check(emp.url().includes(psql(`select id from crm_opportunities where title = 'Fictional retried save'`)), "it opens the ORIGINAL enquiry");
  check(/already saved by your earlier attempt/.test(await text(emp.getByTestId("enquiry-already-saved"))), "and says it was already saved");
  await shot(emp, "15-already-saved");
  await emp.unroute("**/sales/new**");
  // two separate forms with the same details are two enquiries
  for (let i = 0; i < 2; i++) {
    await emp.goto(`${BASE}/sales/new?company=${UAE}&org=${CLIENT}&title=${encodeURIComponent("Fictional twin")}&source=website&next=${encodeURIComponent("Call back")}&due=${today}`);
    await emp.locator("input[name=submissionKey]").waitFor({ state: "attached", timeout: 20000 });
    await emp.getByRole("button", { name: "Record enquiry" }).click();
    await emp.waitForURL(/\/sales\/opportunities\/[0-9a-f-]{36}$/, { timeout: 30000 });
  }
  check(psql(`select count(*) from crm_opportunities where title = 'Fictional twin'`) === "2", "two forms opened separately, identical details: both enquiries are created");

  // ============================================================================================================================ 5. Time zone
  console.log("\n# 5. A company on the Warsaw clock");
  const dueBefore = psql(`select string_agg(id::text || ':' || extract(epoch from due_at)::text, ',' order by id) from crm_follow_ups`);
  await ceo.goto(`${BASE}/sales/settings?company=${PL}#follow-up-time-zone`);
  const zonePanel = ceo.locator("#follow-up-time-zone");
  await zonePanel.getByLabel("Time zone").selectOption("Europe/Warsaw");
  await shot(ceo, "16-settings-time-zone");
  await zonePanel.getByRole("button", { name: "Save time zone" }).click();
  await ceo.waitForTimeout(1500);
  check(psql(`select follow_up_time_zone from crm_company_settings where company_id = '${PL}'`) === "Europe/Warsaw" && psql(`select follow_up_time_zone from crm_company_settings where company_id = '${UAE}'`) === "Asia/Dubai", "the founder sets the Polish company to Europe/Warsaw; the UAE company stays on Asia/Dubai");
  check(psql(`select string_agg(id::text || ':' || extract(epoch from due_at)::text, ',' order by id) from crm_follow_ups`) === dueBefore, "changing the zone moved no existing deadline");
  await emp.goto(`${BASE}/sales/settings?company=${PL}`);
  check(/Europe\/Warsaw \(Warsaw time\)/.test(await text(emp.locator("main"))) && (await emp.getByRole("button", { name: "Save time zone" }).count()) === 0, "a Sales employee reads the zone and cannot change it");
  // a deadline typed on the Warsaw clock
  await emp.goto(`${BASE}/sales/opportunities/${OPP_PL}`);
  await emp.getByRole("button", { name: /Add follow-up|Schedule next action/ }).first().click();
  const dialog = emp.getByRole("dialog");
  await dialog.getByLabel("What needs to happen?").fill("Call the Warsaw client");
  check((await dialog.getByLabel("Time (Warsaw)").count()) === 1, "the time field is labelled with the company's place: Time (Warsaw)");
  await dialog.getByTestId("when-tomorrow").click();
  await dialog.getByLabel("Time (Warsaw)").fill("11:00");
  const preview = await text(dialog.getByTestId("when-result"));
  check(/11:00 \(Warsaw time\)/.test(preview), "the preview names the clock before saving", preview);
  await shot(emp, "17-follow-up-dialog-warsaw");
  await dialog.getByRole("button", { name: "Add follow-up" }).click();
  await emp.waitForTimeout(2000);
  const saved = psql(`select to_char(due_at at time zone 'Europe/Warsaw', 'HH24:MI') || '|' || to_char(due_at at time zone 'Asia/Dubai', 'HH24:MI') from crm_follow_ups where title = 'Call the Warsaw client'`);
  check(/^11:00\|1[34]:00$/.test(saved), "saved on the Warsaw clock: 11:00 in Warsaw (13:00 or 14:00 in Dubai), not 11:00 Dubai", saved);
  await emp.goto(`${BASE}/sales/opportunities/${OPP_PL}`);
  check(/11:00 \(Warsaw\)/.test(await text(emp.locator("main"))), "the enquiry shows the deadline with its place");
  await emp.goto(`${BASE}/sales/follow-ups`);
  await emp.getByText(/\(Warsaw\)/).first().waitFor({ timeout: 20000 }).catch(() => null);
  const list = await text(emp.locator("main"));
  check(/11:00 \(Warsaw\)/.test(list) && /\(Dubai\)/.test(list), "Follow-ups with both companies: the Warsaw row and the Dubai rows each carry their own place");
  await shot(emp, "18-follow-ups-two-zones");
  // due today in Warsaw: move the deadline to a few minutes from now and read My Day
  psql(`update crm_follow_ups set due_at = now() + interval '5 minutes' where title = 'Call the Warsaw client'`);
  await emp.goto(`${BASE}/`);
  await emp.getByText(/Call the Warsaw client/).first().waitFor({ timeout: 20000 }).catch(() => null);
  const day = await text(emp.locator("main"));
  check(/Call the Warsaw client/.test(day) && /\(Warsaw\)/.test(day), "My Day lists the Warsaw follow-up with its place");
  await shot(emp, "19-my-day-warsaw");

  const errors = [...emp.errors, ...mgr.errors, ...lead.errors, ...ceo.errors].filter((e) => !/Failed to load resource|net::ERR|connectionreset|fetch failed|Failed to fetch/i.test(e));
  check(errors.length === 0, "no page errors in the four main sessions", errors.slice(0, 3).join(" || "));
} catch (e) {
  failed++;
  console.log(`FAIL  the flow stopped: ${e.message.split("\n")[0]}`);
  await shot(emp, "zz-stopped-emp"); await shot(mgr, "zz-stopped-mgr"); await shot(lead, "zz-stopped-lead");
} finally {
  await browser.close();
}
console.log(`\n${failed === 0 ? "VERDICT: PASS" : `VERDICT: FAIL (${failed})`}`);
process.exit(failed === 0 ? 0 : 1);
