import { redirect } from "next/navigation";

/**
 * The Sales landing page is Follow-ups: what needs doing today. Everything the old overview showed now lives where it is used
 * (reminders and "needs attention" on Follow-ups, the pipeline as the board on Enquiries, recent activity inside each enquiry, the
 * numbers in Reports). The address stays valid for bookmarks.
 */
export default function SalesIndexPage() {
  redirect("/sales/follow-ups");
}
