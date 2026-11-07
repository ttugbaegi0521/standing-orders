-- Watch loop bookkeeping. next_check_at null means due now; paused/cancelled/filled/needs_review orders
-- are never selected regardless (see RUNNABLE_STATUSES in lib/orders.ts).

ALTER TABLE standing_orders ADD COLUMN next_check_at timestamptz;
ALTER TABLE standing_orders ADD COLUMN last_checked_at timestamptz;

CREATE INDEX standing_orders_due_idx ON standing_orders (next_check_at) WHERE status = 'active';
