-- 0010_file_versions.sql
-- File versions for orders. Each submission is a new, immutable version; the
-- order points at its latest via orders.current_version_id.
--
-- INVARIANT (enforced in the app layer, part b): every object_key here is an
-- opaque name produced by the single sanitization gate (core/files) — the
-- original filename is never stored, so nothing here leaks who made a file.
-- The DB stores only opaque keys + verified content type + size.

CREATE TABLE file_versions (
  id           text        PRIMARY KEY,
  order_id     text        NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
  version_no   integer     NOT NULL,
  object_key   text        NOT NULL UNIQUE,   -- opaque storage key (from the gate)
  content_type text        NOT NULL,
  size_bytes   integer     NOT NULL CHECK (size_bytes >= 0),
  uploaded_by  text        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  UNIQUE (order_id, version_no)
);

CREATE INDEX file_versions_order_idx ON file_versions (order_id);

-- Now that file_versions exists, wire the orders pointer to it.
ALTER TABLE orders
  ADD CONSTRAINT orders_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES file_versions (id) ON DELETE RESTRICT;

-- Record a new version (after the gate has sanitized + storage has the object).
-- Only the order's client or assigned designer may add one. Audited. Sets the
-- order's current_version_id and returns the new version id.
CREATE OR REPLACE FUNCTION public.add_file_version(
  p_id           text,
  p_order_id     text,
  p_object_key   text,
  p_content_type text,
  p_size_bytes   integer
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_clerk_id text;
  v_order    public.orders%ROWTYPE;
  v_no       integer;
BEGIN
  v_clerk_id := app.current_clerk_id();
  IF v_clerk_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found';
  END IF;
  IF v_order.client_id IS DISTINCT FROM v_clerk_id
     AND v_order.designer_id IS DISTINCT FROM v_clerk_id THEN
    RAISE EXCEPTION 'not a participant of this order';
  END IF;

  SELECT coalesce(max(version_no), 0) + 1 INTO v_no
  FROM public.file_versions WHERE order_id = p_order_id;

  INSERT INTO public.file_versions
    (id, order_id, version_no, object_key, content_type, size_bytes, uploaded_by)
  VALUES
    (p_id, p_order_id, v_no, p_object_key, p_content_type, p_size_bytes, v_clerk_id);

  UPDATE public.orders SET current_version_id = p_id WHERE id = p_order_id;

  PERFORM audit.log_event(
    'FILE_VERSION_ADDED', 'order', p_order_id, v_clerk_id, app.current_user_role(),
    jsonb_build_object('version_id', p_id, 'version_no', v_no,
                       'content_type', p_content_type, 'size_bytes', p_size_bytes)
  );

  RETURN p_id;
END
$$;

REVOKE ALL ON FUNCTION public.add_file_version(text, text, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_file_version(text, text, text, text, integer) TO authenticated, service_role;
