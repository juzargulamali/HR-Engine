import { describe, expect, it } from "vitest";
import { computeExceptions, computeSetup, peopleAccessHref, remainingSteps, setupSummary, type SetupInput } from "./setup";
import { DOCUMENT_TYPES, documentFormHref, expiryState, missingForType, ruleFor, ruleForKey, storedCode, typesForCountry } from "./document-types";
import { outcomeSentence, planChange, splitTimeline, type CareerEventRow } from "./changes";

const base: SetupInput = {
  employeeId: "e1", employmentStatus: "active", removed: false,
  counts: { contracts: 0, compensation: 0, identityDocuments: 0, employeeDocuments: 0, openingBalances: 0 },
  linkedUserId: null, viewerCanInvite: false, viewerCanOpenAccess: false,
};

describe("computeSetup", () => {
  it("a fresh employee has contract, pay, documents and account to do; opening balances are optional", () => {
    const steps = computeSetup(base);
    expect(steps.map((s) => [s.key, s.status])).toEqual([["contract", "todo"], ["compensation", "todo"], ["documents", "todo"], ["opening_balances", "optional"], ["account", "todo"]]);
    expect(setupSummary(steps)).toMatchObject({ remaining: 4, total: 4, text: "4 of 4 setup steps to do" });
    expect(steps.find((s) => s.key === "contract")!.href).toBe("/employees/e1?tab=employment&step=contract");
  });
  it("derives done from existing records and never repeats opening balances", () => {
    const steps = computeSetup({ ...base, counts: { contracts: 1, compensation: 2, identityDocuments: 1, employeeDocuments: 0, openingBalances: 2 }, linkedUserId: "u1", viewerCanOpenAccess: true });
    expect(steps.every((s) => s.status === "done")).toBe(true);
    expect(steps.find((s) => s.key === "opening_balances")!.href).toBeNull();
    expect(steps.find((s) => s.key === "account")!.href).toBe("/people-access?person=u%3Au1&tab=account");
    expect(setupSummary(steps).text).toBe("Setup complete");
  });
  it("hides a step the viewer cannot see instead of calling it to do", () => {
    const steps = computeSetup({ ...base, counts: { contracts: null, compensation: null, identityDocuments: null, employeeDocuments: null, openingBalances: null } });
    expect(steps.map((s) => s.key)).toEqual(["account"]);
  });
  it("is Not applicable for someone who has left or was removed", () => {
    expect(computeSetup({ ...base, employmentStatus: "terminated" }).every((s) => s.status === "not_applicable")).toBe(true);
    expect(computeSetup({ ...base, removed: true })[0]!.detail).toMatch(/removed/);
  });
  it("only a System Administrator is sent to invite; an HR Admin is told what to do", () => {
    expect(computeSetup({ ...base, viewerCanInvite: true }).find((s) => s.key === "account")!.href).toBe("/people-access?person=e%3Ae1&tab=account");
    const hr = computeSetup(base).find((s) => s.key === "account")!;
    expect(hr.href).toBe("/employees/e1?tab=overview&step=account");
    expect(hr.detail).toMatch(/System Administrator/);
    expect(remainingSteps(computeSetup(base)).length).toBe(4);
  });
  it("people access links name the person by login when there is one", () => {
    expect(peopleAccessHref("u9", "e1", "modules")).toBe("/people-access?person=u%3Au9&tab=modules");
  });
});

describe("computeExceptions", () => {
  const ex = { employeeId: "e1", employmentStatus: "active" as const, removed: false, jobTitle: "Tech", managerId: "m", managerNotExpected: false, steps: computeSetup({ ...base, counts: { contracts: 1, compensation: 1, identityDocuments: 1, employeeDocuments: 0, openingBalances: 0 }, linkedUserId: "u" }), expiredDocuments: 0, expiringDocuments: 0, scheduledChanges: 0 };
  it("is quiet for a complete record", () => expect(computeExceptions(ex)).toEqual([]));
  it("names what needs action and links to it", () => {
    const e = computeExceptions({ ...ex, managerId: null, jobTitle: null, expiredDocuments: 2, scheduledChanges: 1, steps: computeSetup(base) });
    expect(e.map((x) => x.key)).toEqual(["setup", "manager", "job", "expired", "scheduled"]);
    expect(e[0]!.href).toBe("/employees/e1?tab=employment&step=contract");
  });
  it("says nothing about a manager for a top-level person, and nothing for someone who has left", () => {
    expect(computeExceptions({ ...ex, managerId: null, managerNotExpected: true })).toEqual([]);
    expect(computeExceptions({ ...ex, employmentStatus: "terminated", managerId: null })).toEqual([]);
  });
  it("expiring is information, expired is attention", () => {
    expect(computeExceptions({ ...ex, expiringDocuments: 1 })[0]).toMatchObject({ key: "expiring", tone: "info" });
  });
});

