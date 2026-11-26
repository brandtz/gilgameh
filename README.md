# Back Office Platform

A multi-tenant, API-first back-office operations platform for small businesses. Built with Nuxt 3, TypeScript, Drizzle ORM (PostgreSQL / Neon), Tailwind CSS, JOSE JWTs, OAuth 2.1 + PKCE, and an official MCP Streamable HTTP server.

## Quick Start

```bash
pnpm install
cp .env.example .env
# Optional: configure DATABASE_URL (if omitted, runs on embedded PostgreSQL via PGlite)
pnpm run db:seed
pnpm run dev
```

### Default Seeded Accounts (Studio 37 — Woodworking Design Partner)

| Role | Email | Password |
| --- | --- | --- |
| BWE Operator | `matthew@bwe.local` | `BweOperator!2026` |
| Studio 37 Owner | `drew@studio37.local` | `Studio37Owner!2026` |
| Studio 37 Staff | `staff@studio37.local` | `Studio37Staff!2026` |

## Key Endpoints

- **Admin UI**: `http://localhost:3000`
- **REST API v1**: `http://localhost:3000/api/v1/*`
- **OpenAPI 3.1 Spec**: `http://localhost:3000/api/v1/openapi.json`
- **MCP Streamable HTTP**: `http://localhost:3000/api/mcp`
- **OAuth 2.1 Metadata**: `http://localhost:3000/.well-known/oauth-authorization-server`

## Testing & Verification

```bash
pnpm run typecheck
pnpm run test
pnpm run build
```

## Deployment (Vercel / Netlify)

- **Vercel**: Connect the GitHub repository; `vercel.json` is preconfigured. Set `DATABASE_URL` (Neon), `JWT_SECRET`, `APP_BASE_URL`, and optional R2 / Resend variables.
- **Netlify**: Connect the GitHub repository; `netlify.toml` sets `NITRO_PRESET=netlify` and Node 22.
