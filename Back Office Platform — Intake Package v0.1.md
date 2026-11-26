# Back Office Platform — Intake Package v0.1

*Intended as `docs/intake-package.md` for the BWE boilerplate. Master Agent: read this first; ask only about items listed under Open Decisions or gaps not covered here. Product name TBD (working name: "Back Office").*

## 1. Product summary

A multi-tenant, API-first back-office platform for small businesses that sell products and/or services. It manages customers and leads, quotes, orders, invoices, payments, production/fulfilment, inventory, and expenses.

**Operating model:** BWE (Matthew and Mindy) acts as a managed back office for client businesses. Business owners rarely log in. They interact through (a) their own AI agent (Claude, ChatGPT) via an authenticated MCP connector, mostly by voice, (b) existing channels (Messenger, Instagram, SMS, web forms), or (c) by sending material to BWE operators, who enter it.

**Design partner / first tenant:** Studio 37 (woodworking). It mixes bulk B2B orders with POs (e.g. 50–100 coasters for Made in Oregon), custom work (slab flattening, cabinets, countertops), and walk-in retail.

This is a **clean build**. It does not share code, schema, or platform layer with Bulwark.

## 2. Core principles (non-negotiable)

1. **API first.** Every capability is a service-layer operation exposed through a versioned API. The admin UI, external websites, and the MCP server are all clients of the same API. No feature exists only in the UI.
2. **Built for external exposure from day one.** Every endpoint assumes it will eventually be called by an authenticated third party (MCP agent, tenant website). This means scoped auth, input validation, idempotency, rate limits, and stable contracts on every route.
3. **Agents are the input layer; the server is the referee.** We do not build OCR, voice transcription, or NLP. Agents interpret; the server validates strictly and never trusts agent-supplied totals, IDs, or prices without checks.
4. **Draft then confirm** for anything touching money or inventory: quotes, invoices, expenses, stock adjustments. Approval is a separate explicit call tied to the exact draft version.
5. **Tenant-configurable, not industry-specific.** No trade-specific tables. Tenants define their own products, services, attributes, and workflows through configuration.
6. **Ops system, not the accounting system.** This app owns operations. External accounting (QuickBooks, etc.) stays the books of record; sync is one-way push of finalized transactions.
7. **Auditability.** Every write is attributed to an actor (user, agent token, integration, system) and logged immutably. Soft deletes only.

## 3. Proposed tech stack (CONFIRM before scaffolding)

Matthew's usual defaults, proposed but not yet locked for this product: Nuxt 3 + TypeScript, Drizzle ORM, PostgreSQL (local native for dev, Neon for staging/prod), JOSE for JWTs, Cloudflare R2 for files (receipts, PDFs), Vercel hosting, pnpm, Zod validation, no Docker. MCP server in TypeScript using the official MCP SDK, Streamable HTTP transport, OAuth 2.1.

Conventions carried over: integer cents for money, UUIDs, soft deletes, multi-table writes in transactions, typed error taxonomy, route → service → ORM layering, structured JSON logs with no PII or secrets.

## 4. Tenancy and identity

- Shared database, `tenant_id` on every tenant-scoped table; tenant resolved from auth context only, never from request bodies.
- **Actors:**
  - BWE operators: platform-level, can act across tenants they manage (every action audited with the operator and tenant).
  - Tenant users: owner, staff.
  - Agent clients: OAuth tokens issued to a user's AI agent, with narrow scopes, revocable from the admin panel.
  - Integration clients: API keys or signed webhooks for tenant websites and Chatwoot.
- **Scopes (initial):** `customers:read/write`, `catalog:read/write`, `quotes:read/draft/approve`, `orders:read/write`, `invoices:read/draft/approve`, `production:read/write`, `expenses:read/draft/approve`, `inventory:read/adjust`. Agent tokens default to read plus draft; approve scopes are opt-in per tenant.

## 5. Domain model (first pass)

