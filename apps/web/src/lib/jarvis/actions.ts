import "server-only";
import { registerJarvisAction } from "./registry";
import { createEnquiryFromBrief } from "./sales/enquiry-create-from-brief";
import { registerDisabledSalesActions } from "./sales/disabled-actions";
import { draftReply } from "./sales/draft-reply";
import { changeStage } from "./sales/enquiry-stage";
import { recordMeeting } from "./sales/meeting-record";
import { updateEnquiry } from "./sales/enquiry-update";
import { chatReply } from "./sales/chat";
import { overdueFollowUps } from "./sales/followups-overdue";
import { helpAnswer } from "./sales/help-answer";
import { registerOrganisation } from "./sales/organisation-register";

let done = false;

/**
 * The one list of everything JARVIS can do. A module adds its actions here (see docs/enginious-os/modules/jarvis.md "How the next module registers actions"):
 *   1. create apps/web/src/lib/jarvis/<module>/<action>.ts exporting a JarvisActionDefinition (id jarvis.<module>.<noun>.<verb>),
 *   2. import and register it below, 3. add a grant checker for the module in runtime.ts (moduleGrant), 4. add tests. Nothing outside this list is reachable.
 */
export function registerAllJarvisActions(): void {
  if (done) return;
  done = true;
  registerJarvisAction(createEnquiryFromBrief);
  const implemented = [draftReply, helpAnswer, registerOrganisation, updateEnquiry, changeStage, recordMeeting, chatReply, overdueFollowUps];
  for (const a of implemented) registerJarvisAction(a);
  registerDisabledSalesActions(implemented.map((a) => a.id));
}

/** For tests only: lets a test register the list again after clearing the registry. */
export const resetJarvisActionsForTests = () => { done = false; };
