/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, row, rows, type FakeResult } from "@/test/fake-supabase";
import { canDownloadLetter } from "./download-rule";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/letters", redirect: vi.fn() }));
vi.mock("./issue-letter-form", () => ({ IssueLetterForm: () => null }));
vi.mock("./new-template-form", () => ({ NewTemplateForm: () => null }));
vi.mock("./delete-letter-button", () => ({ DeleteLetterButton: () => null }));
vi.mock("./delete-template-button", () => ({ DeleteTemplateButton: () => null }));

let grants: { role: string; companyId: string | null; countryCode: string | null }[] = [];
let signed: string[] = [];
const letter = (id: string, status: string) => ({ id, employee_id: "e1", template_id: "t1", status, generated_at: "2026-11-01T00:00:00Z", file_path: `c1/e1/letters/${id}.pdf` });
let employeeReads = 0;
const tables = (): Record<string, FakeResult | (() => FakeResult)> => ({
  // the first read is the viewer's own record (one row), the rest are name lists
  employees: () => (employeeReads++ === 0 ? row({ id: "e1", first_name: "Erin", last_name: "Employee", company_id: "c1" }) : rows([{ id: "e1", first_name: "Erin", last_name: "Employee", company_id: "c1" }])),
  letter_templates: rows([{ id: "t1", name: "Salary certificate", template_type: "salary_certificate", requires_approval: true }]),
  generated_letters: rows([letter("l-pending", "pending_approval"), letter("l-issued", "issued"), letter("l-void", "void"), letter("l-draft", "draft")]),
});
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const base = fakeSupabase(tables());
    return { ...base, storage: { from: () => ({ createSignedUrl: async (path: string) => { signed.push(path); return { data: { signedUrl: `https://files.test/${path}` } }; } }) } };
  },
}));
vi.mock("@/lib/auth/session", () => ({ getCurrentSession: async () => ({ userId: "u1", employeeId: "e1", email: null, fullName: "Person", grants }) }));

import LettersPage from "./page";

beforeEach(() => { grants = []; signed = []; employeeReads = 0; });

describe("canDownloadLetter", () => {
  it("an employee only for an issued letter; HR in every status", () => {
    for (const status of ["draft", "pending_approval", "void"]) expect(canDownloadLetter(status, false), status).toBe(false);
    expect(canDownloadLetter("issued", false)).toBe(true);
    for (const status of ["draft", "pending_approval", "issued", "void"]) expect(canDownloadLetter(status, true), status).toBe(true);
  });
});

describe("Letters page: Download (A17)", () => {
  it("an employee sees the status of a pending letter with no Download, and Download only on the issued one; no link is even created for the others", async () => {
    grants = [{ role: "employee", companyId: "c1", countryCode: null }];
    const html = renderToStaticMarkup((await LettersPage()) as never);
    expect(html.match(/>Download</g)).toHaveLength(1);
    expect(html).toContain("l-issued.pdf");
    expect(html).not.toContain("l-pending.pdf");
    expect(html).not.toContain("l-void.pdf");
    expect(html).not.toContain("l-draft.pdf");
    expect(signed).toEqual(["c1/e1/letters/l-issued.pdf"]);
    expect(html).toContain("pending approval");
    expect(html).toContain("Available once it is approved");
  });

  it("HR keeps Download in every status, to review before sign-off", async () => {
    grants = [{ role: "hr_admin", companyId: "c1", countryCode: null }];
    const html = renderToStaticMarkup((await LettersPage()) as never);
    expect(html.match(/>Download</g)).toHaveLength(4);
    expect(html).not.toContain("Available once it is approved");
  });
});
