// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/projects/p1/documents" }));
vi.mock("@/lib/actions/projectsTimelineSelect", () => ({ saveClientTimelineSelection: vi.fn(), saveClientTimelineTasks: vi.fn() }));
import { fireEvent } from "@testing-library/react";
import { ClientTimelinePicker, type PickerRow } from "./client-timeline-picker";
import { ClientTimelineTaskPicker, type TaskPickRow } from "./client-timeline-task-picker";

afterEach(cleanup);
const rows: PickerRow[] = [
  { kind: "mile", id: "m1", title: "Design sign-off", when: "Due 1 Mar 2027", group: "Milestones", clientFacing: true, version: 2 },
  { kind: "item", id: "i1", title: "Build week", when: "8 Mar 2027 to 12 Mar 2027", group: "Delivery timeline", clientFacing: false, version: 1 },
  { kind: "item", id: "i2", title: "Load-in", when: "Not scheduled yet", group: "Site schedule", clientFacing: false, version: 1 },
];

describe("Client timeline chooser", () => {
  it("lists every existing milestone and activity under its own heading with its current choice and says how many are on the next timeline", () => {
    render(<ClientTimelinePicker projectId="p1" rows={rows} canEdit />);
    expect((screen.getByTestId("ct-pick-m1") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId("ct-pick-i1") as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText("Milestones")).toBeTruthy();
    expect(screen.getByText("Delivery timeline")).toBeTruthy();
    expect(screen.getByText("Site schedule")).toBeTruthy();
    expect(screen.getByTestId("ct-picker-count").textContent).toMatch(/1 of 3 will be on the next issued timeline/);
  });
  it("is read only for someone who cannot edit", () => {
    render(<ClientTimelinePicker projectId="p1" rows={rows} canEdit={false} />);
    expect((screen.getByTestId("ct-pick-i1") as HTMLInputElement).disabled).toBe(true);
  });
  it("says an issued timeline would be empty when nothing is chosen", () => {
    render(<ClientTimelinePicker projectId="p1" rows={rows.map((r) => ({ ...r, clientFacing: false }))} canEdit />);
    expect(screen.getByTestId("ct-picker-count").textContent).toMatch(/Nothing is client-facing yet/);
  });
});

const tasks: TaskPickRow[] = [
  { id: "t1", title: "Render loop v3 (internal)", when: "Due 5 Mar 2099", statusLabel: "In progress", chosen: false, clientTitle: null },
  { id: "t2", title: "QA pass", when: "No date", statusLabel: "To do", chosen: true, clientTitle: "Final checks" },
];
describe("Client timeline: individual tasks", () => {
  it("ticks nothing by default and has no way to choose every task at once", () => {
    render(<ClientTimelineTaskPicker projectId="p1" rows={tasks.map((t) => ({ ...t, chosen: false, clientTitle: null }))} canEdit />);
    for (const t of tasks) expect((screen.getByTestId(`ct-task-pick-${t.id}`) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByTestId("ct-task-count").textContent).toMatch(/No task is on the client timeline/);
    expect(screen.queryByText(/all tasks|select all|choose all/i)).toBeNull();
    expect(screen.queryByTestId("ct-task-title-t1")).toBeNull();          // no client title is asked for (or sent) for a task that is not ticked
  });
  it("a ticked task asks for the title the client sees, offered from the task and kept when already set", () => {
    render(<ClientTimelineTaskPicker projectId="p1" rows={tasks} canEdit />);
    expect((screen.getByTestId("ct-task-title-t2") as HTMLInputElement).value).toBe("Final checks");
    expect(screen.getByTestId("ct-task-count").textContent).toMatch(/1 of 2 tasks will be on the next issued timeline/);
    fireEvent.click(screen.getByTestId("ct-task-pick-t1"));
    const title = screen.getByTestId("ct-task-title-t1") as HTMLInputElement;
    expect(title.value).toBe("Render loop v3 (internal)");
    expect(title.required).toBe(true);
    expect(screen.getByTestId("ct-task-count").textContent).toMatch(/2 of 2 tasks/);
  });
  it("is read only for someone who cannot edit", () => {
    render(<ClientTimelineTaskPicker projectId="p1" rows={tasks} canEdit={false} />);
    expect((screen.getByTestId("ct-task-pick-t1") as HTMLInputElement).disabled).toBe(true);
  });
});
