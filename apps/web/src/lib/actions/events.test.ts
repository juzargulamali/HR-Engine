import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

import { removeEdition, removeEvent, removeObservation, saveEdition, saveEvent, saveObservation, setOpportunityEdition, setOutreachPriority } from "./events";

const A = "11111111-1111-4111-8111-111111111111"; // edition
const B = "22222222-2222-4222-8222-222222222222"; // exhibitor
const C = "33333333-3333-4333-8333-333333333333"; // agency
const E = "44444444-4444-4444-8444-444444444444"; // event
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); return f; };
const calls = (name: string) => rpc.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);

beforeEach(() => { rpc.mockReset().mockResolvedValue({ data: "new-id", error: null }); });

describe("outreach priority", () => {
  it("sets 1 to 5 or clears it (Unrated = null) through the one function", async () => {
    expect(await setOutreachPriority(B, 5)).toEqual({ error: null });
    expect(await setOutreachPriority(B, null)).toEqual({ error: null });
    expect(calls("crm_set_outreach_priority")).toEqual([{ p_org: B, p_priority: 5 }, { p_org: B, p_priority: null }]);
  });
  it("refuses 0, 6, a fraction and a bad id before calling the database; a refusal from the database is shown in words", async () => {
    for (const bad of [0, 6, 2.5]) expect((await setOutreachPriority(B, bad)).error).toMatch(/1 to 5/);
    expect((await setOutreachPriority("nope", 3)).error).toBe("Missing account.");
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: null, error: { message: "You do not have Sales access" } });
    expect((await setOutreachPriority(B, 3)).error).toBeTruthy();
  });
});

describe("events and editions", () => {
  it("adds an event with its kind; a blank name is refused before the database; a duplicate comes back in words", async () => {
    expect(await saveEvent({ error: null }, fd({ name: " GITEX Global ", kind: "exhibition", website: "https://gitex.example" }))).toEqual({ error: null, id: "new-id" });
    expect(calls("crm_save_event")[0]).toEqual({ p_id: null, p_name: "GITEX Global", p_kind: "exhibition", p_website: "https://gitex.example", p_note: null });
    expect((await saveEvent({ error: null }, fd({ name: "  " }))).error).toMatch(/event name/);
    rpc.mockResolvedValue({ data: null, error: { message: "An event with that name already exists. Open it and add the next edition instead." } });
    expect((await saveEvent({ error: null }, fd({ name: "GITEX Global" }))).error).toMatch(/already exists/);
  });
  it("adds the next edition for one event and validates the dates and country before the database", async () => {
    await saveEdition({ error: null }, fd({ eventId: E, start: "2027-10-11", end: "2027-10-15", city: "Dubai", country: "ae", venue: "Fictional Hall" }));
    expect(calls("crm_save_edition")[0]).toEqual({ p_id: null, p_event: E, p_start: "2027-10-11", p_end: "2027-10-15", p_city: "Dubai", p_country: "AE", p_venue: "Fictional Hall", p_note: null });
    const bads: Record<string, string>[] = [{ start: "2027-10-15", end: "2027-10-11" }, { start: "x", end: "2027-10-11" }, { start: "2027-10-11", end: "2027-10-15", country: "UAE" }];
    for (const bad of bads) {
      expect((await saveEdition({ error: null }, fd({ eventId: E, ...bad }))).error).toBeTruthy();
    }
    expect((await saveEdition({ error: null }, fd({ start: "2027-10-11", end: "2027-10-15" }))).error).toMatch(/Choose the event/);
    expect(calls("crm_save_edition")).toHaveLength(1);
  });
  it("editing an edition sends its id and never an event (it cannot move)", async () => {
    await saveEdition({ error: null }, fd({ id: A, start: "2026-10-12", end: "2026-10-17" }));
    expect(calls("crm_save_edition")[0]).toMatchObject({ p_id: A, p_event: null });
  });
  it("says whether a removal deleted or archived", async () => {
    rpc.mockResolvedValueOnce({ data: "archived", error: null });
    expect(await removeEdition(A)).toEqual({ error: null, archived: true });
    rpc.mockResolvedValueOnce({ data: "deleted", error: null });
    expect(await removeEvent(E)).toEqual({ error: null, archived: false });
    expect((await removeEdition("nope")).error).toBe("Missing edition.");
  });
});

