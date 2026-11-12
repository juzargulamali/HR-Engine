"use client";

import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { emailLinkDestination, isUsedOrExpired, readEmailLink } from "@/lib/auth/email-link";

/**
 * On the sign-in page: an invite or password link that arrived here instead of on its own page is passed on to it, with its session
 * still in the address, so the person can set their password. A link that was already used or is too old is said to be so, with what to
 * do next. Renders nothing otherwise. The address is never logged or sent anywhere.
 */
export function EmailLinkForwarder() {
  const [used, setUsed] = useState(false);
  useEffect(() => {
    const destination = emailLinkDestination(window.location.hash);
    if (destination) { window.location.replace(`${destination}${window.location.hash}`); return; }
    const link = readEmailLink(window.location.hash, window.location.search);
    if (isUsedOrExpired(link)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the address is only readable in the browser, after the page has loaded
      setUsed(true);
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);
  if (!used) return null;
  return (
    <Alert variant="destructive" role="alert" data-testid="email-link-used">
      That link has already been used or has expired. A link works once. If you have set a password, sign in below; otherwise press Forgot password to get a new link.
    </Alert>
  );
}
