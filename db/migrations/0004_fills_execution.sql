-- Step 5 execution: a fill is now keyed by the decision that caused it, not by the order.
-- A standing order can have several fills over time; retrying the same decision hits UNIQUE(decision_id)
-- and returns the existing row instead of charging twice.

ALTER TABLE fills DROP CONSTRAINT IF EXISTS fills_order_id_key;
CREATE INDEX fills_order_id_idx ON fills (order_id);

ALTER TABLE fills ADD CONSTRAINT fills_decision_id_key UNIQUE (decision_id);

-- paypal_order_id exists from 0001 as NOT NULL; the pending row is inserted before PayPal is called.
ALTER TABLE fills ALTER COLUMN paypal_order_id DROP NOT NULL;
ALTER TABLE fills ADD COLUMN capture_id text;
ALTER TABLE fills ADD COLUMN error text;
