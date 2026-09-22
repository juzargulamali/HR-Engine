"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";

type Status = "checking" | "ready" | "invalid";

/**
 * Supabase's invite email (its default template — editing templates
 * requires custom SMTP, which this project doesn't have configured) links
 * to Supabase's own /verify endpoint, which redirects back here with a
 * ready-made session as access_token/refresh_token in the URL hash
 * ("implicit grant" delivery). @supabase/ssr's browser client hardcodes
 * flowType: "pkce", so its own automatic hash-detection
 * (detectSessionInUrl, run once at client construction) explicitly refuses
 * that shape of URL — "Not a valid PKCE flow url" — and never establishes
 * a session from it. setSession() has no such gate (it just validates the
 * token pair directly), so this parses the hash itself and calls that
 * instead of relying on automatic detection.
 */
export function SetPasswordForm() {
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

    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setPending(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setPending(false);
      setError(updateError.message);
      return;
    }

    // Full navigation, not router.push — proxy.ts's session check runs on
    // the server and only sees cookies once a real request lands there;
    // a client-side route change wouldn't force that round trip.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/";
  }

  if (status === "checking") {
    return <p className="text-sm text-muted-foreground">Verifying your invite link…</p>;
  }

  if (status === "invalid") {
    return (
      <Alert variant="destructive">
        This link is invalid or has expired. Ask HR to send you a new invite from Admin → Users.
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
          minLength={8}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirmPassword">Confirm password</Label>
        <Input
          id="confirmPassword"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
      </div>
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Saving…" : "Set password & continue"}
      </Button>
    </form>
  );
}
