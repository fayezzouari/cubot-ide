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
    async jwt({ token }) {
      token.backendToken = makeBackendToken(
        { sub: token.sub, email: token.email, name: token.name },
        process.env.NEXTAUTH_SECRET!
      )
      return token
    },
    async session({ session, token }) {
      ;(session as any).backendToken = token.backendToken
      return session
    },
  },
}
