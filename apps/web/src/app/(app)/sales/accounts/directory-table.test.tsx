/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

vi.mock("@/lib/actions/outreach", () => ({ assignOutreach: vi.fn() }));
import type { CrmOrganisationRow } from "@/types/crm";
import { buildDirectoryRows, sortDirectory, type DirectoryRow } from "@/lib/crm/clients-agencies/directory";
import { SelectionProvider } from "./outreach-select";
import { DirectoryTable, ENQUIRIES_NOTE, PhoneSort, QuickFilters, RelationshipBadge } from "./directory-table";

const CO = "aaaaaaaa-0000-4000-8000-000000000001";
const org = (id: string, name: string, extra: Partial<CrmOrganisationRow> = {}) => ({ id, name, roles: ["agency", "client"], country_code: "AE", archived_at: null, ...extra }) as unknown as CrmOrganisationRow;
const opp = (id: string, o: string, stage: string, created_at: string) => ({ id, company_id: CO, agency_org_id: null, client_org_id: o, stage, created_at }) as never;
const build = (opportunities: never[] | null): DirectoryRow[] => buildDirectoryRows({
  organisations: [org("a", "Fictional Alpha"), org("b", "Fictional Beta", { roles: [], country_code: null })], contacts: [], companyId: CO, now: new Date("2026-11-08T08:00:00Z"),
  profiles: [{ organisation_id: "a", company_id: CO, owner_id: "u1", lead_source: null, exhibition: null }] as never, opportunities,
});
const view = (rows: DirectoryRow[], over: Partial<Parameters<typeof DirectoryTable>[0]> = {}) => render(
  <SelectionProvider>
    <DirectoryTable rows={rows} sort={{ key: "name", dir: "asc" }} hrefFor={(k) => `/s?sort=${k}`} accountHref={(id) => `/sales/accounts/${id}`} canSelect ownerName={(id) => (id === "u1" ? "Amal Fixture" : null)} {...over} />
  </SelectionProvider>,
);

describe("directory table", () => {
  const rows = build([opp("1", "a", "won", "2026-10-20T08:00:00Z")]);
  it("has one row per organisation with the columns, a linked name, the badge words and the owner or Unassigned", () => {
    view(rows);
    const heads = screen.getAllByRole("columnheader").map((h) => h.textContent?.replace(/\s+/g, " ").trim());
    expect(heads).toEqual(["Name", "Country", "Type", "Enquiries", "Won enquiries", "Last enquiry", "Relationship", "Account owner"]);
    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(screen.getByRole("link", { name: "Fictional Alpha" }).getAttribute("href")).toBe("/sales/accounts/a");
    const alpha = within(screen.getAllByRole("row")[1]!);
    expect(alpha.getByText("Won work")).toBeTruthy();
    expect(alpha.getByText("Amal Fixture")).toBeTruthy();
    expect(alpha.getByText("Agency")).toBeTruthy();
    expect(alpha.getByText("End client")).toBeTruthy(); // several roles together
    expect(alpha.getByText("20 Oct 2026")).toBeTruthy();
    const beta = within(screen.getAllByRole("row")[2]!);
    expect(beta.getByText("No enquiries recorded")).toBeTruthy();
    expect(beta.getByText("Unassigned")).toBeTruthy();
    expect(beta.getByText("None")).toBeTruthy(); // no enquiry date
  });
  it("the Enquiries heading carries the 'not quotes' hint, and the sort links are labelled", () => {
    view(rows);
    const enq = screen.getByRole("link", { name: /Enquiries/ });
    expect(enq.getAttribute("title")).toContain(ENQUIRIES_NOTE);
    expect(ENQUIRIES_NOTE).toBe("CRM enquiries linked to this account, not quotes Enginious sent");
  });
  it("marks the sorted column with aria-sort (and none on the others)", () => {
    view(rows, { sort: { key: "last", dir: "desc" } });
    const th = (name: RegExp) => screen.getAllByRole("columnheader").find((h) => name.test(h.textContent ?? ""))!;
    expect(th(/Last enquiry/).getAttribute("aria-sort")).toBe("descending");
    expect(th(/Country/).getAttribute("aria-sort")).toBe("none");
    expect(th(/^Name/).getAttribute("aria-sort")).toBe("none");
  });
  it("name ascending is the default mark", () => {
    view(rows);
    expect(screen.getAllByRole("columnheader")[0]!.getAttribute("aria-sort")).toBe("ascending");
  });
  it("every checkbox has a name, including select-all", () => {
    view(rows);
    expect(screen.getByRole("checkbox", { name: "Select all 2 accounts on this page" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Select Fictional Alpha for outreach" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Select Fictional Beta for outreach" })).toBeTruthy();
  });
  it("no checkboxes without the assign owners right", () => {
    view(rows, { canSelect: false });
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });
  it("a failed enquiries read shows Could not load, no zero and no badge", () => {
    view(build(null));
    const r = within(screen.getAllByRole("row")[1]!);
    expect(r.getAllByText("Could not load")).toHaveLength(4); // enquiries, won, last enquiry, relationship
    expect(r.queryByText("0")).toBeNull();
    for (const w of ["Won work", "No wins yet", "No enquiries recorded", "Dormant"]) expect(r.queryByText(w)).toBeNull();
    expect(r.getByText("Amal Fixture")).toBeTruthy(); // what loaded still shows
    expect(r.getByText("United Arab Emirates")).toBeTruthy();
  });
  it("sorted rows render in that order", () => {
    const sorted = sortDirectory(rows, { key: "name", dir: "desc" }, () => null);
    view(sorted, { sort: { key: "name", dir: "desc" } });
    expect(screen.getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("link")[0]!.textContent)).toEqual(["Fictional Beta", "Fictional Alpha"]);
  });
});