- **Tenant**: business profile, branding (logo, colors), numbering settings, tax settings.
- **Customer**: person or organization; contact methods; lead source and UTM attribution; status (lead, active, inactive); `waiting_on_owner` flag; external IDs (Chatwoot contact, website user).
- **Interaction**: logged touchpoint (call, walk-in, message, form), linked to customer.
- **CatalogItem**: type `product` or `service`; SKU; unit; base price (cents); tenant-defined attributes (JSONB, validated by tenant-defined schemas: dimensions, finish, species); `track_inventory` flag; `verified` flag (false when created by an agent).
- **Quote**: tenant-sequential number (e.g. Q-1042), immutable once sent; revisions (Q-1042-R2); customer; optional customer PO number; line items; status (draft, sent, accepted, declined, expired); valid-until; PDF.
- **Order**: created from an accepted quote or an external channel (website, POS); links to quote; channel source; status.
- **Invoice**: sequential number; links to order and quote; payments; status (draft, sent, partially paid, paid, overdue, void).
- **Payment**: method (check, cash, card, Stripe, other); amount; reference; date.
- **WorkItem** (production queue): derived from order lines; quantity; due date; priority rank; state (queued, in progress, ready, shipped or picked up).
- **InventoryItem / StockMovement**: movements are append-only (receipt, sale, adjustment, production use).
- **Expense**: vendor, date, line items, totals, category, attachment (original receipt image required when agent-created), duplicate-detection fingerprint.
- **Attachment**: file in object storage, linked to any record.
- **AuditLog**: actor type and ID, tenant, action, entity, before/after, timestamp. Immutable.

## 6. API design rules

- Versioned REST under `/api/v1`; one OpenAPI spec generated from Zod schemas is the contract for the UI, websites, and MCP.
- **Idempotency keys** required on all create calls from external clients (agents retry; websites resend webhooks).
- **Optimistic concurrency** via a version field; approve calls must include the draft version they approve.
- **Server-side math only**: line totals, tax, and totals are computed by the server; client-supplied totals are checked and rejected if they don't match.
- Pagination, filtering, and consistent error envelopes on every list endpoint.
- **Outbound webhooks** (signed, retried) for tenant websites and integrations: `order.created`, `order.status_changed`, `quote.accepted`, `invoice.paid`.
- **Inbound webhooks** (signature-verified, idempotent): website leads and orders, Chatwoot conversation events, Stripe events.

## 7. MCP server

A thin adapter over the public API: no business logic of its own.

**Phase 1 tools:** `find_customer`, `create_customer`, `log_interaction`, `search_catalog`, `create_catalog_item` (unverified), `create_draft_quote`, `update_draft_quote`, `get_quote` (returns summary plus PDF link), `approve_quote`, `list_open_quotes`.

**Later tools:** `list_production_queue`, `update_work_item`, `list_unpaid_invoices`, `record_payment`, `create_draft_expense` (receipt image required), `approve_expense`, `adjust_inventory`, plus business Q&A reads.

Rules:

- Usage guidance lives in tool descriptions and a `getting-started` resource, not in user prompts.
- Ambiguous matches (two customers named Wade) return candidates; tools never guess.
- Every tool response is a structured summary the agent can read back to the owner.
- No tool exposes raw inbound customer messages until prompt-injection handling is designed.

## 8. Integrations (sequenced)

1. Tenant websites (e.g. Studio 37): inbound leads and orders, outbound status.
2. Stripe Connect (tenant-owned accounts) for card payments.
3. Email delivery for quotes and invoices.
4. Chatwoot Cloud: link contacts and conversations to customers; drive `waiting_on_owner`.
5. QuickBooks Online: one-way push of finalized invoices, payments, expenses.
6. Future: restaurant online ordering as another inbound order channel.

## 9. Proof-of-concept scope (Phase 1)

Goal: Drew dictates a quote to his AI agent and receives a correctly numbered, branded draft quote to approve.

In scope: tenant and user setup, auth, catalog with tenant attributes, customers and interactions, quotes with numbering, revisions, and PDF, audit log, minimal admin UI for operators, the MCP server with Phase 1 tools and OAuth.

Out of scope for the PoC: invoices, payments, production queue, inventory, expenses, Chatwoot, QuickBooks.

**Acceptance test:** "New customer Wade, 12 pieces 5x8x24, finish X, draft a quote" leads to a customer created or matched, items matched or flagged unverified, draft Q-number returned with correct server-computed totals, approval by explicit call, PDF available, and all actions in the audit log attributed to the agent token.

## 10. Open decisions (ask Matthew)

1. Confirm the tech stack in section 3.
2. Product name and repo name.
3. Tax handling for the PoC (single tenant rate vs. per-line).
4. Whether agent tokens may hold approve scopes, or approval always requires a tap in a web link.
5. Quote PDF template and branding requirements from Drew.
6. Does Drew's Facebook Marketplace activity run through the Studio 37 Page? (affects inbox phase)

## 11. First tasks for the planning stage

1. Produce ARCHITECTURE.md and a data model ERD from section 5.
2. Draft the OpenAPI contract for Phase 1 resources.
3. Define the auth and scope model, including the OAuth flow for MCP clients.
4. Write the phase plan and numbered prompt files for the PoC.
5. Set up BUILD\_STATUS.md.
