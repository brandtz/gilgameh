# MCP Server Tools, OAuth 2.1 Scopes & Approval Policy

Generated from the single-source-of-truth tool policy registry in [server/utils/mcp-scopes.ts](../server/utils/mcp-scopes.ts).

## OAuth 2.1 Discovery Endpoints

Both protected-resource endpoints return the exact same RFC 9728 metadata document derived from `MCP_SCOPES_SUPPORTED`:

- `GET /.well-known/oauth-protected-resource`
- `GET /.well-known/oauth-protected-resource/api/mcp`
- `GET /.well-known/oauth-authorization-server`

### Advertised `scopes_supported`

All MCP tool scopes (including approval/adjustment scopes) are advertised:
`customers:read`, `customers:write`, `catalog:read`, `catalog:write`, `quotes:read`, `quotes:draft`, `quotes:approve`, `orders:read`, `orders:write`, `production:read`, `production:write`, `invoices:read`, `invoices:draft`, `invoices:approve`, `inventory:read`, `inventory:adjust`, `expenses:read`, `expenses:draft`, `expenses:approve`.

### Excluded Admin-Only Scopes (App-Only)

Never advertised to or grantable by MCP OAuth clients:
`webhooks:manage`, `integrations:manage`, `audit:read`, `tenant:manage`.

### Missing Scope Behavior

If an MCP client calls a tool requiring a scope absent from its token, `/api/mcp` returns:
- HTTP `403 Forbidden`
- Header: `WWW-Authenticate: Bearer error="insufficient_scope", scope="<needed>", resource_metadata="<APP_BASE_URL>/.well-known/oauth-protected-resource"`
- Agent-relayable error: `"This action needs the <needed> permission. Reconnect the Gilgameh connector to grant it."`

---

## Tool → Scope Matrix (32 Tools)

| Tool | Category | Required Scope(s) | Tenant Opt-In Required | Notes |
| --- | --- | --- | --- | --- |
| `find_customer` | Customers | `customers:read` | No | Returns candidates; flags ambiguity |
| `create_customer` | Customers | `customers:write` | No | Creates customer or lead |
| `update_customer` | Customers | `customers:write` | No | Updates contact info, status, notes, or `waitingOnOwner` |
| `list_customers_waiting` | Customers | `customers:read` | No | Lists all customers waiting on owner |
| `log_interaction` | Customers | `customers:write` | No | Logs touchpoint |
| `list_interactions` | Customers | `customers:read` | No | Summarized history (raw external messages withheld) |
| `search_catalog` | Catalog | `catalog:read` | No | Searches products & services |
| `create_catalog_item` | Catalog | `catalog:write` | No | Always sets `verified=false` for agents; supports stock tracking & photo `attachmentId` |
| `update_catalog_item` | Catalog | `catalog:write` | No | Updates name, description, price, unit, attributes, photo (cannot self-verify) |
| `upload_attachment` | Attachments | `catalog:write` | No | Uploads base64 slab/product photos or receipts for linking |
| `create_draft_quote` | Quotes | `quotes:draft` | No | Server computes totals; returns signed `shareablePdfUrl` |
| `update_draft_quote` | Quotes | `quotes:draft` | No | Version-pinned draft update; returns `shareablePdfUrl` |
| `get_quote` | Quotes | `quotes:read` | No | Returns summary + direct `shareablePdfUrl` (no login required) |
| `revise_quote` | Quotes | `quotes:draft` | No | Creates next draft revision (`Q-xxxx-R2`) + `shareablePdfUrl` |
| `approve_quote` | Quotes | `quotes:approve` | **Yes** | Requires BOTH `quotes:approve` scope AND `allowAgentApproveScopes=true`. Returns `shareablePdfUrl` + emails PDF copy to signed-in user only. |
| `email_quote_copy` | Quotes | `quotes:read` | No | Emails finalized quote PDF strictly to signed-in user only (`additionalProperties: false`, max 3/hr/quote/user). Future customer send needs `quotes:send`. |
| `list_open_quotes` | Quotes | `quotes:read` | No | Lists `draft` and `sent` quotes |
| `create_order_from_quote` | Orders | `orders:write` | No | Converts quote to Order + queues production WorkItems + deducts inventory |
| `list_orders` | Orders | `orders:read` | No | Lists recent/filtered orders |
| `update_order_status` | Orders | `orders:write` | No | Updates order lifecycle & fires outbound website webhook |
| `list_production_queue` | Production | `production:read` | No | Lists shop-floor work items |
| `update_work_item` | Production | `production:write` | No | Version-pinned state/priority update |
| `create_draft_invoice` | Invoices & Payments | `invoices:draft` | No | Creates draft invoice from `fromQuoteId`, `fromOrderId`, or standalone lines + `shareablePdfUrl` |
| `get_invoice` | Invoices & Payments | `invoices:read` | No | Returns invoice details, balance due, payments + `shareablePdfUrl` |
| `approve_invoice` | Invoices & Payments | `invoices:approve` | **Yes** | Requires BOTH `invoices:approve` scope AND `allowAgentApproveScopes=true`. Returns `shareablePdfUrl`. |
| `list_unpaid_invoices` | Invoices & Payments | `invoices:read` | No | Lists `sent`, `partially_paid`, `overdue` |
| `record_payment` | Invoices & Payments | `invoices:draft` | No | Records payment against open invoice |
| `list_inventory` | Inventory | `inventory:read` | No | Lists tracked inventory levels & low-stock alerts |
| `adjust_inventory` | Inventory | `inventory:adjust` | **Yes (approve)** | Drafting uses `inventory:adjust`; approving requires `allowAgentApproveScopes=true` |
| `create_draft_expense` | Expenses | `expenses:draft` | No | Requires `receiptAttachmentId` (from `upload_attachment`) for agents |
| `approve_expense` | Expenses | `expenses:approve` | **Yes** | Requires BOTH `expenses:approve` scope AND `allowAgentApproveScopes=true` |
| `business_summary` | Summary | **⚠️ None (FLAGGED)** | No | Enforces no scope; available to any authenticated tenant token. Returns aggregate KPI counts only (no PII). |

---

## How a Tenant Opts In to Agent Approvals

Holding `quotes:approve`, `expenses:approve`, or `inventory:adjust` on an OAuth token is **necessary but not sufficient** to approve financial or stock mutations via an AI agent. By default, every tenant has `settings.allowAgentApproveScopes = false` and receives `403 APPROVAL_REQUIRED_IN_UI` with a direct web approval link.

To opt in for a specific business:
1. Sign in as the business **Owner** or a **BWE Operator**.
2. Open **Business, PDF & Security** (`/settings`).
3. Enable **"Allow AI Agent Approve Scopes"** and click **Save Business & PDF Settings**.
4. This setting is strictly per-tenant and audited in `audit_logs`.

## Release Note (Existing MCP Connectors)

OAuth tokens issued prior to this release retain their original granted scopes. Users with an existing Claude or ChatGPT connector should **disconnect and reconnect** the Gilgameh connector so the new OAuth flow requests and grants the `quotes:approve`, `invoices:approve`, `expenses:approve`, and `inventory:adjust` scopes.