describe("observations", () => {
  const base = { editionId: A, exhibitorId: B };
  it("records an exhibitor with a known agency, an optional stand and role, unverified by default", async () => {
    expect(await saveObservation({ error: null }, fd({ ...base, kind: "exhibited", agencyId: C, stand: " B12 ", role: "stand_builder" }))).toEqual({ error: null, id: "new-id" });
    expect(calls("crm_record_observation")[0]).toEqual({
      p_edition: A, p_exhibitor: B, p_kind: "exhibited", p_agency: C, p_agency_unknown: false, p_stand: "B12", p_role: "stand_builder", p_note: null, p_verification: "unverified",
    });
  });
  it("Agency unknown sends no agency; Confirmed sends confirmed", async () => {
    await saveObservation({ error: null }, fd({ ...base, kind: "exhibited", agencyId: "", agencyUnknown: "on", confirmed: "on" }));
    expect(calls("crm_record_observation")[0]).toMatchObject({ p_agency: null, p_agency_unknown: true, p_verification: "confirmed" });
  });
  it("Did not exhibit is its own record with no agency, stand or role even if the form carried them", async () => {
    await saveObservation({ error: null }, fd({ ...base, kind: "did_not_exhibit", agencyId: C, stand: "A1", role: "stand_builder" }));
    expect(calls("crm_record_observation")[0]).toMatchObject({ p_kind: "did_not_exhibit", p_agency: null, p_agency_unknown: false, p_stand: null, p_role: null });
  });
  it("needs the edition and the exhibitor, and an agency or Agency unknown (not both), before the database is called", async () => {
    expect((await saveObservation({ error: null }, fd({ exhibitorId: B, kind: "exhibited", agencyUnknown: "on" }))).error).toMatch(/Choose the edition/);
    expect((await saveObservation({ error: null }, fd({ editionId: A, kind: "exhibited", agencyUnknown: "on" }))).error).toMatch(/Choose the exhibitor/);
    expect((await saveObservation({ error: null }, fd({ ...base, kind: "exhibited" }))).error).toMatch(/Choose the agency/);
    expect((await saveObservation({ error: null }, fd({ ...base, kind: "exhibited", agencyId: C, agencyUnknown: "on" }))).error).toMatch(/not both/);
    expect((await saveObservation({ error: null }, fd({ ...base, kind: "exhibited", agencyUnknown: "on", role: "caterer" }))).error).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("editing sends the id (the edition and exhibitor stay as recorded); removing needs a valid id", async () => {
    await saveObservation({ error: null }, fd({ id: A, kind: "exhibited", agencyUnknown: "on" }));
    expect(calls("crm_update_observation")[0]).toMatchObject({ p_id: A, p_kind: "exhibited", p_agency_unknown: true });
    expect(calls("crm_record_observation")).toHaveLength(0);
    expect(await removeObservation(A)).toEqual({ error: null });
    expect((await removeObservation("nope")).error).toBe("Missing observation.");
  });
});

describe("linking an enquiry to an edition", () => {
  it("sets, changes or clears the link with the enquiry's version", async () => {
    await setOpportunityEdition(B, A, 3);
    await setOpportunityEdition(B, null, 4);
    expect(calls("crm_set_opportunity_edition")).toEqual([{ p_id: B, p_edition: A, p_expected_version: 3 }, { p_id: B, p_edition: null, p_expected_version: 4 }]);
    expect((await setOpportunityEdition("nope", A, 1)).error).toMatch(/Missing/);
  });
});