describe("document types", () => {
  it("identity types need a number; employee types need a file; the date rule follows the type", () => {
    expect(missingForType(ruleFor("identity", "passport")!, { number: "", expiry: "2030-01-01", hasFile: false })).toMatch(/number/);
    expect(missingForType(ruleFor("employee", "visa")!, { expiry: "2030-01-01", hasFile: false })).toMatch(/file/);
    expect(missingForType(ruleFor("employee", "visa")!, { expiry: "", hasFile: true })).toMatch(/expiry/);
    expect(missingForType(ruleFor("identity", "pesel")!, { number: "90010112345", hasFile: false })).toBeNull();
    expect(missingForType(ruleFor("employee", "certificate")!, { hasFile: true })).toBeNull();
  });
  it("keeps the stored value of the identity table's own 'other'", () => {
    const r = ruleFor("identity", "other")!;
    expect(r.code).toBe("other_identity");
    expect(storedCode(r)).toBe("other");
    expect(ruleForKey("identity:other_identity")).toBe(r);
    expect(ruleForKey("bogus")).toBeNull();
    expect(new Set(DOCUMENT_TYPES.map((t) => `${t.store}:${t.code}`)).size).toBe(DOCUMENT_TYPES.length);
  });
  it("suggests the types usual for the country first", () => {
    expect(typesForCountry("SA").suggested.map((t) => t.code)).toEqual(["iqama", "visa"]);
    expect(typesForCountry("PL").suggested.map((t) => t.code)).toEqual(["pesel"]);
    expect(typesForCountry("AE").suggested.map((t) => t.code)).toEqual(["emirates_id", "visa", "labor_card"]);
  });
  it("classifies expiry by calendar day", () => {
    expect(expiryState(null, "2026-11-16")).toBe("none");
    expect(expiryState("2026-11-15", "2026-11-16")).toBe("expired");
    expect(expiryState("2026-12-16", "2026-11-16")).toBe("expiring");
    expect(expiryState("2027-06-01", "2026-11-16")).toBe("valid");
  });
  it("builds the form address with the type chosen", () => {
    expect(documentFormHref("e1", "identity", "passport", true)).toBe("/employees/e1?tab=documents&add=identity%3Apassport&renew=1");
    expect(documentFormHref("e1", "identity", "other")).toBe("/employees/e1?tab=documents&add=identity%3Aother_identity");
  });
});

describe("changes", () => {
  const cur = { currentJobTitle: "Technician", currentBasic: 5000, currentOther: 500, today: "2026-11-16" };
  it("refuses an empty change and a bad date", () => {
    expect(planChange({ effectiveDate: "2026-11-16", ...cur })).toMatchObject({ ok: false });
    expect(planChange({ effectiveDate: "", newJobTitle: "Lead", ...cur })).toMatchObject({ ok: false });
    expect(planChange({ effectiveDate: "2026-11-16", newBasic: 0, ...cur })).toMatchObject({ ok: false });
  });
  it("classifies job, pay and both, now or scheduled", () => {
    expect(planChange({ effectiveDate: "2026-11-16", newJobTitle: "Lead", ...cur })).toMatchObject({ ok: true, kind: "job", when: "now" });
    expect(planChange({ effectiveDate: "2026-11-01", newBasic: 5500, ...cur })).toMatchObject({ ok: true, kind: "pay", when: "now" });
    expect(planChange({ effectiveDate: "2027-01-01", newJobTitle: "Lead", newBasic: 6000, ...cur })).toMatchObject({ ok: true, kind: "both", when: "scheduled" });
    expect(planChange({ effectiveDate: "2026-11-16", newJobTitle: "Technician", newBasic: 5000, newOther: 500, ...cur })).toMatchObject({ ok: false });
  });
  it("splits scheduled from history", () => {
    const row = (id: string, d: string, applied: string | null): CareerEventRow => ({ id, effective_date: d, event_type: "promotion", previous_job_title: null, new_job_title: null, previous_base_salary: null, new_base_salary: null, currency: null, note: null, applied_at: applied });
    const t = splitTimeline([row("a", "2026-01-01", "x"), row("b", "2027-03-01", null), row("c", "2027-02-01", null), row("d", "2026-06-01", "x")]);
    expect(t.scheduled.map((r) => r.id)).toEqual(["c", "b"]);
    expect(t.history.map((r) => r.id)).toEqual(["d", "a"]);
  });
  it("says exactly what saved and what did not", () => {
    expect(outcomeSentence({ event: "failed", title: "skipped", pay: "skipped", messages: ["Denied."] }).error).toMatch(/Nothing was saved/);
    const w = outcomeSentence({ event: "saved", title: "applied", pay: "failed", messages: ["The salary insert failed."] });
    expect(w.warning).toMatch(/Saved: the new job title is in force/);
    expect(w.warning).toMatch(/Not saved: the pay/);
    expect(outcomeSentence({ event: "saved", title: "scheduled", pay: "scheduled", messages: [] }).ok).toMatch(/job title is scheduled and the new pay is scheduled/);
  });
});
