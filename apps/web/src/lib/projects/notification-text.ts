/**
 * Plain-English text and a link for a project notification, built only from its type and payload. A notification never carries
 * message text, only who and what it is about, so this is all there is to show. Unknown types are shown honestly, not hidden.
 */
export interface NotificationView {
  text: string;
  href: string | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export function describeNotification(type: string, payload: Record<string, unknown>): NotificationView {
  const pid = str(payload.project_id);
  const project = [str(payload.reference), str(payload.name)].filter(Boolean).join(" ") || "a project";
  const projectLink = pid ? `/projects/${pid}` : null;
  const taskId = str(payload.task_id);
  const task = str(payload.task);
  const taskLink = pid && taskId ? `/projects/${pid}/work/tasks/${taskId}` : projectLink;
  const handover = str(payload.title) ?? str(payload.reference) ?? "a handover";
  const to = str(payload.to);

  switch (type) {
    case "project_invitation":
      return { text: `You were added to ${project}.`, href: projectLink };
    case "project_assigned": {
      const team = str(payload.team);
      const until = str(payload.acting_until);
      if (team) return { text: `You were made head of the ${team} team on ${project}.`, href: projectLink };
      if (until) return { text: `You were given temporary project leadership of ${project} until ${until}.`, href: projectLink };
      return { text: `You were made responsible for ${project}.`, href: projectLink };
    }
    case "project_assignment": {
      const deliverable = str(payload.deliverable);
      if (deliverable) return { text: `The deliverable “${deliverable}” on ${project} was assigned to your department.`, href: pid ? `/projects/${pid}/work` : null };
      if (str(payload.booking_id)) {
        const where = str(payload.location);
        return { text: `A site booking${where ? ` at ${where}` : ""} on ${project} was made or confirmed for you.`, href: pid ? `/projects/${pid}/timeline` : null };
      }
      if (str(payload.feedback_id)) return { text: `Client feedback on ${project} was assigned to you.`, href: pid ? `/projects/${pid}/changes` : null };
      return { text: `You were given a new assignment on ${project}.`, href: projectLink };
    }
    case "project_handover_submitted":
      return { text: `Sales submitted the handover “${handover}”: it needs a Project Manager.`, href: "/projects/handovers" };
    case "project_handover_assigned":
      return { text: `You were named Project Manager for the handover “${handover}”. Accept it or ask Sales to clarify.`, href: "/projects/handovers" };
    case "project_handover_resubmitted":
      return { text: `Sales updated and resubmitted the handover “${handover}”.`, href: "/projects/handovers" };
    case "project_handover_clarification":
      return { text: `The Project Manager asked for clarification on the handover “${handover}”.`, href: "/projects/handovers" };
    case "project_handover_accepted":
      return { text: `The handover “${handover}” was accepted and ${project === "a project" ? "a project was created" : `${project} was created`}.`, href: projectLink ?? "/projects" };
    case "project_task_assigned":
      return { text: `${task ? `The task “${task}”` : "A task"} on ${project} was assigned to you.`, href: taskLink };
    case "project_deadline_changed": {
      if (payload.cancelled === true) return { text: `A site booking on ${project} was cancelled.`, href: pid ? `/projects/${pid}/timeline` : null };
      const what = task ? `The task “${task}”` : str(payload.deliverable) ? `The deliverable “${str(payload.deliverable)}”` : str(payload.milestone) ? `The milestone “${str(payload.milestone)}”` : str(payload.booking_id) ? "A site booking" : "A date";
      return { text: `${what} on ${project} changed${to ? ` (now ${to})` : ""}.`, href: task ? taskLink : projectLink };
    }
    case "project_review_requested":
      return { text: `${task ? `“${task}”` : str(payload.deliverable) ? `The deliverable “${str(payload.deliverable)}”` : "Work"} on ${project} is ready for your review.`, href: taskLink };
    case "project_review_result": {
      const done = payload.result === "done";
      return { text: `${task ? `“${task}”` : "Your task"} on ${project} was ${done ? "accepted and completed" : "sent back with changes requested"}.`, href: taskLink };
    }
    case "project_task_blocked": {
      const reason = str(payload.reason);
      return { text: `${task ? `“${task}”` : "A task"} on ${project} is blocked and needs your action${reason ? `: ${reason}` : ""}.`, href: taskLink };
    }
    case "project_mention":
      return { text: `You were mentioned in the discussion of ${project}.`, href: pid ? `/projects/${pid}/discussion` : null };
    case "project_reply":
      return { text: `Someone replied to your message in the discussion of ${project}.`, href: pid ? `/projects/${pid}/discussion` : null };
    case "project_dates_changed":
      return { text: `The key dates of ${project} changed.`, href: projectLink };
    case "project_scope_decision":
      return { text: `A scope change on ${project} was ${payload.decision === "approve" ? "approved" : "rejected"}.`, href: pid ? `/projects/${pid}/changes` : null };
    case "project_completed":
      return { text: `${project} was completed.`, href: projectLink };
    case "project_reopened":
      return { text: `${project} was reopened.`, href: projectLink };
    default:
      return { text: "A project update.", href: projectLink };
  }
}
