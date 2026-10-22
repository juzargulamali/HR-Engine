import { describe, expect, it } from "vitest";
import {
  KIND_CONFIG, emptyDraft, formatInZone, localToUtcIso, nowLocalInput, parseLines, parseQty, parseSerials, sanitizeLines, statusMessage, successMessage,
  summaryRows, toRpcCall, validateInput, type LineDraft, type MovementInput, type MovementKind,
} from "./stock-movements";

const KEY = "mv-12345678-abcd";
const unit = (id: string, over: Partial<LineDraft> = {}): LineDraft => emptyDraft({ id, itemId: "item-laptop", itemName: "Laptop", unitId: `unit-${id}`, code: `UAE-E-0000${id}`, ...over });
const counted = (id: string, over: Partial<LineDraft> = {}): LineDraft =>
  emptyDraft({ id, itemId: "item-xlr", itemName: "XLR cable", tracking: "quantity", scale: 0, ...over });

describe("parseQty", () => {
  it("never treats a blank, zero, negative or text as a quantity", () => {
    for (const bad of ["", "  ", "0", "0.0", "-1", "abc", "1e3", "1..2"]) expect(parseQty(bad, 3).ok, bad).toBe(false);
  });
  it("accepts whole numbers and, only when the item allows, decimals", () => {
    expect(parseQty("12", 0)).toEqual({ ok: true, value: 12 });
    expect(parseQty("2,5", 3)).toEqual({ ok: true, value: 2.5 });
    expect(parseQty("2.50", 1)).toEqual({ ok: true, value: 2.5 });
    expect(parseQty("2.5", 0).ok).toBe(false);
    expect(parseQty("1.2345", 3).ok).toBe(false);
  });
});

describe("parseSerials", () => {
  it("splits on lines, commas and semicolons and drops blanks", () => {
    expect(parseSerials("A1\nB2, C3;;\n\n")).toEqual(["A1", "B2", "C3"]);
  });
});

describe("time zones", () => {
  it("converts a time typed for a place into the UTC instant", () => {
    expect(localToUtcIso("2026-11-03T09:30", "Asia/Dubai")).toBe("2026-11-03T05:30:00.000Z");
    expect(localToUtcIso("2026-07-03T09:30", "Europe/Warsaw")).toBe("2026-07-03T07:30:00.000Z");
    expect(localToUtcIso("2026-01-03T09:30", "Europe/Warsaw")).toBe("2026-01-03T08:30:00.000Z");
  });
  it("refuses what is not a date", () => {
    expect(localToUtcIso("tomorrow", "Asia/Dubai")).toBeNull();
    expect(localToUtcIso("2026-11-03", "Asia/Dubai")).toBeNull();
  });
  it("shows a time in the place's own zone and reads the clock of a place", () => {
    expect(formatInZone("2026-11-03T05:30:00.000Z", "Asia/Dubai")).toContain("09:30");
    expect(formatInZone(null, "Asia/Dubai")).toBe("—");
    expect(nowLocalInput("Asia/Dubai", new Date("2026-11-03T22:30:00Z"))).toBe("2026-11-04T02:30");
  });
});

