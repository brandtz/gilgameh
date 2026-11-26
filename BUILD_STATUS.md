# Build Status — Back Office Platform

| Area | Status | Notes |
| --- | --- | --- |
| Project scaffold, Vercel/Netlify & CI | Done | Nuxt 3, TypeScript, Drizzle, Tailwind, Vitest, GitHub Actions |
| Architecture & Auth/Scope Docs | Done | `docs/ARCHITECTURE.md`, `docs/AUTH_AND_SCOPES.md`, `docs/intake-package.md` |
| PostgreSQL Schema & Studio 37 Seed | Done | Full domain model (all 28 tables) + `server/db/seed.ts` |
| Auth, OAuth 2.1 PKCE, API Keys, Middleware | Done | JOSE JWT, scrypt, scopes, idempotency, rate limit, structured redacting logger |
| Domain Services + PDF Engine | Done | All domains + branded Quote/Invoice PDFs via `pdf-lib` |
| REST API `/api/v1/*` + OpenAPI 3.1 | Done | Versioned contracts, inbound/outbound HMAC webhooks, QBO one-way sync |
| MCP Server (`/api/mcp`) | Done | Streamable HTTP, all Phase 1 + full-platform tools, `getting-started` resource |
| Admin & Operator UI | Done | Full Nuxt 3 + Tailwind dashboard (12 pages + OAuth 2.1 consent screen) |
| Integration & Acceptance Tests | Done | `nuxt typecheck`, `vitest run` (3/3 suites), and `nuxt build` all passing |
