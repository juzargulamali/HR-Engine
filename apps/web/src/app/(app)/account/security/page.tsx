import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChangePasswordForm } from "./change-password-form";
import { SessionControls } from "./session-controls";

export default async function AccountSecurityPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const lastSignIn = user.last_sign_in_at
    ? new Date(user.last_sign_in_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : "Unknown";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Account &amp; security</h1>
        <p className="text-muted-foreground">Manage your sign-in email, password, and active sessions.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Sign-in identity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p>
            Signed in as <span className="font-medium text-foreground">{user.email}</span>
          </p>
          <p className="text-muted-foreground">Last sign-in: {lastSignIn}</p>
          <p className="text-xs text-muted-foreground">
            Your sign-in email is managed by a System Administrator and can&apos;t be changed here yet.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Change password</CardTitle>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sessions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Sign out of just this device, or every device you&apos;re currently signed in on.
          </p>
          <SessionControls />
        </CardContent>
      </Card>
    </div>
  );
}
