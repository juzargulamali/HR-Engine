// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { DeliveryPlan, DpItem, DpLine } from "@/lib/projects/delivery-plan/model";

vi.mock("next/link", () => ({ default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...(rest as Record<string, unknown>)}>{children}</a> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/projects/p1/delivery", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/actions/projectsDeliveryPlan", () => ({
  saveDeliverable: vi.fn(), removeDeliverable: vi.fn(), savePlanLine: vi.fn(), removePlanLine: vi.fn(), delegatePlanSection: vi.fn(), releaseDeliveryPlan: vi.fn(),
  raisePlanCorrection: vi.fn(), decidePlanCorrection: vi.fn(), decidePlanChange: vi.fn(), addPlanSequence: vi.fn(), seedPlanScope: vi.fn(), reconcilePlanTask: vi.fn(), addPlanLines: vi.fn(), reorderPlanLines: vi.fn(),
}));
import { DeliveryPlanView, type DeliveryPlanViewProps } from "./delivery-plan-view";

// jsdom has no <dialog> methods: open and close it the plain way so the dialog's contents can be read.
HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.removeAttribute("open"); };
afterEach(cleanup);
const line = (over: Partial<DpLine>): DpLine => ({ id: "l1", key: "L0001", section: "content", description: "Welcome loop video", qty: 3, inv_item_id: null, assignee_id: "content", assignee_name: "Fictional Cara", needed_by: null, notes: null, released_at: null, version: 1, task: null, equipment: null, ...over });
const wall: DpItem = {
  id: "i1", key: "D001", zone: "Entrance", title: "Interactive LED welcome wall", specs: "6 x 4 m, touch", owner_id: "eng", owner_name: "Fictional Eli", needed_by: "2027-03-01", image_file_id: null, released_at: "2026-11-12T08:00:00Z", version: 2, sort_order: 10,
  lines: [
    line({ released_at: "2026-11-12T08:00:00Z", task: { id: "t1", title: "x", status: "in_progress", due_date: "2027-03-01", blocked: false, assignee_name: "Fictional Cara" } }),
    line({ id: "l2", key: "L0002", section: "hardware", description: "LED panels", qty: 48, inv_item_id: "led", assignee_id: null, assignee_name: null, released_at: "2026-11-12T08:00:00Z", equipment: { request_id: "r1", request_code: "EQ-1", request_status: "in_progress", qty: 48, reserved: 48, dispatched: 48, returned: 30 } }),
    line({ id: "l3", key: "L0003", section: "programming", description: "Touch app", qty: null, assignee_id: null, assignee_name: null }),
  ],
};
const kiosk: DpItem = { id: "i2", key: "D002", zone: "Lounge", title: "Product kiosk", specs: null, owner_id: null, owner_name: null, needed_by: null, image_file_id: null, released_at: null, version: 1, sort_order: 20, lines: [] };
const plan = (over: Partial<DeliveryPlan> = {}): DeliveryPlan => ({
  rev: 7, can_manage: false, my_sections: [], delegations: [{ section: "content", user_id: "content", name: "Fictional Cara" }], items: [wall, kiosk],
  corrections: [{ id: "c1", target_type: "line", target_id: "l3", target_label: "L0003 Interactive LED welcome wall: Touch app", body: "Needs an offline mode", raised_by: "tech", raised_by_name: "Fictional Tom", raised_at: "2026-11-12T09:00:00Z", routed_to: "prog", routed_to_name: "Fictional Pru", status: "open", decided_by_name: null, decided_at: null, decision_note: null },
    { id: "c2", target_type: "deliverable", target_id: "i1", target_label: "D001 Interactive LED welcome wall", body: "Wall is 6.5 m on the drawing", raised_by: "tech", raised_by_name: "Fictional Tom", raised_at: "2026-11-11T09:00:00Z", routed_to: "eng", routed_to_name: "Fictional Eli", status: "declined", decided_by_name: "Fictional Eli", decided_at: "2026-11-11T12:00:00Z", decision_note: "Drawing is out of date" }],
  changes: [{ id: "ch1", item_id: null, line_id: "l1", changes: { qty: { from: 3, to: "5" } }, reason: "Client asked", source: "excel", proposed_by: "content", proposed_by_name: "Fictional Cara", proposed_at: "2026-11-12T10:00:00Z", status: "proposed", decided_by_name: null, decided_at: null, decision_note: null }],
  ...over,
});
const props = (p: DeliveryPlan, over: Partial<DeliveryPlanViewProps> = {}): DeliveryPlanViewProps => ({
  projectId: "p1", plan: p, userId: "tech", readOnly: false, statusWord: "completed", members: [{ id: "eng", name: "Fictional Eli" }, { id: "content", name: "Fictional Cara" }],
  stock: [{ id: "led", name: "LED panel P2.6" }], stockFailed: false, images: [], imagesFailed: false, nameOfUser: (u) => u, ...over,
});
const text = () => document.body.textContent ?? "";

