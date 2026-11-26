export function buildOpenApiSpec(baseUrl: string) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Back Office Platform API',
      version: '1.0.0',
      description:
        'Multi-tenant, API-first small business back-office operations API. All monetary amounts are integer cents. External creates support Idempotency-Key. Approvals require optimistic concurrency version.'
    },
    servers: [{ url: `${baseUrl}/api/v1` }],
    components: {
      securitySchemes: {
        BearerAuth: { type: 'http', scheme: 'bearer', description: 'Session JWT, OAuth 2.1 Agent Token (bo_at_*), or API Key (bo_key_*)' },
        ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-Api-Key' }
      }
    },
    security: [{ BearerAuth: [] }],
    paths: {
      '/auth/login': { post: { summary: 'Authenticate operator or tenant user', tags: ['Auth'] } },
      '/auth/me': { get: { summary: 'Current actor, scopes, and accessible tenants', tags: ['Auth'] } },
      '/auth/api-keys': {
        get: { summary: 'List tenant API keys', tags: ['Auth'] },
        post: { summary: 'Create scoped API key', tags: ['Auth'] }
      },
      '/auth/tokens': { get: { summary: 'List active MCP OAuth 2.1 agent tokens', tags: ['Auth'] } },
      '/auth/tokens/{id}': { delete: { summary: 'Revoke MCP OAuth agent token', tags: ['Auth'] } },
      '/tenant': {
        get: { summary: 'Get active tenant profile, branding, numbering, tax, and security settings', tags: ['Tenant'] },
        patch: { summary: 'Update tenant configuration', tags: ['Tenant'] }
      },
      '/dashboard/summary': { get: { summary: 'Business KPI summary', tags: ['Dashboard'] } },
      '/customers': {
        get: { summary: 'List/search customers with pagination and waiting_on_owner filter', tags: ['Customers'] },
        post: { summary: 'Create customer (supports Idempotency-Key)', tags: ['Customers'] }
      },
      '/customers/search': { get: { summary: 'Candidate customer search (explicitly flags ambiguity)', tags: ['Customers'] } },
      '/customers/{id}': {
        get: { summary: 'Get customer by ID', tags: ['Customers'] },
        patch: { summary: 'Update customer (optimistic concurrency)', tags: ['Customers'] },
        delete: { summary: 'Soft-delete customer', tags: ['Customers'] }
      },
      '/interactions': {
        get: { summary: 'List customer interactions (raw inbound content redacted for agents)', tags: ['Customers'] },
        post: { summary: 'Log customer interaction', tags: ['Customers'] }
      },
      '/catalog': {
        get: { summary: 'Search/list catalog products and services', tags: ['Catalog'] },
        post: { summary: 'Create catalog item (agent-created items default to verified=false)', tags: ['Catalog'] }
      },
      '/catalog/{id}': {
        get: { summary: 'Get catalog item', tags: ['Catalog'] },
        patch: { summary: 'Update or verify catalog item', tags: ['Catalog'] }
      },
      '/catalog/schemas': {
        get: { summary: 'List tenant-defined JSONB attribute schemas', tags: ['Catalog'] },
        post: { summary: 'Create tenant-defined attribute schema', tags: ['Catalog'] }
      },
      '/quotes': {
        get: { summary: 'List quotes (supports openOnly=true, status, customerId)', tags: ['Quotes'] },
        post: { summary: 'Create draft quote with server-computed totals & sequential Q-number', tags: ['Quotes'] }
      },
      '/quotes/{id}': {
        get: { summary: 'Get quote with lines and PDF link', tags: ['Quotes'] },
        patch: { summary: 'Update draft quote (version-pinned; immutable once sent)', tags: ['Quotes'] }
      },
      '/quotes/{id}/approve': { post: { summary: 'Approve & send draft quote (version-pinned; generates branded PDF)', tags: ['Quotes'] } },
      '/quotes/{id}/revise': { post: { summary: 'Create next revision (e.g. Q-1001-R2)', tags: ['Quotes'] } },
      '/quotes/{id}/status': { post: { summary: 'Transition sent quote to accepted/declined/expired', tags: ['Quotes'] } },
      '/quotes/{id}/pdf': { get: { summary: 'Download branded Quote PDF', tags: ['Quotes'] } },
      '/orders': {
        get: { summary: 'List orders', tags: ['Orders'] },
        post: { summary: 'Create order (from quote or external channel; generates production work items)', tags: ['Orders'] }
      },
      '/orders/{id}': {
        get: { summary: 'Get order with lines and work items', tags: ['Orders'] },
        patch: { summary: 'Update order status (emits order.status_changed webhook)', tags: ['Orders'] }
      },
      '/production': { get: { summary: 'List production queue work items sorted by priority & due date', tags: ['Production'] } },
      '/production/{id}': { patch: { summary: 'Update work item state, priority, or assignment', tags: ['Production'] } },
      '/invoices': {
        get: { summary: 'List invoices (supports unpaidOnly=true)', tags: ['Invoices'] },
        post: { summary: 'Create draft invoice (from order or standalone)', tags: ['Invoices'] }
      },
      '/invoices/{id}': { get: { summary: 'Get invoice with lines and payments', tags: ['Invoices'] } },
      '/invoices/{id}/approve': { post: { summary: 'Approve & send draft invoice (version-pinned; generates PDF)', tags: ['Invoices'] } },
      '/invoices/{id}/pdf': { get: { summary: 'Download branded Invoice PDF', tags: ['Invoices'] } },
      '/payments': {
        get: { summary: 'List payments', tags: ['Payments'] },
        post: { summary: 'Record payment against invoice (emits invoice.paid when settled)', tags: ['Payments'] }
      },
      '/inventory': { get: { summary: 'List tracked inventory levels and low-stock flags', tags: ['Inventory'] } },
      '/inventory/movements': {
        get: { summary: 'List append-only stock movements', tags: ['Inventory'] },
        post: { summary: 'Create draft stock adjustment', tags: ['Inventory'] }
      },
      '/inventory/movements/{id}/approve': { post: { summary: 'Approve drafted stock adjustment (version-pinned)', tags: ['Inventory'] } },
      '/expenses': {
        get: { summary: 'List expenses', tags: ['Expenses'] },
        post: { summary: 'Create draft expense (receiptAttachmentId required for agents; duplicate fingerprint check)', tags: ['Expenses'] }
      },
      '/expenses/{id}/approve': { post: { summary: 'Approve draft expense (version-pinned)', tags: ['Expenses'] } },
      '/attachments': { post: { summary: 'Upload attachment (base64 or multipart) to R2/local storage', tags: ['Attachments'] } },
      '/attachments/{id}': { get: { summary: 'Download attachment', tags: ['Attachments'] } },
      '/webhooks': {
        get: { summary: 'List outbound webhook endpoints and recent deliveries', tags: ['Webhooks'] },
        post: { summary: 'Register outbound HMAC-signed webhook endpoint', tags: ['Webhooks'] }
      },
      '/webhooks/{id}': { delete: { summary: 'Delete outbound webhook endpoint', tags: ['Webhooks'] } },
      '/integrations': { get: { summary: 'List integration configs', tags: ['Integrations'] } },
      '/integrations/{provider}': { put: { summary: 'Configure integration (website, stripe_connect, email, chatwoot, quickbooks)', tags: ['Integrations'] } },
      '/integrations/quickbooks/sync': { post: { summary: 'One-way push of finalized invoices, payments, and expenses to QuickBooks', tags: ['Integrations'] } },
      '/audit': { get: { summary: 'Query immutable audit log', tags: ['Audit'] } }
    }
  }
}
