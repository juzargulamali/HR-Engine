import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { isFinishedProject } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { getProjectsContext } from "@/lib/projects/context";
import { loadProjectView } from "@/lib/projects/data";
import { loadDeliveryPlan } from "@/lib/projects/delivery-plan/data";
import { cn } from "@/lib/utils";
import { ImportFlow } from "./import-flow";

export const metadata = { title: "Import Excel" };

/** Import a Delivery plan workbook: upload, preview, confirm. The checks here only decide what to draw; the import route and the database repeat every one. */
export default async function DeliveryPlanImportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getProjectsContext();
  if (!ctx) return null;
  const view = await loadProjectView(ctx, id);
  if (!view) notFound();
  const back = `/projects/${id}/delivery`;
  const head = (
    <div className="space-y-2">
      <Link href={back} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-ml-3")}><ArrowLeft className="h-4 w-4" aria-hidden /> Back to the Delivery plan</Link>
      <h2 className="text-lg font-semibold">Import Excel</h2>
      <p className="text-muted-foreground">Nothing is saved until you confirm.</p>
    </div>
  );
  const say = (body: React.ReactNode, variant?: "warning" | "destructive") => <div className="space-y-6">{head}<Alert variant={variant} role="status">{body}</Alert></div>;
  if (view.level !== "details") return say("The Delivery plan is for the people working on this project. The Project Manager can add you if you should take part.");
  if (isFinishedProject(view.project.status)) return say("This project is finished, so its Delivery plan is read-only. You can still export it from the Delivery plan.");
  const read = await loadDeliveryPlan(id);
  if (read.state === "not_installed") return say("The Delivery plan is not installed in this environment yet.");
  if (read.state === "denied") return say("You cannot open this project's Delivery plan.", "warning");
  if (read.state === "error") return say("Could not load the Delivery plan. Reload to try again.", "destructive");
  if (!read.plan.can_manage && read.plan.my_sections.length === 0) {
    return say("Only the Project Manager, or a person a section was delegated to, can import into the Delivery plan. You can raise a correction on the Delivery plan instead.", "warning");
  }
  return (
    <div className="space-y-6">
      {head}
      <ImportFlow projectId={id} canManage={read.plan.can_manage} />
    </div>
  );
}
