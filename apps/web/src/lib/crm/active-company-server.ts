import "server-only";
import { cookies } from "next/headers";
import { chooseSalesCompany, SALES_COMPANY_COOKIE, type ActiveCompany } from "./active-company";
import type { CrmCompanyInfo, CrmContext } from "./context";

/** The company the person used last in Sales, from the cookie the Sales pages leave. Never trusted: `pickSalesCompany` checks it against today's companies. */
async function rememberedSalesCompany(): Promise<string | undefined> {
  try { return (await cookies()).get(SALES_COMPANY_COOKIE)?.value; } catch { return undefined; }
}

/**
 * The active company for a Sales page or form. `asked` is the current context: the `company` in the address, or the company of the enquiry, account or
 * edition on screen. See lib/crm/active-company.ts for the order. When `from` is "choose" the caller shows a chooser (components/sales/company-switch.tsx)
 * and loads no company-scoped data.
 */
export async function pickSalesCompany(ctx: Pick<CrmContext, "companies" | "homeCompanyId">, asked?: string | string[] | null): Promise<ActiveCompany<CrmCompanyInfo>> {
  return chooseSalesCompany(ctx.companies, { asked: typeof asked === "string" ? asked : null, remembered: await rememberedSalesCompany(), home: ctx.homeCompanyId ?? null });
}
