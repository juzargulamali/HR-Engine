import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// /set-password and /reset-password must stay public: they're where an
// invite/recovery email lands before the recipient has any session cookie
// at all — the token arrives as a URL hash fragment, which never reaches
// this server-side check, only the browser JS running on that page (see
// components/auth/password-reset-form.tsx). /forgot-password is the request
// form that sends that email in the first place, so it's public for the
// same reason /login is.
//
// /api/cron/crm-reminders is called by the scheduler with no session cookie, so the sign-in redirect would swallow it.
// It authenticates itself with CRON_SECRET (lib/cron/auth.ts) and returns 401 without it. Only this one route is
// listed; the older /api/cron/* routes are deliberately left exactly as they were.
const PUBLIC_PATHS = ["/login", "/set-password", "/forgot-password", "/reset-password", "/api/cron/crm-reminders"];

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

  if (!user && !isPublicPath) {
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
  // `os-preview` is the design-only ENGINIOUS OS preview: static sample data, no session, no database.
  // It is hidden in Production by its own layout gate (app/os-preview/_lib/gate.ts).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|os-preview(?:/|$)|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
