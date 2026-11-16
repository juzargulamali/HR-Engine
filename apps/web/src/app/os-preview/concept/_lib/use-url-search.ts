"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { withParams } from "@/components/workspace/url-state";

/**
 * A search box whose text is kept in the address (so Back, reload and sharing keep it) but is typed locally and written a moment after
 * typing stops. If the address changes from somewhere else ("Clear filters", Back) the box follows it.
 */
export function useUrlSearch(key = "q"): [string, (v: string) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const url = sp.get(key) ?? "";
  const [q, setQ] = useState(url);
  const [written, setWritten] = useState(url);
  const [seen, setSeen] = useState(url);
  if (url !== seen) {
    setSeen(url);
    if (url !== written) { setQ(url); setWritten(url); }
  }
  useEffect(() => {
    if (q === url) return;
    const t = window.setTimeout(() => { setWritten(q); router.replace(withParams(pathname, sp, { [key]: q || null }), { scroll: false }); }, 180);
    return () => window.clearTimeout(t);
  }, [q, url, key, pathname, sp, router]);
  return [q, setQ];
}
