// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("next/link", () => ({ default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...(rest as Record<string, unknown>)}>{children}</a> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/projects/p1/delivery", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/actions/projectsPhase2", () => ({
  saveTaskOutput: vi.fn(), submitTaskOutput: vi.fn(), decideTaskOutput: vi.fn(), linkFeedbackToOutput: vi.fn(), saveSiteActivity: vi.fn(), addSiteActivities: vi.fn(), setSiteCrew: vi.fn(), saveShipment: vi.fn(), removeShipment: vi.fn(),
}));
vi.mock("@/lib/actions/projectsFiles", () => ({ prepareProjectUpload: vi.fn(), finalizeProjectUpload: vi.fn(), getProjectFileUrl: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/actions/projectsDeliveryPlan", () => ({
  saveDeliverable: vi.fn(), removeDeliverable: vi.fn(), savePlanLine: vi.fn(), removePlanLine: vi.fn(), delegatePlanSection: vi.fn(), releaseDeliveryPlan: vi.fn(), raisePlanCorrection: vi.fn(), decidePlanCorrection: vi.fn(),
  decidePlanChange: vi.fn(), addPlanSequence: vi.fn(), seedPlanScope: vi.fn(), reconcilePlanTask: vi.fn(), addPlanLines: vi.fn(), reorderPlanLines: vi.fn(),
}));
import { RegisterView, TaskOutputSection } from "./deliverables/output-views";
import { SiteSchedulePanel, SiteTimelineStrip } from "./site/site-views";
import { WorkOverviewAreas } from "./work-overview";
import type { OutputVersion, RegisterRow, SiteActivity, SiteSchedule, SiteShipment, WorkOverview } from "@/lib/projects/phase2/model";

HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.removeAttribute("open"); };
afterEach(cleanup);

const ver = (o: Partial<OutputVersion> = {}): OutputVersion => ({ id: "v1", version_no: 1, status: "awaiting", item_count: 1, mutable_link: false, note: null, submitted_by: "u", submitted_by_name: "Fictional Cara", attached_at: "2027-11-10T06:05:00Z",
  decided_at: null, decided_by_name: null, decision_note: null, approved_at: null, approved_by_name: null, file: { id: "f", accessible: true, kind: "link", name: "Storyboard v1", url: "https://docs.example.com/s1" }, snapshot: null, feedback: [], ...o });
const row = (o: Partial<RegisterRow> = {}): RegisterRow => ({ task_id: "t1", task_title: "Storyboard", task_status: "in_progress", task_due: null, blocked: false, requires_review: true, team_id: "tm", assignee_id: "u", assignee_name: "Fictional Cara",
  output_label: "Storyboard", output_qty: 1, output_required: true, activation: { id: "a", key: "D001", title: "Welcome wall" }, milestone: { id: "m", title: "Ready for mockup", status: "open" }, state: "missing", versions_count: 0, current: null, versions: [], ...o });
const flags = { canDefine: true, canSubmit: true, viewerIsAssignee: true, canReview: false, readOnly: false };

