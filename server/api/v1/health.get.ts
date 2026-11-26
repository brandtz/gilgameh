import { defineEventHandler } from 'h3'
import { getDb } from '../../db'

export default defineEventHandler(async () => {
  await getDb()
  return {
    status: 'ok',
    service: 'back-office-platform',
    timestamp: new Date().toISOString()
  }
})
