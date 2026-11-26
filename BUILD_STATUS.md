# Build Status — Back Office Platform

| Area | Status | Notes |
| --- | --- | --- |
| Project scaffold, Vercel/Netlify & CI | Done | Nuxt 3, TypeScript, Drizzle, Tailwind, Vitest, GitHub Actions |
| Architecture & Auth/Scope Docs | Done | `docs/ARCHITECTURE.md`, `docs/AUTH_AND_SCOPES.md`, `docs/mcp-tools.md`, `docs/intake-package.md` |
| PostgreSQL Schema & Studio 37 Seed | Done | Full domain model (31 tables including `quote_email_sends`, `chatwoot_contacts`, `chatwoot_conversations`) + `server/db/seed.ts` |
| Auth, OAuth 2.1 PKCE, API Keys, Middleware | Done | JOSE JWT, scrypt, multi-tenant RBAC, single-sourced MCP OAuth scopes, `/.well-known/oauth-protected-resource/api/mcp`, 403 `insufficient_scope`, idempotency, rate limit, structured redacting logger |
| Domain Services + PDF Engine | Done | All domains, multi-page branded Quote/Invoice PDFs with saved business logo piping (`pdf-lib`), and Resend quote email copy (`email_quote_copy` + auto-copy on approve) |
| REST API `/api/v1/*` + OpenAPI 3.1 | Done | Versioned contracts, inbound/outbound HMAC webhooks, QBO one-way sync, `/api/v1/quotes/:id/email-copy`, `/api/v1/tenant/logo/:id` |
| MCP Server (`/api/mcp`) | Done | Streamable HTTP, 19 tools (`email_quote_copy` + Phase 1 & full-platform), `getting-started` resource |
| Admin & Operator UI | Done | Full Nuxt 3 + Tailwind dashboard (16 pages: `/select-business`, `/customers`, `/chatwoot`, `/catalog`, `/quotes`, `/orders`, `/invoices`, `/inventory`, `/expenses`, `/integrations`, `/team`, `/settings`, `/profile`, `/audit`, `/login`, `/oauth/consent`) |
| Integration & Acceptance Tests | Done | `nuxt typecheck`, `vitest run` (11/11 tests across `platform.test.ts` and `quote-email-and-mcp-scopes.test.ts`), and `nuxt build` all passing |

## Act 2 / Act 3 Challenge Review & Arbitration (NN — Quote Email Copy + MCP OAuth Scopes)

- **Architect**: Email dispatch executes strictly after DB approval commit inside a failure-isolated `try/catch`; MCP scopes are single-sourced in `server/utils/mcp-scopes.ts`; `renderDocumentCopyEmail` is reusable for future invoice copy emails. **Decision: Approved.**
- **Security**: Recipient is strictly locked to the authenticated user's DB email (`users.email`) with `.strict()` input schema rejecting `to`/`cc`/`bcc`; tenant isolation returns `404` on cross-tenant quote IDs; HTML escaping and CR/LF subject stripping close XSS and header-injection vectors; admin scopes excluded from OAuth; rate limit (3/hr/quote/user) persisted in PostgreSQL; no email bodies, PDF bytes, or secrets logged; no customer interaction recorded. **Decision: Approved (note: `business_summary` flagged in `docs/mcp-tools.md` as no-scope aggregate KPI read).**
- **QA**: All 12 acceptance criteria verified + edge cases (zero tax, 55-line multi-page PDF, long notes, Unicode names, missing PDF regeneration, saved logo piping into existing & new quotes). **Decision: Approved.**
- **UX**: Responsive 600px mobile-friendly HTML table layout + plain-text alternative; scannable subject (`Quote Q-xxxx — Customer — $Total`); natural voice readback summaries on `approve_quote` and `email_quote_copy`. **Decision: Approved — Ready to Merge & Deploy.**

## Backlog (Planned — Not Built Yet)

- `update_customer`, and contacts under organization customers (today a record has one name; a business's contact person ends up in notes)
- `list_interactions`, to read a customer's history back
- `list_customers_waiting` (`business_summary` counts them, but no tool lists them)
- An attachment/receipt upload tool (`create_draft_expense` requires `receiptAttachmentId` from agents, so the agent expense flow is currently blocked without an upload tool)
- Create tools for invoices (from an approved quote), orders, and production work items
- `get_invoice`, `list_inventory` / low-stock lookup
- A draft-quote PDF with a `DRAFT` watermark, for review before approval
- `send_quote_to_customer`: requires a new `quotes:send` scope, an explicit confirmation design, and customer interaction logging
