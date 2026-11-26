/**
 * Idempotent PostgreSQL DDL matching server/db/schema.ts.
 * Used for zero-config bootstrap on both Neon/PostgreSQL and embedded PGlite (dev & tests).
 */
export const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  legal_name text,
  contact_name text,
  website text,
  email text,
  phone text,
  address jsonb NOT NULL DEFAULT '{}'::jsonb,
  branding jsonb NOT NULL DEFAULT '{"primaryColor":"#1e293b","accentColor":"#b45309"}'::jsonb,
  numbering_settings jsonb NOT NULL DEFAULT '{"quotePrefix":"Q","nextQuoteNumber":1001,"orderPrefix":"ORD","nextOrderNumber":1001,"invoicePrefix":"INV","nextInvoiceNumber":1001}'::jsonb,
  tax_settings jsonb NOT NULL DEFAULT '{"defaultTaxRateBps":0,"taxLabel":"Tax"}'::jsonb,
  settings jsonb NOT NULL DEFAULT '{"allowAgentApproveScopes":false,"defaultQuoteValidDays":30,"defaultPaymentTermsDays":30,"currency":"USD"}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  name text NOT NULL,
  phone text,
  title text,
  role text NOT NULL DEFAULT 'tenant_staff',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS tenant_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL DEFAULT 'staff',
  scopes jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS oauth_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text NOT NULL UNIQUE,
  client_secret_hash text,
  name text NOT NULL,
  redirect_uris jsonb NOT NULL DEFAULT '[]'::jsonb,
  allowed_scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  tenant_id uuid REFERENCES tenants(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oauth_auth_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash text NOT NULL UNIQUE,
  client_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  redirect_uri text NOT NULL,
  code_challenge text NOT NULL,
  code_challenge_method text NOT NULL DEFAULT 'S256',
  scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oauth_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  token_type text NOT NULL,
  client_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL DEFAULT 'Agent Token',
  scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  key_prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by_user_id uuid REFERENCES users(id),
  last_used_at timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  type text NOT NULL DEFAULT 'person',
  name text NOT NULL,
  company_name text,
  email text,
  phone text,
  address jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'lead',
  lead_source text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  waiting_on_owner boolean NOT NULL DEFAULT false,
  notes text,
  external_ids jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  channel text NOT NULL DEFAULT 'call',
  direction text NOT NULL DEFAULT 'inbound',
  summary text NOT NULL,
  raw_content text,
  contains_external_input boolean NOT NULL DEFAULT false,
  external_ref text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_type text NOT NULL,
  created_by_actor_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS catalog_attribute_schemas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  item_type text NOT NULL DEFAULT 'both',
  fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS catalog_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  type text NOT NULL DEFAULT 'product',
  sku text,
  name text NOT NULL,
  description text,
  unit text NOT NULL DEFAULT 'each',
  base_price_cents integer NOT NULL DEFAULT 0,
  taxable boolean NOT NULL DEFAULT true,
  tax_rate_bps integer,
  attribute_schema_id uuid REFERENCES catalog_attribute_schemas(id),
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  track_inventory boolean NOT NULL DEFAULT false,
  verified boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  entity_type text NOT NULL,
  entity_id uuid,
  filename text NOT NULL,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL,
  storage_key text NOT NULL,
  sha256 text NOT NULL,
  created_by_actor_type text NOT NULL,
  created_by_actor_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  quote_number text NOT NULL,
  base_quote_number text NOT NULL,
  parent_quote_id uuid,
  revision_number integer NOT NULL DEFAULT 1,
  customer_id uuid NOT NULL REFERENCES customers(id),
  customer_po_number text,
  status text NOT NULL DEFAULT 'draft',
  valid_until timestamptz,
  notes text,
  internal_notes text,
  tax_rate_bps integer NOT NULL DEFAULT 0,
  subtotal_cents integer NOT NULL DEFAULT 0,
  tax_cents integer NOT NULL DEFAULT 0,
  total_cents integer NOT NULL DEFAULT 0,
  pdf_attachment_id uuid REFERENCES attachments(id),
  sent_at timestamptz,
  accepted_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (tenant_id, quote_number)
);