describe("relationship badge", () => {
  it("each badge has its words (colour is never the only signal) and an icon", () => {
    for (const [value, words, tone] of [["won", "Won work", "green"], ["no_wins", "No wins yet", "amber"], ["none", "No enquiries recorded", "neutral"], ["dormant", "Dormant", "purple"]] as const) {
      const { container, unmount } = render(<RelationshipBadge value={value} />);
      expect(container.textContent).toBe(words);
      expect(container.querySelector(".os-badge")?.getAttribute("data-tone")).toBe(tone);
      expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
      unmount();
    }
  });
});

describe("quick filters", () => {
  const counts = { won: 4, no_wins: 3, none: 2, dormant: 1 };
  const hrefFor = (rel: string) => `/x?rel=${rel}`;
  it("lists All and the four badges with counts, links toggling one at a time", () => {
    render(<QuickFilters active="dormant" counts={counts} available hrefFor={hrefFor} />);
    expect(screen.getByRole("link", { name: /^All\s*\(10\)/ }).getAttribute("href")).toBe("/x?rel=");
    expect(screen.getByRole("link", { name: /Won work\s*\(4\)/ }).getAttribute("href")).toBe("/x?rel=won");
    expect(screen.getByRole("link", { name: /No wins yet\s*\(3\)/ }).getAttribute("href")).toBe("/x?rel=no_wins");
    expect(screen.getByRole("link", { name: /No enquiries recorded\s*\(2\)/ }).getAttribute("href")).toBe("/x?rel=none");
    // the active one links back to All, and is marked current
    const on = screen.getByRole("link", { name: /Dormant\s*\(1\)/ });
    expect(on.getAttribute("href")).toBe("/x?rel=");
    expect(on.getAttribute("aria-current")).toBe("true");
    expect(screen.getByText(/Dormant = last enquiry 90\+ days ago and no open enquiry/)).toBeTruthy();
  });
  it("when the figures could not load the filters are unavailable, say Could not load, and are not links", () => {
    render(<QuickFilters active="" counts={null} available={false} hrefFor={hrefFor} />);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.getAllByText(/Could not load/)).toHaveLength(4);
  });
});

describe("phone sort links", () => {
  it("offers every sort, with the direction of the active one in words", () => {
    render(<PhoneSort sort={{ key: "won", dir: "desc" }} hrefFor={(k) => `/s?sort=${k}`} />);
    expect(screen.getAllByRole("link")).toHaveLength(7);
    expect(screen.getByRole("link", { name: /Won enquiries\s*descending/ }).getAttribute("aria-current")).toBe("true");
  });
});
