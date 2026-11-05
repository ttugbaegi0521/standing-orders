-- Standing Orders: initial schema.
-- Money is stored as integer US cents (`*_cents`) to keep arithmetic exact in TS.
-- Enum-like columns use text + CHECK so adding a value is a one-line migration.

CREATE TABLE users (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 text NOT NULL UNIQUE,
  -- Encrypted PayPal Vault payment token. Only lib/paypal.ts reads this; it must never reach LLM context.
  paypal_vault_token_enc text,
  -- Global kill switch: when true, guardrails refuse every fill/ask for this user.
  kill_switch           boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE standing_orders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  raw_intent          text NOT NULL,
  spec                jsonb,          -- null until step 1 parses raw_intent
  max_price_cents     integer CHECK (max_price_cents > 0), -- copied from spec.maxPriceCents
  per_order_cap_cents integer NOT NULL CHECK (per_order_cap_cents > 0),
  monthly_cap_cents   integer NOT NULL CHECK (monthly_cap_cents > 0),
  merchant_allowlist  text[] NOT NULL DEFAULT '{}',
  status              text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'filled', 'paused', 'cancelled')),
  workflow_id         text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX standing_orders_user_id_idx ON standing_orders (user_id);

CREATE TABLE candidates (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            uuid NOT NULL REFERENCES standing_orders(id) ON DELETE CASCADE,
  channel3_product_id text NOT NULL,
  merchant            text NOT NULL,
  title               text NOT NULL,
  url                 text,
  price_cents         integer NOT NULL CHECK (price_cents >= 0),
  fit_score           integer NOT NULL CHECK (fit_score BETWEEN 0 AND 100),
  fit_reasoning       text NOT NULL,
  must_haves          jsonb NOT NULL DEFAULT '[]', -- [{ requirement, pass }]
  seen_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX candidates_order_id_seen_at_idx ON candidates (order_id, seen_at DESC);

-- Observed prices per product; powers fake-sale detection and timing.
CREATE TABLE price_points (
  id          bigserial PRIMARY KEY,
  product_id  text NOT NULL, -- Channel3 product id
  price_cents integer NOT NULL CHECK (price_cents >= 0),
  observed_at timestamptz NOT NULL DEFAULT now(),
  -- 'channel3' for real observations, 'override' for the demo price-override endpoint, 'seed' for fixtures.
  source      text NOT NULL DEFAULT 'channel3' CHECK (source IN ('channel3', 'override', 'seed'))
);
CREATE INDEX price_points_product_observed_idx ON price_points (product_id, observed_at DESC);

-- Audit trail: one row per decide→guardrails cycle.
CREATE TABLE decisions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          uuid NOT NULL REFERENCES standing_orders(id) ON DELETE CASCADE,
  candidate_id      uuid REFERENCES candidates(id) ON DELETE SET NULL,
  model_action      text NOT NULL CHECK (model_action IN ('fill', 'hold', 'ask', 'skip')),
  action            text NOT NULL CHECK (action IN ('fill', 'hold', 'ask', 'skip')), -- after guardrails
  reasoning         text NOT NULL,
  guardrail_reasons text[] NOT NULL DEFAULT '{}',
  explanation       text, -- two-sentence user-facing message
  llm_input_hash    text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX decisions_order_id_created_idx ON decisions (order_id, created_at DESC);

-- Raw log of every model call, for the audit trail judges will ask for.
CREATE TABLE llm_calls (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid REFERENCES standing_orders(id) ON DELETE CASCADE,
  step        text NOT NULL CHECK (step IN ('parse_intent', 'search_and_score', 'decide')),
  model       text NOT NULL,
  input_hash  text NOT NULL,
  input       jsonb NOT NULL,
  output      jsonb,
  error       text,
  duration_ms integer,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX llm_calls_order_id_idx ON llm_calls (order_id, created_at DESC);

-- order_id is UNIQUE: this row is the workflow's lock against double-buying.
CREATE TABLE fills (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid NOT NULL UNIQUE REFERENCES standing_orders(id) ON DELETE CASCADE,
  decision_id     uuid REFERENCES decisions(id) ON DELETE SET NULL,
  paypal_order_id text NOT NULL,
  merchant        text NOT NULL,
  amount_cents    integer NOT NULL CHECK (amount_cents > 0),
  currency        text NOT NULL DEFAULT 'USD',
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'captured', 'failed', 'refunded')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE approvals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id     uuid NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  token           text NOT NULL UNIQUE,
  paypal_order_id text,
  expires_at      timestamptz NOT NULL,
  resolved_at     timestamptz,
  resolution      text CHECK (resolution IN ('approved', 'rejected', 'expired')),
  created_at      timestamptz NOT NULL DEFAULT now()
);
