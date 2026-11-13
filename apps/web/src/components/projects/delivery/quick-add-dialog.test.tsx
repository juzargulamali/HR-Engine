// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/projects/p1/delivery", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/actions/projectsDeliveryPlan", () => ({
  saveDeliverable: vi.fn(), removeDeliverable: vi.fn(), savePlanLine: vi.fn(), removePlanLine: vi.fn(), delegatePlanSection: vi.fn(), releaseDeliveryPlan: vi.fn(),
  raisePlanCorrection: vi.fn(), decidePlanCorrection: vi.fn(), decidePlanChange: vi.fn(), addPlanSequence: vi.fn(), seedPlanScope: vi.fn(), reconcilePlanTask: vi.fn(), addPlanLines: vi.fn(), reorderPlanLines: vi.fn(),
}));
import { QuickAddDialog } from "./quick-add-dialog";

HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.removeAttribute("open"); };
afterEach(cleanup);

const LONG = "Fictional Alexandria Konstantinopoulos-Wickramasinghe, Senior Interactive Content Designer";
const members = [{ id: "u1", name: "Fictional Cara" }, { id: "u2", name: LONG }];
const open = (sections: ("hardware" | "content")[] = ["hardware"]) => {
  render(<QuickAddDialog projectId="p1" itemId="i1" sections={sections} members={members} milestones={[]} activationOwner="Fictional Eli" />);
  fireEvent.click(screen.getByRole("button", { name: "Quick add" }));
  return screen.getByRole("dialog");
};

describe("Quick add: the form", () => {
  it("is a wide dialog with five empty rows; hardware rows have a quantity and no chain option, and every field has a visible or accessible name", () => {
    const d = open();
    expect(d.className).toMatch(/w-\[min\(60rem,/);
    expect(within(d).getAllByRole("row").filter((r) => r.getAttribute("data-testid")?.startsWith("qa-row-"))).toHaveLength(5);
    for (const f of ["name", "quantity", "owner", "start", "due"]) expect(within(d).getByLabelText(new RegExp(`Row 1 ${f}`))).toBeTruthy();
    expect(within(d).queryByLabelText(/each row waits/i)).toBeNull();
    expect((within(d).getByLabelText("Row 1 owner") as HTMLSelectElement).options[0]!.text).toBe("No owner");
  });

  it("a work section hides quantity, offers the sequence option, and names the activation owner as the default", () => {
    const d = open(["content"]);
    expect(within(d).queryByLabelText("Row 1 quantity")).toBeNull();
    expect(within(d).getByLabelText(/Each row waits for the one above/)).toBeTruthy();
    expect((within(d).getByLabelText("Row 1 owner") as HTMLSelectElement).options[0]!.text).toBe("Use activation owner (Fictional Eli)");
    const data = new FormData(d.querySelector("form")!);
    expect(data.getAll("rowName")).toHaveLength(5);
    expect(data.getAll("rowQty")).toHaveLength(5);                         // the lists stay the same length whatever the section, so row n is always row n
    expect(data.get("section")).toBe("content");
  });

  it("a pasted list lands in the rows, keeps what was already typed, and a chosen owner is readable in full", () => {
    const d = open();
    fireEvent.change(within(d).getByLabelText("Row 1 name"), { target: { value: "Already typed" } });
    fireEvent.change(within(d).getByLabelText("Row 1 owner"), { target: { value: "u2" } });
    expect(within(d).getByTestId("qa-owner-name-0").textContent).toBe(`Assigned to ${LONG}`);
    fireEvent.click(within(d).getByText("Paste a list"));
    fireEvent.change(within(d).getByLabelText(/One requirement per line/), { target: { value: "Batak unit\t4\nPower distribution box x 2\nFlight case" } });
    fireEvent.click(within(d).getByRole("button", { name: "Put these in the rows below" }));
    expect(within(d).getByTestId("qa-note").textContent).toMatch(/^3 rows added below/);
    const data = new FormData(d.querySelector("form")!);
    expect(data.getAll("rowName")).toEqual(["Already typed", "Batak unit", "Power distribution box", "Flight case"]);
    expect(data.getAll("rowQty")).toEqual(["", "4", "2", ""]);
    expect(data.getAll("rowOwner")).toEqual(["u2", "", "", ""]);           // the typed row kept its owner
  });

  it("removing a row keeps the others' names, owners and dates", () => {
    const d = open(["content"]);
    fireEvent.change(within(d).getByLabelText("Row 3 name"), { target: { value: "Storyboard" } });
    fireEvent.change(within(d).getByLabelText("Row 3 owner"), { target: { value: "u1" } });
    fireEvent.change(within(d).getByLabelText("Row 3 due"), { target: { value: "2027-04-08" } });
    fireEvent.click(within(d).getByRole("button", { name: "Remove row 1" }));
    expect((within(d).getByLabelText("Row 2 name") as HTMLInputElement).value).toBe("Storyboard");
    expect((within(d).getByLabelText("Row 2 owner") as HTMLSelectElement).value).toBe("u1");
    expect((within(d).getByLabelText("Row 2 due") as HTMLInputElement).value).toBe("2027-04-08");
  });
});
