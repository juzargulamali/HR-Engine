"use client";

import { useCallback } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ROLES, parseRole, parseState } from "../_lib/modules";

/**
 * Preview-only view state. `?role=` chooses which sample home/menu is drawn; `?state=` forces a UI state.
 * Neither switches a real identity or calls any API: this must never become an impersonation feature.
 */
export function usePreview() {
  const sp = useSearchParams();
  const role = parseRole(sp.get("role"));
  const state = parseState(sp.get("state"));
  const tab = sp.get("tab");
  const href = useCallback(
    (path: string, extra?: Record<string, string>) => {
      const [base, query] = path.split("?");
      const q = new URLSearchParams(query ?? "");
      q.set("role", role);
      for (const [k, v] of Object.entries(extra ?? {})) q.set(k, v);
      return `${base}?${q.toString()}`;
    },
    [role],
  );
  return { role, roleDef: ROLES[role], state, tab, href };
}

/** A Link that keeps the previewed role in the URL. */
export function PLink({ href, ...props }: Omit<React.ComponentProps<typeof Link>, "href"> & { href: string }) {
  const p = usePreview();
  return <Link href={p.href(href)} {...props} />;
}