describe("parseLines", () => {
  it("needs at least one line, except where the database means 'everything'", () => {
    expect(parseLines("issue", []).ok).toBe(false);
    expect(parseLines("return_rental", [])).toEqual({ ok: true, lines: [], units: 0, quantities: 0 });
    expect(parseLines("receive_transfer", []).ok).toBe(true);
    expect(parseLines("unpack_kit", []).ok).toBe(true);
  });

  it("a counted line needs a typed quantity: a scan or a search never implies the whole bin", () => {
    const res = parseLines("issue", [counted("1", { code: "UAE-S-00007", binId: "bin-a" })]);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toMatch(/type the quantity/i);
    expect(!res.ok && res.lineId).toBe("1");
    const typed = parseLines("issue", [counted("1", { qty: "20", binId: "bin-a" })]);
    expect(typed).toEqual({ ok: true, lines: [{ item_id: "item-xlr", qty: 20, bin_id: "bin-a" }], units: 0, quantities: 1 });
  });

  it("refuses more decimals than the item allows and more than the shelf holds", () => {
    expect(parseLines("issue", [counted("1", { qty: "1.5" })]).ok).toBe(false);
    const over = parseLines("issue", [counted("1", { qty: "11", maxQty: 10, uom: "each" })]);
    expect(!over.ok && over.error).toMatch(/only 10 is on the shelf/i);
    expect(parseLines("issue", [counted("1", { qty: "10", maxQty: 10 })]).ok).toBe(true);
  });

  it("lists a unit once", () => {
    const a = unit("1");
    const res = parseLines("issue", [a, { ...a, id: "2" }]);
    expect(!res.ok && res.error).toMatch(/on the list twice/);
  });

  it("issues units by id only", () => {
    expect(parseLines("issue", [unit("1")])).toEqual({ ok: true, lines: [{ unit_id: "unit-1" }], units: 1, quantities: 0 });
  });

  it("a return line carries its condition (good by default) and the bin it goes back to", () => {
    const res = parseLines("return", [unit("1", { binId: "bin-z" }), unit("2", { condition: "damaged", note: " cracked " }), counted("3", { qty: "4", condition: "needs_inspection" })]);
    expect(res).toEqual({
      ok: true, units: 2, quantities: 1,
      lines: [
        { unit_id: "unit-1", condition: "good", bin_id: "bin-z" },
        { unit_id: "unit-2", condition: "damaged", note: "cracked" },
        { item_id: "item-xlr", qty: 4, condition: "needs_inspection" },
      ],
    });
  });

  it("refuses a condition that does not exist for counted stock", () => {
    expect(parseLines("return", [counted("1", { qty: "1", condition: "fair" })]).ok).toBe(false);
    expect(parseLines("return", [unit("1", { condition: "fair" })]).ok).toBe(true);
  });

  it("receiving individual items takes a count and optional serial numbers that must match it", () => {
    const laptop = (over: Partial<LineDraft>) => emptyDraft({ id: "r", itemId: "item-laptop", itemName: "Laptop", tracking: "individual", ...over });
    expect(parseLines("receive", [laptop({ qty: "3" })])).toEqual({ ok: true, lines: [{ item_id: "item-laptop", qty: 3, condition: "good" }], units: 3, quantities: 0 });
    expect(parseLines("receive", [laptop({ serials: "A\nB" })])).toEqual({ ok: true, lines: [{ item_id: "item-laptop", qty: 2, condition: "good", serials: ["A", "B"] }], units: 2, quantities: 0 });
    expect(parseLines("receive", [laptop({ qty: "3", serials: "A\nB" })]).ok).toBe(false);
    expect(parseLines("receive", [laptop({ serials: "A\na" })]).ok).toBe(false);
    expect(parseLines("receive", [laptop({ qty: "201" })]).ok).toBe(false);
    expect(parseLines("receive", [laptop({ qty: "" })]).ok).toBe(false);
    expect(parseLines("receive", [laptop({ qty: "1.5" })]).ok).toBe(false);
  });

  it("receiving counted stock keeps the bin, and costs only when the person may enter them", () => {
    const line = counted("1", { qty: "50", binId: "bin-a", cost: "2,5" });
    expect(parseLines("receive", [line])).toMatchObject({ ok: true, lines: [{ item_id: "item-xlr", qty: 50, condition: "good", bin_id: "bin-a" }] });
    const res = parseLines("receive", [line], { canSeeCosts: true, currency: "aed" });
    expect(res.ok && res.lines[0]).toMatchObject({ unit_cost: 2.5, currency: "AED" });
    expect(parseLines("receive", [{ ...line, cost: "free" }], { canSeeCosts: true }).ok).toBe(false);
  });

  it("transfers send counted stock as good unless said otherwise and units by id", () => {
    expect(parseLines("transfer", [unit("1"), counted("2", { qty: "5", binId: "b" })])).toMatchObject({
      lines: [{ unit_id: "unit-1" }, { item_id: "item-xlr", qty: 5, condition: "good", bin_id: "b" }],
    });
  });

  it("a condition check carries the old and the new condition of counted stock", () => {
    expect(parseLines("check", [counted("1", { qty: "2", fromCondition: "needs_inspection", condition: "good" })])).toMatchObject({
      lines: [{ item_id: "item-xlr", qty: 2, condition: "good", from_condition: "needs_inspection" }],
    });
  });

  it("receiving a transfer can name the condition on arrival", () => {
    expect(parseLines("receive_transfer", [unit("1", { condition: "needs_inspection" })])).toMatchObject({ lines: [{ unit_id: "unit-1", condition: "needs_inspection" }] });
  });
});

