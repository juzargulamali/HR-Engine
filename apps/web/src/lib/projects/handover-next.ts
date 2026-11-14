/**
 * Who a handover is with and what happens next, in one line, from its status alone. Shown at the top of every pending handover (and under each row), so the person who has to act
 * and the step they take are obvious without opening the brief. Pure.
 *
 * `who` is a person's name when the record names one, otherwise the role that acts. "you" is used when the viewer is that person.
 */
export interface HandoverNextInput { status: string; pm_user_id: string | null; prepared_by: string | null; project_id: string | null }
export interface HandoverNext { who: string; role: string; next: string; line: string }

export function handoverNext(h: HandoverNextInput, names: { pm: string; sales: string; viewerId: string }): HandoverNext {
  const you = (id: string | null, name: string) => (id && id === names.viewerId ? "you" : name);
  let who: string; let role: string; let next: string;
  switch (h.status) {
    case "submitted": who = "Operations"; role = "Operations"; next = "Assign a Project Manager"; break;
    case "pm_assigned": who = you(h.pm_user_id, names.pm); role = "Project Manager"; next = "Accept the handover (it creates the project) or ask Sales a question"; break;
    case "clarification_requested": who = you(h.prepared_by, names.sales); role = "Sales owner"; next = `Answer ${names.pm}'s question and resubmit`; break;
    case "accepted": who = you(h.pm_user_id, names.pm); role = "Project Manager"; next = h.project_id ? "Open the project plan and press Bring in accepted technologies" : "The project was created"; break;
    case "withdrawn": who = "Sales owner"; role = "Sales owner"; next = "Prepare the brief again to restart"; break;
    default: who = "Sales owner"; role = "Sales owner"; next = "Finish and submit the brief";
  }
  return { who, role, next, line: `With ${who} (${role}) · Next: ${next}` };
}
