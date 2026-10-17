import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isScheduledRoutePath, scheduledRoutesAllowedWithoutSession } from "@/lib/cron/scheduled-routes";

// /set-password and /reset-password must stay public: they're where an
// invite/recovery email lands before the recipient has any session cookie
// at all — the token arrives as a URL hash fragment, which never reaches
// this server-side check, only the browser JS running on that page (see
// components/auth/password-reset-form.tsx). /forgot-password is the request
// form that sends that email in the first place, so it's public for the
// same reason /login is.
const PUBLIC_PATHS = ["/login", "/set-password", "/forgot-password", "/reset-password"];

// Scheduled (Vercel Cron) routes carry no session cookie, so without an
// exemption this proxy answers them 307 -> /login before their own CRON_SECRET
// check runs. The exemption is OFF unless ALLOW_SCHEDULED_ROUTES_WITHOUT_SESSION
// is exactly "on", and then covers only the exact paths in
// SCHEDULED_ROUTE_PATHS. See docs/scheduled-routes-diagnosis.md before enabling.

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Required even though we don't use the value directly — this call is
  // what actually refreshes an expiring session and rewrites the cookie.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublicPath = PUBLIC_PATHS.some((path) => request.nextUrl.pathname.startsWith(path));

  const isExemptScheduledRoute = scheduledRoutesAllowedWithoutSession() && isScheduledRoutePath(request.nextUrl.pathname);

  if (!user && !isPublicPath && !isExemptScheduledRoute) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (user && request.nextUrl.pathname === "/login") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
