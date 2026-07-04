-- 0013_messages.sql
-- Double-blind messaging: a per-order thread between the client and the assigned
-- designer that STRUCTURALLY cannot leak identity.
--
-- A message carries only an OPAQUE sender_id (already used as an order FK, never
-- a name/email) and a PARTY label ('CLIENT' | 'DESIGNER'). There is no name,
-- email, or avatar column anywhere — each side sees the other purely as a role.
-- Messages are APPEND-ONLY (immutable evidence for disputes) and audited.
--
-- Reading is order-scoped (0010 policy): you can read a thread only if you can
-- read its order, so the same client/designer/staff visibility as the order
-- applies. Staff mediation is possible without ever learning identities, because
-- the order (and every message) carries none.

CREATE TABLE messages (
  id           text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  order_id     text        NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
  sender_id    text        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,  -- opaque
  sender_party text        NOT NULL CHECK (sender_party IN ('CLIENT', 'DESIGNER')),
  body         text        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX messages_order_idx ON messages (order_id, created_at);

-- Append-only: a posted message is never rewritten (dispute evidence).
CREATE TRIGGER messages_no_update
  BEFORE UPDATE ON messages
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER messages_no_delete
  BEFORE DELETE ON messages
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();

-- Post a message to an order's thread. Only the order's client or assigned
-- designer may post; the party label is derived from who they are (never taken
-- from the client). Audited. Identity is the verified token, never a parameter.
CREATE OR REPLACE FUNCTION public.post_message(
  p_order_id text,
  p_body     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_clerk_id text;
  v_order    public.orders%ROWTYPE;
  v_party    text;
  v_id       text;
BEGIN
  v_clerk_id := app.current_clerk_id();
  IF v_clerk_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_body IS NULL OR char_length(btrim(p_body)) = 0 THEN
    RAISE EXCEPTION 'message body is empty';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found';
  END IF;

  IF v_order.client_id = v_clerk_id THEN
    v_party := 'CLIENT';
  ELSIF v_order.designer_id = v_clerk_id THEN
    v_party := 'DESIGNER';
  ELSE
    RAISE EXCEPTION 'only the order''s client or assigned designer may message';
  END IF;

  INSERT INTO public.messages (order_id, sender_id, sender_party, body)
  VALUES (p_order_id, v_clerk_id, v_party, btrim(p_body))
  RETURNING id INTO v_id;

  PERFORM audit.log_event(
    'MESSAGE_POSTED', 'order', p_order_id, v_clerk_id, app.current_user_role(),
    jsonb_build_object('message_id', v_id, 'party', v_party)
  );

  RETURN jsonb_build_object('message_id', v_id, 'party', v_party);
END
$$;

REVOKE ALL ON FUNCTION public.post_message(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_message(text, text) TO authenticated, service_role;
