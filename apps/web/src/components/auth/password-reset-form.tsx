"use client";

import { useEffect, useState, type FormEvent } from "react";
import { getPasswordIssues, PASSWORD_REQUIREMENTS_TEXT } from "@enginious-hr/domain";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";

type Status = "checking" | "ready" | "invalid";

/**
 * Shared by /set-password (invite completion) and /reset-password
 * (forgot-password completion) — both receive the exact same
 * access_token/refresh_token-in-URL-hash shape from Supabase's default
 * email templates (see the original comment this was extracted from,
 * still accurate): @supabase/ssr's browser client hardcodes flowType:
 * "pkce", so its automatic hash-detection refuses that shape of URL, and
 * setSession() is used directly instead of relying on it.
 */
export function PasswordResetForm({ mode }: { mode: "invite" | "reset" }) {
  const [status, setStatus] = useState<Status>("checking");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function establishSession() {
      const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
      const params = new URLSearchParams(hash);
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");

      let ok = false;
      if (accessToken && refreshToken) {
        const supabase = createClient();
        const { error: sessionError } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        ok = !sessionError;
      }

      if (cancelled) return;
      if (ok) {
        // Drop the tokens from the visible URL/history now that they're spent.
        window.history.replaceState(null, "", window.location.pathname);
        setStatus("ready");
      } else {
        setStatus("invalid");
      }
    }

    establishSession();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const issues = getPasswordIssues(password);
    if (issues.length > 0) {
      setError(issues[0] ?? "Password doesn't meet the requirements.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setPending(true);
    const supabase = createClient();
    const { data: updateData, error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setPending(false);
      setError(updateError.message);
      return;
    }

    const userId = updateData.user?.id;
    if (userId) {
      // No-op (0 rows matched) unless this account is still 'invited' —
      // profiles_self_activate is the only policy that allows this specific
      // transition, so this is safe to call unconditionally from either flow.
      await supabase.from("profiles").update({ account_status: "active" }).eq("id", userId);
    }

    // "Where supported" — Supabase's signOut(scope: 'others') invalidates
    // every OTHER session for this user server-side, leaving the one that
    // just set the new password signed in. Best-effort: a failure here
    // doesn't block completing the password reset itself.
    await supabase.auth.signOut({ scope: "others" });
    await supabase.rpc("log_security_event", { p_action: "password_changed" });

    // Full navigation, not router.push — proxy.ts's session check runs on
    // the server and only sees cookies once a real request lands there;
    // a client-side route change wouldn't force that round trip.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/";
  }

  if (status === "checking") {
    return <p className="text-sm text-muted-foreground">Verifying your link…</p>;
  }

  if (status === "invalid") {
    return (
      <Alert variant="destructive">
        {mode === "invite"
          ? "This link is invalid or has expired. Ask HR to send you a new invite from Admin → Users."
          : "This link is invalid or has expired. Request a new one from the forgot-password page."}
      </Alert>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-describedby="password-requirements"
        />
        <p id="password-requirements" className="text-xs text-muted-foreground">
          {PASSWORD_REQUIREMENTS_TEXT}
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirmPassword">Confirm password</Label>
        <Input
          id="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
      </div>
      {error ? (
        <Alert variant="destructive" role="alert" aria-live="assertive">
          {error}
        </Alert>
      ) : null}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Saving…" : mode === "invite" ? "Set password & continue" : "Reset password & continue"}
      </Button>
    </form>
  );
}
