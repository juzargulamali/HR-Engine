// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/projects/p1/delivery", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/actions/projectsDeliveryPlan", () => ({
  saveDeliverable: vi.fn(), removeDeliverable: vi.fn(), savePlanLine: vi.fn(), removePlanLine: vi.fn(), delegatePlanSection: vi.fn(), releaseDeliveryPlan: vi.fn(),
  raisePlanCorrection: vi.fn(), decidePlanCorrection: vi.fn(), decidePlanChange: vi.fn(), addPlanSequence: vi.fn(), seedPlanScope: vi.fn(), reconcilePlanTask: vi.fn(), addPlanLines: vi.fn(), reorderPlanLines: vi.fn(),
}));
import { SequenceDialog } from "./delivery-forms";

HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.removeAttribute("open"); };
afterEach(cleanup);

const LONG = "Fictional Alexandria Konstantinopoulos-Wickramasinghe, Senior Interactive Content Designer";
const members = [{ id: "u1", name: "Fictional Cara" }, { id: "u2", name: LONG }];
const open = (owner: string | null = "Fictional Eli") => {
  render(<SequenceDialog projectId="p1" itemId="i1" section="content" members={members} milestones={[]} activationOwner={owner} />);
  fireEvent.click(screen.getByRole("button", { name: "Start from a sequence" }));
  return screen.getByRole("dialog");
};
const owner = (d: HTMLElement, n: number) => within(d).getByLabelText(`Step ${n} owner`) as HTMLSelectElement;
const selectedText = (s: HTMLSelectElement) => s.options[s.selectedIndex]!.text;

describe("Start from a sequence: the form", () => {
  it("is a wide dialog; each step has a full-width name, then Owner, Start date and Due date with visible labels; the default owner says what it means", () => {
    const d = open();
    expect(d.className).toMatch(/w-\[min\(60rem,/);
    const step = within(d).getByTestId("seq-step-0");
    expect(within(step).getByLabelText("Step 1 name").className).toMatch(/w-full/);
    for (const label of ["Owner", "Start date", "Due date"]) expect(within(step).getByText(label, { selector: "label" })).toBeTruthy();   // visible, not only aria-label
    const row = within(step).getByText("Owner", { selector: "label" }).closest("div")!.parentElement!;
    expect(row.className).toMatch(/grid-cols-1/);                                       // stacked on a phone
    expect(row.className).toMatch(/sm:grid-cols-\[minmax\(0,2fr\)/);                    // Owner gets the widest column from the sm breakpoint
    expect(selectedText(owner(d, 1))).toBe("Use activation owner (Fictional Eli)");
    cleanup();
    const d2 = open(null);
    expect(selectedText(owner(d2, 1))).toBe("Use activation owner (none set yet)");
  });

  it("starts blank and neutral: nothing is prefilled (no Moodboard or Storyboard to re-enter), with a hint that tasks are already tracked", () => {
    const d = open();
    const names = within(d).getAllByLabelText(/^Step \d+ name$/) as HTMLInputElement[];
    expect(names).toHaveLength(2);
    expect(names.map((i) => i.value)).toEqual(["", ""]);
    expect(d.textContent).not.toMatch(/Moodboard|Storyboard|First draft|On-device test/);
    expect(within(d).getByTestId("seq-hint").textContent).toMatch(/already exists as a task/);
    // empty steps are ignored by the save: the form carries them as empty strings
    expect(new FormData(d.querySelector("form")!).getAll("stepDescription")).toEqual(["", ""]);
  });

  it("a chosen owner is readable at once, in full even when the name is long, and survives editing dates and removing another step", () => {
    const d = open();
    fireEvent.click(within(d).getByRole("button", { name: "Add a step" }));
    fireEvent.click(within(d).getByRole("button", { name: "Add a step" }));                           // four steps
    ["Alpha", "Beta", "Gamma", "Delta"].forEach((name, i) => fireEvent.change(within(d).getByLabelText(`Step ${i + 1} name`), { target: { value: name } }));
    fireEvent.change(owner(d, 2), { target: { value: "u2" } });
    expect(selectedText(owner(d, 2))).toBe(LONG);
    expect(within(d).getByTestId("seq-owner-name-1").textContent).toBe(`Assigned to ${LONG}`);        // written out under the box: a clipped select cannot hide it
    fireEvent.change(owner(d, 4), { target: { value: "u1" } });
    fireEvent.change(within(d).getByLabelText("Step 2 start"), { target: { value: "2027-04-04" } });
    fireEvent.change(within(d).getByLabelText("Step 2 due"), { target: { value: "2027-04-08" } });
    expect(selectedText(owner(d, 2))).toBe(LONG);                                                       // dates did not touch it
    // remove step 1: the others move up with their owners and dates
    fireEvent.click(within(d).getByRole("button", { name: "Remove step 1" }));
    expect((within(d).getByLabelText("Step 1 name") as HTMLInputElement).value).toBe("Beta");
    expect(selectedText(owner(d, 1))).toBe(LONG);
    expect((within(d).getByLabelText("Step 1 start") as HTMLInputElement).value).toBe("2027-04-04");
    expect((within(d).getByLabelText("Step 1 due") as HTMLInputElement).value).toBe("2027-04-08");
    expect(selectedText(owner(d, 3))).toBe("Fictional Cara");                                           // the former step 4
    expect(selectedText(owner(d, 2))).toMatch(/^Use activation owner/);                                 // an untouched step keeps the default
    // adding a step does not disturb the rest
    fireEvent.click(within(d).getByRole("button", { name: "Add a step" }));
    expect(selectedText(owner(d, 1))).toBe(LONG);
    expect(selectedText(owner(d, 4))).toMatch(/^Use activation owner/);
  });

  it("submits each step's name, owner and dates in step order, with an empty owner meaning the activation owner", () => {
    const d = open();
    fireEvent.change(within(d).getByLabelText("Step 1 name"), { target: { value: "Kiosk copy" } });
    fireEvent.change(within(d).getByLabelText("Step 2 name"), { target: { value: "Kiosk build" } });
    fireEvent.change(owner(d, 2), { target: { value: "u1" } });
    const data = new FormData(d.querySelector("form")!);
    expect(data.getAll("stepDescription")).toEqual(["Kiosk copy", "Kiosk build"]);
    expect(data.getAll("stepOwner")).toEqual(["", "u1"]);
    expect(data.getAll("stepStart")).toHaveLength(2);
    expect(data.getAll("stepDue")).toHaveLength(2);
  });
});
