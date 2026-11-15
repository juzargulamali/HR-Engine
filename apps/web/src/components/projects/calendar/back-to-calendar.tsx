"use client";

import { useSearchParams } from "next/navigation";
import { BackLink } from "@/components/workspace/list-memory";

/**
 * "Back to Calendar" on the record a calendar entry opened. A calendar link carries `from=calendar` (the Projects calendar) or `from=plan-calendar` (the project's own Plan
 * calendar); this shows the way back only then, and returns to the calendar as the person left it: the same date, view (Month, Week, Agenda), time zone and filters, which all
 * live in the calendar's address and are remembered by its <RememberList/>. Without a remembered address (a new tab, storage blocked) it opens the plain calendar.
 */
export function BackToCalendar({ projectId }: { projectId: string }) {
  const from = useSearchParams().get("from");
  if (from === "calendar") return <BackLink section="calendar" fallback="/projects/calendar">Back to Calendar</BackLink>;
  if (from === "plan-calendar") return <BackLink section={`plan-calendar-${projectId}`} fallback={`/projects/${projectId}/plan?mode=calendar`}>Back to Calendar</BackLink>;
  return null;
}
