import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronsUpDown, CircleDashed, CircleOff, Info, Moon, Trophy } from "lucide-react";
import { OsBadge } from "@/components/os/pills";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { type DirectoryRow, type DirectorySort, type SortKey } from "@/lib/crm/clients-agencies/directory";
import { countryLabel, ROLE_LABEL } from "@/lib/crm/clients-agencies/normalise";
import { RELATIONSHIPS, RELATIONSHIP_HELP, RELATIONSHIP_LABEL, RELATIONSHIP_TONE, type Relationship } from "@/lib/crm/clients-agencies/relationship";
import { SelectAllBox, SelectBox } from "./outreach-select";

/** The wording of the Enquiries column, shown as a visible footnote and as the column's tooltip. */
export const ENQUIRIES_NOTE = "CRM enquiries linked to this account, not quotes Enginious sent";
export const ENQUIRIES_NOTE_ID = "ca-enquiries-note";

const ICON: Record<Relationship, typeof Trophy> = { won: Trophy, no_wins: CircleDashed, none: CircleOff, dormant: Moon };

/** The relationship badge: a colour, an icon AND the words, so colour is never the only signal. `null` = the enquiries could not be loaded. */
export function RelationshipBadge({ value }: { value: Relationship | null }) {
  if (!value) return <span className="text-muted-foreground">Could not load</span>;
  const Icon = ICON[value];
  return <OsBadge tone={RELATIONSHIP_TONE[value]} className="whitespace-nowrap" ><Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />{RELATIONSHIP_LABEL[value]}</OsBadge>;
}