describe("sanitizeLines", () => {
  it("keeps only keys and types the database reads", () => {
    const lines = sanitizeLines([
      { unit_id: "u1", evil: "x", qty: "5", condition: "good", __proto__: { a: 1 } },
      { item_id: "i1", qty: 3, serials: ["a", 7, "b"], unit_cost: 1.5, currency: "AED" },
      null, "string", {}, { qty: Infinity },
    ]);
    expect(lines).toEqual([{ unit_id: "u1", condition: "good" }, { item_id: "i1", qty: 3, serials: ["a", "b"], unit_cost: 1.5, currency: "AED" }]);
    expect(sanitizeLines("nope")).toEqual([]);
  });
});

describe("validateInput", () => {
  const base: MovementInput = { kind: "issue", companyId: "c1", locationId: "l1", key: KEY, lines: [{ unit_id: "u1" }], employeeId: "e1" };
  it("accepts a complete request", () => {
    expect(validateInput(base)).toBeNull();
  });
  it("needs a well-formed key, a location and lines", () => {
    expect(validateInput({ ...base, key: "short" })).toMatch(/expired/);
    expect(validateInput({ ...base, locationId: null })).toMatch(/location/i);
    expect(validateInput({ ...base, lines: [] })).toMatch(/at least one/i);
  });
  it("says what is missing for each kind", () => {
    expect(validateInput({ ...base, employeeId: undefined })).toMatch(/employee/);
    expect(validateInput({ ...base, kind: "dispatch", employeeId: undefined })).toMatch(/project/);
    expect(validateInput({ ...base, kind: "dispatch", projectId: "p1" })).toMatch(/expected back/);
    expect(validateInput({ ...base, kind: "dispatch", projectId: "p1", requestId: "r1" })).toBeNull();
    expect(validateInput({ ...base, kind: "return" })).toMatch(/who is returning/i);
    expect(validateInput({ ...base, kind: "return", returnFrom: "project" })).toMatch(/project/);
    expect(validateInput({ ...base, kind: "transfer" })).toMatch(/where it is going/);
    expect(validateInput({ ...base, kind: "transfer", toLocationId: "l1" })).toMatch(/different location/);
    expect(validateInput({ ...base, kind: "repair_out" })).toMatch(/repair reference/);
    expect(validateInput({ ...base, kind: "adjust", adjustAction: "missing" })).toMatch(/reason/);
    expect(validateInput({ ...base, kind: "adjust", adjustAction: "missing", reason: "  " })).toMatch(/reason/);
    expect(validateInput({ ...base, kind: "adjust", adjustAction: "missing", reason: "Not found in the count" })).toBeNull();
    expect(validateInput({ ...base, kind: "consume", employeeId: "e1", projectId: "p1" })).toMatch(/not both/);
    expect(validateInput({ ...base, kind: "project_transfer", projectId: "p1", toProjectId: "p1", requestId: "r" })).toMatch(/two different/);
    expect(validateInput({ ...base, kind: "project_transfer", projectId: "p1", toProjectId: "p2" })).toMatch(/request/);
    expect(validateInput({ ...base, kind: "receive", rental: { supplierName: "", externalReference: "x", returnDeadline: "2026-12-01T00:00:00Z" } })).toMatch(/supplier/);
  });
});

