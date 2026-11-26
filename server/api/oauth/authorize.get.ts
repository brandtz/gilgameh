import { defineEventHandler, getQuery, sendRedirect } from 'h3'

/**
 * Redirects OAuth 2.1 authorization requests to the Nuxt consent screen (/oauth/consent)
 * preserving all PKCE and scope parameters.
 */
export default defineEventHandler((event) => {
  const query = getQuery(event)
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) params.set(k, String(v))
  }
  return sendRedirect(event, `/oauth/consent?${params.toString()}`, 302)
})
