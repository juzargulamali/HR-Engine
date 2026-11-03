import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ownCountryFirst, policyTitle } from "@/lib/policies/readable";
import { cn } from "@/lib/utils";

export interface StaffPolicy { id: string; country_code: string; countryName: string; policy_type: string; effective_from: string }

const since = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

function PolicyList({ items }: { items: StaffPolicy[] }) {
  return (
    <ul className="divide-y divide-border/70">
      {items.map((p) => (
        <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
          <div className="min-w-0">
            <Link href={`/policies/${p.id}`} className="font-medium hover:underline">{policyTitle(p.policy_type)}</Link>
            <p className="text-sm text-muted-foreground">In force since {since(p.effective_from)}</p>
          </div>
          <Link href={`/policies/${p.id}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>Read<span className="sr-only">: {policyTitle(p.policy_type)}, {p.countryName}</span></Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * What staff see on Policies: only the rules in force (the database never shows them drafts or old versions), the person's own country first and the other
 * countries folded away, each policy by name with the date it came into force. The setup controls, version table and draft tools are HR's and are not here.
 */
export function StaffPolicies({ policies, ownCountry, ownCountryName }: { policies: StaffPolicy[]; ownCountry: string | null; ownCountryName: string | null }) {
  const { own, others } = ownCountryFirst(policies, ownCountry);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Policies</h1>
          <p className="text-muted-foreground">The rules in force that apply to you, in plain words{ownCountry ? ", for your country first" : ""}.</p>
        </div>
        <Link href="/holidays" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>Public holidays</Link>
      </div>
      {ownCountry ? (
        <Card>
          <CardHeader><CardTitle>{ownCountryName ?? ownCountry}</CardTitle></CardHeader>
          <CardContent>{own.length > 0 ? <PolicyList items={own} /> : <EmptyState dense title="No policy is in force for your country yet." />}</CardContent>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground">Your country is not recorded on your employee record, so every country is listed below.</p>
      )}
      {others.length > 0 ? (
        <details className="rounded-lg border border-border bg-card" open={!ownCountry}>
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">{ownCountry ? `Other countries (${others.length})` : `All countries (${others.length})`}</summary>
          <div className="px-4 pb-3"><PolicyList items={others} /></div>
        </details>
      ) : null}
      {policies.length === 0 ? <EmptyState title="No policies are in force yet." /> : null}
    </div>
  );
}
