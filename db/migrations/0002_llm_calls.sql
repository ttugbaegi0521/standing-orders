-- One audit shape for llm_calls: failures store { "error": "..." } in output instead of a separate column.
-- (The (order_id, created_at DESC) index from 0001 already serves per-order timelines in either order.)

ALTER TABLE llm_calls RENAME COLUMN duration_ms TO latency_ms;

ALTER TABLE llm_calls ADD COLUMN decision_id uuid REFERENCES decisions(id) ON DELETE SET NULL;

UPDATE llm_calls
SET output = jsonb_build_object('error', error)
WHERE error IS NOT NULL;

ALTER TABLE llm_calls DROP COLUMN error;
