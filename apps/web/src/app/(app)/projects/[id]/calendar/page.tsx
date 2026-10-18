import { redirect } from "next/navigation";
import { legacyCalendarTarget } from "@/lib/projects/plan-view";

export const metadata = { title: "Plan calendar" };

/** The project calendar is now the Calendar view of the Plan section. The view, date, time zone and filters in the address carry over. */
export default async function ProjectCalendarPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  redirect(legacyCalendarTarget(id, await searchParams));
}
