"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { holdExplanation, moneyText, routeExplanation, versionStatusTone, VERSION_STATUS_LABELS, type ApprovalRoute, type VersionStatus } from "@enginious-hr/domain";
import { OsBadge, type OsTone } from "@/components/os/pills";
import { Alert } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { BudgetActionResult } from "@/lib/actions/projectBudget";

/** Money as words and digits in the budget's own currency ("AED 1,470.00"). The database already rounded it; this only formats. */
export const money = (amount: number | string | null | undefined, currency: string): string => {
  if (amount === null || amount === undefined || amount === "") return "—";
  const n = typeof amount === "number" ? amount : Number(amount);
  return Number.isFinite(n) ? moneyText(n, currency) : "—";
};

/** A calendar date typed as YYYY-MM-DD, written the way the rest of the application writes it. Dates have no time zone: they are the project's own days. */
export const day = (d: string | null | undefined): string => {
  if (!d) return "—";
  const [y, m, dd] = d.split("-").map(Number);
  if (!y || !m || !dd) return d;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, dd)));
};

/** A moment, shown in the project's own time zone (falls back to Dubai) so a PM on site and Finance in the office read the same time. */
export const stamp = (iso: string | null | undefined, tz: string | null | undefined): string => {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: tz || "Asia/Dubai" }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" }).format(new Date(iso));
  }
};

const TONE: Record<ReturnType<typeof versionStatusTone>, OsTone> = { neutral: "neutral", blue: "blue", amber: "amber", red: "red", green: "green", quiet: "quiet" };
export function StatusPill({ status, children }: { status: VersionStatus; children?: React.ReactNode }) {
  return <OsBadge tone={TONE[versionStatusTone(status)]} dot>{children ?? VERSION_STATUS_LABELS[status]}</OsBadge>;
}

/**
 * Runs a server action with the three things every button on these pages needs: it cannot be pressed twice while it is running, a refusal is shown
 * in plain words next to the control, and a success refreshes the page's data. `newRequestId` is a stable id for "this click": the database
 * treats a second submit with the same id as the first, so a retry or a double click can never record anything twice.
 */
export function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const requestId = useRef<string>(crypto.randomUUID());
  const run = useCallback(
    (fn: () => Promise<BudgetActionResult>, onDone?: (r: BudgetActionResult) => void, message?: string) => {
      setError(null);
      setNotice(null);
      start(async () => {
        let r: BudgetActionResult;
        try {
          r = await fn();
        } catch {
          r = { error: "The request did not reach the server. Check your connection, reload the page to see whether it went through, then try again if it did not." };
        }
        if (r.error) { setError(r.error); return; }
        requestId.current = crypto.randomUUID();
        if (message) setNotice(message);
        onDone?.(r);
        router.refresh();
      });
    },
    [router],
  );
  const getRequestId = useCallback(() => requestId.current, []);
  return { pending, error, notice, run, getRequestId, clear: () => { setError(null); setNotice(null); } };
}

export function ActionMessage({ error, notice }: { error: string | null; notice?: string | null }) {
  if (error) return <Alert variant="destructive" role="alert" className="text-sm">{error}</Alert>;
  if (notice) return <p role="status" className="text-sm text-[hsl(var(--os-green))]">{notice}</p>;
  return null;
}

export function Field({ label, htmlFor, hint, children, className }: { label: string; htmlFor?: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      <Label htmlFor={htmlFor} className="text-sm">{label}</Label>
      {children}
      {hint ? <p className="text-[13px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** A figure with its label, for the summary strip and the settlement table. `tone` marks over / under without relying on colour alone (the words say it too). */
export function Figure({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "over" | "under" | null }) {
  return (
    <div className="os-card min-w-0 px-3.5 py-2.5">
      <div className="text-[13px] leading-tight text-muted-foreground">{label}</div>
      <div className={cn("mt-1 font-heading text-xl font-semibold leading-tight tabular-nums", tone === "over" && "text-[hsl(var(--os-red))]", tone === "under" && "text-[hsl(var(--os-green))]")}>{value}</div>
      {hint ? <div className="mt-0.5 text-[12px] leading-tight text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

/** Decimal-only typing: digits and one point, no sign (a negative amount is never meaningful here), so a stray letter cannot reach the database. */
export const cleanDecimal = (s: string): string => {
  const t = s.replace(/[^\d.]/g, "");
  const i = t.indexOf(".");
  return i < 0 ? t : t.slice(0, i + 1) + t.slice(i + 1).replace(/\./g, "");
};

/** Who decides a submission and why (fixed when it was submitted), in one sentence. */
export function RouteLine({ route }: { route: ApprovalRoute | null }) {
  if (!route) return null;
  return <p className="text-sm"><span className="text-muted-foreground">Approval: </span>{routeExplanation(route)}</p>;
}

/** Shown when nobody eligible and independent exists for the route: the request waits, nothing is approved or lost. */
export function HoldAlert({ route, submitterName }: { route: ApprovalRoute | null; submitterName: string | null }) {
  return (
    <Alert role="status" className="text-sm">
      <strong>On hold.</strong> {holdExplanation(route ?? "finance", submitterName).replace(/^On hold: /, "")}
    </Alert>
  );
}
