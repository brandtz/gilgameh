# Back Office Platform — Architecture & Data Model

## 1. System Overview

**Back Office** is a multi-tenant, API-first operational platform for small businesses managed by BWE operators and accessed by business owners via AI agents (MCP over Streamable HTTP + OAuth 2.1), external websites/webhooks, and the Nuxt 3 operator/tenant web UI.

```mermaid
flowchart LR
  subgraph Clients
    UI[Nuxt 3 Admin UI]
    Agent[AI Agent / Claude / ChatGPT]
    Web[Tenant Website / Storefront]
    Ext[Chatwoot / Stripe]
  end

  subgraph Edge["Nitro / Nuxt 3 Server (Vercel / Netlify)"]
    OAuth[OAuth 2.1 + PKCE Server]
    MCP[MCP Streamable HTTP /api/mcp]
    REST[Versioned REST API /api/v1/*]
    WHIn[Inbound Webhooks /api/webhooks/*]
    Services[Domain Service Layer]
    PDF[PDF Engine pdf-lib]
    WHOut[Outbound HMAC Webhooks]
    Sync[Accounting / Email Adapters]
  end

  subgraph Data
    PG[(PostgreSQL / Neon)]
    R2[(Cloudflare R2 / Local Files)]
  end

  UI --> REST
  Agent --> OAuth
  Agent --> MCP
  MCP --> Services
  Web --> REST
  Web --> WHIn
  Ext --> WHIn
  REST --> Services
  WHIn --> Services
  Services --> PG
  Services --> R2
  Services --> PDF
  Services --> WHOut
  Services --> Sync
```

## 2. Core Architectural Rules

1. **API-First**: Every capability lives in `server/services/*` and is exposed under `/api/v1/*` with a generated OpenAPI 3.1 contract at `/api/v1/openapi.json`. The Nuxt UI and the MCP server are thin clients of the same service/API layer.
2. **Strict Tenant Isolation**: Every tenant-scoped table carries `tenant_id`. Tenant context is resolved exclusively from authenticated credentials (JWT, OAuth token, API key, or operator `X-Tenant-Id` header verified against `tenant_memberships`) — never from request payloads.
3. **Server as Referee**: All monetary calculations use integer cents and are computed exclusively on the server. Client-supplied totals are validated and rejected with `422` if they do not match.
4. **Draft-Then-Confirm**: Quotes, Invoices, Expenses, and Inventory Stock Adjustments follow a draft → approve lifecycle. Approval calls require an explicit `version` matching the current record (optimistic concurrency, `409` on mismatch).
5. **Idempotency & Rate Limiting**: External write endpoints support `Idempotency-Key` (replaying identical requests and rejecting payload mismatches with `409`). Sliding-window rate limiting guards all API routes.
6. **Immutable Auditability & Soft Deletes**: Every write executes inside a PostgreSQL transaction alongside an immutable `audit_logs` entry recording actor type, actor ID, action, entity, and before/after snapshots. Domain records use `deleted_at` soft deletes; `stock_movements` and `audit_logs` are append-only.
7. **Prompt-Injection Defense**: Raw inbound customer messages are flagged (`contains_external_input = true`) and withheld from MCP tool responses.

## 3. Entity Relationship Diagram

```mermaid
erDiagram
  TENANTS ||--o{ TENANT_MEMBERSHIPS : has
  USERS ||--o{ TENANT_MEMBERSHIPS : joins
  TENANTS ||--o{ CUSTOMERS : owns
  CUSTOMERS ||--o{ INTERACTIONS : logs
  TENANTS ||--o{ CATALOG_ATTRIBUTE_SCHEMAS : defines
  TENANTS ||--o{ CATALOG_ITEMS : offers
  CATALOG_ATTRIBUTE_SCHEMAS ||--o{ CATALOG_ITEMS : validates
  CUSTOMERS ||--o{ QUOTES : receives
  QUOTES ||--o{ QUOTE_LINES : contains
  QUOTES ||--o{ ORDERS : converts_to
  CUSTOMERS ||--o{ ORDERS : places
  ORDERS ||--o{ ORDER_LINES : contains
  ORDERS ||--o{ WORK_ITEMS : schedules
  ORDERS ||--o{ INVOICES : bills
  CUSTOMERS ||--o{ INVOICES : billed_to
  INVOICES ||--o{ INVOICE_LINES : contains
  INVOICES ||--o{ PAYMENTS : paid_by
  CATALOG_ITEMS ||--o| INVENTORY_ITEMS : tracks
  INVENTORY_ITEMS ||--o{ STOCK_MOVEMENTS : ledger
  TENANTS ||--o{ EXPENSES : records
  TENANTS ||--o{ ATTACHMENTS : stores
  TENANTS ||--o{ AUDIT_LOGS : audits
  TENANTS ||--o{ WEBHOOK_ENDPOINTS : subscribes
  WEBHOOK_ENDPOINTS ||--o{ WEBHOOK_DELIVERIES : delivers
  TENANTS ||--o{ OAUTH_TOKENS : authorizes
  TENANTS ||--o{ API_KEYS : issues
```

## 4. Layering Convention

- **Routes (`server/api/**`)**: Parse & validate request via Zod schemas (`server/schemas/*`), enforce auth + scopes (`requireAuth`), enforce idempotency (`withIdempotency`), call a single service method, return envelope `{ data, meta? }` or `{ error }`.
- **Services (`server/services/*`)**: Pure business logic, server-side math, optimistic concurrency checks, DB transactions (`db.transaction(...)`), audit logging, and webhook event emission.
- **Database (`server/db/*`)**: Drizzle ORM PostgreSQL schema, migrations, and connection manager (supports `pg` / Neon via `DATABASE_URL` and `@electric-sql/pglite` for zero-config tests and local dev).
- **MCP (`server/services/mcp.service.ts` & `server/api/mcp.ts`)**: Thin adapter over the service layer using `@modelcontextprotocol/sdk` Streamable HTTP transport and OAuth 2.1 Bearer tokens.