describe("task output section", () => {
  it("shows what is expected and what is missing next to the action, with the buttons that apply", () => {
    render(<TaskOutputSection projectId="p1" task={{ id: "t1", version: 3, status: "in_progress" }} row={row()} tz="Asia/Dubai" files={[]} flags={flags} />);
    const s = screen.getByTestId("task-output");
    expect(within(s).getByText("Required")).toBeTruthy();
    expect(within(s).getByText("Missing")).toBeTruthy();
    expect(screen.getByTestId("task-output-next").textContent).toMatch(/Add the expected output: Storyboard\. The task cannot be sent for review or completed without it\./);
    expect(within(s).getByRole("button", { name: "Submit output" })).toBeTruthy();
    expect(within(s).getByRole("button", { name: "Edit expected output" })).toBeTruthy();
    expect(within(s).queryByRole("button", { name: "Review" })).toBeNull();
  });

  it("v1 changes requested then v2 awaiting: each version keeps its own review and both times, in the project's time zone, named", () => {
    const v1 = ver({ id: "v1", version_no: 1, status: "changes_requested", decided_at: "2027-11-10T09:00:00Z", decided_by_name: "Fictional Eli", decision_note: "Too dark" });
    const v2 = ver({ id: "v2", version_no: 2, status: "awaiting", attached_at: "2027-11-11T05:00:00Z", file: { id: "f2", accessible: true, kind: "link", name: "Storyboard v2", url: "https://docs.example.com/s2" } });
    render(<TaskOutputSection projectId="p1" task={{ id: "t1", version: 3, status: "ready_for_review" }} row={row({ state: "awaiting_review", current: v2, versions: [v2, v1], versions_count: 2 })} tz="Asia/Dubai"
      files={[]} flags={{ ...flags, viewerIsAssignee: false, canReview: true, canSubmit: false }} />);
    expect(screen.getAllByTestId("output-attached-at")[0]!.textContent).toBe("11 Nov 2027, 09:00 Asia/Dubai");          // the current version first, then the history
    expect(screen.getByRole("button", { name: "Review" })).toBeTruthy();                                              // reviews the CURRENT version
    expect(screen.getByTestId("task-output-next").textContent).toBe("Version 2 is waiting for your review.");
    const h = screen.getByTestId("output-history-t1");
    expect(within(h).getByTestId("output-version-1").textContent).toMatch(/Changes requested.*Too dark/s);
    expect(within(h).getByTestId("output-version-2").textContent).toMatch(/Awaiting review/);
    expect(within(h).getByTestId("output-version-1").textContent).toMatch(/Changes requested: 10 Nov 2027, 13:00 Asia\/Dubai/);   // the decision time is its own time
  });

  it("approval time is separate from the attachment time; a mutable link is called out; a restricted file shows no name or link; read-only draws no buttons", () => {
    const approved = ver({ version_no: 2, status: "approved", approved_at: "2027-11-12T08:30:00Z", approved_by_name: "Fictional Eli", decided_at: "2027-11-12T08:30:00Z", mutable_link: true });
    const { rerender } = render(<TaskOutputSection projectId="p1" task={{ id: "t1", version: 3, status: "done" }} row={row({ state: "approved", current: approved, versions: [approved], versions_count: 1 })} tz="Asia/Dubai" files={null} flags={{ ...flags, readOnly: true }} />);
    expect(screen.getAllByTestId("output-attached-at")[0]!.textContent).toBe("10 Nov 2027, 10:05 Asia/Dubai");
    expect(screen.getAllByTestId("output-approved-at")[0]!.textContent).toBe("12 Nov 2027, 12:30 Asia/Dubai");
    expect(screen.getAllByTestId("output-mutable-note")[0]!.textContent).toMatch(/document that can change after approval/);
    expect(screen.queryByRole("button", { name: /Submit|Review|Edit expected/ })).toBeNull();
    const secret = ver({ file: { id: null, accessible: false, restricted: true } });
    rerender(<TaskOutputSection projectId="p1" task={{ id: "t1", version: 3, status: "in_progress" }} row={row({ state: "awaiting_review", current: secret, versions: [secret], versions_count: 1 })} tz={null} files={null} flags={flags} />);
    expect(screen.getByTestId("output-file-restricted").textContent).toBe("Restricted file (the Project Manager can open it)");
    expect(document.body.textContent).not.toContain("docs.example.com");
    expect(screen.getAllByTestId("output-attached-at")[0]!.textContent).toBe("10 Nov 2027, 06:05 UTC (project time zone not set)");   // an explicit fallback, never a bare time
  });

  it("with no expected output only someone who may define one is offered the button", () => {
    render(<TaskOutputSection projectId="p1" task={{ id: "t1", version: 1, status: "todo" }} row={null} tz="Asia/Dubai" files={null} flags={flags} />);
    expect(screen.getByRole("button", { name: "Set expected output" })).toBeTruthy();
    cleanup();
    const { container } = render(<TaskOutputSection projectId="p1" task={{ id: "t1", version: 1, status: "todo" }} row={null} tz="Asia/Dubai" files={null} flags={{ ...flags, canDefine: false }} />);
    expect(container.textContent).toBe("");
  });
});

