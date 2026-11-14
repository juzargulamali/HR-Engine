import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { InfoHint } from "@/components/ui/info-hint";
import { LoadError } from "@/components/workspace/states";
import { CompanyMemory } from "@/components/operations/company-memory";
import type { OpsResult } from "@/lib/operations/data";
import { cn } from "@/lib/utils";

/**
 * The company an Operations page shows, always visible, with the chooser when the person manages more than one: links, one per company, each keeping the person on the same page.
 * The company is remembered for the next visit (checked against their current companies on the server).
 */
export function CompanyTabs({ companies, current, base }: { companies: { id: string; name: string }[]; current: string; base: string }) {
  const name = companies.find((c) => c.id === current)?.name ?? "";
  if (companies.length < 2) {
    return <p className="text-sm" data-testid="ops-company" data-company-id={current}><CompanyMemory companyId={current} /><span className="text-muted-foreground">Company</span> <span className="font-medium">{name}</span></p>;
  }
  return (
    <nav aria-label="Company" className="flex flex-wrap items-center gap-2" data-testid="ops-company" data-company-id={current}>
      <CompanyMemory companyId={current} />
      <span className="text-sm text-muted-foreground">Company</span>
      {companies.map((c) => (
        <Link key={c.id} href={`${base}?company=${c.id}`} aria-current={c.id === current ? "page" : undefined}
          className={cn("rounded-full border px-3 py-1 text-sm", c.id === current ? "border-accent bg-accent/10 font-medium" : "text-muted-foreground hover:text-foreground")}>{c.name}</Link>
      ))}
    </nav>
  );
}

/** The three ways a read can end without data. Each says what happened: not installed, refused, or failed. None of them looks like "nothing to show". */
export function ReadState({ result, what, retryHref }: { result: Exclude<OpsResult<unknown>, { state: "ok" }>; what: string; retryHref: string }) {
  if (result.state === "not_installed") return <Alert role="status">Operations is not installed in this environment yet. Nothing else is affected.</Alert>;
  if (result.state === "denied") return <Alert role="status" data-testid="ops-denied">You are no longer an Operations Manager of this company, so {what} is not shown. People &amp; Access shows who can give it back.</Alert>;
  return <LoadError what={what} retryHref={retryHref} />;
}

export const Unknown = ({ children = "Not recorded" }: { children?: React.ReactNode }) => <span className="text-muted-foreground">{children}</span>;

/** The page heading of an Operations screen with its optional explanation behind a shared ⓘ beside the title (instead of a paragraph under it). */
export function OpsHeader({ title, subtitle, help }: { title: string; subtitle?: string; help?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <h1 className="text-2xl font-semibold">{title}{help ? <InfoHint label={title.toLowerCase()} className="ml-1.5">{help}</InfoHint> : null}</h1>
      {subtitle ? <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{subtitle}</p> : null}
    </div>
  );
}
