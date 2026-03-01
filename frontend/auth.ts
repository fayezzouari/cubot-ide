import { NextAuthOptions } from "next-auth"
import GoogleProvider from "next-auth/providers/google"
import * as jose from "jose"

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
      // Regenerate a fresh short-lived HS256 token the backend can verify.
      // Runs server-side only; signing is ~1ms so always refreshing is fine.
      const secret = new TextEncoder().encode(process.env.NEXTAUTH_SECRET!)
      token.backendToken = await new jose.SignJWT({
        sub: token.sub,
        email: token.email,
        name: token.name,
      })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime("1d")
        .sign(secret)
      return token
    },
    async session({ session, token }) {
      ;(session as any).backendToken = token.backendToken
      return session
    },
  },
}
