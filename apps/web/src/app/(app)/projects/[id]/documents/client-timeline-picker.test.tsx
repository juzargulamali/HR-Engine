// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/projects/p1/documents" }));
vi.mock("@/lib/actions/projectsTimelineSelect", () => ({ saveClientTimelineSelection: vi.fn() }));
import { ClientTimelinePicker, type PickerRow } from "./client-timeline-picker";

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
