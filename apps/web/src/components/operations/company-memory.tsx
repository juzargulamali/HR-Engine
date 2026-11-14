"use client";

import { useEffect } from "react";
import { OPS_COMPANY_COOKIE } from "@/lib/operations/company";

/**
 * Remembers the company an Operations page is showing, so the next visit opens it again. Only a company id is stored, in a first-party cookie scoped to the Operations pages; the server checks
 * it against the companies the person manages today before using it, so a stored value can never open a company they no longer manage.
 */
export function CompanyMemory({ companyId }: { companyId: string }) {
  useEffect(() => {
    try { document.cookie = `${OPS_COMPANY_COOKIE}=${encodeURIComponent(companyId)}; path=/operations; max-age=31536000; samesite=lax`; } catch { /* storage may be blocked; the page still works */ }
  }, [companyId]);
  return null;
}
