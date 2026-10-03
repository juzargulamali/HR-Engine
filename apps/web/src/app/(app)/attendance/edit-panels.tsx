"use client";

import { useState, useTransition } from "react";
import { utcIsoToLocalDateTime } from "@enginious-hr/domain";
import { addMissingAttendance, closeMissingClockOut, correctAttendanceSession } from "@/lib/actions/recoveryWindows";
import { WORK_MODE_LABELS } from "@/lib/recovery/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Alert } from "@/components/ui/alert";
import type { Colleague, SessionDetail } from "./register-types";

function Result({ error, ok }: { error: string | null; ok: boolean }) {
  if (error) return <Alert variant="destructive">{error}</Alert>;
  if (ok) return <Alert variant="success">Saved. The register will refresh.</Alert>;
  return null;
}

/**
 * HR-only. Times are entered, and shown, in the EMPLOYEE'S own timezone (never
 * the browser's), and every change needs a reason. The original recording is
 * never overwritten: both values are stored side by side by the database.
 */
export function CorrectSessionForm({ session, timeZone }: { session: SessionDetail; timeZone: string }) {
  const [clockIn, setClockIn] = useState(utcIsoToLocalDateTime(timeZone, session.clockIn));
  const [clockOut, setClockOut] = useState(session.clockOut ? utcIsoToLocalDateTime(timeZone, session.clockOut) : "");
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const isOpen = session.status === "open";

  return (
    <form
      className="space-y-3 rounded-md border border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        setOk(false);
        startTransition(async () => {
          const result = isOpen
            ? await closeMissingClockOut({ sessionId: session.id, clockOutLocal: clockOut, reason })
            : await correctAttendanceSession({ sessionId: session.id, clockInLocal: clockIn, clockOutLocal: clockOut, reason });
          setError(result.error);
          setOk(!result.error);
          if (!result.error) setReason("");
        });
      }}
    >
      <p className="text-sm font-medium">{isOpen ? "Close a missing clock-out" : "Correct this session's times"}</p>
      <div className="flex flex-wrap gap-3">
        {!isOpen ? (
          <div className="space-y-1.5">
            <Label htmlFor={`in-${session.id}`}>Clock-in ({timeZone})</Label>
            <Input id={`in-${session.id}`} type="datetime-local" value={clockIn} onChange={(e) => setClockIn(e.target.value)} required />
          </div>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor={`out-${session.id}`}>Clock-out ({timeZone})</Label>
          <Input id={`out-${session.id}`} type="datetime-local" value={clockOut} onChange={(e) => setClockOut(e.target.value)} required />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`reason-${session.id}`}>Reason (required — kept with the original and corrected times)</Label>
        <Textarea id={`reason-${session.id}`} value={reason} onChange={(e) => setReason(e.target.value)} required className="min-h-16" />
      </div>
      <Button type="submit" size="sm" disabled={pending || reason.trim().length === 0}>
        {pending ? "Saving…" : isOpen ? "Close session" : "Save correction"}
      </Button>
      <Result error={error} ok={ok} />
    </form>
  );
}

/** "Add missing attendance" — recorded by HR, flagged as such, never shown as a live Clocked-in state. */
export function AddMissingAttendanceForm({
  employeeId,
  timeZone,
  defaultDate,
  colleagues,
}: {
  employeeId: string;
  timeZone: string;
  defaultDate: string;
  colleagues: Colleague[];
}) {
  const [start, setStart] = useState(`${defaultDate}T09:00`);
  const [end, setEnd] = useState(`${defaultDate}T18:00`);
  const [mode, setMode] = useState("office");
  const [project, setProject] = useState("");
  const [lead, setLead] = useState("");
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  return (
    <form
      className="space-y-3 rounded-md border border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        setOk(false);
        startTransition(async () => {
          const result = await addMissingAttendance({
            employeeId,
            clockInLocal: start,
            clockOutLocal: end,
            workMode: mode as "office",
            projectName: project,
            projectLeadEmployeeId: lead,
            reason,
          });
          setError(result.error);
          setOk(!result.error);
          if (!result.error) setReason("");
        });
      }}
    >
      <p className="text-sm font-medium">Add missing attendance (recorded by HR)</p>
      <div className="flex flex-wrap gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={`ms-${employeeId}`}>Clock-in ({timeZone})</Label>
          <Input id={`ms-${employeeId}`} type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`me-${employeeId}`}>Clock-out ({timeZone})</Label>
          <Input id={`me-${employeeId}`} type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`mm-${employeeId}`}>Work mode</Label>
          <Select id={`mm-${employeeId}`} value={mode} onChange={(e) => setMode(e.target.value)}>
            {Object.entries(WORK_MODE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`mp-${employeeId}`}>Project{mode === "site_work" ? " (required)" : " (optional)"}</Label>
          <Input id={`mp-${employeeId}`} value={project} onChange={(e) => setProject(e.target.value)} required={mode === "site_work"} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`ml-${employeeId}`}>Project lead{mode === "site_work" ? " (required)" : " (optional)"}</Label>
          <Select id={`ml-${employeeId}`} value={lead} onChange={(e) => setLead(e.target.value)} required={mode === "site_work"}>
            <option value="">None</option>
            {colleagues.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`mr-${employeeId}`}>Reason (required)</Label>
        <Textarea id={`mr-${employeeId}`} value={reason} onChange={(e) => setReason(e.target.value)} required className="min-h-16" />
      </div>
      <Button type="submit" size="sm" disabled={pending || reason.trim().length === 0}>
        {pending ? "Saving…" : "Add attendance"}
      </Button>
      <Result error={error} ok={ok} />
    </form>
  );
}
