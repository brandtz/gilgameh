# Authentication, Authorization & OAuth 2.1 Scope Model

## 1. Actor Types

| Actor Type | Auth Mechanism | Tenant Resolution | Default Scopes |
| --- | --- | --- | --- |
| `operator` (BWE Operator) | Session JWT (`Bearer` or `HttpOnly` cookie) | `X-Tenant-Id` header (verified against `tenant_memberships` or platform operator grant) | All scopes |
| `user` (`tenant_owner`) | Session JWT (`Bearer` or `HttpOnly` cookie) | Fixed from JWT `tid` claim | All tenant scopes |
| `user` (`tenant_staff`) | Session JWT (`Bearer` or `HttpOnly` cookie) | Fixed from JWT `tid` claim | Read/write/draft (approval configurable) |
| `agent` (AI Agent via MCP) | OAuth 2.1 Bearer Token (`bo_at_...` or JWT) | Fixed from OAuth token record | Read + draft by default; approve scopes opt-in per tenant |
| `integration` (Website / Webhook) | API Key (`bo_key_...`) or HMAC-SHA256 Webhook Signature | Fixed from API key / webhook endpoint | Explicit key scopes |
| `system` | Internal background jobs | Explicit service context | System internal |

## 2. Scope Matrix

- `customers:read`, `customers:write`
- `catalog:read`, `catalog:write`
- `quotes:read`, `quotes:draft`, `quotes:approve`
- `orders:read`, `orders:write`
- `invoices:read`, `invoices:draft`, `invoices:approve`
- `production:read`, `production:write`
- `expenses:read`, `expenses:draft`, `expenses:approve`
- `inventory:read`, `inventory:adjust`
- `webhooks:manage`
- `integrations:manage`
- `audit:read`
- `tenant:manage`

## 3. Agent Approval Policy (Secure by Default)

By default, every tenant has `settings.allowAgentApproveScopes = false`.

- OAuth 2.1 authorization requests from AI agents default to read + draft scopes.
- Even if an agent token requests or holds an approve scope (`quotes:approve`, `invoices:approve`, `expenses:approve`, `inventory:adjust`), the server checks `tenant.settings.allowAgentApproveScopes` at execution time.
- When `false`, the server returns `403 FORBIDDEN` along with a direct web approval URL (e.g., `/quotes/<id>`) so the business owner can approve in one tap in the UI.
- Tenants that want hands-free voice approval can opt in via **Settings → Security → Allow Agent Approve Scopes**.

## 4. OAuth 2.1 Flow for MCP Clients

Implemented in accordance with the MCP Authorization specification:

1. **Discovery**:
   - `GET /.well-known/oauth-protected-resource`
   - `GET /.well-known/oauth-authorization-server`
2. **Dynamic Client Registration**:
   - `POST /api/oauth/register`
3. **Authorization + PKCE (S256 required)**:
   - `GET /api/oauth/authorize` → redirects to `/oauth/consent` where the authenticated user selects tenant & scopes and approves
   - `POST /api/oauth/authorize` → issues short-lived single-use authorization code
4. **Token Exchange & Refresh**:
   - `POST /api/oauth/token` (`grant_type=authorization_code` with `code_verifier`, or `grant_type=refresh_token`)
5. **Revocation**:
   - `POST /api/oauth/revoke` and `DELETE /api/v1/auth/tokens/:id` from the Admin Panel.

## 5. Inbound & Outbound Webhook Security

- **Outbound**: Signed with `X-BackOffice-Signature: t=<unix_ts>,v1=<hmac_sha256>` using the endpoint's secret. Retried with exponential backoff tracking in `webhook_deliveries`.
- **Inbound** (`/api/webhooks/website`, `/api/webhooks/chatwoot`, `/api/webhooks/stripe`): Verified via HMAC-SHA256 signature header against the tenant's configured integration secret and deduplicated via event ID idempotency.