CREATE TABLE IF NOT EXISTS quote_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  quote_id uuid NOT NULL REFERENCES quotes(id),
  line_order integer NOT NULL DEFAULT 0,
  catalog_item_id uuid REFERENCES catalog_items(id),
  description text NOT NULL,
  quantity numeric(12,3) NOT NULL DEFAULT 1,
  unit text NOT NULL DEFAULT 'each',
  unit_price_cents integer NOT NULL DEFAULT 0,
  taxable boolean NOT NULL DEFAULT true,
  tax_rate_bps integer,
  line_subtotal_cents integer NOT NULL DEFAULT 0,
  line_tax_cents integer NOT NULL DEFAULT 0,
  line_total_cents integer NOT NULL DEFAULT 0,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  unverified_item boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  order_number text NOT NULL,
  quote_id uuid REFERENCES quotes(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  customer_po_number text,
  channel text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'confirmed',
  subtotal_cents integer NOT NULL DEFAULT 0,
  tax_cents integer NOT NULL DEFAULT 0,
  total_cents integer NOT NULL DEFAULT 0,
  notes text,
  external_order_id text,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (tenant_id, order_number)
);

CREATE TABLE IF NOT EXISTS order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  order_id uuid NOT NULL REFERENCES orders(id),
  line_order integer NOT NULL DEFAULT 0,
  catalog_item_id uuid REFERENCES catalog_items(id),
  description text NOT NULL,
  quantity numeric(12,3) NOT NULL DEFAULT 1,
  unit text NOT NULL DEFAULT 'each',
  unit_price_cents integer NOT NULL DEFAULT 0,
  taxable boolean NOT NULL DEFAULT true,
  tax_rate_bps integer,
  line_subtotal_cents integer NOT NULL DEFAULT 0,
  line_tax_cents integer NOT NULL DEFAULT 0,
  line_total_cents integer NOT NULL DEFAULT 0,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS work_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  order_id uuid NOT NULL REFERENCES orders(id),
  order_line_id uuid REFERENCES order_lines(id),
  title text NOT NULL,
  description text,
  quantity numeric(12,3) NOT NULL DEFAULT 1,
  due_date timestamptz,
  priority_rank integer NOT NULL DEFAULT 100,
  state text NOT NULL DEFAULT 'queued',
  assigned_to_user_id uuid REFERENCES users(id),
  notes text,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  invoice_number text NOT NULL,
  order_id uuid REFERENCES orders(id),
  quote_id uuid REFERENCES quotes(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  status text NOT NULL DEFAULT 'draft',
  issued_at timestamptz,
  due_at timestamptz,
  tax_rate_bps integer NOT NULL DEFAULT 0,
  subtotal_cents integer NOT NULL DEFAULT 0,
  tax_cents integer NOT NULL DEFAULT 0,
  total_cents integer NOT NULL DEFAULT 0,
  amount_paid_cents integer NOT NULL DEFAULT 0,
  balance_due_cents integer NOT NULL DEFAULT 0,
  notes text,
  pdf_attachment_id uuid REFERENCES attachments(id),
  external_accounting_id text,
  synced_to_accounting_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (tenant_id, invoice_number)
);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  invoice_id uuid NOT NULL REFERENCES invoices(id),
  line_order integer NOT NULL DEFAULT 0,
  catalog_item_id uuid REFERENCES catalog_items(id),
  description text NOT NULL,
  quantity numeric(12,3) NOT NULL DEFAULT 1,
  unit text NOT NULL DEFAULT 'each',
  unit_price_cents integer NOT NULL DEFAULT 0,
  taxable boolean NOT NULL DEFAULT true,
  tax_rate_bps integer,
  line_subtotal_cents integer NOT NULL DEFAULT 0,
  line_tax_cents integer NOT NULL DEFAULT 0,
  line_total_cents integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  invoice_id uuid NOT NULL REFERENCES invoices(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  method text NOT NULL DEFAULT 'other',
  amount_cents integer NOT NULL,
  reference text,
  paid_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  external_payment_id text,
  synced_to_accounting_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  catalog_item_id uuid NOT NULL REFERENCES catalog_items(id),
  quantity_on_hand integer NOT NULL DEFAULT 0,
  reorder_point integer NOT NULL DEFAULT 0,
  location text,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (tenant_id, catalog_item_id)
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  inventory_item_id uuid NOT NULL REFERENCES inventory_items(id),
  catalog_item_id uuid NOT NULL REFERENCES catalog_items(id),
  movement_type text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  quantity_delta integer NOT NULL,
  reference_type text,
  reference_id uuid,
  reason text,
  approved_by_actor_type text,
  approved_by_actor_id text,
  approved_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_by_actor_type text NOT NULL,
  created_by_actor_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  vendor text NOT NULL,
  expense_date text NOT NULL,
  category text NOT NULL DEFAULT 'supplies',
  status text NOT NULL DEFAULT 'draft',
  subtotal_cents integer NOT NULL DEFAULT 0,
  tax_cents integer NOT NULL DEFAULT 0,
  total_cents integer NOT NULL DEFAULT 0,
  line_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  receipt_attachment_id uuid REFERENCES attachments(id),
  fingerprint text NOT NULL,
  notes text,
  external_accounting_id text,
  synced_to_accounting_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id),
  actor_type text NOT NULL,
  actor_id text NOT NULL,
  actor_label text NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  before_state jsonb,
  after_state jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  key text NOT NULL,
  method text NOT NULL,
  path text NOT NULL,
  request_hash text NOT NULL,
  response_status integer NOT NULL,
  response_body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE (tenant_id, key, method, path)
);

CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  url text NOT NULL,
  secret text NOT NULL,
  events jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  endpoint_id uuid NOT NULL REFERENCES webhook_endpoints(id),
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_status_code integer,
  last_error text,
  next_retry_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS integration_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  provider text NOT NULL,
  is_enabled boolean NOT NULL DEFAULT false,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  webhook_secret text,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider)
);

CREATE TABLE IF NOT EXISTS chatwoot_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  external_contact_id text NOT NULL,
  customer_id uuid REFERENCES customers(id),
  name text NOT NULL,
  email text,
  phone text,
  avatar_url text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_activity_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, external_contact_id)
);

CREATE TABLE IF NOT EXISTS chatwoot_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  external_conversation_id text NOT NULL,
  chatwoot_contact_id uuid NOT NULL REFERENCES chatwoot_contacts(id),
  inbox_name text NOT NULL DEFAULT 'Default Inbox',
  channel text NOT NULL DEFAULT 'web',
  status text NOT NULL DEFAULT 'open',
  unread_count integer NOT NULL DEFAULT 0,
  last_message_preview text,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, external_conversation_id)
);

-- Idempotent column upgrades for existing deployments
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS contact_name text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS website text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE tenant_memberships ADD COLUMN IF NOT EXISTS scopes jsonb;

CREATE INDEX IF NOT EXISTS customers_tenant_name_idx ON customers(tenant_id, name);
CREATE INDEX IF NOT EXISTS customers_tenant_status_idx ON customers(tenant_id, status);
CREATE INDEX IF NOT EXISTS interactions_tenant_customer_idx ON interactions(tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS catalog_items_tenant_name_idx ON catalog_items(tenant_id, name);
CREATE INDEX IF NOT EXISTS quotes_tenant_customer_idx ON quotes(tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS quotes_tenant_status_idx ON quotes(tenant_id, status);
CREATE INDEX IF NOT EXISTS quote_lines_quote_idx ON quote_lines(quote_id);
CREATE INDEX IF NOT EXISTS orders_tenant_customer_idx ON orders(tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS work_items_tenant_state_idx ON work_items(tenant_id, state);
CREATE INDEX IF NOT EXISTS invoices_tenant_status_idx ON invoices(tenant_id, status);
CREATE INDEX IF NOT EXISTS payments_tenant_invoice_idx ON payments(tenant_id, invoice_id);
CREATE INDEX IF NOT EXISTS stock_movements_tenant_item_idx ON stock_movements(tenant_id, inventory_item_id);
CREATE INDEX IF NOT EXISTS expenses_tenant_fingerprint_idx ON expenses(tenant_id, fingerprint);
CREATE INDEX IF NOT EXISTS audit_logs_tenant_created_idx ON audit_logs(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS webhook_deliveries_tenant_idx ON webhook_deliveries(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS chatwoot_contacts_tenant_idx ON chatwoot_contacts(tenant_id);
CREATE INDEX IF NOT EXISTS chatwoot_convos_tenant_status_idx ON chatwoot_conversations(tenant_id, status);
`
