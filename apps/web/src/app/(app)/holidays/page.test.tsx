/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { failing, fakeSupabase, row, rows, type FakeResult } from "@/test/fake-supabase";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/holidays", useSearchParams: () => new URLSearchParams(), redirect: vi.fn() }));

let grants: { role: string; companyId: string | null; countryCode: string | null }[] = [];
let tables: Record<string, FakeResult> = {};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeSupabase(tables) }));
vi.mock("@/lib/auth/session", () => ({ getCurrentSession: async () => ({ userId: "u1", employeeId: "e1", email: null, fullName: "Person", grants }) }));

import HolidaysPage from "./page";

const render = async () => renderToStaticMarkup((await HolidaysPage()) as never);
beforeEach(() => {
  grants = [{ role: "employee", companyId: "c1", countryCode: null }];
  tables = {
    countries: rows([{ code: "AE", name: "United Arab Emirates" }, { code: "PL", name: "Poland" }]),
    employees: row({ country_code: "AE" }),
    public_holidays: rows([
      { id: "h1", country_code: "AE", holiday_date: "2099-12-02", name: "National Day" },
      { id: "h2", country_code: "AE", holiday_date: "2020-01-01", name: "New Year's Day" },
      { id: "h3", country_code: "PL", holiday_date: "2099-11-11", name: "Independence Day" },
    ]),
  };
});

describe("Holidays page for staff (U-22)", () => {
  it("shows what is coming in their own country first, folds the past and other countries, and drops the HR explanation and controls", async () => {
    const html = await render();
    expect(html).toContain("Coming up in United Arab Emirates");
    expect(html).toContain("National Day");
    expect(html).toContain("Earlier (1)");
    expect(html).toContain("Other countries (1)");
    expect(html).toContain("Independence Day");
    expect(html.indexOf("National Day")).toBeLessThan(html.indexOf("Independence Day"));
    for (const hr of ["Add a holiday", "leave day-count calculator", "pending confirmation", "Delete"]) expect(html).not.toContain(hr);
  });
  it("lists every country when the person's country cannot be read", async () => {
    tables.employees = failing();
    const html = await render();
    expect(html).toContain("All countries (3)");
    expect(html).toContain("is not recorded on your employee record");
  });
  it("a failed holiday read is still 'could not load', not an empty calendar", async () => {
    tables.public_holidays = failing();
    expect(await render()).toContain("Could not load the public holidays");
  });
  it("HR who manage holidays keep the full page", async () => {
    grants = [{ role: "hr_admin", companyId: null, countryCode: null }];
    const html = await render();
    expect(html).toContain("Add a holiday");
    expect(html).toContain("leave day-count calculator");
  });
});
