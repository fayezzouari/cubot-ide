import { withAuth } from "next-auth/middleware"
import { NextResponse } from "next/server"

const ADMIN_PREFIX = "/dashboard/admin"

// Server-side URL of the API. BACKEND_INTERNAL_URL skips the public proxy when set;
// otherwise a relative NEXT_PUBLIC_API_URL ("/api") is resolved against this site.
function apiBase(origin: string): string {
  const url = process.env.BACKEND_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api"
  return (url.startsWith("/") ? `${origin}${url}` : url).replace(/\/$/, "")
}

// The backend decides who is an admin (ADMIN_EMAILS); any failure counts as "not an admin".
async function isAdmin(backendToken: unknown, origin: string): Promise<boolean> {
  if (typeof backendToken !== "string") return false
  try {
    const res = await fetch(`${apiBase(origin)}/admin/access`, {
      headers: { Authorization: `Bearer ${backendToken}` },
      cache: "no-store",
    })
    return res.ok
  } catch {
    return false
  }
}

export default withAuth(async function middleware(req) {
  const { pathname, origin } = req.nextUrl
  if (pathname !== ADMIN_PREFIX && !pathname.startsWith(`${ADMIN_PREFIX}/`)) return NextResponse.next()

  if (await isAdmin(req.nextauth.token?.backendToken, origin)) return NextResponse.next()
  return NextResponse.redirect(new URL("/dashboard", req.url))
})

export const config = { matcher: ["/dashboard/:path*", "/learn"] }
