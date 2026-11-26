# Back Office Platform

A multi-tenant, API-first operational back-office platform built for managed small business operations. Designed to serve business owners via authenticated AI agents (MCP over Streamable HTTP + OAuth 2.1), external storefronts/webhooks, and a role-based Nuxt 3 web workspace.

## Core Architecture & Principles

- **API-First**: Every operational capability lives in `server/services/*` and is exposed through versioned REST endpoints under `/api/v1/*` with an OpenAPI 3.1 contract at `/api/v1/openapi.json`. The Nuxt 3 UI and the MCP server are thin clients of the same service layer.
- **Strict Multi-Tenant Isolation**: Every tenant-scoped table carries `tenant_id`. Tenant context is resolved exclusively from verified auth credentials (Session JWT + `tenant_memberships`, OAuth 2.1 token, or scoped API key) — never from request bodies. Business branding, logos, PDF templates, Chatwoot accounts, webhooks, and customers are strictly isolated per tenant.
- **Role-Based Access Control (RBAC)**:
  - **BWE Operators** (`bwe_operator`) can access and manage multiple client businesses via a dedicated Business Selector landing page (`/select-business`) and header switcher.
  - **Tenant Users** (`owner`, `manager`, `staff`, `viewer`, plus optional per-member custom scope overrides) only ever see businesses they hold an active membership for. Single-business owners bypass the business selector and never see a tenant switcher.
- **Server as Referee**: All monetary amounts use integer cents (`unitPriceCents`, `subtotalCents`, `taxCents`, `totalCents`) and are computed strictly on the server. Client-supplied discrepancies are rejected with `422 MATH_MISMATCH`.
- **Draft-Then-Confirm & Optimistic Concurrency**: Quotes, invoices, expenses, and inventory adjustments require explicit version-pinned approval (`409 VERSION_CONFLICT` on stale versions). Sent quotes are immutable; changes create sequential revisions (`Q-1001-R2`).
- **Auditability & Prompt Safety**: Every write executes inside a PostgreSQL transaction alongside an immutable `audit_logs` record attributed to the actor (operator, user, agent token, or integration). Raw inbound customer messages are flagged and withheld from AI agent tool responses.

## Tech Stack

- **Framework**: Nuxt 3 + Vue 3 + TypeScript + Tailwind CSS
- **Database**: PostgreSQL (Neon for staging/production; embedded `@electric-sql/pglite` for zero-config local dev & Vitest) + Drizzle ORM
- **Auth & Security**: JOSE HS256 JWTs (`HttpOnly` cookie / Bearer), `scrypt` password hashing, OAuth 2.1 + PKCE (`S256`), scoped API keys, HMAC-SHA256 webhooks, `Idempotency-Key` support, sliding-window rate limiting, redacting structured JSON logs
- **Documents & Storage**: Branded Quote & Invoice PDFs (`pdf-lib` with per-tenant uploaded PNG/JPEG logo, business contact details, header/footer, and payment instructions), Cloudflare R2 (S3-compatible) or local storage
- **Email**: Resend transactional API (or console logger in dev)
- **AI Agent Connector**: Official `@modelcontextprotocol/sdk` Streamable HTTP MCP server at `/api/mcp`

## Feature Modules

