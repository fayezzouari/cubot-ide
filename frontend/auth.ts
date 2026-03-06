import { NextAuthOptions } from "next-auth"
import GoogleProvider from "next-auth/providers/google"
import { createHmac } from "crypto"

function makeBackendToken(payload: Record<string, unknown>, secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")
  const now = Math.floor(Date.now() / 1000)
  const body = Buffer.from(
    JSON.stringify({ ...payload, iat: now, exp: now + 86400 })
  ).toString("base64url")
  const sig = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url")
  return `${header}.${body}.${sig}`
}

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  pages: {
    signIn: '/',
  },
  callbacks: {
    async jwt({ token, account }) {
      token.backendToken = makeBackendToken(
        { sub: token.sub, email: token.email, name: token.name, picture: token.picture },
        process.env.NEXTAUTH_SECRET!
      )

      // On first sign-in (account is present), sync user with backend
      if (account) {
        try {
          const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api'
          await fetch(`${apiUrl}/users/sync`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token.backendToken}`,
            },
          })
        } catch {
          // Non-fatal — user sync will be retried on next sign-in
        }
      }

      return token
    },
    async session({ session, token }) {
      ;(session as any).backendToken = token.backendToken
      return session
    },
  },
}
