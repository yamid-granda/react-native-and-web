-- Reverses 20261007120000_enable_unaccent_for_search.
--
-- Note the ordering hazard: rolling this back while the service still runs the
-- `unaccent()` search queries turns every `?q=` search into a database error,
-- so a rollback must ship with the query revert, not alone.
DROP EXTENSION IF EXISTS unaccent;
