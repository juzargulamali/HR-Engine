import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { splitHolidays, type HolidayRow } from "@/lib/policies/holidays";

const dayText = (iso: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

function List({ rows, showCountry }: { rows: HolidayRow[]; showCountry?: boolean }) {
  return (
    <ul className="divide-y divide-border/70">
      {rows.map((h) => (
        <li key={h.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2">
          <span className="font-medium">{h.name}</span>
          <span className="text-sm text-muted-foreground">{dayText(h.holiday_date)}{showCountry ? ` · ${h.countryName}` : ""}</span>
        </li>
      ))}
    </ul>
  );
}

/** Staff read the calendar for their own country first (what is coming, then what has passed); other countries are folded away. No settings, no add or delete. */
export function StaffHolidays({ holidays, ownCountry, ownCountryName, today }: { holidays: HolidayRow[]; ownCountry: string | null; ownCountryName: string | null; today: string }) {
  const { upcoming, earlier, others } = splitHolidays(holidays, ownCountry, today);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Public holidays</h1>
        <p className="text-muted-foreground">The official days off{ownCountryName ? ` in ${ownCountryName}` : ""}. Dates for lunar (Islamic-calendar) holidays are added once they are officially announced.</p>
      </div>
      {ownCountry ? (
        <Card>
          <CardHeader><CardTitle>Coming up{ownCountryName ? ` in ${ownCountryName}` : ""}</CardTitle></CardHeader>
          <CardContent>{upcoming.length > 0 ? <List rows={upcoming} /> : <EmptyState dense title="No upcoming public holidays are on the calendar yet." />}</CardContent>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground">Your country is not recorded on your employee record, so every country is listed below.</p>
      )}
      {earlier.length > 0 ? (
        <details className="rounded-lg border border-border bg-card"><summary className="cursor-pointer px-4 py-3 text-sm font-medium">Earlier ({earlier.length})</summary><div className="px-4 pb-3"><List rows={earlier} /></div></details>
      ) : null}
      {others.length > 0 ? (
        <details className="rounded-lg border border-border bg-card" open={!ownCountry}><summary className="cursor-pointer px-4 py-3 text-sm font-medium">{ownCountry ? `Other countries (${others.length})` : `All countries (${others.length})`}</summary><div className="px-4 pb-3"><List rows={others} showCountry /></div></details>
      ) : null}
      {holidays.length === 0 ? <EmptyState title="No holidays are on the calendar yet." /> : null}
    </div>
  );
}
