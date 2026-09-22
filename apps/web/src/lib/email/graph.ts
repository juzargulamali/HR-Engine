import "server-only";

/**
 * Sends mail through Microsoft Graph, authenticated as the app registration
 * itself (client-credentials flow) rather than as any one signed-in user —
 * so it can send "as" any mailbox in the tenant via /users/{email}/sendMail,
 * which is what lets a leave notification legitimately come from the
 * employee's or approver's own mailbox instead of one shared service
 * account. Requires the Graph app registration to hold the *Application*
 * permission Mail.Send with admin consent granted (see docs/ or ask HR
 * Admin) — MICROSOFT_TENANT_ID/CLIENT_ID/CLIENT_SECRET must be set, or every
 * call here throws and the caller (lib/email/leave-notifications.ts) treats
 * that as "email isn't configured yet" and no-ops.
 */

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.value;
  }

  const tenantId = process.env.MICROSOFT_TENANT_ID;
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error("Microsoft 365 email is not configured (MICROSOFT_TENANT_ID / MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET).");
  }

  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) {
    throw new Error(`Failed to get a Microsoft Graph access token (${res.status}): ${await res.text()}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

export async function sendMailAsUser(opts: { fromEmail: string; to: string[]; subject: string; html: string }): Promise<void> {
  if (opts.to.length === 0) return;

  const token = await getAccessToken();
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(opts.fromEmail)}/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        subject: opts.subject,
        body: { contentType: "HTML", content: opts.html },
        toRecipients: opts.to.map((address) => ({ emailAddress: { address } })),
      },
      saveToSentItems: true,
    }),
  });
  if (!res.ok) {
    throw new Error(`Microsoft Graph sendMail failed (${res.status}) sending as ${opts.fromEmail}: ${await res.text()}`);
  }
}
