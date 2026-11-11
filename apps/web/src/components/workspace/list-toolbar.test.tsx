// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ListToolbar, type ToolbarFilter } from "./list-toolbar";

const replace = vi.fn();
let address = "";
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }), usePathname: () => "/sales/events", useSearchParams: () => new URLSearchParams(address) }));
vi.mock("next/link", () => ({ default: ({ children, href, scroll: _scroll, ...rest }: { children: React.ReactNode; href: string; scroll?: boolean }) => <a href={href} {...(rest as Record<string, unknown>)}>{children}</a> }));

const filters = (over: Record<string, string> = {}): ToolbarFilter[] => [
  { name: "country", label: "Country", value: over.country ?? "", options: [{ value: "", label: "Any country" }, { value: "AE", label: "United Arab Emirates" }] },
  { name: "from", label: "From date", kind: "date", secondary: true, value: over.from ?? "" },
  { name: "exhibition", label: "Exhibition", kind: "text", secondary: true, value: over.exhibition ?? "" },
  { name: "archived", label: "Include archived", kind: "toggle", secondary: true, value: over.archived ?? "" },
  { name: "scope", label: "Enquiry figures for", secondary: true, scopeOnly: true, value: over.scope ?? "", options: [{ value: "", label: "Fictional Co" }, { value: "all", label: "All my companies" }] },
];
const last = () => replace.mock.calls.at(-1)?.[0] as string;

describe("ListToolbar: every filter applies as it changes", () => {
  beforeEach(() => { replace.mockClear(); address = "view=calendar&month=2027-03&q=expo&sort=name&dir=desc&page=3"; vi.useFakeTimers(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("has no Apply button", () => {
    render(<ListToolbar search={{ value: "expo", placeholder: "Search" }} filters={filters()} clearHref="/sales/events" />);
    expect(screen.queryByRole("button", { name: /apply/i })).toBeNull();
  });

  it("a choice applies at once and keeps the view, month, search and sort; paging named in resetKeys starts again", () => {
    render(<ListToolbar search={{ value: "expo", placeholder: "Search" }} filters={filters()} resetKeys={["page"]} />);
    fireEvent.change(screen.getByLabelText("Country"), { target: { value: "AE" } });
    expect(last()).toBe("/sales/events?view=calendar&month=2027-03&q=expo&sort=name&dir=desc&country=AE");
  });

  it("choosing the first option again removes the filter", () => {
    address = "view=calendar&month=2027-03&country=AE";
    render(<ListToolbar filters={filters({ country: "AE" })} />);
    fireEvent.change(screen.getByLabelText("Country"), { target: { value: "" } });
    expect(last()).toBe("/sales/events?view=calendar&month=2027-03");
  });

  it("a date applies when chosen and when emptied; a tick box applies when ticked and unticked", () => {
    address = "";
    const { rerender } = render(<ListToolbar filters={filters()} />);
    fireEvent.click(screen.getByRole("button", { name: /More filters/ }));
    fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2027-03-01" } });
    expect(last()).toBe("/sales/events?from=2027-03-01");
    fireEvent.click(screen.getByLabelText("Include archived"));
    expect(last()).toBe("/sales/events?from=2027-03-01&archived=1");
    address = "from=2027-03-01&archived=1";
    rerender(<ListToolbar filters={filters({ from: "2027-03-01", archived: "1" })} />);
    fireEvent.change(screen.getByLabelText("From date"), { target: { value: "" } });
    expect(last()).toBe("/sales/events?archived=1");
    fireEvent.click(screen.getByLabelText("Include archived"));
    expect(last()).toBe("/sales/events");
  });

  it("a typed filter applies a moment after typing stops, without a button", () => {
    address = "";
    render(<ListToolbar filters={filters()} />);
    fireEvent.click(screen.getByRole("button", { name: /More filters/ }));
    fireEvent.change(screen.getByLabelText("Exhibition"), { target: { value: " Fictional Expo " } });
    expect(replace).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(300); });
    expect(last()).toBe("/sales/events?exhibition=Fictional+Expo");
  });

  it("two filters changed in quick succession are both kept, even before the address catches up", () => {
    address = "view=calendar&month=2027-03";
    render(<ListToolbar filters={filters()} />);
    fireEvent.click(screen.getByRole("button", { name: /More filters/ }));
    fireEvent.click(screen.getByLabelText("Include archived"));
    expect((screen.getByLabelText("Include archived") as HTMLInputElement).checked).toBe(true);
    fireEvent.change(screen.getByLabelText("Country"), { target: { value: "AE" } });
    expect(last()).toBe("/sales/events?view=calendar&month=2027-03&archived=1&country=AE");
  });

  it("shows how many less common filters are in use, opens their panel, and removes one from its chip", () => {
    address = "from=2027-03-01&archived=1";
    render(<ListToolbar filters={filters({ from: "2027-03-01", archived: "1" })} clearHref="/sales/events" />);
    expect(screen.getByLabelText("2 in use")).toBeTruthy();
    expect(screen.getByRole("button", { name: /More filters/ }).getAttribute("aria-expanded")).toBe("true");
    const chips = screen.getByRole("list", { name: "Filters in use" });
    expect(chips.textContent).toContain("From date: 2027-03-01");
    expect(chips.textContent).toContain("Include archived");
    fireEvent.click(screen.getByRole("button", { name: "Remove filter: Include archived" }));
    expect(last()).toBe("/sales/events?from=2027-03-01");
    expect(screen.getByRole("link", { name: "Clear" }).getAttribute("href")).toBe("/sales/events");
  });

  it("a chooser that is not a filter is never counted, shows no chip and does not offer Clear", () => {
    address = "scope=all";
    render(<ListToolbar filters={filters({ scope: "all" })} clearHref="/sales/events" />);
    expect(screen.queryByRole("link", { name: "Clear" })).toBeNull();
    expect(screen.queryByRole("list", { name: "Filters in use" })).toBeNull();
    expect(screen.getByRole("button", { name: /More filters/ }).getAttribute("aria-expanded")).toBe("false");
  });
});
