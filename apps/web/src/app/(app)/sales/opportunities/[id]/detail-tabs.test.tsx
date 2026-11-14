/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DetailTabs, TabLink, tabAddress } from "./detail-tabs";

const tabs = [
  { id: "overview", label: "Overview", content: <label>Draft note<input defaultValue="" /></label> },
  { id: "scope", label: "Scope & dates", content: <p>scope body</p> },
  { id: "commercial", label: "Commercial", content: <p>commercial body</p> },
];
const address = () => `${window.location.pathname}${window.location.search}`;
beforeEach(() => window.history.replaceState(null, "", "/sales/opportunities/o1?from=follow-ups"));
afterEach(() => cleanup());

describe("the open tab and the address agree", () => {
  it("tabAddress sets ?tab=, drops it for the first tab and keeps everything else", () => {
    expect(tabAddress("/sales/opportunities/o1", "scope", "overview")).toBe("/sales/opportunities/o1?tab=scope");
    expect(tabAddress("/sales/opportunities/o1?from=follow-ups&tab=scope", "commercial", "overview")).toBe("/sales/opportunities/o1?from=follow-ups&tab=commercial");
    expect(tabAddress("/sales/opportunities/o1?tab=scope&from=follow-ups#timeline", "overview", "overview")).toBe("/sales/opportunities/o1?from=follow-ups#timeline");
  });
  it("opens on the tab the address names (reload, shared link) and falls back to the first for an unknown one", () => {
    render(<DetailTabs tabs={tabs} initial="commercial" syncAddress />);
    expect(screen.getByRole("tab", { name: "Commercial" }).getAttribute("aria-selected")).toBe("true");
    cleanup();
    render(<DetailTabs tabs={tabs} initial="nonsense" syncAddress />);
    expect(screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected")).toBe("true");
  });
  it("a click, the arrow keys and a link elsewhere on the page each update the address, without a navigation and without losing typed input", () => {
    render(<><TabLink tab="commercial" href="?tab=commercial">Recheck availability</TabLink><DetailTabs tabs={tabs} initial="overview" syncAddress /></>);
    const before = window.history.length;
    fireEvent.change(screen.getByLabelText("Draft note"), { target: { value: "half typed" } });
    fireEvent.click(screen.getByRole("tab", { name: "Scope & dates" }));
    expect(address()).toBe("/sales/opportunities/o1?from=follow-ups&tab=scope");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Scope & dates" }), { key: "ArrowRight" });
    expect(address()).toBe("/sales/opportunities/o1?from=follow-ups&tab=commercial");
    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
    expect(address()).toBe("/sales/opportunities/o1?from=follow-ups");
    fireEvent.click(screen.getByText("Recheck availability"));
    expect(address()).toBe("/sales/opportunities/o1?from=follow-ups&tab=commercial");
    expect(window.history.length).toBe(before);
    expect((screen.getByLabelText("Draft note") as HTMLInputElement).value).toBe("half typed");
  });
  it("Back or Forward to an address of this page shows the tab it names", () => {
    render(<DetailTabs tabs={tabs} initial="overview" syncAddress />);
    window.history.replaceState(null, "", "/sales/opportunities/o1?tab=scope");
    fireEvent(window, new PopStateEvent("popstate"));
    expect(screen.getByRole("tab", { name: "Scope & dates" }).getAttribute("aria-selected")).toBe("true");
  });
  it("without syncAddress (the side panel on a list) the address is left alone", () => {
    render(<DetailTabs tabs={tabs} initial="overview" />);
    fireEvent.click(screen.getByRole("tab", { name: "Commercial" }));
    expect(address()).toBe("/sales/opportunities/o1?from=follow-ups");
  });
});
