// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach } from "vitest";
import { matchOptions, SearchCombobox, type ComboOption } from "./combobox";

afterEach(cleanup);
/** Typing without a user-event library: focus, then set the text (what the browser does for each change). */
const type = (el: HTMLElement, text: string) => { fireEvent.focus(el); fireEvent.change(el, { target: { value: text } }); };
const key = (el: HTMLElement, k: string) => fireEvent.keyDown(el, { key: k });
const OPTS: ComboOption[] = [
  { id: "1", label: "Fictional Aurora Events", detail: "United Arab Emirates · aurora.example" },
  { id: "2", label: "Fictional Aurora Media", detail: "Saudi Arabia · auroramedia.example" },
  { id: "3", label: "Fictional Harbour Client", detail: "Poland" },
  { id: "4", label: "Orbit Motors" },
];

describe("matchOptions", () => {
  it("every typed word must appear in the name or the detail, in any order; names starting with the first word come first", () => {
    expect(matchOptions(OPTS, "aurora").map((o) => o.id)).toEqual(["1", "2"]);
    expect(matchOptions(OPTS, "poland harbour").map((o) => o.id)).toEqual(["3"]);
    expect(matchOptions(OPTS, "saudi aurora").map((o) => o.id)).toEqual(["2"]);
    expect(matchOptions(OPTS, "orb").map((o) => o.id)).toEqual(["4"]);
    expect(matchOptions(OPTS, "zzz")).toEqual([]);
  });
  it("shows at most the limit and keeps a chosen option visible when nothing is typed", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: String(i), label: `Org ${String(i).padStart(2, "0")}` }));
    expect(matchOptions(many, "", "", 8)).toHaveLength(8);
    expect(matchOptions(many, "", "19", 8).map((o) => o.id)).toContain("19");
  });
});

function Harness({ onChange }: { onChange?: (v: string) => void }) {
  const [v, setV] = useState("");
  return <form onSubmit={(e) => e.preventDefault()}><SearchCombobox id="c" name="agencyOrgId" label="Agency" options={OPTS} value={v} onChange={(x) => { setV(x); onChange?.(x); }} /><output data-testid="v">{v}</output></form>;
}

describe("SearchCombobox", () => {
  it("shows matches directly under the field as you type, with the country or website to tell similar names apart", () => {
    render(<Harness />);
    const field = screen.getByRole("combobox", { name: /Agency/ });
    type(field, "aurora");
    const list = screen.getByRole("listbox");
    const items = within(list).getAllByRole("option");
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toContain("United Arab Emirates");
    expect(items[1]!.textContent).toContain("Saudi Arabia");
  });
  it("typing alone selects nothing; choosing a match by click sets the id; editing the text clears the choice again", () => {
    const seen = vi.fn();
    render(<Harness onChange={seen} />);
    const field = screen.getByRole("combobox", { name: /Agency/ }) as HTMLInputElement;
    type(field, "Fictional Aurora Media");
    expect(screen.getByTestId("v").textContent).toBe("");
    expect(screen.getByText(/Typing alone selects nothing/)).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: /Fictional Aurora Media/ }));
    expect(screen.getByTestId("v").textContent).toBe("2");
    expect(field.value).toBe("Fictional Aurora Media");
    expect((document.querySelector('input[name="agencyOrgId"]') as HTMLInputElement).value).toBe("2");
    type(field, "Fictional Aurora Mediax");
    expect(screen.getByTestId("v").textContent).toBe("");
  });
  it("works from the keyboard: arrows move, Enter chooses the highlighted match, Escape closes; Enter with nothing highlighted never submits", () => {
    render(<Harness />);
    const field = screen.getByRole("combobox", { name: /Agency/ });
    type(field, "aurora");
    key(field, "ArrowDown");
    expect(field.getAttribute("aria-activedescendant")).toBeTruthy();
    expect(screen.getAllByRole("option")[1]!.className).toContain("bg-secondary");
    key(field, "Enter");
    expect(screen.getByTestId("v").textContent).toBe("2");
    type(field, "zzz");
    key(field, "Enter");
    expect(screen.getByTestId("v").textContent).toBe("");
    key(field, "Escape");
    expect(screen.queryByRole("listbox")).toBeNull();
  });
  it("can be cleared with its own button, and says when nothing matches", () => {
    render(<Harness />);
    const field = screen.getByRole("combobox", { name: /Agency/ }) as HTMLInputElement;
    type(field, "Orbit");
    fireEvent.click(screen.getByRole("option", { name: /Orbit Motors/ }));
    expect(screen.getByTestId("v").textContent).toBe("4");
    fireEvent.click(screen.getByRole("button", { name: "Clear Agency" }));
    expect(screen.getByTestId("v").textContent).toBe("");
    expect(field.value).toBe("");
    type(field, "nothing like this");
    expect(screen.getByText(/Nothing matches/)).toBeTruthy();
  });
});
