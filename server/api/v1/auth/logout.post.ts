import { defineEventHandler, deleteCookie } from 'h3'

export default defineEventHandler((event) => {
  deleteCookie(event, 'bo_session', { path: '/' })
  return { data: { loggedOut: true } }
})
