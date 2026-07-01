-- 0006_audit_log.sql
-- Append-only, hash-chained audit log.
--
-- Every state change and every identity-piercing read is recorded here as one
-- immutable entry. Two guarantees, both enforced by the database:
--   1. APPEND-ONLY  — UPDATE/DELETE/TRUNCATE are rejected by a trigger, so even
--      a privileged connection cannot rewrite history.
--   2. TAMPER-EVIDENT — each entry stores a SHA-256 `hash` computed over its own
--      contents plus the previous entry's hash (a hash chain). Altering any past
--      entry breaks every hash after it; audit.verify_chain() detects it.
--
-- Hashing uses Postgres built-ins (sha256/encode/convert_to) — no extension, so
-- behaviour is identical on local Postgres and Supabase.
--
-- `seq` is an internal monotonic ordering column used only to chain entries; it
-- is never exposed as an entity id. The row's own PK `id` is an opaque value.

CREATE SCHEMA IF NOT EXISTS audit;

CREATE SEQUENCE IF NOT EXISTS audit.audit_log_seq;

CREATE TABLE audit.audit_log (
  id               text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  seq              bigint      NOT NULL UNIQUE DEFAULT nextval('audit.audit_log_seq'),
  actor_id         text,                         -- who acted (users.id), NULL = system
  actor_role       public.role,                  -- their role at the time
  action           text        NOT NULL,         -- e.g. USER_CREATED, ORDER_STATUS_CHANGED
  entity_type      text        NOT NULL,         -- e.g. user, order, client_profile
  entity_id        text,                         -- the affected entity
  payload          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  is_identity_read boolean     NOT NULL DEFAULT false,  -- marks identity-piercing reads
  created_at       timestamptz NOT NULL DEFAULT now(),
  prev_hash        text,                         -- hash of the previous entry (NULL for first)
  hash             text        NOT NULL          -- set by the chain trigger
);

CREATE INDEX audit_log_entity_idx ON audit.audit_log (entity_type, entity_id);
CREATE INDEX audit_log_actor_idx  ON audit.audit_log (actor_id);

-- Canonicalise an entry's fields into a stable string (UTC, tz-independent) and
-- SHA-256 it together with the previous hash. Serialised via a transaction-level
-- advisory lock so concurrent appends cannot fork the chain.
CREATE OR REPLACE FUNCTION audit.chain_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_prev_hash text;
  v_canonical text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('audit.audit_log'));

  SELECT a.hash INTO v_prev_hash
  FROM audit.audit_log a
  ORDER BY a.seq DESC
  LIMIT 1;

  NEW.prev_hash := v_prev_hash;

  v_canonical :=
    coalesce(NEW.prev_hash, '')                 || '|' ||
    NEW.seq::text                               || '|' ||
    coalesce(NEW.actor_id, '')                  || '|' ||
    coalesce(NEW.actor_role::text, '')          || '|' ||
    NEW.action                                  || '|' ||
    NEW.entity_type                             || '|' ||
    coalesce(NEW.entity_id, '')                 || '|' ||
    NEW.payload::text                           || '|' ||
    NEW.is_identity_read::text                  || '|' ||
    to_char(NEW.created_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSUS');

  NEW.hash := encode(sha256(convert_to(v_canonical, 'UTF8')), 'hex');
  RETURN NEW;
END
$$;

CREATE TRIGGER audit_log_chain
  BEFORE INSERT ON audit.audit_log
  FOR EACH ROW EXECUTE FUNCTION audit.chain_before_insert();

-- Append-only enforcement: reject any mutation of existing entries.
CREATE OR REPLACE FUNCTION audit.prevent_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit.audit_log is append-only: % is not permitted', TG_OP;
END
$$;

CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON audit.audit_log
  FOR EACH ROW EXECUTE FUNCTION audit.prevent_mutation();

CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON audit.audit_log
  FOR EACH ROW EXECUTE FUNCTION audit.prevent_mutation();

CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON audit.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit.prevent_mutation();

-- The single sanctioned way to append an entry. SECURITY DEFINER so trusted
-- callers (server-side / other DB functions) can log without direct table gr.
CREATE OR REPLACE FUNCTION audit.log_event(
  p_action           text,
  p_entity_type      text,
  p_entity_id        text        DEFAULT NULL,
  p_actor_id         text        DEFAULT NULL,
  p_actor_role       public.role DEFAULT NULL,
  p_payload          jsonb       DEFAULT '{}'::jsonb,
  p_is_identity_read boolean     DEFAULT false
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id text;
BEGIN
  INSERT INTO audit.audit_log
    (action, entity_type, entity_id, actor_id, actor_role, payload, is_identity_read)
  VALUES
    (p_action, p_entity_type, p_entity_id, p_actor_id, p_actor_role,
     coalesce(p_payload, '{}'::jsonb), p_is_identity_read)
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;

-- Recompute the whole chain and report the first break, if any.
CREATE OR REPLACE FUNCTION audit.verify_chain()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  r               record;
  v_expected_prev text := NULL;
  v_canonical     text;
  v_expected_hash text;
  v_count         bigint := 0;
BEGIN
  FOR r IN SELECT * FROM audit.audit_log ORDER BY seq ASC LOOP
    IF r.prev_hash IS DISTINCT FROM v_expected_prev THEN
      RETURN jsonb_build_object('valid', false, 'broken_at', r.seq, 'reason', 'prev_hash link mismatch');
    END IF;

    v_canonical :=
      coalesce(r.prev_hash, '')                 || '|' ||
      r.seq::text                               || '|' ||
      coalesce(r.actor_id, '')                  || '|' ||
      coalesce(r.actor_role::text, '')          || '|' ||
      r.action                                  || '|' ||
      r.entity_type                             || '|' ||
      coalesce(r.entity_id, '')                 || '|' ||
      r.payload::text                           || '|' ||
      r.is_identity_read::text                  || '|' ||
      to_char(r.created_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSUS');
    v_expected_hash := encode(sha256(convert_to(v_canonical, 'UTF8')), 'hex');

    IF r.hash <> v_expected_hash THEN
      RETURN jsonb_build_object('valid', false, 'broken_at', r.seq, 'reason', 'content hash mismatch');
    END IF;

    v_expected_prev := r.hash;
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('valid', true, 'entries', v_count);
END
$$;
