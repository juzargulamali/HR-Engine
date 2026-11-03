/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, row, rows, type FakeResult } from "@/test/fake-supabase";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/policies/p1", useSearchParams: () => new URLSearchParams(), redirect: vi.fn(), notFound: () => { throw new Error("NOT_FOUND"); } }));

let grants: { role: string; companyId: string | null; countryCode: string | null }[] = [];
const policy = { id: "p1", country_code: "AE", policy_type: "notice_period", version_no: 2, status: "active", effective_from: "2026-01-01", effective_to: null, payload: { default_days: 30, note: "A fallback default." }, created_by: "x", approved_by: null, approved_at: null, activation_record: null };
const tables: Record<string, FakeResult> = { policy_versions: row(policy), countries: row({ name: "United Arab Emirates" }), policy_leave_types: rows([]) };
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeSupabase(tables, { recovery_scheduler_status: row(null) }) }));
vi.mock("@/lib/auth/session", () => ({ getCurrentSession: async () => ({ userId: "u1", employeeId: "e1", email: null, fullName: "Person", grants }) }));
vi.mock("@/components/workspace/list-memory", () => ({ BackLink: ({ children }: { children: React.ReactNode }) => <a>{children}</a>, RememberList: () => null }));

import PolicyDetailPage from "./page";

const render = async () => renderToStaticMarkup((await PolicyDetailPage({ params: Promise.resolve({ id: "p1" }) })) as never);
beforeEach(() => { grants = []; });

describe("Policy page (U-22)", () => {
  it("staff read the values as plain lines, with no JSON payload, no version or status badge", async () => {
    grants = [{ role: "employee", companyId: "c1", countryCode: null }];
    const html = await render();
    expect(html).toContain("Notice periods");
    expect(html).toContain("in force since 2026-01-01");
    expect(html).toContain("What it says");
    expect(html).toContain("Default days");
    expect(html).toContain("30");
    expect(html).not.toContain("Payload");
    expect(html).not.toMatch(/&quot;default_days&quot;|<pre/);
    expect(html).not.toContain("version 2");
  });
  it("HR keeps the stored payload as it was", async () => {
    grants = [{ role: "hr_admin", companyId: null, countryCode: null }];
    const html = await render();
    expect(html).toContain("Payload");
    expect(html).toContain("<pre");
    expect(html).toContain("version 2");
  });
});
