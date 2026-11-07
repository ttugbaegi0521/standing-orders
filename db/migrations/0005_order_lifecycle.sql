-- Order lifecycle: 'needs_review' marks an order whose intent could not be parsed into a spec.
-- ('filled' was already allowed; spec and max_price_cents already exist from 0001.)
-- Only 'active' orders may be advanced by a cycle run; see RUNNABLE_STATUSES in lib/orders.ts.

ALTER TABLE standing_orders DROP CONSTRAINT IF EXISTS standing_orders_status_check;
ALTER TABLE standing_orders ADD CONSTRAINT standing_orders_status_check
  CHECK (status IN ('active', 'filled', 'paused', 'cancelled', 'needs_review'));
