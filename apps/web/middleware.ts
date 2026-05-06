import { NextResponse, type NextRequest } from "next/server";

const AUTH_COOKIE_NAME = "meeting_ai_session";
const DEFAULT_API_BASE_URL = "http://localhost:4000";

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/render/") && request.nextUrl.searchParams.has("renderToken")) {
    return NextResponse.next();
  }

  const auth = await readAuthState(request);
  if (auth?.authEnabled === false) {
    return NextResponse.next();
  }
  if (auth?.authenticated) {
    return NextResponse.next();
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  loginUrl.searchParams.set("redirect", `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

async function readAuthState(request: NextRequest): Promise<{ authenticated: boolean; authEnabled: boolean } | null> {
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || DEFAULT_API_BASE_URL;
  try {
    const response = await fetch(`${apiBaseUrl}/api/auth/me`, {
      cache: "no-store",
      headers: {
        cookie: request.headers.get("cookie") ?? ""
      }
    });
    const payload = await response.json() as { data?: { authenticated?: boolean; authEnabled?: boolean } };
    if (typeof payload.data?.authEnabled !== "boolean") {
      return null;
    }
    return {
      authenticated: Boolean(payload.data.authenticated),
      authEnabled: payload.data.authEnabled
    };
  } catch {
    return null;
  }
}

function isPublicPath(pathname: string) {
  return (
    pathname === "/login" ||
    pathname.startsWith("/login/") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/audio-worklet/") ||
    pathname === "/favicon.ico"
  );
}

export const config = {
  matcher: ["/((?!api).*)"]
};
