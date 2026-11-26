const REDACTED_KEYS = new Set([
  'password',
  'passwordhash',
  'secret',
  'clientsecret',
  'token',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'cookie',
  'apikey',
  'webhooksecret',
  'email',
  'phone',
  'address',
  'rawcontent'
])

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[TRUNCATED]'
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitize(v, depth + 1))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (REDACTED_KEYS.has(k.toLowerCase())) {
        out[k] = '[REDACTED]'
      } else {
        out[k] = sanitize(v, depth + 1)
      }
    }
    return out
  }
  return value
}

function writeLog(level: 'debug' | 'info' | 'warn' | 'error', msg: string, fields?: Record<string, unknown>) {
  if (process.env.VITEST === 'true' && level === 'debug') return
  const payload = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(fields ? (sanitize(fields) as Record<string, unknown>) : {})
  }
  const line = JSON.stringify(payload)
  if (level === 'error') {
    console.error(line)
  } else if (level === 'warn') {
    console.warn(line)
  } else if (process.env.VITEST !== 'true') {
    console.log(line)
  }
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => writeLog('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => writeLog('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => writeLog('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => writeLog('error', msg, fields)
}
