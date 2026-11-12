import type { EvidenceSnapshot } from "./evidence";

/**
 * ONE integrated exhibition project (fictional), the same shape the database test builds: delegated Engineering, Content and Programming sections, an approved change, a
 * client comment with our response, a partial equipment return and NO completion record (so no client sign-off).
 */
export const ID = {
  project: "11111111-1111-4111-8111-111111111111", handover: "22222222-2222-4222-8222-222222222222", pm: "aaaaaaaa-0000-4000-8000-000000000001", eng: "aaaaaaaa-0000-4000-8000-000000000002",
  content: "aaaaaaaa-0000-4000-8000-000000000003", prog: "aaaaaaaa-0000-4000-8000-000000000004", wall: "33333333-3333-4333-8333-333333333333", change: "44444444-4444-4444-8444-444444444444",
  feedback: "55555555-5555-4555-8555-555555555555", request: "66666666-6666-4666-8666-666666666666", reqLine: "77777777-7777-4777-8777-777777777777", completion: "88888888-8888-4888-8888-888888888888",
};
export function fixtureSnapshot(over: Partial<EvidenceSnapshot> = {}): EvidenceSnapshot {
  return {
    taken_at: "2027-03-06T10:00:00+00:00",
    project: { id: ID.project, reference: "UAE-P-2027-0001", name: "Fictional Expo stand", kind: "client", status: "in_progress", start_date: "2027-02-01", end_date: "2027-03-10", client: "Fictional Motors", venue: "Expo Hall 4", install_start: "2027-02-26", event_start: "2027-03-01", event_end: "2027-03-05", project_manager: "Pat Manager" },
    handover: { id: ID.handover, sales_reference: "UAE-O-2027-0007", title: "Expo stand for Fictional Motors", venue: "Expo Hall 4", install_start: "2027-02-26", event_start: "2027-03-01", event_end: "2027-03-05", accepted_at: "2027-01-20T09:00:00+00:00", accepted_by: "Pat Manager", technologies: [{ name: "LED wall", qty: 1 }], notes_text: "Edition 2027. The agency wants a rehearsal the evening before." },
    scope: { original_text: "LED welcome wall 6 x 4 m", original_exclusions_text: "Rigging by venue", current_text: "LED welcome wall 6 x 4 m plus a second kiosk", current_exclusions_text: "Rigging by venue", changed: true, approved_changes: 1 },
    team: [
      { user_id: ID.pm, name: "Pat Manager", role: "Project Manager", team: null, heads: [], active: true, tasks_done: 0, tasks_assigned: 0, milestones_accepted: 1, deliverables_owned: [] },
      { user_id: ID.content, name: "Casey Content", role: "Member", team: "Content", heads: ["Content"], active: true, tasks_done: 1, tasks_assigned: 1, milestones_accepted: 0, deliverables_owned: [] },
      { user_id: ID.eng, name: "Eli Engineer", role: "Member", team: "Engineering", heads: [], active: true, tasks_done: 0, tasks_assigned: 0, milestones_accepted: 0, deliverables_owned: ["D001 Interactive LED welcome wall"] },
      { user_id: ID.prog, name: "Pri Programmer", role: "Member", team: "Programming", heads: [], active: true, tasks_done: 0, tasks_assigned: 1, milestones_accepted: 0, deliverables_owned: [] },
    ],
    milestones: [
      { id: "99999999-0000-4000-8000-000000000001", title: "Design approved", status: "accepted", due_date: "2027-02-10", required: true, accepted_at: "2027-02-09T10:00:00+00:00", accepted_by: "Pat Manager" },
      { id: "99999999-0000-4000-8000-000000000002", title: "Client walkthrough", status: "planned", due_date: "2027-03-01", required: true, accepted_at: null, accepted_by: null },
    ],
    tasks: { total: 2, done: 1, open: 1, cancelled: 0, deferred: 0, blocked: 0, not_finished: [{ id: "99999999-0000-4000-8000-000000000003", title: "Touch interaction", status: "in_progress", assignee: "Pri Programmer", due_date: "2027-02-28", blocked: false }] },
    plan: [{ id: ID.wall, key: "D001", zone: "Entrance", title: "Interactive LED welcome wall", owner: "Eli Engineer", needed_by: "2027-03-01", released: true, lines: [
      { id: "99999999-0000-4000-8000-000000000011", key: "L0001", section: "hardware", description: "LED panels", qty: 4, released: true, request_line_id: ID.reqLine, task: null },
      { id: "99999999-0000-4000-8000-000000000012", key: "L0002", section: "content", description: "Welcome loop video", qty: null, released: true, request_line_id: null, task: { status: "done", completed_at: "2027-02-27T15:00:00+00:00", assignee: "Casey Content" } },
      { id: "99999999-0000-4000-8000-000000000013", key: "L0003", section: "programming", description: "Touch interaction", qty: null, released: true, request_line_id: null, task: { status: "in_progress", completed_at: null, assignee: "Pri Programmer" } },
    ] }],
    decisions: [{ id: ID.change, kind: "scope_change", title: "Add a second kiosk", status: "approved", proposed_by: "Eli Engineer", proposed_at: "2027-02-11T08:00:00+00:00", decided_by: "Pat Manager", decided_at: "2027-02-12T11:00:00+00:00", reason: "Agreed with the client on the 12 Feb call", effect_on_dates: "One extra install day" }],
    feedback: [{ id: ID.feedback, received_on: "2027-03-02", kind: "in_scope_correction", status: "resolved", resolved_at: "2027-03-02T16:00:00+00:00", resolved_by: "Casey Content", responsible: "Casey Content", due_date: null, request_text: "Please make the welcome loop brighter", response_text: "Brightness raised and confirmed on site" }],
    completion: null,
    reopened_earlier: false,
    equipment: { requests: [{ id: ID.request, code: "UAE-R-00001", status: "in_progress", expected_return_at: "2027-03-08T08:00:00+00:00", lines: [{ id: ID.reqLine, item: "LED panel P2.6", qty: 4, status: "active", sent: 4, returned: 1 }] }] },
    missing: [],
    ...over,
  };
}
