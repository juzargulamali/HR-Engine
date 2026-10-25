import { describe, expect, it, vi } from "vitest";
import {
  canChangeGrant, canConfirmCount, capabilityDisabledReason, computeChecklist, COMMON_TIMEZONES, countDifference, isCapabilityDisabled, isValidTimezone,
  legacyRowsIncomplete, legacyRowsToImport, legacySkipWords, linesMissingReason, missingSuggestions, normaliseLocationCode, operatorNeedsLocations,
  parseCountedQty, reasonRequired, sendableCapabilities, timezonePreview, utcOffsetLabel, wouldRemoveLastFounder, type SetupFacts,
} from "./setup";

const empty: SetupFacts = {
  activeLocations: 0, locationsWithStock: 0, categories: 0, activeItems: 0, draftItems: 0, stockKnown: true, draftUnitsOnShelf: 0, draftUnitsWithPeople: 0,
  confirmedCustodyUnits: 0, totalUnits: 0, labelledUnits: 0, confirmedOpeningCounts: 0, openCounts: 0,
};
const state = (f: Partial<SetupFacts>) => computeChecklist({ ...empty, ...f }).steps.map((s) => s.state);

describe("getting started checklist", () => {
  it("has the five steps and nothing is done on an empty company", () => {
    const c = computeChecklist(empty);
    expect(c.steps.map((s) => s.id)).toEqual([1, 2, 3, 4, 5]);
    expect(c.doneCount).toBe(0);
    expect(c.total).toBe(5);
    expect(state({})).toEqual(["todo", "todo", "todo", "todo", "todo"]);
  });

  it("step 1 needs both a category and an active item", () => {
    expect(state({ categories: 2 })[0]).toBe("partial");
    expect(state({ activeItems: 3 })[0]).toBe("partial");
    expect(state({ draftItems: 3 })[0]).toBe("partial");
    expect(state({ categories: 2, activeItems: 3 })[0]).toBe("done");
  });

  it("step 2 counts locations that hold stock, and asks for a location first", () => {
    expect(computeChecklist(empty).steps[1]!.detail).toMatch(/add a location first/i);
    expect(state({ activeLocations: 3, locationsWithStock: 1 })[1]).toBe("partial");
    expect(state({ activeLocations: 3, locationsWithStock: 3 })[1]).toBe("done");
    expect(computeChecklist({ ...empty, activeLocations: 3, locationsWithStock: 2 }).steps[1]!.detail).toBe("2 of 3 locations have stock recorded.");
  });

  it("step 3 is partial while people-held units wait, done once confirmed, and never claims done on no evidence", () => {
    expect(state({ draftUnitsWithPeople: 2 })[2]).toBe("partial");
    expect(state({ confirmedCustodyUnits: 4 })[2]).toBe("done");
    expect(state({ confirmedCustodyUnits: 4, draftUnitsWithPeople: 1 })[2]).toBe("partial");
    expect(state({})[2]).toBe("todo");
    expect(computeChecklist(empty).steps[2]!.detail).toMatch(/skip/i);
  });

  it("step 4 follows printed labels", () => {
    expect(state({ totalUnits: 10, labelledUnits: 0 })[3]).toBe("todo");
    expect(state({ totalUnits: 10, labelledUnits: 4 })[3]).toBe("partial");
    expect(state({ totalUnits: 10, labelledUnits: 10 })[3]).toBe("done");
  });

  it("step 5 needs a confirmed opening count and nothing left Not counted yet", () => {
    expect(state({ openCounts: 1 })[4]).toBe("partial");
    expect(state({ confirmedOpeningCounts: 1 })[4]).toBe("done");
    expect(state({ confirmedOpeningCounts: 1, draftUnitsOnShelf: 2 })[4]).toBe("partial");
    expect(state({ confirmedOpeningCounts: 1, openCounts: 1 })[4]).toBe("partial");
  });

  it("says unknown, not done or not done, when the person cannot read stock", () => {
    expect(state({ stockKnown: false, categories: 1, activeItems: 1 })).toEqual(["done", "unknown", "unknown", "unknown", "unknown"]);
  });

  it("counts the done steps", () => {
    const c = computeChecklist({ ...empty, categories: 1, activeItems: 1, activeLocations: 1, locationsWithStock: 1, confirmedCustodyUnits: 1, totalUnits: 2, labelledUnits: 2, confirmedOpeningCounts: 1 });
    expect(c.doneCount).toBe(5);
  });
});

