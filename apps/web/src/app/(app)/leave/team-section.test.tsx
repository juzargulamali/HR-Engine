/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/leave" }));

import { TeamLeaveSection } from "./team-section";
import type { TeamRow } from "@/lib/leave/team";

const ok = <T,>(value: T) => ({ status: "ok" as const, value });
const row = (over: Partial<TeamRow> = {}): TeamRow => ({ id: "e1", name: "Amal Hadi", jobTitle: "Designer", balances: ok([{ code: "annual", days: 12 }]), recovery: ok(1), pending: ok(2), nextLeave: ok("2026-11-10"), ...over });
const render = (result: Parameters<typeof TeamLeaveSection>[0]["result"]) => renderToStaticMarkup(<TeamLeaveSection result={result} today="2026-11-03" />);

describe("Team leave section", () => {
  it("shows each person's balance, Recovery Leave, waiting requests and next leave, linked to their Leave tab", () => {
    const html = render({ failed: false, rows: [row(), row({ id: "e2", name: "Bilal Noor", pending: ok(0), recovery: ok(null), nextLeave: ok(null) })], total: 2, capped: false });
    expect(html).toContain("Team leave");
    expect(html).toContain("Amal Hadi");
    expect(html).toContain("Annual 12");
    expect(html).toContain("1 days");
    expect(html).toContain("2 waiting");
    expect(html).toContain("10 Nov");
    expect(html).toContain('href="/employees/e1?tab=leave"');
    expect(html).toContain("2 requests are waiting for a decision");
  });
  it("says the people could not be loaded rather than showing an empty team", () => {
    const html = render({ failed: true, rows: [], total: 0, capped: false });
    expect(html).toContain("Could not load the team");
    expect(html).not.toContain("Team leave");
  });
  it("shows nothing at all for a person who can read nobody else", () => {
    expect(render({ failed: false, rows: [], total: 0, capped: false })).toBe("");
  });
  it("a figure that could not be read says so, never zero or a dash", () => {
    const html = render({ failed: false, rows: [row({ balances: { status: "failed" }, pending: { status: "failed" } })], total: 1, capped: false });
    expect(html).toContain("Could not load");
    expect(html).toContain("Requests waiting could not be counted");
    expect(html).not.toContain("0 waiting");
  });
  it("says when only the first people are shown", () => {
    expect(render({ failed: false, rows: [row()], total: 450, capped: true })).toContain("Showing the first 1 of 450 people");
  });
});