export function QuickFilters({ active, counts, available, hrefFor }: { active: "" | Relationship; counts: Record<Relationship, number> | null; available: boolean; hrefFor: (rel: "" | Relationship) => string }) {
  const chip = "inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors";
  const total = counts ? RELATIONSHIPS.reduce((n, r) => n + counts[r], 0) : null;
  return (
    <nav aria-label="Relationship quick filters" className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Relationship</span>
        {available ? (
          <Link href={hrefFor("")} aria-current={active === "" ? "true" : undefined} className={cn(chip, active === "" ? "border-foreground bg-foreground text-background" : "border-border hover:bg-secondary/60")}>
            All{total !== null ? <span className="font-normal">({total})</span> : null}
          </Link>
        ) : null}
        {RELATIONSHIPS.map((r) => {
          const Icon = ICON[r];
          const on = active === r;
          const body = (<><Icon className="h-3.5 w-3.5" aria-hidden />{RELATIONSHIP_LABEL[r]}<span className="font-normal">({available && counts ? counts[r] : "Could not load"})</span></>);
          return available ? (
            // Clicking the active chip switches it off (back to All): one badge at a time.
            <Link key={r} href={hrefFor(on ? "" : r)} aria-current={on ? "true" : undefined} data-tone={RELATIONSHIP_TONE[r]} className={cn(chip, "os-quick", on && "os-quick-on")}>{body}</Link>
          ) : (
            <span key={r} aria-disabled="true" data-tone={RELATIONSHIP_TONE[r]} className={cn(chip, "os-quick cursor-not-allowed opacity-60")}>{body}</span>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">{RELATIONSHIP_HELP}</p>
    </nav>
  );
}

function SortHead({ sortKey, label, sort, hrefFor, note }: { sortKey: SortKey; label: string; sort: DirectorySort; hrefFor: (key: SortKey) => string; note?: boolean }) {
  const active = sort.key === sortKey;
  const Arrow = !active ? ChevronsUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <Link href={hrefFor(sortKey)} className="inline-flex min-h-10 items-center gap-1 underline-offset-2 hover:underline" title={note ? `${label}: ${ENQUIRIES_NOTE}` : `Sort by ${label}`} aria-describedby={note ? ENQUIRIES_NOTE_ID : undefined}>
        {label}
        {note ? <Info className="h-3.5 w-3.5" aria-hidden /> : null}
        <Arrow className={cn("h-3.5 w-3.5", !active && "opacity-50")} aria-hidden />
      </Link>
    </TableHead>
  );
}

export const SORT_LABELS: Record<SortKey, string> = { name: "Name", country: "Country", enquiries: "Enquiries", won: "Won enquiries", last: "Last enquiry", owner: "Account owner", badge: "Relationship" };

/** Phone only: the header row is hidden there (rows become cards), so the same sorts are offered as a short row of links. */
export function PhoneSort({ sort, hrefFor }: { sort: DirectorySort; hrefFor: (key: SortKey) => string }) {
  return (
    <nav aria-label="Sort accounts" className="flex flex-wrap items-center gap-1.5 text-sm md:hidden">
      <span className="font-medium">Sort by</span>
      {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
        <Link key={k} href={hrefFor(k)} aria-current={sort.key === k ? "true" : undefined} className={cn("inline-flex min-h-10 items-center gap-1 rounded-md border px-2.5", sort.key === k ? "border-foreground font-semibold" : "border-border")}>
          {SORT_LABELS[k]}{sort.key === k ? (sort.dir === "asc" ? <ArrowUp className="h-3.5 w-3.5" aria-hidden /> : <ArrowDown className="h-3.5 w-3.5" aria-hidden />) : null}
          {sort.key === k ? <span className="sr-only">{sort.dir === "asc" ? "ascending" : "descending"}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

export const formatEnquiryDate = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** One row per organisation. Below `md` each row is a card (existing stacked-table pattern): name first, then every figure with its heading. */
export function DirectoryTable({ rows, sort, hrefFor, accountHref, canSelect, ownerName }: {
  rows: readonly DirectoryRow[]; sort: DirectorySort; hrefFor: (key: SortKey) => string; accountHref: (orgId: string) => string; canSelect: boolean; ownerName: (id: string | null) => string | null;
}) {
  const shown = rows.map((r) => ({ id: r.org.id, name: r.org.name }));
  const head = (key: SortKey, note?: boolean) => <SortHead sortKey={key} label={SORT_LABELS[key]} sort={sort} hrefFor={hrefFor} note={note} />;
  return (
    <Table stack aria-label="Clients and agencies" className="[&_td]:align-middle">
      <TableHeader>
        <TableRow>
          <TableHead aria-sort={sort.key === "name" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
            <span className="flex items-center gap-2">
              {canSelect ? <SelectAllBox shown={shown} /> : null}
              <Link href={hrefFor("name")} className="inline-flex min-h-10 items-center gap-1 underline-offset-2 hover:underline" title="Sort by Name">
                Name{sort.key === "name" ? (sort.dir === "asc" ? <ArrowUp className="h-3.5 w-3.5" aria-hidden /> : <ArrowDown className="h-3.5 w-3.5" aria-hidden />) : <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" aria-hidden />}
              </Link>
            </span>
          </TableHead>
          {head("country")}
          <TableHead>Type</TableHead>
          {head("enquiries", true)}
          {head("won")}
          {head("last")}
          {head("badge")}
          {head("owner")}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => {
          const owner = ownerName(r.profile?.owner_id ?? null);
          return (
            <TableRow key={r.org.id}>
              <TableCell>
                <span className="flex items-start gap-2.5">
                  {canSelect ? <SelectBox id={r.org.id} name={r.org.name} /> : null}
                  <Link href={accountHref(r.org.id)} className="min-w-0 break-words font-medium underline-offset-2 hover:underline">{r.org.name}</Link>
                </span>
              </TableCell>
              <TableCell>{r.org.country_code ? countryLabel(r.org.country_code) : <span className="text-muted-foreground">Not recorded</span>}</TableCell>
              <TableCell>
                <span className="flex flex-wrap gap-1.5 md:max-w-[14rem]">
                  {r.org.roles.length === 0 ? <OsBadge tone="quiet">Role not recorded</OsBadge> : r.org.roles.map((role) => <OsBadge key={role} tone={role === "agency" ? "blue" : role === "technology" ? "cyan" : "neutral"} className="whitespace-nowrap">{ROLE_LABEL[role]}</OsBadge>)}
                </span>
              </TableCell>
              <TableCell className="tabular-nums">{r.stats ? r.stats.total : <span className="text-muted-foreground">Could not load</span>}</TableCell>
              <TableCell className="tabular-nums">{r.stats ? r.stats.won : <span className="text-muted-foreground">Could not load</span>}</TableCell>
              <TableCell>
                {!r.stats ? <span className="text-muted-foreground">Could not load</span> : r.stats.lastEnquiryOn ? <time dateTime={r.stats.lastEnquiryOn}>{formatEnquiryDate(r.stats.lastEnquiryOn)}</time> : <span className="text-muted-foreground">None</span>}
              </TableCell>
              <TableCell><RelationshipBadge value={r.relationship} /></TableCell>
              <TableCell>{owner ? <span className="font-medium">{owner}</span> : <OsBadge tone="amber">Unassigned</OsBadge>}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
