import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { LoadError } from "@/components/workspace/states";
import type { OpsResult } from "@/lib/operations/data";
import { cn } from "@/lib/utils";

/** The company chooser of an Operations page: links, one per company the person is Operations Manager of. Hidden when there is only one. */
export function CompanyTabs({ companies, current, base }: { companies: { id: string; name: string }[]; current: string; base: string }) {
  if (companies.length < 2) return null;
  return (
    <nav aria-label="Company" className="flex flex-wrap gap-2">
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