describe("time zones", () => {
  it("offers Dubai, Riyadh and Warsaw in the list", () => {
    const values = COMMON_TIMEZONES.map((t) => t.value);
    expect(values).toEqual(expect.arrayContaining(["Asia/Dubai", "Asia/Riyadh", "Europe/Warsaw"]));
    for (const t of COMMON_TIMEZONES) expect(isValidTimezone(t.value)).toBe(true);
  });

  it("recognises real and invalid zone names", () => {
    expect(isValidTimezone("Asia/Dubai")).toBe(true);
    expect(isValidTimezone("Mars/Olympus")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
    expect(isValidTimezone(null)).toBe(false);
  });

  it("shows the local time and the offset at the place", () => {
    const at = new Date("2026-10-22T10:35:00Z");
    expect(timezonePreview("Asia/Dubai", at)).toBe("Thu 22 Oct, 14:35 (UTC+4)");
    expect(timezonePreview("Asia/Riyadh", at)).toBe("Thu 22 Oct, 13:35 (UTC+3)");
    expect(timezonePreview("Mars/Olympus", at)).toBeNull();
  });

  it("follows summer time in Poland", () => {
    expect(timezonePreview("Europe/Warsaw", new Date("2026-07-01T10:00:00Z"))).toBe("Wed 1 Jul, 12:00 (UTC+2)");
    expect(timezonePreview("Europe/Warsaw", new Date("2026-12-01T10:00:00Z"))).toBe("Tue 1 Dec, 11:00 (UTC+1)");
  });

  it("writes half-hour offsets and UTC", () => {
    expect(utcOffsetLabel("Asia/Kolkata", new Date("2026-01-01T00:00:00Z"))).toBe("UTC+5:30");
    expect(utcOffsetLabel("UTC")).toBe("UTC");
    expect(utcOffsetLabel("nope")).toBeNull();
  });

  it("calls an offset of nothing UTC even when the runtime spells it GMT+00:00 (as some Node/ICU builds do)", () => {
    const real = Intl.DateTimeFormat;
    const spy = vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function (this: unknown, locale?: string | string[], options?: Intl.DateTimeFormatOptions) {
      const f = new real(locale, options);
      if (options?.timeZoneName !== "longOffset") return f;
      return { formatToParts: () => [{ type: "timeZoneName", value: "GMT+00:00" }] } as unknown as Intl.DateTimeFormat;
    } as unknown as typeof Intl.DateTimeFormat);
    try {
      expect(utcOffsetLabel("UTC")).toBe("UTC");
      expect(utcOffsetLabel("Europe/London", new Date("2026-01-01T00:00:00Z"))).toBe("UTC");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("location suggestions", () => {
  it("offers all three when nothing exists (nothing is ever pre-created)", () => {
    expect(missingSuggestions([]).map((s) => s.name)).toEqual(["Dubai", "Riyadh", "Poznan"]);
  });
  it("does not offer a place that already exists, by name or by code", () => {
    expect(missingSuggestions([{ name: "dubai", code: "XX" }]).map((s) => s.name)).toEqual(["Riyadh", "Poznan"]);
    expect(missingSuggestions([{ name: "Main", code: "poz" }]).map((s) => s.name)).toEqual(["Dubai", "Riyadh"]);
  });
  it("normalises a typed code", () => {
    expect(normaliseLocationCode(" dxb-1 ")).toBe("DXB1");
    expect(normaliseLocationCode("abcdefghijk")).toBe("ABCDEFGH");
  });
});

describe("capability rules", () => {
  it("disables founder, access management and cost rights for people who are not founders", () => {
    for (const cap of ["founder", "manage_access", "view_costs"] as const) {
      expect(isCapabilityDisabled(cap, false)).toBe(true);
      expect(isCapabilityDisabled(cap, true)).toBe(false);
      expect(capabilityDisabledReason(cap)).toMatch(/only a founder/i);
    }
    for (const cap of ["warehouse", "manage_catalogue", "view_stock", "confirm_stock", "cross_location", "view_audit", "request_for_employees", "view_employee_custody"] as const) {
      expect(isCapabilityDisabled(cap, false)).toBe(false);
      expect(capabilityDisabledReason(cap)).toBeNull();
    }
  });
  it("says cost visibility is never part of warehouse access", () => {
    expect(capabilityDisabledReason("view_costs")).toMatch(/never part of warehouse access/i);
  });
  it("never sends a founder-only right from a non-founder", () => {
    expect(sendableCapabilities(["warehouse", "view_costs", "founder", "manage_access", "warehouse"], false)).toEqual(["warehouse"]);
    expect(sendableCapabilities(["warehouse", "view_costs"], true)).toEqual(["warehouse", "view_costs"]);
  });
  it("lets a non-founder change only people without founder-only rights", () => {
    expect(canChangeGrant(["warehouse"], false)).toBe(true);
    expect(canChangeGrant(["warehouse", "view_costs"], false)).toBe(false);
    expect(canChangeGrant(["founder"], true)).toBe(true);
  });
  it("catches removing the last founder", () => {
    expect(wouldRemoveLastFounder(["founder"], [], 1)).toBe(true);
    expect(wouldRemoveLastFounder(["founder"], [], 2)).toBe(false);
    expect(wouldRemoveLastFounder(["founder"], ["founder"], 1)).toBe(false);
    expect(wouldRemoveLastFounder(["warehouse"], [], 1)).toBe(false);
  });
  it("asks for locations only for warehouse operators without all-locations", () => {
    expect(operatorNeedsLocations(["warehouse"], [])).toBe(true);
    expect(operatorNeedsLocations(["warehouse"], ["a"])).toBe(false);
    expect(operatorNeedsLocations(["warehouse", "cross_location"], [])).toBe(false);
    expect(operatorNeedsLocations(["view_stock"], [])).toBe(false);
  });
});

describe("count rules", () => {
  it("requires a typed quantity and never assumes one", () => {
    expect(parseCountedQty("", 0, "cycle")).toEqual({ ok: false, error: "Type the quantity you counted." });
    expect(parseCountedQty("   ", 0, "opening")).toMatchObject({ ok: false });
    expect(parseCountedQty(null, 0, "cycle")).toMatchObject({ ok: false });
  });
  it("accepts whole numbers and decimals within the item's scale", () => {
    expect(parseCountedQty("12", 0, "cycle")).toEqual({ ok: true, value: 12 });
    expect(parseCountedQty("36,5", 3, "cycle")).toEqual({ ok: true, value: 36.5 });
    expect(parseCountedQty("1.2345", 3, "cycle")).toMatchObject({ ok: false });
    expect(parseCountedQty("2.5", 0, "cycle")).toMatchObject({ ok: false, error: expect.stringMatching(/whole numbers/) });
  });
  it("refuses words, negatives and an opening quantity of zero", () => {
    expect(parseCountedQty("abc", 0, "cycle")).toMatchObject({ ok: false });
    expect(parseCountedQty("-3", 0, "cycle")).toMatchObject({ ok: false });
    expect(parseCountedQty("0", 0, "opening")).toMatchObject({ ok: false });
    expect(parseCountedQty("0", 0, "cycle")).toEqual({ ok: true, value: 0 });
  });
  it("needs a reason for any difference on a cycle count only", () => {
    expect(reasonRequired("cycle", 10, 9)).toBe(true);
    expect(reasonRequired("cycle", 10, 10)).toBe(false);
    expect(reasonRequired("cycle", null, 4)).toBe(true);
    expect(reasonRequired("opening", 0, 9)).toBe(false);
    expect(countDifference(10, 9.5)).toBe(-0.5);
  });
  it("lists lines still missing a reason and blocks confirming", () => {
    const lines = [{ counted: 9, expected: 10, reason: null }, { counted: 5, expected: 5, reason: null }, { counted: 1, expected: 0, reason: "Found behind the rack" }];
    expect(linesMissingReason("cycle", lines)).toBe(1);
    expect(canConfirmCount("cycle", "open", lines)).toEqual({ ok: false, why: "1 line differs from the system and still needs a reason." });
    expect(canConfirmCount("cycle", "open", [{ counted: 9, expected: 10, reason: "  " }]).ok).toBe(false);
    expect(canConfirmCount("cycle", "open", [{ counted: 9, expected: 10, reason: "Broken, binned" }]).ok).toBe(true);
    expect(canConfirmCount("opening", "open", [{ counted: 9, expected: 0, reason: null }]).ok).toBe(true);
    expect(canConfirmCount("opening", "open", []).ok).toBe(false);
    expect(canConfirmCount("opening", "confirmed", [{ counted: 1, expected: 0, reason: null }])).toEqual({ ok: false, why: "This count is already confirmed." });
  });
});

describe("legacy import", () => {
  it("imports only ticked rows that have both an item and a location", () => {
    const choices = {
      a: { included: true, itemId: "i1", locationId: "l1" },
      b: { included: true, itemId: "", locationId: "l1" },
      c: { included: false, itemId: "i1", locationId: "l1" },
      d: undefined,
    };
    expect(legacyRowsToImport(choices)).toEqual([{ asset_id: "a", item_id: "i1", location_id: "l1" }]);
    expect(legacyRowsIncomplete(choices)).toBe(1);
  });
  it("words every skip reason the database can give", () => {
    for (const r of ["duplicate_in_request", "asset_not_found", "already_linked", "retired_asset", "item_not_usable", "location_not_usable"]) {
      expect(legacySkipWords(r)).not.toBe(r);
    }
    expect(legacySkipWords(null)).toBe("");
    expect(legacySkipWords("something_new")).toBe("something_new");
  });
});

import { categoryRows, descendantIds, expectedFor } from "./setup";

describe("category tree", () => {
  const cats = [
    { id: "b", name: "Cables", parentId: null, sortOrder: 20, isActive: true },
    { id: "a", name: "Audio", parentId: null, sortOrder: 10, isActive: true },
    { id: "a2", name: "Speakers", parentId: "a", sortOrder: 0, isActive: true },
    { id: "a1", name: "Microphones", parentId: "a", sortOrder: 0, isActive: false },
    { id: "a1x", name: "Wireless", parentId: "a1", sortOrder: 0, isActive: true },
    { id: "z", name: "Orphan", parentId: "gone", sortOrder: 30, isActive: true },
  ];
  it("orders parents before children, siblings by order then name, with depth and path", () => {
    const rows = categoryRows(cats);
    expect(rows.map((r) => [r.id, r.depth])).toEqual([["a", 0], ["a1", 1], ["a1x", 2], ["a2", 1], ["b", 0], ["z", 0]]);
    expect(rows.find((r) => r.id === "a1x")!.path).toBe("Audio › Microphones › Wireless");
  });
  it("finds every descendant, never the category itself", () => {
    expect([...descendantIds(cats, "a")].sort()).toEqual(["a1", "a1x", "a2"]);
    expect(descendantIds(cats, "b").size).toBe(0);
  });
  it("does not loop on bad data", () => {
    const loop = [{ id: "x", name: "X", parentId: "y", sortOrder: 0, isActive: true }, { id: "y", name: "Y", parentId: "x", sortOrder: 0, isActive: true }];
    expect(categoryRows(loop).map((r) => r.id).sort()).toEqual(["x", "y"]);
    expect(descendantIds(loop, "x").has("y")).toBe(true);
  });
});

describe("expected quantity for a count line", () => {
  const balances = [{ itemId: "i1", binId: "b1", condition: "good", qty: 12 }, { itemId: "i1", binId: null, condition: "good", qty: 3 }, { itemId: "i1", binId: "b1", condition: "damaged", qty: 1 }];
  it("matches item, bin and condition, and is zero when there is no row", () => {
    expect(expectedFor(balances, "i1", "b1", "good")).toBe(12);
    expect(expectedFor(balances, "i1", null, "good")).toBe(3);
    expect(expectedFor(balances, "i1", "b1", "damaged")).toBe(1);
    expect(expectedFor(balances, "i1", "b2", "good")).toBe(0);
    expect(expectedFor(balances, "i2", "b1", "good")).toBe(0);
  });
});
