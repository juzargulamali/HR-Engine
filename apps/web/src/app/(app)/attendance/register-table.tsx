"use client";

import { Fragment, useState } from "react";
import { formatHoursMinutes, reviewFlagLabel, workModeLabel, CLASSIFICATION_LABELS, RECOVERY_SUMMARY_LABELS } from "@/lib/recovery/labels";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ClockStatus } from "@/components/attendance/clock-status";
import { AddMissingAttendanceForm, CorrectSessionForm } from "./edit-panels";
import type { Colleague, RegisterDetail, RegisterRowView } from "./register-types";

const ATTENDANCE_LABELS: Record<string, string> = {
  not_recorded: "Not recorded",
  present: "Present",
  absent: "Absent",
  leave: "Leave",
  partial_day: "Partial day",
};

function fmtTime(iso: string | null, timeZone: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}
function fmtDateTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

function recoveryVariant(summary: string): "success" | "warning" | "secondary" | "outline" {
  if (summary === "approved") return "success";
  if (summary === "needs_review") return "warning";
  if (summary === "none") return "outline";
  return "secondary";
}

export function RegisterTable({
  rows,
  details,
  colleagues,
  workDate,
  canEdit,
}: {
  rows: RegisterRowView[];
  details: Record<string, RegisterDetail>;
  colleagues: Colleague[];
  workDate: string;
  canEdit: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Employee</TableHead>
          <TableHead>Clock status</TableHead>
          <TableHead>Attendance for {workDate}</TableHead>
          <TableHead>Work mode</TableHead>
          <TableHead>First clock-in</TableHead>
          <TableHead>Last clock-out</TableHead>
          <TableHead>Recorded hours</TableHead>
          <TableHead>Recovery / review</TableHead>
          <TableHead>{canEdit ? "Edit" : ""}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => {
          const detail = details[r.employeeId];
          const expanded = open === r.employeeId;
          const hasEvidence = r.sessionCount > 0 || (detail?.windows.length ?? 0) > 0;
          return (
            <Fragment key={r.employeeId}>
              <TableRow data-employee-id={r.employeeId}>
                <TableCell className="font-medium">
                  <button
                    type="button"
                    className="text-left hover:underline disabled:no-underline"
                    aria-expanded={expanded}
                    aria-controls={`detail-${r.employeeId}`}
                    onClick={() => setOpen(expanded ? null : r.employeeId)}
                  >
                    <span aria-hidden>{expanded ? "▾ " : "▸ "}</span>
                    {r.name}
                  </button>
                </TableCell>
                <TableCell>
                  <ClockStatus status={r.clockStatus} />
                  {r.clockStatus === "clocked_in" && r.openSince ? (
                    <div className="text-xs text-muted-foreground">since {fmtTime(r.openSince, r.timeZone)}</div>
                  ) : null}
                </TableCell>
                <TableCell>
                  {r.attendanceStatus === "not_recorded" && r.clockStatus === "not_started" ? (
                    <span className="text-muted-foreground">Not started / Not recorded</span>
                  ) : (
                    <span>{ATTENDANCE_LABELS[r.attendanceStatus] ?? r.attendanceStatus}</span>
                  )}
                  {r.onLeave ? (
                    <Badge variant="secondary" className="ml-2">
                      On leave
                    </Badge>
                  ) : null}
                  {r.attendanceSource && r.attendanceSource !== "self_clock" ? (
                    <div className="text-xs text-muted-foreground">
                      Manual entry{r.manualHours != null ? ` · ${r.manualHours} h` : ""}
                    </div>
                  ) : null}
                  {r.presenceConflict ? (
                    <div className="text-xs text-warning" title={r.presenceConflict}>
                      Manual and clock records differ — review
                    </div>
                  ) : null}
                </TableCell>
                <TableCell>{r.workModes.length > 0 ? r.workModes.map(workModeLabel).join(", ") : "—"}</TableCell>
                <TableCell>{fmtTime(r.firstClockIn, r.timeZone)}</TableCell>
                <TableCell>{r.clockStatus === "clocked_in" ? "—" : fmtTime(r.lastClockOut, r.timeZone)}</TableCell>
                <TableCell>
                  {r.sessionCount === 0 ? (
                    "—"
                  ) : (
                    <>
                      {formatHoursMinutes(r.recordedSeconds)}
                      {r.isProvisional ? <div className="text-xs text-muted-foreground">so far — still clocked in</div> : null}
                    </>
                  )}
                  {r.hrRecorded ? <div className="text-xs text-muted-foreground">Recorded by HR</div> : null}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1">
                    {r.recoverySummary !== "none" ? (
                      <Badge variant={recoveryVariant(r.recoverySummary)}>{RECOVERY_SUMMARY_LABELS[r.recoverySummary]}</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                    {r.openAlertCount > 0 ? <Badge variant="warning">HR alert</Badge> : null}
                  </div>
                  {r.reviewFlags.length > 0 ? <div className="mt-1 text-xs text-muted-foreground">{r.reviewFlags.map(reviewFlagLabel).join(" · ")}</div> : null}
                </TableCell>
                <TableCell>
                  {canEdit ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setOpen(r.employeeId);
                        setEditing(editing === r.employeeId ? null : r.employeeId);
                      }}
                    >
                      Edit
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
              {expanded ? (
                <TableRow id={`detail-${r.employeeId}`}>
                  <TableCell colSpan={9} className="bg-secondary/30">
                    <div className="space-y-4 py-2">
                      {!hasEvidence ? <p className="text-sm text-muted-foreground">No clock sessions recorded for this date.</p> : null}

                      {(detail?.sessions ?? []).map((s) => (
                        <div key={s.id} className="space-y-2 rounded-md border border-border bg-background p-3 text-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">
                              {fmtDateTime(s.clockIn, r.timeZone)} → {s.clockOut ? fmtDateTime(s.clockOut, r.timeZone) : "still clocked in"}
                            </span>
                            {s.recordedByHr ? <Badge variant="secondary">Recorded by HR</Badge> : null}
                            {s.hrClosedReason ? <Badge variant="warning">Clock-out closed by HR</Badge> : null}
                            {s.recoveryModel === "legacy" ? <Badge variant="outline">Previous calculation</Badge> : null}
                          </div>
                          {s.recordedByHrReason ? <p className="text-xs text-muted-foreground">HR note: {s.recordedByHrReason}</p> : null}
                          {s.hrClosedReason ? <p className="text-xs text-muted-foreground">Closing reason: {s.hrClosedReason}</p> : null}
                          <ul className="space-y-1 text-xs">
                            {s.segments.map((seg) => (
                              <li key={seg.id}>
                                {fmtTime(seg.start, r.timeZone)}–{seg.end ? fmtTime(seg.end, r.timeZone) : "now"} · {workModeLabel(seg.mode)}
                                {seg.projectName ? ` · ${seg.projectName}` : ""}
                                {seg.leadName ? ` · lead ${seg.leadName}` : ""}
                                {seg.location ? ` · location: ${seg.location}` : ""}
                              </li>
                            ))}
                          </ul>
                          {s.corrections.map((c) => (
                            <p key={c.id} className="rounded bg-secondary/50 p-2 text-xs">
                              {c.kind === "add_missing" ? "Added by HR" : "Corrected by HR"} ({c.actorName}, {fmtDateTime(c.createdAt, r.timeZone)}):{" "}
                              {c.originalIn ? `${fmtDateTime(c.originalIn, r.timeZone)}–${c.originalOut ? fmtDateTime(c.originalOut, r.timeZone) : "open"} → ` : ""}
                              {fmtDateTime(c.correctedIn, r.timeZone)}–{fmtDateTime(c.correctedOut, r.timeZone)}. Reason: {c.reason}
                            </p>
                          ))}
                          {canEdit && editing === r.employeeId && s.recoveryModel === "windowed" && s.status === "closed" ? (
                            <CorrectSessionForm session={s} timeZone={r.timeZone} />
                          ) : null}
                          {canEdit && editing === r.employeeId && s.status === "open" ? <CorrectSessionForm session={s} timeZone={r.timeZone} /> : null}
                          {canEdit && editing === r.employeeId && s.recoveryModel === "legacy" && s.status === "closed" ? (
                            <p className="text-xs text-muted-foreground">
                              This session was recorded under the previous Recovery Leave calculation and keeps it, so its times are not edited here.
                            </p>
                          ) : null}
                        </div>
                      ))}

                      {(detail?.windows ?? []).length > 0 ? (
                        <div className="space-y-1 text-sm">
                          <p className="font-medium">Recovery windows starting on this date</p>
                          {(detail?.windows ?? []).map((w) => (
                            <p key={w.id} className="text-xs">
                              {fmtDateTime(w.start, r.timeZone)} → {fmtDateTime(w.end, r.timeZone)} · {CLASSIFICATION_LABELS[w.classification as keyof typeof CLASSIFICATION_LABELS] ?? w.classification} ·{" "}
                              {formatHoursMinutes(w.recordedSeconds)} recorded ·{" "}
                              {w.status === "open" ? "window still open (provisional)" : `${w.entitlementDays} day${w.entitlementDays === 1 ? "" : "s"}`}
                              {w.requestStatus ? ` · request ${w.requestStatus.replace(/_/g, " ")}` : ""}
                              {w.hrVerificationRequired && !w.hrVerifiedAt ? " · awaiting HR verification" : ""}
                            </p>
                          ))}
                        </div>
                      ) : null}

                      {canEdit && editing === r.employeeId ? (
                        <AddMissingAttendanceForm employeeId={r.employeeId} timeZone={r.timeZone} defaultDate={workDate} colleagues={colleagues} />
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ) : null}
            </Fragment>
          );
        })}
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={9} className="text-center text-muted-foreground">
              No employees match these filters.
            </TableCell>
          </TableRow>
        ) : null}
      </TableBody>
    </Table>
  );
}