describe("toRpcCall", () => {
  const lines = [{ unit_id: "u1" }];
  it("maps every kind to its database function with its own key", () => {
    const base = { companyId: "c1", locationId: "l1", key: KEY, lines } as const;
    const cases: [MovementKind, Partial<MovementInput>, string][] = [
      ["receive", {}, "inv_receive_stock"],
      ["issue", { employeeId: "e1" }, "inv_issue_to_employee"],
      ["dispatch", { projectId: "p1", expectedReturnAt: "2026-12-01T00:00:00Z" }, "inv_dispatch_to_project"],
      ["return", { returnFrom: "employee", employeeId: "e1" }, "inv_return_from_employee"],
      ["return", { returnFrom: "project", projectId: "p1" }, "inv_return_from_project"],
      ["transfer", { toLocationId: "l2" }, "inv_transfer_dispatch"],
      ["receive_transfer", { transferId: "t1" }, "inv_transfer_receive"],
      ["project_transfer", { projectId: "p1", toProjectId: "p2", requestId: "r1" }, "inv_transfer_between_projects"],
      ["repair_out", { repairReference: "JOB-1" }, "inv_repair_out"],
      ["repair_in", {}, "inv_repair_in"],
      ["check", {}, "inv_check_condition"],
      ["adjust", { adjustAction: "retire", reason: "Scrapped" }, "inv_adjust_stock"],
      ["consume", {}, "inv_consume"],
      ["return_unused", { employeeId: "e1" }, "inv_return_unused"],
      ["return_rental", { rentalId: "rent1" }, "inv_return_rental"],
      ["pack_kit", { kitUnitId: "k1" }, "inv_pack_kit"],
      ["unpack_kit", { kitUnitId: "k1" }, "inv_unpack_kit"],
    ];
    for (const [kind, extra, fn] of cases) {
      const call = toRpcCall({ kind, ...base, ...extra });
      expect(call.fn).toBe(fn);
      expect(call.args.p_key).toBe(KEY);
      expect(call.args.p_company_id).toBe("c1");
    }
  });
  it("sends the exact arguments of an issue, dispatch, transfer and return", () => {
    expect(toRpcCall({ kind: "issue", companyId: "c", locationId: "l", key: KEY, lines, employeeId: "e", note: " hello ", expectedReturnAt: "2026-12-01T00:00:00Z", requestId: "r" }).args).toEqual({
      p_company_id: "c", p_key: KEY, p_location_id: "l", p_employee_id: "e", p_lines: lines, p_expected_return_at: "2026-12-01T00:00:00Z", p_note: "hello", p_request_id: "r",
    });
    expect(toRpcCall({ kind: "transfer", companyId: "c", locationId: "l1", toLocationId: "l2", key: KEY, lines, carrier: "DHL" }).args).toMatchObject({ p_from_location_id: "l1", p_to_location_id: "l2", p_carrier: "DHL", p_expected_at: null });
    expect(toRpcCall({ kind: "return", companyId: "c", locationId: "l", key: KEY, lines, returnFrom: "project", projectId: "p" }).args).toMatchObject({ p_project_id: "p" });
  });
  it("an empty list means 'everything' for receiving a transfer, unpacking and returning a rental", () => {
    expect(toRpcCall({ kind: "receive_transfer", companyId: "c", locationId: "l", key: KEY, lines: [], transferId: "t" }).args.p_lines).toBeNull();
    expect(toRpcCall({ kind: "unpack_kit", companyId: "c", locationId: "l", key: KEY, lines: [], kitUnitId: "k" }).args.p_lines).toBeNull();
    expect(toRpcCall({ kind: "return_rental", companyId: "c", locationId: "l", key: KEY, lines: [], rentalId: "r" }).args.p_lines).toBeNull();
  });
  it("sends a rental's details with a receipt", () => {
    const call = toRpcCall({ kind: "receive", companyId: "c", locationId: "l", key: KEY, lines, rental: { supplierName: " ACME ", externalReference: "PO-9", returnDeadline: "2026-12-01T00:00:00Z" } });
    expect(call.args.p_rental).toEqual({ supplier_name: "ACME", external_reference: "PO-9", return_deadline: "2026-12-01T00:00:00Z", project_id: null, note: null });
  });
});

