/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

import { ModuleNavigation } from "./sidebar-nav";
import type { NavModuleData } from "./nav-groups";

const finance = (waiting?: number): NavModuleData => ({
  id: "finance", label: "Finance", iconKey: "reimbursements", href: "/finance/project-budgets",
  sections: [{ label: "Finance", links: [{ href: "/finance/project-budgets", label: "Project budgets", iconKey: "reimbursements" }] }],
  ...(waiting === undefined ? {} : { waiting }),
});

describe("Finance menu entry waiting number", () => {
  it("shows the number with a spoken label when something waits", () => {
    const html = renderToStaticMarkup(<ModuleNavigation modules={[finance(3)]} />);
    expect(html).toContain("Finance");
    expect(html).toContain(">3<");
    expect(html).toContain("3 waiting for your decision");
  });
  it("shows nothing when there is no number (none waiting, or the count could not be read)", () => {
    const html = renderToStaticMarkup(<ModuleNavigation modules={[finance()]} />);
    expect(html).not.toContain("waiting for your decision");
  });
  it("caps a large number and keeps it readable when the menu is collapsed", () => {
    expect(renderToStaticMarkup(<ModuleNavigation modules={[finance(150)]} />)).toContain("99+");
    expect(renderToStaticMarkup(<ModuleNavigation modules={[finance(5)]} collapsed />)).toContain("5 waiting for your decision");
  });
});
