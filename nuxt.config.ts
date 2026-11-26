export default defineNuxtConfig({
  compatibilityDate: '2025-03-01',
  devtools: { enabled: false },
  modules: ['@nuxtjs/tailwindcss'],
  typescript: {
    strict: true,
    typeCheck: false
  },
  runtimeConfig: {
    databaseUrl: process.env.DATABASE_URL || '',
    jwtSecret: process.env.JWT_SECRET || 'dev-insecure-jwt-secret-change-in-production-32bytes',
    jwtIssuer: process.env.JWT_ISSUER || 'back-office-platform',
    appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:3000',
    r2AccountId: process.env.R2_ACCOUNT_ID || '',
    r2AccessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    r2BucketName: process.env.R2_BUCKET_NAME || '',
    r2PublicUrl: process.env.R2_PUBLIC_URL || '',
    storageDriver: process.env.STORAGE_DRIVER || 'local',
    localStorageDir: process.env.LOCAL_STORAGE_DIR || '.data/uploads',
    emailProvider: process.env.EMAIL_PROVIDER || 'console',
    resendApiKey: process.env.RESEND_API_KEY || '',
    emailFrom: process.env.EMAIL_FROM || 'Back Office <noreply@backoffice.local>',
    rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
    rateLimitMaxRequests: Number(process.env.RATE_LIMIT_MAX_REQUESTS || 120),
    public: {
      appName: process.env.NUXT_PUBLIC_APP_NAME || 'Back Office',
      appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:3000'
    }
  },
  nitro: {
    experimental: {
      asyncContext: true
    },
    routeRules: {
      '/api/**': {
        cors: true,
        headers: {
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
          'Referrer-Policy': 'strict-origin-when-cross-origin'
        }
      },
      '/.well-known/**': {
        cors: true
      }
    }
  },
  app: {
    head: {
      title: 'Back Office Platform',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'description', content: 'Multi-tenant, API-first small business back-office platform' }
      ]
    }
  }
})
