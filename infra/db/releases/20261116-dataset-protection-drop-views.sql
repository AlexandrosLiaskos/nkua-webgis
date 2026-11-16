-- Dataset protection, step 2 (16 November 2026): remove anonymous whole-table access.
-- Run only after the pages use the functions of step 1.
-- The views api.beachrocks and api.tombolos returned every record with every column in one request.
-- Undo: 20261116-dataset-protection-rollback.sql
BEGIN;
DROP VIEW api.beachrocks;
DROP VIEW api.tombolos;
NOTIFY pgrst, 'reload schema';
COMMIT;
