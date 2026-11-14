import { describe, expect, it } from "vitest";
import { handoverReadiness, RESUBMIT_TELLS, SUBMIT_TELLS, WITHDRAW_CONSEQUENCE, type ReadinessBrief } from "./readiness";

// Fictional enquiry.
const brief = (over: Partial<ReadinessBrief> = {}): ReadinessBrief => ({
  title: "Fictional Expo stand", clientName: "Northwind Events", location: "Hall 4, Dubai", siteTimezone: "Asia/Dubai", installStart: "2027-02-01", eventStart: "2027-02-03", eventEnd: "2027-02-05",
  scope: "Two LED walls, installed and run", exclusions: "", notes: "Loading bay closes at 18:00", technologies: [{ name: "LED wall", qty: 2 }], risks: ["Venue power unconfirmed"], ...over,
});
const fmt = (d: string) => `D(${d})`;
const run = (over: Partial<Parameters<typeof handoverReadiness>[0]> = {}) => handoverReadiness({ brief: brief(), saved: true, edition: null, contactCount: 2, formatDate: fmt, ...over });

describe("what a handover transfers", () => {
  it("names each field the project really receives, in the order of the brief, with the value it will carry", () => {
    const r = run();
    expect(r.ready).toBe(true);
    expect(r.transfers.map((t) => t.label)).toEqual(["Project name", "Scope of work", "Exclusions", "Client", "Location", "Installation date", "Show dates", "Site time zone", "Technologies and quantities", "Risks"]);
    const value = (key: string) => r.transfers.find((t) => t.key === key)!;
    expect(value("show").value).toBe("D(2027-02-03) to D(2027-02-05)");
    expect(value("technologies").value).toBe("LED wall × 2");
    expect(value("risks").value).toBe("1 risk");
    expect(value("exclusions")).toMatchObject({ value: "None recorded", missing: true });
    // The notes are NOT in the list: the database does not copy them onto the project.
    expect(r.transfers.some((t) => /note/i.test(t.label))).toBe(false);
  });

  it("lists the event edition only when one is linked, and says it is a copy", () => {
    expect(run().transfers.some((t) => t.key === "edition")).toBe(false);
    expect(run({ edition: "Fictional Expo · 2027 · Dubai" }).transfers.at(-1)).toMatchObject({ label: "Event edition", value: "Fictional Expo · 2027 · Dubai (copied as it stands when you submit)" });
  });

  it("a new brief left without a client says where the name will come from", () => {
    expect(run({ saved: false, brief: brief({ clientName: "" }) }).transfers.find((t) => t.key === "client")).toMatchObject({ value: "The client or agency on the enquiry", missing: false });
    expect(run({ saved: true, brief: brief({ clientName: "" }) }).transfers.find((t) => t.key === "client")).toMatchObject({ value: "Not given", missing: true });
  });
});

describe("what needs attention", () => {
  it("a missing scope is the one blocker, listed first, and the handover is not ready", () => {
    const r = run({ brief: brief({ scope: "   " }) });
    expect(r.ready).toBe(false);
    expect(r.attention[0]).toMatchObject({ kind: "blocker", key: "scope" });
    expect(r.attention[0]!.text).toMatch(/cannot be submitted without it/);
    expect(r.attention.filter((a) => a.kind === "blocker")).toHaveLength(1);
  });

  it("missing dates, place and technologies are checks, never blockers; the enquiry's own gaps are listed as checks too", () => {
    const r = run({ brief: brief({ installStart: "", eventStart: "", eventEnd: "", location: "", technologies: [] }), salesGaps: ["No accepted proposal is recorded."] });
    expect(r.ready).toBe(true);
    expect(r.attention.filter((a) => a.kind === "check").map((a) => a.key)).toEqual(["dates", "location", "technologies", "gap-0"]);
    expect(r.attention.find((a) => a.key === "gap-0")!.text).toBe("On the enquiry: No accepted proposal is recorded.");
  });

  it("says in words what is NOT copied: contacts, the notes and everything commercial", () => {
    const text = (r: ReturnType<typeof run>, key: string) => r.attention.find((a) => a.key === key)!;
    const r = run();
    expect(text(r, "contacts")).toMatchObject({ kind: "not_copied" });
    expect(text(r, "contacts").text).toMatch(/^Contacts are not copied: the 2 contacts and their roles stay on the enquiry\. The Project Manager opens them from the enquiry link/);
    expect(text(r, "notes").text).toMatch(/stay on this brief.*not copied onto the project itself/);
    expect(text(r, "commercial").text).toMatch(/value, payment terms, purchase order or authorised email, proposals, estimates and files stay in Sales & CRM/);
    expect(text(r, "plan").text).toMatch(/only when the Project Manager brings them in/);
    expect(text(run({ contactCount: 0 }), "contacts").text).toMatch(/this enquiry has none linked/);
    // Contacts that could not be read are never worded as "none".
    expect(text(run({ contactCount: null }), "contacts").text).toMatch(/could not be loaded just now/);
    expect(text(run({ contactCount: null }), "contacts").text).not.toMatch(/none linked/);
  });

  it("the consequences of submitting and withdrawing say who is told and that nothing goes to the client", () => {
    expect(SUBMIT_TELLS).toMatch(/Founders, Operations Managers and anyone who can assign Project Managers.*notification in the app/);
    expect(SUBMIT_TELLS).toMatch(/Nothing is sent to the client\./);
    expect(RESUBMIT_TELLS).toMatch(/The Project Manager gets a notification in the app/);
    expect(WITHDRAW_CONSEQUENCE).toMatch(/no project is created from it\. Nobody is notified/);
    for (const s of [SUBMIT_TELLS, RESUBMIT_TELLS, WITHDRAW_CONSEQUENCE]) expect(s).not.toContain("—");
  });
});
