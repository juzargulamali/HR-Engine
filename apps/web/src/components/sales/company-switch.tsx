import Link from "next/link";
import { InfoHint } from "@/components/ui/info-hint";
import { SalesCompanyMemory } from "@/components/sales/company-memory";
import { ACTIVE_COMPANY_WHY, type ActiveCompanySource } from "@/lib/crm/active-company";
import { cn } from "@/lib/utils";

interface Company { id: string; name: string }

/**
 * The active company of a Sales page, always visible, with the chooser when the person has Sales access to more than one. Each choice keeps the person
 * on the same page (`hrefFor`). The choice is remembered for the next Sales page and form (a first-party cookie holding only the company id; the
 * server checks it against the person's companies before using it).
 *
 * `current` null with several companies means no reliable default exists: the bar asks the person to choose, in amber and in words, and the page
 * shows no company-scoped data until they do. `all` adds an "All my companies" choice on pages that can show several at once (it is not remembered).
 */
export function CompanySwitch({ companies, current, from, hrefFor, all, className }: {
  companies: readonly Company[];
  current: string | null;
  from?: ActiveCompanySource;
  hrefFor: (companyId: string) => string;
  all?: { href: string; active: boolean; label?: string };
  className?: string;
}) {
  const name = companies.find((c) => c.id === current)?.name ?? null;
  const why = from ? <InfoHint label="the company shown" className="ml-0.5">{ACTIVE_COMPANY_WHY[from]} Add enquiry and the other Sales pages open in this company until you choose another.</InfoHint> : null;
  if (companies.length < 2 && !all) {
    return (
      <p className={cn("text-sm", className)} data-testid="sales-company" data-company-id={current ?? ""}>
        {current ? <SalesCompanyMemory companyId={current} /> : null}
        <span className="text-muted-foreground">Company</span> <span className="font-medium">{name ?? "None"}</span>{why}
      </p>
    );
  }
  const choosing = !current && !all?.active;
  return (
    <nav aria-label="Company" className={cn("flex flex-wrap items-center gap-2", className)} data-testid="sales-company" data-company-id={current ?? ""} data-choose={choosing ? "true" : undefined}>
      {current && !all?.active ? <SalesCompanyMemory companyId={current} /> : null}
      <span className={cn("text-sm", choosing ? "font-medium text-[hsl(var(--os-amber))]" : "text-muted-foreground")}>{choosing ? "Choose a company" : "Company"}</span>
      {all ? (
        <Link href={all.href} aria-current={all.active ? "page" : undefined}
          className={cn("rounded-full border px-3 py-1 text-sm", all.active ? "border-accent bg-accent/10 font-medium" : "text-muted-foreground hover:text-foreground")}>{all.label ?? "All my companies"}</Link>
      ) : null}
      {companies.map((c) => {
        const on = c.id === current && !all?.active;
        return (
          <Link key={c.id} href={hrefFor(c.id)} aria-current={on ? "page" : undefined}
            className={cn("rounded-full border px-3 py-1 text-sm", on ? "border-accent bg-accent/10 font-medium" : "text-muted-foreground hover:text-foreground")}>{c.name}</Link>
        );
      })}
      {choosing ? null : why}
    </nav>
  );
}

/** Shown in place of company-scoped content while no company is chosen. It is not an empty list and not an error. */
export function ChooseCompanyNotice({ what }: { what: string }) {
  return (
    <p role="status" className="os-card p-4 text-sm" data-testid="sales-choose-company">
      <span className="font-medium">Choose a company above to see {what}.</span>{" "}
      <span className="text-muted-foreground">You have Sales access to more than one company and none has been used yet, so nothing is assumed.</span>
    </p>
  );
}
