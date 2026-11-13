// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/projects/p1/delivery" }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("./user-menu", () => ({ UserMenu: () => null }));
import { DesktopSidebar, ModuleNavigation } from "./sidebar-nav";
import type { NavModuleData } from "./nav-groups";

afterEach(() => { cleanup(); document.cookie = "sidebar-collapsed=; path=/; max-age=0"; window.localStorage.clear(); });

const projects: NavModuleData = {
  id: "projects", label: "Projects", iconKey: "projects", href: "/projects",
  sections: [{ label: "Projects", links: [{ href: "/projects", label: "All projects", iconKey: "projects" }, { href: "/projects/p1/delivery", label: "Project Plan", iconKey: "projects" }, { href: "/projects/mine", label: "My work", iconKey: "projects", secondary: true }] }],
};
const finance: NavModuleData = { id: "finance", label: "Finance", iconKey: "reimbursements", href: "/finance", sections: [] };
const sidebar = (props: Partial<React.ComponentProps<typeof DesktopSidebar>> = {}) => (
  <DesktopSidebar modules={[projects, finance]} fullName="Fictional Pm" email={null} roleLabels={[]} signOutSlot={null} {...props} />
);

describe("collapsed desktop sidebar", () => {
  it("is drawn collapsed from the first paint when the server says so: icon rail width, no wide-then-narrow flash, nothing animates yet", () => {
    const html = renderToStaticMarkup(sidebar({ defaultCollapsed: true }));
    expect(html).toContain("w-[4.5rem]");
    expect(html).not.toContain("w-[16rem]");
    expect(html).toContain('data-collapsed="true"');
    expect(html).not.toContain("transition-[width]");
    expect(html).toContain('aria-label="Expand sidebar"');
    expect(renderToStaticMarkup(sidebar())).toContain("w-[16rem]");
  });

  it("the Collapse button persists the choice in a cookie (what the server reads) and in storage, and Expand clears it", () => {
    render(sidebar());
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(document.cookie).toContain("sidebar-collapsed=1");
    expect(window.localStorage.getItem("sidebar-collapsed")).toBe("1");
    expect(screen.getByRole("complementary", { name: /modules/ }).getAttribute("data-collapsed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(document.cookie).toContain("sidebar-collapsed=0");
  });

  it("someone who collapsed it before the cookie existed keeps their choice, and the cookie is written for the next load", async () => {
    window.localStorage.setItem("sidebar-collapsed", "1");
    render(sidebar());
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole("complementary", { name: /modules/ }).getAttribute("data-collapsed")).toBe("true");
    expect(document.cookie).toContain("sidebar-collapsed=1");
  });

  it("the icon rail reaches a module's pages: the icon links to the module, and its pages open beside it on hover or focus, with the current page marked", () => {
    render(<ModuleNavigation modules={[projects, finance]} collapsed />);
    expect(screen.queryByTestId("rail-flyout-projects")).toBeNull();
    const home = screen.getByRole("link", { name: "Projects" });
    expect(home.getAttribute("href")).toBe("/projects");
    fireEvent.mouseEnter(home);
    const fly = screen.getByTestId("rail-flyout-projects");
    const links = within(fly).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["All projects", "Project Plan"]);          // the secondary link stays out, as in the open sidebar
    expect(within(fly).getByRole("link", { name: "Project Plan" }).getAttribute("aria-current")).toBe("page");
    expect(within(fly).getByRole("link", { name: "All projects" }).getAttribute("aria-current")).toBeNull();
    fireEvent.keyDown(fly, { key: "Escape" });
    expect(screen.queryByTestId("rail-flyout-projects")).toBeNull();
    // keyboard: focusing the icon opens it, and the pages come straight after it in tab order
    fireEvent.focus(home);
    expect(screen.getByTestId("rail-flyout-projects")).toBeTruthy();
    expect(home.compareDocumentPosition(screen.getByRole("link", { name: "All projects" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // a module with no pages of its own keeps its plain label
    expect(screen.queryByTestId("rail-flyout-finance")).toBeNull();
  });
});
