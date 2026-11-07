-- The watch loop now stores the top-scored products from each check, not just the one it picked.
-- `chosen` marks the pick. DEFAULT true keeps every existing insert (the seed, older code) meaning what it
-- always meant: a row written on its own is the chosen candidate. The watch loop sets it explicitly.

ALTER TABLE candidates ADD COLUMN chosen boolean NOT NULL DEFAULT true;
