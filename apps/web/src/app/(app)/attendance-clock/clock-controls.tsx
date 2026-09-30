"use client";

import { useState, useTransition } from "react";
import { clockIn, clockOut, switchWorkSegment } from "@/lib/actions/attendanceClocking";
import { captureLocation, type LocationCapture } from "@/lib/geolocation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";

type WorkMode = "office" | "wfh" | "site_work" | "client_meeting" | "business_travel";

const WORK_MODE_OPTIONS: { value: WorkMode; label: string }[] = [
  { value: "office", label: "Office" },
  { value: "wfh", label: "Work from home" },
  { value: "site_work", label: "Site work / Installation" },
  { value: "client_meeting", label: "Client meeting" },
  { value: "business_travel", label: "Business travel" },
];

function locationNote(loc: LocationCapture): string | null {
  if (loc.permissionStatus === "granted") return null;
  if (loc.permissionStatus === "denied") return "Location permission was denied — clocking anyway, this has been flagged for HR review.";
  if (loc.permissionStatus === "timeout") return "Location took too long to respond — clocking anyway, this has been flagged for HR review.";
  return "Location is unavailable on this device — clocking anyway, this has been flagged for HR review.";
}

/**
 * Employee self-service clock controls — Clock In / Clock Out only (never
 * Start Break / End Break) and a "Switch work mode" action that closes the
 * current segment and opens a new one WITHOUT ending the session. Fresh
 * geolocation is requested ONLY when the relevant segment (the one being
 * closed, opened, or clocked out) is Site work / Installation — never
 * otherwise, and never blocking on denial (see captureLocation()'s own doc
 * comment).
 */
export function ClockControls({
  isClockedIn,
  currentWorkMode,
  colleagues,
}: {
  isClockedIn: boolean;
  currentWorkMode: string | null;
  colleagues: { id: string; first_name: string; last_name: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);

  const [workMode, setWorkMode] = useState<WorkMode>("office");
  const [projectName, setProjectName] = useState("");
  const [projectLeadEmployeeId, setProjectLeadEmployeeId] = useState("");

  const requiresProject = workMode === "site_work";

  function resetForm() {
    setWorkMode("office");
    setProjectName("");
    setProjectLeadEmployeeId("");
    setSwitching(false);
  }

  function handleClockIn() {
    if (requiresProject && (!projectName.trim() || !projectLeadEmployeeId)) {
      setError("Site work / Installation requires a project name and a project lead.");
      return;
    }
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const location = workMode === "site_work" ? await captureLocation() : undefined;
      const result = await clockIn({
        workMode,
        projectName: projectName.trim() || undefined,
        projectLeadEmployeeId: projectLeadEmployeeId || undefined,
        location,
      });
      setError(result.error);
      if (!result.error) {
        resetForm();
        if (location) {
          const note = locationNote(location);
          if (note) setNotice(note);
        }
      }
    });
  }

  function handleSwitch() {
    if (requiresProject && (!projectName.trim() || !projectLeadEmployeeId)) {
      setError("Site work / Installation requires a project name and a project lead.");
      return;
    }
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const closingLocation = currentWorkMode === "site_work" ? await captureLocation() : undefined;
      const openingLocation = workMode === "site_work" ? await captureLocation() : undefined;
      const result = await switchWorkSegment({
        workMode,
        projectName: projectName.trim() || undefined,
        projectLeadEmployeeId: projectLeadEmployeeId || undefined,
        closingLocation,
        openingLocation,
      });
      setError(result.error);
      if (!result.error) {
        resetForm();
        const note = (closingLocation && locationNote(closingLocation)) || (openingLocation && locationNote(openingLocation));
        if (note) setNotice(note);
      }
    });
  }

  function handleClockOut() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const location = currentWorkMode === "site_work" ? await captureLocation() : undefined;
      const result = await clockOut({ location });
      setError(result.error);
      if (!result.error && location) {
        const note = locationNote(location);
        if (note) setNotice(note);
      }
    });
  }

  const workModeFields = (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="space-y-1.5">
        <Label htmlFor="workMode">Work mode</Label>
        <Select id="workMode" value={workMode} onChange={(e) => setWorkMode(e.target.value as WorkMode)}>
          {WORK_MODE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="projectName">Project {requiresProject ? "(required)" : "(optional)"}</Label>
        <Input id="projectName" value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="Project or installation name" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="projectLead">Project lead {requiresProject ? "(required)" : "(optional)"}</Label>
        <Select id="projectLead" value={projectLeadEmployeeId} onChange={(e) => setProjectLeadEmployeeId(e.target.value)}>
          <option value="">None</option>
          {colleagues.map((c) => (
            <option key={c.id} value={c.id}>
              {c.first_name} {c.last_name}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {!isClockedIn ? (
        <div className="space-y-4">
          {workModeFields}
          <Button disabled={pending} onClick={handleClockIn}>
            {pending ? "Clocking in…" : "Clock In"}
          </Button>
        </div>
      ) : switching ? (
        <div className="space-y-4 border-t border-border pt-4">
          {workModeFields}
          <div className="flex gap-2">
            <Button disabled={pending} onClick={handleSwitch}>
              {pending ? "Switching…" : "Switch work mode"}
            </Button>
            <Button variant="outline" disabled={pending} onClick={() => setSwitching(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={pending} onClick={() => setSwitching(true)}>
            Switch work mode
          </Button>
          <Button variant="destructive" disabled={pending} onClick={handleClockOut}>
            {pending ? "Clocking out…" : "Clock Out"}
          </Button>
        </div>
      )}
      {notice ? <Alert variant="warning">{notice}</Alert> : null}
      {error ? <Alert variant="destructive">{error}</Alert> : null}
    </div>
  );
}
