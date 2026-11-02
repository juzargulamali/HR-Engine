/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { failing, fakeSupabase, row, rows, type FakeResult } from "@/test/fake-supabase";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/reimbursements", redirect: vi.fn() }));
vi.mock("./new-claim-form", () => ({ NewClaimForm: ({ defaultCurrency }: { defaultCurrency: string }) => <form data-currency={defaultCurrency}>Start claim</form> }));
vi.mock("./delete-draft-claim-button", () => ({ DeleteDraftClaimButton: () => null }));
vi.mock("@/components/workspace/list-memory", () => ({ RememberList: () => null }));

let tables: Record<string, FakeResult | (() => FakeResult)> = {};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeSupabase(tables) }));
vi.mock("@/lib/auth/session", () => ({ getCurrentSession: async () => ({ userId: "u1", employeeId: "e1", email: null, fullName: "Aisha", grants: [] }) }));

import ReimbursementsPage from "./page";

const render = async () => renderToStaticMarkup(await ReimbursementsPage());

beforeEach(() => {
  tables = {
    reimbursement_claims: rows([{ id: "c1", claim_date: "2026-10-30", currency: "PLN", total_amount: 120, status: "draft" }]),
    employees: row({ company_id: "co1" }),
    companies: row({ default_currency: "PLN" }),
  };
});

describe("My reimbursements", () => {
  it("healthy: lists claims and pre-fills the company's currency", async () => {
    const html = await render();
    expect(html).toContain("PLN 120");
    expect(html).toContain('data-currency="PLN"');
  });
  it("a failed claims read is an error, not 'No claims yet' (which invites a duplicate)", async () => {
    tables = { ...tables, reimbursement_claims: failing() };
    const html = await render();
    expect(html).toContain("Could not load your claims");
    expect(html).not.toContain("No claims yet");
  });
  it("a failed company read never pre-fills a made-up AED", async () => {
    tables = { ...tables, companies: failing() };
    const html = await render();
    expect(html).toContain("Could not load your company");
    expect(html).not.toContain('data-currency="AED"');
    expect(html).not.toContain("Start claim");
  });
  it("a successful read with no claims still says so", async () => {
    tables = { ...tables, reimbursement_claims: rows([]) };
    expect(await render()).toContain("No claims yet");
  });
});
