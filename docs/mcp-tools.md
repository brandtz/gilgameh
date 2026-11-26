# MCP Server Tools, OAuth 2.1 Scopes & Approval Policy

Generated from the single-source-of-truth tool policy registry in [server/utils/mcp-scopes.ts](../server/utils/mcp-scopes.ts).

## OAuth 2.1 Discovery Endpoints

Both protected-resource endpoints return the exact same RFC 9728 metadata document derived from `MCP_SCOPES_SUPPORTED`:

- `GET /.well-known/oauth-protected-resource`
- `GET /.well-known/oauth-protected-resource/api/mcp`
- `GET /.well-known/oauth-authorization-server`

### Advertised `scopes_supported`

All MCP tool scopes (including approval/adjustment scopes) are advertised:
`customers:read`, `customers:write`, `catalog:read`, `catalog:write`, `quotes:read`, `quotes:draft`, `quotes:approve`, `production:read`, `production:write`, `invoices:read`, `invoices:draft`, `invoices:approve`, `expenses:read`, `expenses:draft`, `expenses:approve`, `inventory:adjust`.

### Excluded Admin-Only Scopes (App-Only)

Never advertised to or grantable by MCP OAuth clients:
`webhooks:manage`, `integrations:manage`, `audit:read`, `tenant:manage`.

### Missing Scope Behavior

If an MCP client calls a tool requiring a scope absent from its token, `/api/mcp` returns:
- HTTP `403 Forbidden`
- Header: `WWW-Authenticate: Bearer error="insufficient_scope", scope="<needed>", resource_metadata="<APP_BASE_URL>/.well-known/oauth-protected-resource"`
- Agent-relayable error: `"This action needs the <needed> permission. Reconnect the Gilgameh connector to grant it."`

---

## Tool → Scope Matrix

| Tool | Category | Required Scope(s) | Tenant Opt-In Required | Notes |
| --- | --- | --- | --- | --- |
| `find_customer` | Customers | `customers:read` | No | Returns candidates; flags ambiguity |
| `create_customer` | Customers | `customers:write` | No | Creates customer or lead |
| `log_interaction` | Customers | `customers:write` | No | Logs touchpoint |
| `search_catalog` | Catalog | `catalog:read` | No | Searches products & services |
| `create_catalog_item` | Catalog | `catalog:write` | No | Always sets `verified=false` for agents |
| `create_draft_quote` | Quotes | `quotes:draft` | No | Server computes integer-cent totals |
| `update_draft_quote` | Quotes | `quotes:draft` | No | Version-pinned; draft quotes only |
| `get_quote` | Quotes | `quotes:read` | No | Returns summary + PDF link |
| `approve_quote` | Quotes | `quotes:approve` | **Yes** | Requires BOTH `quotes:approve` scope AND `allowAgentApproveScopes=true`. Emails PDF copy strictly to signed-in user. |
| `email_quote_copy` | Quotes | `quotes:read` | No | Emails finalized quote PDF strictly to signed-in user only (`additionalProperties: false`, max 3/hr/quote/user). Future customer send needs `quotes:send`. |
| `list_open_quotes` | Quotes | `quotes:read` | No | Lists `draft` and `sent` quotes |
| `list_production_queue` | Production | `production:read` | No | Lists shop-floor work items |
| `update_work_item` | Production | `production:write` | No | Version-pinned state/priority update |
| `list_unpaid_invoices` | Invoices & Payments | `invoices:read` | No | Lists `sent`, `partially_paid`, `overdue` |
| `record_payment` | Invoices & Payments | `invoices:draft` | No | Records payment against open invoice |
| `create_draft_expense` | Expenses | `expenses:draft` | No | Requires `receiptAttachmentId` for agents |
| `approve_expense` | Expenses | `expenses:approve` | **Yes** | Requires BOTH `expenses:approve` scope AND `allowAgentApproveScopes=true` |
| `adjust_inventory` | Inventory | `inventory:adjust` | **Yes (approve)** | Drafting uses `inventory:adjust`; approving requires `allowAgentApproveScopes=true` |
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
