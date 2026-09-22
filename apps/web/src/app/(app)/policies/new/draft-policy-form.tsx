"use client";

import Link from "next/link";
import { useActionState } from "react";
import { draftPolicy } from "@/lib/actions/policies";
import type { ActionState } from "@/lib/actions/companies";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";

const initialState: ActionState = { error: null };

const PAYLOAD_PLACEHOLDERS: Record<string, string> = {
  leave_rules: '{\n  "source": "describe where these numbers come from"\n}',
  notice_period: '{\n  "default_days": 30\n}',
  probation_rules: '{\n  "max_probation_days": 180\n}',
  overtime_rules: "{}",
  working_week: "{}",
  end_of_service_benefit: "{}",
};

export function DraftPolicyForm({ countries }: { countries: { code: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(draftPolicy, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="countryCode">Country</Label>
          <Select id="countryCode" name="countryCode" defaultValue={countries[0]?.code}>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="policyType">Policy type</Label>
          <Select id="policyType" name="policyType" defaultValue="leave_rules">
            <option value="leave_rules">Leave rules</option>
            <option value="notice_period">Notice period</option>
            <option value="probation_rules">Probation rules</option>
            <option value="overtime_rules">Overtime rules</option>
            <option value="working_week">Working week</option>
            <option value="end_of_service_benefit">End-of-service benefit</option>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="versionNo">Version number</Label>
          <Input id="versionNo" name="versionNo" type="number" min={1} defaultValue={1} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="effectiveFrom">Effective from</Label>
          <Input id="effectiveFrom" name="effectiveFrom" type="date" required />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="payloadJson">Payload (JSON)</Label>
        <textarea
          id="payloadJson"
          name="payloadJson"
          rows={5}
          defaultValue={PAYLOAD_PLACEHOLDERS.leave_rules}
          className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <p className="text-xs text-muted-foreground">
          For leave rules, per-leave-type numbers (annual, sick…) are added on the policy&apos;s own page after
          drafting — this payload is context/metadata for the version as a whole.
        </p>
      </div>

      {state.error ? <Alert variant="destructive">{state.error}</Alert> : null}
      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save draft"}
        </Button>
        <Link href="/policies" className={buttonVariants({ variant: "outline" })}>
          Cancel
        </Link>
      </div>
      <p className="text-xs text-muted-foreground">
        This saves as a draft. A <em>different</em> HR Admin or the CEO for this country must activate it before it
        takes effect.
      </p>
    </form>
  );
}