describe("deliverables register", () => {
  const rows = [row({ task_id: "a", state: "approved", current: ver({ status: "approved", approved_at: "2027-11-12T08:30:00Z" }) }), row({ task_id: "b", state: "missing", activation: null, output_label: "Video" })];
  const reg = { tz: "Asia/Dubai", rows };
  it("groups by activation, counts the filters, links to the task and to the export, and offers a version history only where there is one", () => {
    render(<RegisterView projectId="p1" register={reg} filter="all" rows={rows} isReviewer={() => false} feedback={[]} activations={[]} hrefFor={(f) => `/x?f=${f}`} />);
    expect(screen.getByTestId("deliverables-group-D001")).toBeTruthy();
    expect(screen.getByTestId("deliverables-group-—").textContent).toMatch(/Not part of an activation/);
    expect(screen.getByTestId("deliverables-filter-missing").textContent).toBe("Missing1");
    expect(screen.getByTestId("deliverables-filter-approved").textContent).toBe("Approved1");
    expect(screen.getByTestId("deliverables-filter-changes").getAttribute("href")).toBe("/x?f=changes");
    expect(screen.getByTestId("deliverables-export").getAttribute("href")).toBe("/api/projects/p1/deliverables/export");
    expect(within(screen.getByTestId("deliverable-a")).getByRole("link", { name: "Storyboard" }).getAttribute("href")).toBe("/projects/p1/work?task=a");
    expect(screen.getAllByTestId("output-approved-at").length).toBeGreaterThan(0);
  });
  it("says so when there is nothing yet, or nothing matches the filter", () => {
    render(<RegisterView projectId="p1" register={{ tz: null, rows: [] }} filter="all" rows={[]} isReviewer={() => false} feedback={[]} activations={[]} hrefFor={() => "/x"} />);
    expect(screen.getByText("No expected outputs yet")).toBeTruthy();
    cleanup();
    render(<RegisterView projectId="p1" register={reg} filter="changes" rows={[]} isReviewer={() => false} feedback={[]} activations={[]} hrefFor={() => "/x"} />);
    expect(screen.getByText("Nothing matches this filter.")).toBeTruthy();
  });
});

const act = (o: Partial<SiteActivity> = {}): SiteActivity => ({ id: "a1", title: "Setup (run 1)", kind: "setup", run_label: "Run 1", location: "Hall 3", status: "planned", owner_id: "o", owner_name: "Fictional Eli", state: "confirmed", confirmed_at: "2027-11-01T00:00:00Z",
  start_date: null, end_date: null, starts_at: "2027-11-11T05:00:00Z", ends_at: "2027-11-11T14:00:00Z", tz: "Asia/Dubai", notes: null, version: 1, milestone_id: null, client_facing: false, crew: [{ user_id: "c1", name: "Fictional Cara", role: "installation" }], missing: [], ...o });
const ship = (o: Partial<SiteShipment> = {}): SiteShipment => ({ id: "s1", label: "Equipment from Mumbai", plan_item_id: "a1", activity_title: "Setup (run 1)", carrier: "Fictional Freight", reference: "FF-1042", notes: null, state: "tentative", version: 1,
  departs_at: "2027-11-09T02:30:00Z", departs_tz: "Asia/Kolkata", arrives_at: "2027-11-11T11:00:00Z", arrives_tz: "Asia/Dubai", returns_at: null, returns_tz: "Asia/Dubai", request: { id: "r1", code: "EQ-1", state: "reserved", needed_from: null, needed_until: null },
  missing: [], conflict: { type: "late", setup_title: "Setup (run 1)", setup_start: "2027-11-11T05:00:00Z", setup_has_time: true }, ...o });