describe("Project Plan screen", () => {
  it("an ordinary member reads the whole plan, every section, with progress from the task and the equipment line, and can raise a correction but change nothing", () => {
    render(<DeliveryPlanView {...props(plan())} />);
    expect(text()).toContain("D001 · Interactive LED welcome wall");
    expect(text()).toContain("Accountable owner: Fictional Eli");
    expect(within(screen.getByTestId("dp-line-L0001")).getByText("Task in progress")).toBeTruthy();
    expect(within(screen.getByTestId("dp-line-L0002")).getByText("Sent 48 of 48, 30 returned, 18 still out")).toBeTruthy();     // delivered and returned stay separate
    expect(within(screen.getByTestId("dp-line-L0003")).getByText("Draft: not released")).toBeTruthy();
    expect(screen.getByTestId("dp-line-L0001").querySelector('a[href="/projects/p1/work?task=t1"]')).toBeTruthy();
    expect(screen.getByTestId("dp-line-L0002").querySelector('a[href="/projects/p1/equipment?request=r1"]')).toBeTruthy();
    expect(screen.queryByTestId("dp-add-deliverable")).toBeNull();
    expect(screen.queryByTestId("dp-release")).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add requirement" })).toBeNull();
    expect(screen.queryByRole("link", { name: /Import Excel/ })).toBeNull();
    expect(screen.getByRole("link", { name: /Export Excel/ }).getAttribute("href")).toBe("/api/projects/p1/delivery-plan/export");
    expect(screen.getAllByRole("button", { name: "Correction" }).length).toBe(5);        // two deliverables and three lines
    expect(screen.queryByTestId("dp-delegations")).toBeNull();
    // the person who raised a correction sees it waiting, and sees the decision on the earlier one, with the reason
    expect(within(screen.getByTestId("dp-corrections")).getByText(/Waiting for Fictional Pru/)).toBeTruthy();
    expect(screen.getByTestId("dp-decisions").textContent).toMatch(/Correction declined.*decided by Fictional Eli.*Drawing is out of date/);
    // a proposed change is visible to everyone, decided only by the manager
    expect(screen.getByTestId("dp-proposed").textContent).toMatch(/Quantity: 3 to 5.*from an Excel import.*Waiting for the Project Manager/);
  });

  it("a section's delegate edits only that section's lines and may import; they cannot edit a deliverable row or release", () => {
    render(<DeliveryPlanView {...props(plan({ my_sections: ["content"] }), { userId: "content" })} />);
    expect(within(screen.getByTestId("dp-line-L0001")).getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(within(screen.getByTestId("dp-line-L0002")).queryByRole("button", { name: "Edit" })).toBeNull();
    expect(within(screen.getByTestId("dp-line-L0003")).queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Add requirement" }).length).toBe(2);
    expect(screen.getByRole("link", { name: /Import Excel/ }).getAttribute("href")).toBe("/projects/p1/delivery/import");
    expect(screen.queryByTestId("dp-release")).toBeNull();
    expect(screen.queryByTestId("dp-add-deliverable")).toBeNull();
    expect(screen.getByRole("button", { name: "Withdraw proposal" })).toBeTruthy();       // their own proposal
    // editing a released line says it becomes a proposal before anything is saved
    fireEvent.click(within(screen.getByTestId("dp-line-L0001")).getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("dialog").textContent).toMatch(/already released.*sent to the Project Manager as a proposal/);
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Propose change" })).toBeTruthy();
  });

  it("the Project Manager adds, releases, delegates and decides; release says what it will create and that the equipment request stays a draft", () => {
    render(<DeliveryPlanView {...props(plan({ can_manage: true }), { userId: "pm" })} />);
    expect(screen.getByTestId("dp-add-deliverable")).toBeTruthy();
    expect(screen.getByTestId("dp-release").textContent).toBe("Release plan (1 draft line)");
    expect(screen.getByTestId("dp-delegations")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve change" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Accept correction" })).toBeTruthy();
    fireEvent.click(screen.getByTestId("dp-release"));
    const preview = screen.getByTestId("dp-release-preview").textContent ?? "";
    expect(preview).toMatch(/1 task will be created and assigned/);
    expect(preview).toMatch(/0 hardware lines will be added to the project's draft equipment request\. It is not sent to the warehouse/);
  });

  it("equipment that is with the warehouse cannot be changed from the plan: the form says where to change it and its Save is off", () => {
    render(<DeliveryPlanView {...props(plan({ can_manage: true }), { userId: "pm" })} />);
    fireEvent.click(within(screen.getByTestId("dp-line-L0002")).getByRole("button", { name: "Edit" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toMatch(/already with the warehouse\. Change it on the Equipment tab/);
    expect((within(dialog).getByRole("button", { name: "Propose change" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("a finished project's plan is read-only for everyone, the manager included", () => {
    render(<DeliveryPlanView {...props(plan({ can_manage: true, my_sections: ["content"] }), { readOnly: true })} />);
    expect(text()).toContain("This project is completed. Its delivery plan is read-only.");
    for (const name of ["Edit", "Add requirement", "Correction", "Approve change", "Accept correction"]) expect(screen.queryByRole("button", { name })).toBeNull();
    expect(screen.queryByTestId("dp-release")).toBeNull();
    expect(screen.queryByRole("link", { name: /Import Excel/ })).toBeNull();
  });

  it("an empty plan says what to do; a failed image read says so", () => {
    render(<DeliveryPlanView {...props(plan({ can_manage: true, items: [], corrections: [], changes: [] }), { imagesFailed: true })} />);
    expect(text()).toContain("No technologies or activations yet");
    expect(text()).toMatch(/download the template, fill it in Excel and import it/);
    expect(text()).toContain("Could not load this project's image files");
  });

  describe("Release 1: the working Project Plan", () => {
    const hw = (over: Partial<DpLine>): DpLine => line({ id: "h1", key: "L0010", section: "hardware", description: "Ring light", qty: 2, assignee_id: null, assignee_name: null, notes: "", ...over });
    const photobooth: DpItem = {
      id: "i9", key: "D001", zone: "", title: "Kids photobooth", specs: null, qty: 2, owner_id: "eng", owner_name: "Fictional Eli", needed_by: "2027-04-28", image_file_id: null, released_at: "2026-11-12T08:00:00Z", version: 1, sort_order: 10,
      lines: [
        hw({}),
        hw({ id: "h2", key: "L0011", description: "Booth screen", inv_item_id: "led", notes: "55 in", released_at: "2026-11-12T08:00:00Z", equipment: { request_id: "r1", request_code: "EQ-1", request_status: "draft", qty: 2, reserved: 0, dispatched: 0, returned: 0 } }),
        line({ id: "c1", key: "L0012", description: "Storyboard", released_at: "2026-11-12T08:00:00Z", detail: { deliverable_type: "Storyboard", count: 1, format: "PDF" }, milestone_id: "m1",
          task: { id: "t9", title: "Kids photobooth: Storyboard", status: "in_progress", start_date: "2027-04-04", due_date: "2027-04-10", blocked: true, blocked_reason: "Waiting for the script", unblock_action: "Chase the client", assignee_name: "Fictional Cara", depends_on: [] } }),
        line({ id: "c2", key: "L0013", description: "First draft", assignee_id: null, assignee_name: "Fictional Cara", start_date: "2027-04-08", needed_by: "2027-04-14", milestone_id: "m1", plan_depends_on: [{ line_id: "c1", line_key: "L0012", title: "Storyboard", task_id: "t9", status: "in_progress", due_date: "2027-04-10" }] }),
        line({ id: "a1", key: "L0014", section: "apps", description: "Cartoon photo app", assignee_id: null, assignee_name: null, detail: { app_count: 1, platform: "Android tablet", device_count: 6 } }),
      ],
    };
    const r1 = (over: Partial<DeliveryPlan> = {}) => plan({
      can_manage: true, items: [photobooth], corrections: [], changes: [], delegations: [{ section: "engineering", user_id: "eng", name: "Fictional Eli" }],
      site_dates: { install_start: "2027-05-01", event_start: "2027-05-03", event_end: "2027-05-04" },
      milestones: [{ id: "m1", title: "Ready for mockup", due_date: "2027-04-12", status: "planned", is_required: true,
        tasks: [{ task_id: "t9", title: "Kids photobooth: Storyboard", status: "in_progress", due_date: "2027-04-10", blocked: true, assignee_name: "Fictional Cara", line_key: "L0012", item_key: "D001" }],
        planned: [{ line_id: "c2", line_key: "L0013", title: "Kids photobooth: First draft", item_key: "D001", needed_by: "2027-04-14", assignee_name: "Fictional Cara" }] }],
      ...over,
    });
    const render1 = (p = r1(), over: Partial<DeliveryPlanViewProps> = {}) => render(<DeliveryPlanView {...props(p, { userId: "pm", today: "2027-04-09", ...over })} />);

    it("leads with the next-step summary: the next site date, what needs attention in priority order, and one next action linked to its row", () => {
      render1();
      const s = screen.getByTestId("plan-summary");
      expect(within(s).getByTestId("summary-site").textContent).toMatch(/1 May 2027.*Installation starts/);
      const attention = within(s).getByTestId("summary-attention").textContent ?? "";
      expect(attention).toMatch(/1 · Open blockers/);
      expect(attention).toMatch(/1 · Late dependencies/);
      expect(attention).toMatch(/1 · Hardware to source/);
      expect(attention).toMatch(/1 · Equipment drafts to send/);
      const next = within(within(s).getByTestId("summary-next")).getByRole("link");
      expect(next.textContent).toMatch(/L0012 Storyboard is blocked: Waiting for the script\. Next: Chase the client/);
      expect(next.getAttribute("href")).toBe("/projects/p1/delivery?open=D001#dp-L0012");
    });

    it("shows each requirement's owner, planned start, due date, status and blocker, and the supply route and state of hardware", () => {
      render1();
      const story = screen.getByTestId("dp-line-L0012").textContent ?? "";
      expect(story).toMatch(/Storyboard × PDF|Storyboard · PDF|Storyboard.*PDF/);
      expect(story).toMatch(/Fictional Cara.*starts 4 Apr 2027.*due 10 Apr 2027.*for Ready for mockup/);
      expect(within(screen.getByTestId("dp-attention-L0012")).getByText(/Blocked: Waiting for the script\. Next: Chase the client/)).toBeTruthy();
      expect(within(screen.getByTestId("dp-line-L0013")).getByText(/Late: Storyboard is due 2027-04-10, after this starts on 2027-04-08/)).toBeTruthy();
      expect(within(screen.getByTestId("dp-line-L0010")).getByText("Specification pending")).toBeTruthy();                 // a manual line stays visible with its state
      expect(within(screen.getByTestId("dp-line-L0010")).getByTestId("dp-who-L0010").textContent).toMatch(/^Inventory · /);
      expect(within(screen.getByTestId("dp-line-L0011")).getByRole("link", { name: "Review and send to Warehouse" }).getAttribute("href")).toBe("/projects/p1/equipment?request=r1");
      expect(screen.getByTestId("dp-line-L0014").textContent).toMatch(/1 app · Android tablet · 6 devices/);
    });

    it("an activation shows name, quantity, owner, ready-by and a readiness summary; sections with no lines are not drawn; a delegated section with no input is named", () => {
      render1(r1({ delegations: [{ section: "content", user_id: "c", name: "Fictional Cara" }, { section: "engineering", user_id: "eng", name: "Fictional Eli" }] }));
      const card = screen.getByTestId("dp-activation-D001");
      expect(card.textContent).toMatch(/D001 · Kids photobooth × 2/);
      expect(card.textContent).toMatch(/Accountable owner: Fictional Eli · ready by 28 Apr 2027/);
      expect(card.textContent).toMatch(/\d of 5 lines done · \d+ need/);
      expect(within(card).getAllByRole("heading", { level: 4 }).map((h) => h.textContent?.split(" · ")[0])).toEqual(["Hardware", "Content", "Apps"]);   // no Engineering or Site work heading: nothing recorded there
      expect(screen.getByTestId("dp-waiting-D001").textContent).toBe("Waiting for Fictional Eli: Engineering & integration");
      expect(screen.queryByText("No zone")).toBeNull();                                                                       // a project without zones shows no zone heading
    });

    it("the milestone shows N of M complete with the outstanding tasks, apart from its confirmation", () => {
      render1();
      const m = screen.getByTestId("milestone-Ready for mockup");
      expect(m.textContent).toMatch(/0 of 2 complete/);
      expect(m.textContent).toMatch(/Not ready/);
      expect(m.textContent).toMatch(/Kids photobooth: Storyboard.*in progress, blocked.*due 10 Apr 2027/);
      expect(m.textContent).toMatch(/Kids photobooth: First draft.*not released yet/);
      expect(m.textContent).toMatch(/At risk: 2027-04-14 is after the milestone date 2027-04-12/);
      expect(within(m).getByRole("link", { name: "Kids photobooth: Storyboard" }).getAttribute("href")).toBe("/projects/p1/work?task=t9");
    });

    it("the Timeline draws the same records, lists unscheduled work, and Breakdown and Timeline switch by address", () => {
      render1(r1(), { view: "timeline" });
      const tl = screen.getByTestId("plan-timeline");
      expect(within(tl).getAllByTestId("tl-row-activation")).toHaveLength(1);
      expect(within(tl).getAllByTestId("tl-row-line").map((r) => r.textContent).join("|")).toMatch(/Storyboard.*First draft/);
      expect(screen.getByTestId("tl-dates-c1").textContent).toBe("4–10 Apr");                                                 // exact dates on the row, readable without hovering
      expect(screen.getByTestId("tl-dates-c2").textContent).toBe("8–14 Apr");
      expect(screen.getByTestId("tl-dates-h1").textContent).toBe("Due 28 Apr (the activation's date)");                          // a draft with no due date of its own takes its activation's
      expect(tl.getAttribute("data-mode")).toBe("day");                                                                       // 4 to 28 April is under four weeks: a column for every day
      expect(within(screen.getByTestId("tl-header")).getByTestId("tl-col-2027-04-04").textContent).toMatch(/Sun.*4/);
      expect(screen.getByTestId("tl-bar-c1").getAttribute("data-shape")).toBe("range");
      expect(screen.getByTestId("tl-bar-h1").getAttribute("data-shape")).toBe("due");
      expect(within(tl).getByText(/Late: Storyboard is due/)).toBeTruthy();
      expect(screen.getByTestId("dp-view-timeline").getAttribute("aria-current")).toBe("page");
      expect(screen.getByTestId("dp-view-breakdown").getAttribute("href")).toBe("/projects/p1/delivery");
      expect(screen.queryByTestId("dp-line-L0012")).toBeNull();
    });

    it("a long schedule gets weekly labels but every row still states its exact dates; work with no dates says No dates and is listed", () => {
      const long = r1({ items: [{ ...photobooth, needed_by: null, lines: [
        line({ id: "x1", key: "L0030", description: "Early", assignee_name: "Fictional Cara", start_date: "2027-04-28", needed_by: "2027-05-02" }),
        line({ id: "x2", key: "L0031", description: "Late", assignee_name: "Fictional Cara", needed_by: "2027-07-14" }),
        line({ id: "x3", key: "L0032", description: "Undated", assignee_name: "Fictional Cara" }),
      ] }], milestones: [] });
      render1(long, { view: "timeline" });
      const tl = screen.getByTestId("plan-timeline");
      expect(tl.getAttribute("data-mode")).toBe("week");
      const header = within(screen.getByTestId("tl-header"));
      expect(header.getByTestId("tl-col-2027-04-28").textContent).toBe("28 Apr 2027");   // the first label carries the year
      expect(header.getByTestId("tl-col-2027-05-05").textContent).toBe("5 May");
      expect(header.queryByTestId("tl-col-2027-04-29")).toBeNull();                                  // weekly, not daily
      expect(screen.getByTestId("tl-dates-x1").textContent).toBe("28 Apr – 2 May");                    // across a month, exact
      expect(screen.getByTestId("tl-dates-x2").textContent).toBe("Due 14 Jul");
      expect(screen.getByTestId("tl-dates-x3").textContent).toBe("No dates");
      expect(screen.getByTestId("tl-nodates-x3")).toBeTruthy();
      expect(within(screen.getByTestId("tl-unscheduled")).getByText("Undated")).toBeTruthy();
    });

    it("scope that exists only as a brief is shown beside the plan; accepted technologies not yet in the plan are offered once to the manager", () => {
      render1(r1({ scope: { brief: "Photobooth with a cartoon app, printed on the spot.", technologies: [], pending: [] } }));
      expect(screen.getByTestId("dp-brief").textContent).toMatch(/Photobooth with a cartoon app/);
      expect(screen.getByTestId("dp-brief").closest(".grid")).toBeTruthy();
      cleanup();
      render1(r1({ items: [], scope: { brief: null, technologies: [{ name: "Photobooth", qty: 2 }], pending: [{ name: "Photobooth", qty: 2 }, { name: "Cartoon app", qty: 1 }] } }));
      const pending = screen.getByTestId("dp-scope-pending").textContent ?? "";
      expect(pending).toMatch(/Next step: bring in the accepted technologies/);
      expect(pending).toMatch(/2 technologies that are not in the plan yet: Photobooth × 2, Cartoon app × 1/);
      expect(pending).toMatch(/manual step: accepting a handover does not add anything to the plan by itself/);
      expect(screen.getByTestId("plan-summary").compareDocumentPosition(screen.getByTestId("dp-scope-pending")) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();   // shown above the summary, first thing on the page
      expect(screen.getByTestId("dp-seed-scope").textContent).toBe("Bring in accepted technologies (2)");
      cleanup();
      render(<DeliveryPlanView {...props(r1({ can_manage: false, items: [], scope: { brief: null, technologies: [{ name: "Photobooth" }], pending: [{ name: "Photobooth" }] } }), { userId: "tech", today: "2027-04-09" })} />);
      expect(screen.queryByTestId("dp-scope-pending")).toBeNull();                                                            // only a manager brings the scope in
    });

    it("an approved change the task could not take is flagged Task update pending, with the resolve control for a manager only", () => {
      const pending = r1({ items: [{ ...photobooth, lines: [line({ id: "p1", key: "L0020", description: "Integration test", assignee_id: "eng", assignee_name: "Fictional Dev", needed_by: "2027-04-30", released_at: "x",
        task: { id: "tp", title: "x", status: "done", start_date: null, due_date: "2027-04-26", blocked: false, assignee_name: "Fictional Cara", depends_on: [] },
        task_pending: { fields: { assignee_id: "eng", due_date: "2027-04-30" }, reason: "A done task can no longer be edited" } })] }] });
      render1(pending);
      const row = screen.getByTestId("dp-line-L0020");
      expect(within(row).getByTestId("dp-attention-L0020").textContent).toMatch(/Task update pending: A done task can no longer be edited/);
      expect(within(screen.getByTestId("dp-pending-L0020")).getByRole("button", { name: "Resolve" })).toBeTruthy();
      cleanup();
      render(<DeliveryPlanView {...props({ ...pending, can_manage: false }, { userId: "tech", today: "2027-04-09" })} />);
      expect(within(screen.getByTestId("dp-pending-L0020")).queryByRole("button", { name: "Resolve" })).toBeNull();
      expect(screen.getByTestId("dp-pending-L0020").textContent).toMatch(/The Project Manager can resolve it/);
      cleanup();
      const cleared = r1({ items: [{ ...photobooth, lines: [line({ id: "p2", key: "L0021", description: "Cleared dates", assignee_id: "eng", assignee_name: "Fictional Dev", released_at: "x",
        task: { id: "tq", title: "x", status: "done", start_date: "2027-09-01", due_date: "2027-09-04", blocked: false, assignee_name: "Fictional Cara", milestone_id: "m1", depends_on: [] },
        task_pending: { fields: { start_date: null as unknown as string, due_date: null as unknown as string, milestone_id: null as unknown as string }, reason: "A done task can no longer be edited" } })] }] });
      render1(cleared);
      const text = screen.getByTestId("dp-pending-L0021").textContent ?? "";
      expect(text).toMatch(/The plan says start date cleared, due date cleared, milestone cleared; the task still has Fictional Cara, start 1 Sept? 2027, due 4 Sept? 2027, milestone Ready for mockup/);
      expect(within(screen.getByTestId("dp-pending-L0021")).getByRole("button", { name: "Resolve" })).toBeTruthy();
    });

    it("the line form shows only the fields of its section: a hardware line has a supply route, an app has devices, a simple job never meets the rest", () => {
      render1();
      fireEvent.click(within(screen.getByTestId("dp-line-L0010")).getByRole("button", { name: "Edit" }));
      let dialog = screen.getByRole("dialog");
      expect(within(dialog).getByLabelText("How is it supplied?")).toBeTruthy();
      expect(within(dialog).getByLabelText("Stock item").textContent).toMatch(/Not in Inventory yet: manual line/);
      expect(within(dialog).queryByLabelText("Number of devices")).toBeNull();
      fireEvent.change(within(dialog).getByLabelText("How is it supplied?"), { target: { value: "rent" } });
      expect(within(dialog).queryByLabelText("Stock item")).toBeNull();
      expect(within(dialog).getByLabelText("Supplier")).toBeTruthy();
      cleanup();
      render1();
      fireEvent.click(within(screen.getByTestId("dp-line-L0014")).getByRole("button", { name: "Edit" }));
      dialog = screen.getByRole("dialog");
      expect(within(dialog).getByLabelText("Number of devices")).toBeTruthy();
      expect(within(dialog).getByLabelText("Platform")).toBeTruthy();
      expect(within(dialog).getByText(/One app on six screens is one app and six devices/)).toBeTruthy();
      expect(within(dialog).queryByLabelText("Resolution")).toBeNull();
    });
  });
});

describe("Project Plan screen: compact Breakdown, Quick add and order", () => {
  const two: DpItem = { ...kiosk, lines: [line({ id: "k1", key: "L0010", section: "hardware", description: "Batak unit", qty: 4, assignee_id: null, assignee_name: null }), line({ id: "k2", key: "L0011", section: "hardware", description: "Network switch", qty: 1, assignee_id: null, assignee_name: null })] };
  const open = (p: DeliveryPlan, over: Partial<DeliveryPlanViewProps> = {}) => render(<DeliveryPlanView {...props({ ...p, items: [two] }, { today: "2026-11-13", ...over })} />);

  it("a requirement is one compact row: name and quantity, who, dates, status and actions, under one column heading per section", () => {
    open(plan({ can_manage: true }));
    const row = screen.getByTestId("dp-line-L0010");
    expect(within(row).getByTestId("dp-name-L0010").textContent).toContain("Batak unit × 4");
    expect(within(row).getByTestId("dp-who-L0010").textContent).toMatch(/Inventory · Not matched to stock/);
    expect(within(row).getByTestId("dp-when-L0010").textContent).toMatch(/no date recorded/);
    expect(within(row).getByTestId("dp-status-L0010").textContent).toMatch(/Specification pending/);
    expect(row.className).toMatch(/md:grid-cols-\[/);                                      // a table row from the md breakpoint, stacked below it
    const section = screen.getByTestId("dp-section-D002-hardware");
    expect(section.textContent).toMatch(/Requirement.*Supply \/ owner.*Dates.*Status.*Actions/);
  });

  it("the Project Manager can Quick add and reorder; a section's delegate only in their section; an ordinary member and a finished project in none", () => {
    open(plan({ can_manage: true }));
    expect(screen.getByRole("button", { name: "Quick add" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Move L0010 down" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Move L0011 up" })).toBeTruthy();
    cleanup();
    open(plan({ my_sections: ["content"] }));
    expect(screen.getByRole("button", { name: "Quick add" })).toBeTruthy();               // Content is theirs
    expect(screen.queryByRole("button", { name: /Move L0010/ })).toBeNull();               // the hardware rows are not
    cleanup();
    open(plan());
    expect(screen.queryByRole("button", { name: "Quick add" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Move L0010/ })).toBeNull();
    cleanup();
    open(plan({ can_manage: true }), { readOnly: true });
    expect(screen.queryByRole("button", { name: "Quick add" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Move L0010/ })).toBeNull();
  });
});
