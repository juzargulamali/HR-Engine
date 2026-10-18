import { redirect } from "next/navigation";
import { legacyTimelineTarget } from "@/lib/projects/plan-view";

export const metadata = { title: "Plan" };

/** The old "Timelines & site" page now lives in the Plan section. Bookmarks, notifications and links keep working. */
export default async function TimelinePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  redirect(legacyTimelineTarget(id, await searchParams));
}
