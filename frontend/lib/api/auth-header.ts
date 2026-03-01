import { getSession } from 'next-auth/react'

export async function authHeaders(): Promise<Record<string, string>> {
  const session = await getSession()
  const token = (session as any)?.backendToken
  return token ? { Authorization: `Bearer ${token}` } : {}
}
