/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/people-access" }));

import { PersonList } from "./person-list";
import type { PaPerson } from "@/lib/people-access/data";

const person = (key: string, name: string, accountStatus: PaPerson["accountStatus"]): PaPerson => ({
  key, userId: key, employeeId: null, name, email: null, jobTitle: null, employeeCompanyId: null, accountStatus, roles: [], grants: [],
});
const base = { companies: [], companyNames: new Map<string, string>(), showRoles: false };

describe("People & Access list: deactivated people", () => {
  afterEach(cleanup);

  it("offers to show hidden deactivated people and says how many are hidden", () => {
    render(<PersonList {...base} people={[person("u:1", "Amina", "active")]} total={1} hiddenDeactivated={3} params={{ q: "am" }} />);
    const t = screen.getByTestId("pa-deactivated-toggle");
    expect(t.textContent).toContain("3 deactivated people are hidden");
    const link = screen.getByRole("link", { name: "Show deactivated people" });
    expect(link.getAttribute("href")).toBe("/people-access?q=am&inactive=1");
  });

  it("uses the singular for one", () => {
    render(<PersonList {...base} people={[]} total={0} hiddenDeactivated={1} params={{}} />);
    expect(screen.getByTestId("pa-deactivated-toggle").textContent).toContain("1 deactivated person is hidden");
    expect(screen.getByText(/Deactivated people are hidden/)).toBeTruthy();
  });

  it("when shown, marks them and offers to hide them again, keeping the search", () => {
    render(<PersonList {...base} people={[person("u:2", "Lena", "deactivated")]} total={1} hiddenDeactivated={0} params={{ q: "le", inactive: "1" }} />);
    expect(screen.getByText("Deactivated")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Hide deactivated people" });
    expect(link.getAttribute("href")).toBe("/people-access?q=le");
  });

  it("shows no toggle when nobody is deactivated", () => {
    render(<PersonList {...base} people={[person("u:1", "Amina", "active")]} total={1} hiddenDeactivated={0} params={{}} />);
    expect(screen.queryByTestId("pa-deactivated-toggle")).toBeNull();
  });
});