| Module | Route | Capabilities |
| --- | --- | --- |
| Business Selector | `/select-business` | Multi-tenant workspace switcher & operator business onboarding (hidden for single-tenant users) |
| Dashboard | `/` | Real-time operational KPIs, open quotes, unpaid balances, production queue, and recent audit activity |
| Customers & History | `/customers` | Searchable directory, inline edit, full customer detail view with interactions, quotes, orders, invoices, and payments |
| Chatwoot Inbox | `/chatwoot` | Tenant-isolated Chatwoot contacts & inbox conversations, live sync, replies, and 1-click CRM customer linking |
| Catalog & Schemas | `/catalog` | Products & services, tenant-defined JSONB attribute schemas, verification workflow for agent-created items |
| Quotes & PDFs | `/quotes` | Catalog-backed or free-form quote builder, catalog default update prompt, revisions, and branded PDFs |
| Orders & Production | `/orders` | Multi-channel orders, automatic inventory deduction, and prioritized shop-floor work queue |
| Invoices & Payments | `/invoices` | Standalone or order-linked draft invoice builder, branded PDFs, and partial/full payment recording |
| Inventory Ledger | `/inventory` | Stock levels, reorder alerts, and append-only draft-then-confirm stock movements |
| Expenses | `/expenses` | Receipt-required agent expenses, duplicate fingerprint detection, and approval workflow |
| Webhooks & Integrations | `/integrations` | Signed outbound webhooks, inbound connectors (Website, Chatwoot, Stripe), and QuickBooks one-way sync |
| Team & Permissions | `/team` | Tenant user onboarding, RBAC roles (`owner`, `manager`, `staff`, `viewer`), and granular scope overrides |
| Business, PDF & Security | `/settings` | Business profile/contact info, PDF logo & payment instructions ("Make checks payable to..."), API keys, and OAuth tokens |
| My Profile | `/profile` | Personal name, email, phone, title, and self-service password rotation |
| Audit Log | `/audit` | Immutable, actor-attributed audit trail |

## Local Development

### Prerequisites

- Node.js 22+
- pnpm 9+
- PostgreSQL (optional for local dev — if `DATABASE_URL` is omitted in development, embedded PGlite is used automatically)

### Setup

```bash
pnpm install
cp .env.example .env
# Edit .env with your local DATABASE_URL and a strong JWT_SECRET
pnpm run db:migrate
pnpm run dev
```

For local development seeding (creates sample tenant data in your dev database only — never expose default passwords in production):

```bash
pnpm run db:seed
```

### Verification & Testing

```bash
pnpm run typecheck
pnpm run test
pnpm run build
```

## Production Environment Variables

Configure these variables in Netlify or Vercel (never commit `.env` or secrets to git):

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | **Yes** | PostgreSQL / Neon connection string (`sslmode=verify-full`) |
| `JWT_SECRET` | **Yes** | Cryptographically random secret (at least 32 bytes) |
| `APP_BASE_URL` | **Yes** | Public deployment origin (e.g. `https://your-app.netlify.app`) |
| `EMAIL_PROVIDER` | Recommended | `resend` in production (`console` for local dev) |
| `RESEND_API_KEY` | If `resend` | Domain-scoped Resend sending API key |
| `EMAIL_FROM` | If `resend` | Verified sender address (e.g. `Business <noreply@yourdomain.com>`) |
| `STORAGE_DRIVER` | Recommended | `r2` for persistent attachments (`local` uses ephemeral storage on serverless) |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` | If `r2` | Cloudflare R2 bucket credentials |
| `LOCAL_STORAGE_DIR` | Optional | Writable temp path when `STORAGE_DRIVER=local` (e.g. `/tmp/backoffice-uploads`) |

## Key Endpoints

- **OpenAPI 3.1 Spec**: `GET /api/v1/openapi.json`
- **Health Check**: `GET /api/v1/health`
- **MCP Streamable HTTP**: `POST /api/mcp`
- **OAuth 2.1 Discovery**: `GET /.well-known/oauth-authorization-server` and `GET /.well-known/oauth-protected-resource`
- **Inbound Signed Webhooks**:
  - `POST /api/webhooks/website`
  - `POST /api/webhooks/chatwoot`
  - `POST /api/webhooks/stripe`

## Documentation

- [Architecture & Data Model ERD](./docs/ARCHITECTURE.md)
- [Authentication, RBAC & OAuth 2.1 Scope Model](./docs/AUTH_AND_SCOPES.md)
- [Build Status](./BUILD_STATUS.md)
