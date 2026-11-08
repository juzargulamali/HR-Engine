/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);
HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.removeAttribute("open"); };

vi.mock("@/lib/actions/outreach", () => ({ assignOutreach: vi.fn() }));
import { AssignBar, SelectAllBox, SelectBox, SelectionProvider } from "./outreach-select";

const shown = [{ id: "a", name: "Fictional Alpha" }, { id: "b", name: "Fictional Beta" }, { id: "c", name: "Fictional Gamma" }];
const page = (key: string) => (
  <SelectionProvider key={key}>
    <AssignBar companyId="co" shown={shown} people={[{ id: "p1", name: "Sara Fixture" }]} />
    <SelectAllBox shown={shown} />
    {shown.map((r) => <SelectBox key={r.id} id={r.id} name={r.name} />)}
  </SelectionProvider>
);
const box = (name: string) => screen.getByRole("checkbox", { name }) as HTMLInputElement;

describe("bulk selection scope", () => {
  it("states the scope in words and starts with nothing selected", () => {
    render(page("v1"));
    expect(screen.getByRole("status").textContent).toContain("0 selected of 3 shown");
    expect(screen.getByRole("status").textContent).toContain("Assign outreach applies to the 0 selected");
    expect((screen.getByRole("button", { name: /Assign outreach/ }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("select all on this page ticks exactly the rows shown; the header box does the same and clears again", () => {
    render(page("v1"));
    fireEvent.click(screen.getByRole("button", { name: "Select all 3 on this page" }));
    expect(screen.getByRole("status").textContent).toContain("3 selected of 3 shown");
    for (const r of shown) expect(box(`Select ${r.name} for outreach`).checked).toBe(true);
    fireEvent.click(box("Select all 3 accounts on this page"));
    expect(screen.getByRole("status").textContent).toContain("0 selected of 3 shown");
    fireEvent.click(box("Select all 3 accounts on this page"));
    expect(screen.getByRole("status").textContent).toContain("3 selected of 3 shown");
  });
  it("a partial selection shows the header box as mixed", () => {
    render(page("v1"));
    fireEvent.click(box("Select Fictional Beta for outreach"));
    expect(box("Select all 3 accounts on this page").indeterminate).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("1 selected of 3 shown");
  });
  it("any change of filters, search or sort (a new key) starts an empty selection", () => {
    const { rerender } = render(page("filters-1"));
    fireEvent.click(box("Select Fictional Alpha for outreach"));
    expect(screen.getByRole("status").textContent).toContain("1 selected");
    rerender(page("filters-2"));
    expect(screen.getByRole("status").textContent).toContain("0 selected of 3 shown");
    expect(box("Select Fictional Alpha for outreach").checked).toBe(false);
  });
  it("the Assign outreach dialog lists and counts only the selected accounts, and submits only those ids", () => {
    render(page("v1"));
    fireEvent.click(box("Select Fictional Alpha for outreach"));
    fireEvent.click(box("Select Fictional Gamma for outreach"));
    fireEvent.click(screen.getByRole("button", { name: /Assign outreach/ }));
    expect(screen.getByText("2 accounts selected")).toBeTruthy();
    const list = screen.getByRole("list", { name: "Selected accounts" });
    expect(list.textContent).toContain("Fictional Alpha");
    expect(list.textContent).toContain("Fictional Gamma");
    expect(list.textContent).not.toContain("Fictional Beta");
    const ids = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="orgId"]')).map((i) => i.value);
    expect(ids).toEqual(["a", "c"]);
  });
});
