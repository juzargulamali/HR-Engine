/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/crm", () => ({ saveCrmSettings: vi.fn() }));
vi.mock("@/components/workspace/unsaved", () => ({ useUnsavedChanges: () => undefined }));
import { SettingsForm } from "./settings-form";

const initial = { referenceCode: "UAE", currency: "AED", responseTargetHours: null, workdays: [1, 2, 3, 4, 5], workStart: "09:00", workEnd: "18:00", holidays: "", duplicateWindowDays: 30, ownerEmailEnabled: false, approvalPolicy: "not_configured" as const, approvalNote: "" };

describe("Sales settings: reference code help text", () => {
  it("shows the whole reference an enquiry gets, including the OPP- prefix the database adds (crm_create_opportunity: OPP-<code>-<year>-<number>)", () => {
    const html = renderToStaticMarkup(<SettingsForm companyId="c1" companyName="Enginious UAE" exists initial={initial} canEditApproval={false} />);
    expect(html).toContain("OPP-UAE-2026-0042");
    expect(html).not.toMatch(/for example UAE-2026-0042/);
  });
});
