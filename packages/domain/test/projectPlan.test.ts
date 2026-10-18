import { describe, expect, it } from "vitest";
import { DELIVERY_TIMELINE_TEMPLATE, SITE_TIMELINE_TEMPLATE, formatPlanDay, planTableRows, type IssuedPlanPayload } from "../src";

const payload: IssuedPlanPayload = {
  project: { reference: "UAE-P-2026-0001", name: "Floor projection", client_name: "Orbit Motors", location: "Expo Hall 3", site_timezone: "Asia/Dubai" },
  milestones: [{ title: "First draft", due_date: "2099-03-01" }],
  delivery: [{ title: "Moodboard", start_date: "2099-02-01", end_date: "2099-02-03" }, { title: "Storyboard", start_date: null, end_date: null }],
  site: [{ title: "Installation", start_date: null, end_date: null, starts_local: "2099-03-05T08:00", ends_local: "2099-03-07T18:00", tz: "Asia/Dubai" }],
  dependencies: [{ label: "Power drop ready", kind: "power_network", expected_date: "2099-03-04", expected_time: "09:00:00", organisation: "Expo Builders LLC", confirmation: "pending" }],
};

describe("client timeline table", () => {
  it("lists every section in order with plain-language dates", () => {
    const rows = planTableRows(payload);
    expect(rows.map((r) => r.section)).toEqual(["Milestones", "Delivery timeline", "Delivery timeline", "Site production timeline", "Dependencies on others"]);
    expect(rows[0]).toMatchObject({ title: "First draft", when: "1 Mar 2099" });
    expect(rows[1]!.when).toBe("1 Feb 2099 to 3 Feb 2099");
    expect(rows[2]!.when).toBe("Date to be confirmed");
  });
  it("shows site times in the site's local time, with the zone stated", () => {
    const site = planTableRows(payload).find((r) => r.section === "Site production timeline")!;
    expect(site.when).toBe("5 Mar 2099, 08:00 to 7 Mar 2099, 18:00");
    expect(site.detail).toContain("Asia/Dubai");
  });
  it("shows the responsible organisation and confirmation of a dependency, never a person's contact details", () => {
    const dep = planTableRows(payload).at(-1)!;
    expect(dep.when).toBe("4 Mar 2099, 09:00");
    expect(dep.detail).toBe("Expo Builders LLC · Not yet confirmed");
  });
  it("formats a missing date honestly", () => {
    expect(formatPlanDay(null)).toBe("Date to be confirmed");
  });
});

describe("suggested timelines", () => {
  it("contain the delivery and site stages the business uses, as editable suggestions only", () => {
    expect(DELIVERY_TIMELINE_TEMPLATE.map((t) => t.title)).toEqual(["Moodboard", "Storyboard", "First draft", "Final render", "Application demo", "Hardware demo", "Full test"]);
    expect(SITE_TIMELINE_TEMPLATE.map((t) => t.title)).toEqual(["Site / stand access", "Equipment arrival", "Installation", "Integration", "Testing", "Client handover", "Show support", "Dismantling"]);
    expect([...DELIVERY_TIMELINE_TEMPLATE, ...SITE_TIMELINE_TEMPLATE].some((t) => t.client_facing)).toBe(false);   // nothing is client-visible by default
  });
});