describe("summaryRows (the review step)", () => {
  const rows = (kind: MovementKind, extra = {}) => summaryRows({ kind, drafts: [unit("1"), counted("2", { qty: "20", binLabel: "A1" })], location: "Dubai warehouse", ...extra });
  const get = (r: ReturnType<typeof rows>, label: string) => r.find((x) => x.label === label)?.value;

  it("always says what, how much, from and to", () => {
    const r = rows("issue", { employee: "Sara Ali", expectedReturn: "3 Nov 2026, 09:30 GST" });
    expect(get(r, "What")).toContain("Laptop (UAE-E-00001)");
    expect(get(r, "What")).toContain("20 XLR cable, bin A1");
    expect(get(r, "How much")).toBe("1 individual item; 20 XLR cable");
    expect(get(r, "From")).toBe("Dubai warehouse");
    expect(get(r, "To")).toBe("Employee: Sara Ali");
    expect(get(r, "Who")).toBe("Sara Ali");
    expect(get(r, "Expected return")).toBe("3 Nov 2026, 09:30 GST");
  });
  it("says a transfer is in transit and not available at the destination", () => {
    const r = rows("transfer", { toLocation: "Riyadh" });
    expect(get(r, "To")).toMatch(/Riyadh.*in transit.*not available there/);
    expect(get(r, "Status after")).toMatch(/In transit/);
  });
  it("says what stays outstanding on a partial return and what is held back", () => {
    const r = summaryRows({ kind: "return", returnFrom: "employee", employee: "Sara Ali", location: "Dubai warehouse", stillOutstanding: 3, drafts: [unit("1"), unit("2", { condition: "damaged" })] });
    expect(get(r, "Still outstanding")).toMatch(/3 other items stay with the employee/);
    expect(get(r, "Held back")).toMatch(/1 item is not in good condition/);
    expect(get(r, "What")).toContain("good, available");
    expect(get(r, "What")).toContain("damaged, held back");
    expect(get(summaryRows({ kind: "return", returnFrom: "project", project: "P-1", location: "L", stillOutstanding: 0, drafts: [unit("1")] }), "Still outstanding")).toBe("Nothing else is outstanding");
  });
  it("dispatch names the project and the request", () => {
    const r = rows("dispatch", { project: "P-7 Mall", request: "REQ-0004" });
    expect(get(r, "To")).toBe("Project: P-7 Mall");
    expect(get(r, "Request")).toBe("REQ-0004");
  });
  it("says 'everything' when the list was left empty on purpose", () => {
    const r = summaryRows({ kind: "receive_transfer", drafts: [], location: "Riyadh", everything: true, transferCode: "UAE-T-00004" });
    expect(get(r, "What")).toBe("Everything that applies");
    expect(get(r, "From")).toBe("On the way (UAE-T-00004)");
  });
  it("has a sentence for every kind", () => {
    for (const kind of Object.keys(KIND_CONFIG) as MovementKind[]) {
      const r = rows(kind, { adjustAction: "missing" });
      expect(get(r, "From"), kind).toBeTruthy();
      expect(get(r, "To"), kind).toBeTruthy();
    }
  });
});

describe("results in words", () => {
  it("says a transfer is in transit", () => {
    expect(successMessage("transfer", { code: "MV-1", transfer_code: "UAE-T-00004" })).toMatch(/Transfer UAE-T-00004 is in transit.*not available at the destination/);
  });
  it("says which returned lines are available and which are held", () => {
    const m = successMessage("return", { code: "MV-2", lines: [{ available: true }, { available: false }, { available: true }] });
    expect(m).toMatch(/2 lines are available again/);
    expect(m).toMatch(/1 line is held for checking/);
  });
  it("lists the new IDs after a receipt", () => {
    expect(successMessage("receive", { code: "MV-3", lines: [{ code: "UAE-E-00010" }, { code: "UAE-E-00011" }] })).toMatch(/UAE-E-00010, UAE-E-00011/);
  });
  it("answers the result check in words", () => {
    expect(statusMessage({ found: false, status: "not_recorded" }).state).toBe("not_recorded");
    expect(statusMessage({ found: false }).text).toMatch(/safe to send it again/);
    expect(statusMessage({ found: true, status: "recorded", movement_code: "MV-9" })).toEqual({ state: "recorded", text: "Yes, it went through: recorded as MV-9. Do not send it again." });
    expect(statusMessage({ found: true, status: "in_progress" }).state).toBe("in_progress");
    expect(statusMessage(null).state).toBe("not_recorded");
  });
});
