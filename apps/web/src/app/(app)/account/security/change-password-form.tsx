"use client";

import { useActionState } from "react";
import { PASSWORD_REQUIREMENTS_TEXT } from "@enginious-hr/domain";
import { changePassword, type ChangePasswordState } from "@/lib/actions/password";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";

const initialState: ChangePasswordState = { success: false, error: null };

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState(changePassword, initialState);

  return (
    <form action={formAction} className="space-y-4" key={state.success ? "done" : "form"}>
      <div className="space-y-1.5">
        <Label htmlFor="currentPassword">Current password</Label>
        <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="newPassword">New password</Label>
        <Input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          aria-describedby="new-password-requirements"
        />
        <p id="new-password-requirements" className="text-xs text-muted-foreground">
          {PASSWORD_REQUIREMENTS_TEXT}
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirmPassword">Confirm new password</Label>
        <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required />
      </div>
      {state.error ? (
        <Alert variant="destructive" role="alert" aria-live="assertive">
          {state.error}
        </Alert>
      ) : null}
      {state.success ? (
        <Alert variant="success" role="status">
          Password changed. Any other signed-in devices have been signed out.
        </Alert>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Changing…" : "Change password"}
      </Button>
    </form>
  );
}