const RAF: SiteSchedule = { tz: "Asia/Dubai", committed: { install_start: "2027-11-11", event_start: "2027-11-12", event_end: "2027-11-15" }, shipments: [ship()], activities: [
  act(), act({ id: "a2", title: "Show (run 1)", kind: "show", starts_at: null, ends_at: null, start_date: "2027-11-12", end_date: "2027-11-12", crew: [], missing: ["time", "crew"] }),
  act({ id: "a3", title: "Dismantling (run 1)", kind: "dismantling", state: "tentative", starts_at: "2027-11-12T16:00:00Z", ends_at: "2027-11-12T19:30:00Z" }),
  act({ id: "a4", title: "Setup (run 2)", run_label: "Run 2", state: "tentative", starts_at: null, ends_at: null, start_date: "2027-11-13", end_date: "2027-11-13", crew: [], missing: ["time", "crew"] }),
  act({ id: "a5", title: "Show (run 2)", kind: "show", run_label: "Run 2", state: "tentative", starts_at: null, ends_at: null, start_date: "2027-11-14", end_date: "2027-11-15", missing: ["time"] })] };

describe("site schedule (RAF)", () => {
  it("shows both runs clearly and separately, exact dates and times with the zone, state, owner, crew and what is missing with a direct fix", () => {
    render(<SiteSchedulePanel projectId="p1" schedule={RAF} canEdit members={[{ id: "u", name: "Fictional Cara" }]} requests={[]} />);
    const r1 = screen.getByTestId("site-run-Run 1"), r2 = screen.getByTestId("site-run-Run 2");
    expect(within(r1).getAllByRole("listitem").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByTestId("site-when-a1").textContent).toBe("11 Nov, 09:00–18:00 Asia/Dubai");
    expect(screen.getByTestId("site-when-a3").textContent).toBe("12 Nov, 20:00–23:30 Asia/Dubai");
    expect(screen.getByTestId("site-when-a4").textContent).toBe("13 Nov (time to confirm)");
    expect(screen.getByTestId("site-when-a5").textContent).toBe("14–15 Nov (time to confirm)");
    expect(within(r2).getByText("Setup (run 2)")).toBeTruthy();
    expect(within(r1).queryByText("Setup (run 2)")).toBeNull();                                                      // run 2 is not drawn under run 1
    expect(screen.getByTestId("site-vs-plan").textContent).toMatch(/Site schedule.*work schedule.*two runs are two separate records/);
    expect(screen.getByTestId("site-crew-text-a1").textContent).toBe("Installation: Fictional Cara");
    const miss = screen.getByTestId("site-missing-a4");
    expect(miss.textContent).toMatch(/Time to confirm/); expect(miss.textContent).toMatch(/No crew/);
    expect(within(miss).getByRole("button", { name: "Assign crew" })).toBeTruthy();                                  // a direct way to fix it
    expect(within(miss).getByRole("button", { name: "Add the time" })).toBeTruthy();
    expect(screen.queryByTestId("site-committed-note")).toBeNull();                                                  // the first setup is on the committed installation day: nothing to say
    cleanup();
    render(<SiteSchedulePanel projectId="p1" schedule={{ ...RAF, committed: { ...RAF.committed, install_start: "2027-11-10" } }} canEdit members={[]} requests={[]} />);
    expect(screen.getByTestId("site-committed-note").textContent).toMatch(/first setup here starts 11 Nov.*committed installation date is 10 Nov 2027.*Manage project/);
  });
  it("flags the overseas shipment arriving after the setup, with each leg in its own zone and the Inventory state read from the request", () => {
    render(<SiteSchedulePanel projectId="p1" schedule={RAF} canEdit={false} members={[]} requests={[]} />);
    const legs = screen.getByTestId("ship-legs-s1").textContent!;
    expect(legs).toMatch(/Departs 9 Nov, 08:00 Asia\/Kolkata/); expect(legs).toMatch(/Arrives 11 Nov, 15:00 Asia\/Dubai/);
    expect(screen.getByTestId("ship-conflict-s1").textContent).toMatch(/Arrives too late: it arrives after Setup \(run 1\) starts/);
    expect(screen.getByTestId("ship-inventory-s1").textContent).toBe("Reserved");
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();                                               // read-only readers get no editing controls
  });
  it("draws a labelled column per day on a short schedule with the names beside the bars, and exact dates on every row", () => {
    render(<SiteTimelineStrip schedule={RAF} today="2027-11-12" />);
    expect(screen.getByTestId("site-col-2027-11-09")).toBeTruthy(); expect(screen.getByTestId("site-col-2027-11-15")).toBeTruthy();
    expect(screen.getByTestId("site-tl-row-a1").textContent).toMatch(/Setup \(run 1\).*11 Nov, 09:00–18:00 Asia\/Dubai/);
    const bar = screen.getByTestId("site-bar-a5"); expect(bar.getAttribute("data-start")).toBe("2027-11-14"); expect(bar.getAttribute("data-end")).toBe("2027-11-15");
    expect(screen.getByTestId("site-tl-row-s1").textContent).toMatch(/Arrives 11 Nov, 15:00 Asia\/Dubai/);
  });
  it("says what to do on an empty schedule", () => {
    render(<SiteSchedulePanel projectId="p1" schedule={{ ...RAF, activities: [], shipments: [] }} canEdit members={[]} requests={[]} />);
    expect(screen.getByText(/No site activities yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add activity" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});

describe("work overview", () => {
  const o: WorkOverview = { tz: "Asia/Dubai", today: "2027-11-10", next_on_site: act({ id: "n1", title: "Setup soon", state: "tentative" }), recent: [{ at: "2027-11-10T06:05:00Z", actor: "Fictional Eli", entity: "task_output", entity_id: "t1", field: "version", from: null, to: "v2", note: null, title: "Storyboard" }],
    attention: [{ kind: "output_missing", task_id: "t9", title: "Logo", detail: 'Required output "Logo" is missing', who: ["Fictional Cara"] }, { kind: "shipment_conflict", shipment_id: "s1", title: "Late crates", detail: 'Arrives after "Setup" starts', who: ["Fictional Pm"] }] };
  it("shows the next activity, what needs attention with who can act and where to fix it, and recent changes", () => {
    render(<WorkOverviewAreas projectId="p1" overview={o} />);
    expect(screen.getByTestId("overview-next-when").textContent).toBe("11 Nov, 09:00–18:00 Asia/Dubai");
    expect(within(screen.getByTestId("overview-next")).getByText("Tentative")).toBeTruthy();
    const a = screen.getByTestId("attention-output_missing");
    expect(a.textContent).toMatch(/Who can act: Fictional Cara/);
    expect(within(a).getByRole("link", { name: "Logo" }).getAttribute("href")).toBe("/projects/p1/work?task=t9");
    expect(within(screen.getByTestId("attention-shipment_conflict")).getByRole("link", { name: "Late crates" }).getAttribute("href")).toBe("/projects/p1/plan?plan=site&mode=list#ship-s1");
    expect(screen.getByTestId("overview-recent").textContent).toMatch(/Fictional Eli submitted v2 of Storyboard.*10 Nov 2027, 10:05 Asia\/Dubai/);
  });
  it("reads as empty, not as broken, when nothing is recorded", () => {
    render(<WorkOverviewAreas projectId="p1" overview={{ tz: "UTC", today: "2027-11-10", next_on_site: null, attention: [], recent: [] }} />);
    expect(screen.getByTestId("overview-next").textContent).toMatch(/Nothing is recorded on the site schedule yet/);
    expect(screen.getByTestId("overview-attention").textContent).toMatch(/Nothing is waiting/);
    expect(screen.getByTestId("overview-recent").textContent).toMatch(/No new output version/);
  });
});
