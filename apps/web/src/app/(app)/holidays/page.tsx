import { canManageHolidays } from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert } from "@/components/ui/alert";
import { AddHolidayForm } from "./add-holiday-form";
import { DeleteHolidayButton } from "./delete-holiday-button";
import { EmptyState } from "@/components/ui/empty-state";

// 2026 dates deliberately left unconfirmed (never guessed) by the Phase 2b
// leave-policy-configuration migration — each row's date isn't added until
// HR enters it below, once officially announced/decided.
const PENDING_2026_HOLIDAYS: { countryCode: string; label: string }[] = [
  { countryCode: "AE", label: "Islamic New Year, Prophet Muhammad's Birthday, Eid Al Etihad/National Day — exact Gregorian dates pending" },
  { countryCode: "SA", label: "Eid Al Fitr, Eid Al Adha — exact Gregorian dates pending official Umm Al-Qura/HRSD announcement" },
  { countryCode: "PL", label: "Replacement days for 15 Aug and 26 Dec (both fall on a Saturday in 2026) — HR must decide and enter the dates" },
];

export default async function HolidaysPage() {
  const session = await getCurrentSession();
  if (!session) return null;

  const supabase = await createClient();
  const [{ data: holidays }, { data: countries }] = await Promise.all([
    supabase.from("public_holidays").select("id, country_code, holiday_date, name").order("holiday_date"),
    supabase.from("countries").select("code, name").order("name"),
  ]);

  const countryName = new Map((countries ?? []).map((c) => [c.code, c.name]));
  const manageableCountries = (countries ?? []).filter((c) => canManageHolidays(session.grants, c.code));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Public holidays</h1>
        <p className="text-muted-foreground">
          Used by the leave day-count calculator, whose effect on a leave request differs by country: in the UAE, a
          public holiday within Annual Leave counts as part of the calendar-day leave period; in Saudi Arabia, an
          overlapping official holiday extends Annual Leave instead of consuming a day of it; in Poland, holidays and
          other non-working days never consume Annual Leave, since only working days are deducted. Lunar
          (Islamic-calendar) holidays are added each year once officially confirmed, not predicted in advance.
        </p>
      </div>

      {PENDING_2026_HOLIDAYS.some((p) => manageableCountries.some((c) => c.code === p.countryCode)) ? (
        <Alert>
          <p className="font-medium">2026 holidays pending confirmation</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
            {PENDING_2026_HOLIDAYS.filter((p) => manageableCountries.some((c) => c.code === p.countryCode)).map((p) => (
              <li key={p.countryCode}>
                <span className="font-medium">{countryName.get(p.countryCode) ?? p.countryCode}:</span> {p.label}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {manageableCountries.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Add a holiday</CardTitle>
          </CardHeader>
          <CardContent>
            <AddHolidayForm countries={manageableCountries} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Calendar</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Country</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(holidays ?? []).map((h) => (
                <TableRow key={h.id}>
                  <TableCell>{h.holiday_date}</TableCell>
                  <TableCell>{h.name}</TableCell>
                  <TableCell>{countryName.get(h.country_code) ?? h.country_code}</TableCell>
                  <TableCell>{canManageHolidays(session.grants, h.country_code) ? <DeleteHolidayButton holidayId={h.id} /> : null}</TableCell>
                </TableRow>
              ))}
              {(holidays ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4}>
                    <EmptyState dense title="No holidays on the calendar yet." />
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
