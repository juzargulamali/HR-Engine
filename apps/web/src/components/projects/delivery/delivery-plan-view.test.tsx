// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { DeliveryPlan, DpItem, DpLine } from "@/lib/projects/delivery-plan/model";

vi.mock("next/link", () => ({ default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...(rest as Record<string, unknown>)}>{children}</a> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/projects/p1/delivery", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/actions/projectsDeliveryPlan", () => ({
  saveDeliverable: vi.fn(), removeDeliverable: vi.fn(), savePlanLine: vi.fn(), removePlanLine: vi.fn(), delegatePlanSection: vi.fn(), releaseDeliveryPlan: vi.fn(),
  raisePlanCorrection: vi.fn(), decidePlanCorrection: vi.fn(), decidePlanChange: vi.fn(),
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

describe("Delivery plan screen", () => {
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
    expect(screen.queryByRole("button", { name: "Add line" })).toBeNull();
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
    expect(screen.getAllByRole("button", { name: "Add line" }).length).toBe(2);
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
    for (const name of ["Edit", "Add line", "Correction", "Approve change", "Accept correction"]) expect(screen.queryByRole("button", { name })).toBeNull();
    expect(screen.queryByTestId("dp-release")).toBeNull();
    expect(screen.queryByRole("link", { name: /Import Excel/ })).toBeNull();
  });

  it("an empty plan says what to do; a failed image read says so", () => {
    render(<DeliveryPlanView {...props(plan({ can_manage: true, items: [], corrections: [], changes: [] }), { imagesFailed: true })} />);
    expect(text()).toContain("No deliverables yet");
    expect(text()).toMatch(/download the template, fill it in Excel and import it/);
    expect(text()).toContain("Could not load this project's image files");
  });
});
