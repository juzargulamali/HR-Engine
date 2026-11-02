import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { SUBMITTED_OR_LATER } from "@/lib/crm/handover-attention";
import { loadHandoverStatus } from "@/lib/crm/handover-attention-data";
import { cn } from "@/lib/utils";

/**
 * Under "Won": what to do about the handover now. Until it is submitted the prompt is "Prepare the handover now"; afterwards it says where it stands.
 * The state is read from the Projects handover (the same read the handover page uses); a failed read says so. The handover process itself is unchanged.
 */
export async function WonHandoverPrompt({ opportunityId }: { opportunityId: string }) {
  const href = `/sales/opportunities/${opportunityId}/handover`;
  const check = await loadHandoverStatus(opportunityId);
  const link = (label: string, primary = false) => (
    <Link href={href} className={primary ? cn(buttonVariants({ size: "sm" }), "mt-2 inline-flex") : "font-medium underline"}>{label}</Link>
  );
  const wrap = (children: React.ReactNode) => <div className="mt-1">{children}</div>;
  if (check.status === "none") return wrap(<>{link("Open the handover package")}</>);
  if (check.status === "error") return wrap(<><p>Could not check the handover.</p>{link("Open the handover package")}</>);
  const st = check.handoverStatus;
  if (st === "clarification_requested") return wrap(<><p>The Project Manager asked a question about the handover.</p>{link("Answer it", true)}</>);
  if (st === "accepted") return wrap(<><p>Handover accepted: the project exists.</p>{link("See the handover package")}</>);
  if (st && SUBMITTED_OR_LATER.has(st)) return wrap(<><p>Handover submitted. Delivery has it.</p>{link("See the handover package")}</>);
  return wrap(<><p>The handover is not submitted yet. Nobody in delivery is told until you submit it.</p>{link("Prepare the handover now", true)}</>);
}
