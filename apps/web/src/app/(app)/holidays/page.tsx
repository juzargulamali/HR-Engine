import { canManageHolidays } from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AddHolidayForm } from "./add-holiday-form";

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
          Used by the leave day-count calculator so a holiday inside a leave request never consumes a day. Lunar
          (Islamic-calendar) holidays are added each year once officially confirmed, not predicted in advance.
        </p>
      </div>

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
              </TableRow>
            </TableHeader>
            <TableBody>
              {(holidays ?? []).map((h) => (
                <TableRow key={h.id}>
                  <TableCell>{h.holiday_date}</TableCell>
                  <TableCell>{h.name}</TableCell>
                  <TableCell>{countryName.get(h.country_code) ?? h.country_code}</TableCell>
                </TableRow>
              ))}
              {(holidays ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground">
                    No holidays on the calendar yet.
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
