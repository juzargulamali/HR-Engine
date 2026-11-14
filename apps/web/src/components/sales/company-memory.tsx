"use client";

import { useEffect } from "react";
import { SALES_COMPANY_COOKIE } from "@/lib/crm/active-company";

/**
 * Remembers the company a Sales page is showing, so the next Sales page and the Add enquiry forms open in it. Only a company id is stored, in a
 * first-party cookie scoped to the Sales pages; the server checks it against the person's current Sales companies before using it, so a stored
 * value can never open a company they no longer have access to.
 */
export function SalesCompanyMemory({ companyId }: { companyId: string }) {
  useEffect(() => {
    try { document.cookie = `${SALES_COMPANY_COOKIE}=${encodeURIComponent(companyId)}; path=/sales; max-age=31536000; samesite=lax`; } catch { /* storage may be blocked; the page still works */ }
  }, [companyId]);
  return null;
}
