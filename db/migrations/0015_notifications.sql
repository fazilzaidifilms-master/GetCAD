-- 0015_notifications.sql
-- In-app notifications, generated from the audit log so no existing function has
-- to change. Every meaningful event already appends an audit entry; an AFTER
-- INSERT trigger fans a subset of them out to the right recipient(s).
--
-- DOUBLE-BLIND: a notification carries only an opaque recipient id, an order id
-- for context, and a role/order-based summary — never a name or email. Recipients
-- are the order's parties; the actor is never notified of their own action.
-- Fan-out is best-effort: a failure here never rolls back the business action.

CREATE TABLE notifications (
  id         text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id    text        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,  -- recipient (opaque)
  kind       text        NOT NULL,                                           -- e.g. MESSAGE, ASSIGNED
  order_id   text        REFERENCES orders (id) ON DELETE RESTRICT,          -- context
  summary    text        NOT NULL,                                           -- identity-free
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

-- Insert one notification, skipping self-notifications and null recipients.
CREATE OR REPLACE FUNCTION app.notify(
  p_user_id  text,
  p_actor_id text,
  p_kind     text,
  p_order_id text,
  p_summary  text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_user_id IS NULL OR p_user_id IS NOT DISTINCT FROM p_actor_id THEN
    RETURN;  -- no recipient, or would notify the actor of their own action
  END IF;
  INSERT INTO public.notifications (user_id, kind, order_id, summary)
  VALUES (p_user_id, p_kind, p_order_id, p_summary);
END
$$;

-- Derive notifications from an audit entry. Whitelisted actions only.
CREATE OR REPLACE FUNCTION app.fanout_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_client   text;
  v_designer text;
  v_other    text;
  v_to       text;
BEGIN
  IF NEW.entity_type <> 'order' OR NEW.entity_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT client_id, designer_id INTO v_client, v_designer
  FROM public.orders WHERE id = NEW.entity_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- the party that is NOT the actor (for cross-party events)
  v_other := CASE
    WHEN NEW.actor_id IS NOT DISTINCT FROM v_client   THEN v_designer
    WHEN NEW.actor_id IS NOT DISTINCT FROM v_designer THEN v_client
    ELSE NULL
  END;

  IF NEW.action = 'MESSAGE_POSTED' THEN
    PERFORM app.notify(v_other, NEW.actor_id, 'MESSAGE', NEW.entity_id, 'New message on your order.');
  ELSIF NEW.action = 'FILE_VERSION_ADDED' THEN
    PERFORM app.notify(v_other, NEW.actor_id, 'FILE', NEW.entity_id, 'A new file was added to your order.');
  ELSIF NEW.action = 'ORDER_QUOTED' THEN
    PERFORM app.notify(v_client, NEW.actor_id, 'QUOTED', NEW.entity_id, 'Your order has been quoted.');
  ELSIF NEW.action = 'ESCROW_RELEASED' THEN
    PERFORM app.notify(v_designer, NEW.actor_id, 'PAYOUT', NEW.entity_id, 'Your payout has been released.');
  ELSIF NEW.action = 'ESCROW_REFUNDED' THEN
    PERFORM app.notify(v_client, NEW.actor_id, 'REFUNDED', NEW.entity_id, 'Your order has been refunded.');
  ELSIF NEW.action = 'DISPUTE_RAISED' THEN
    PERFORM app.notify(v_designer, NEW.actor_id, 'DISPUTE', NEW.entity_id, 'A dispute was raised on your order.');
  ELSIF NEW.action = 'DISPUTE_RESOLVED' THEN
    PERFORM app.notify(v_client, NEW.actor_id, 'DISPUTE', NEW.entity_id, 'A dispute on your order was resolved.');
    PERFORM app.notify(v_designer, NEW.actor_id, 'DISPUTE', NEW.entity_id, 'A dispute on your order was resolved.');
  ELSIF NEW.action = 'ORDER_STATUS_CHANGED' THEN
    v_to := NEW.payload ->> 'to';
    IF v_to = 'ASSIGNED' THEN
      PERFORM app.notify(v_designer, NEW.actor_id, 'ASSIGNED', NEW.entity_id, 'You have been assigned to an order.');
    ELSIF v_to = 'CLIENT_PREVIEW' THEN
      PERFORM app.notify(v_client, NEW.actor_id, 'PREVIEW', NEW.entity_id, 'Your order is ready to preview.');
    ELSIF v_to = 'DELIVERED' THEN
      PERFORM app.notify(v_client, NEW.actor_id, 'DELIVERED', NEW.entity_id, 'Your order has been delivered.');
    ELSIF v_to = 'DESIGNER_SUBMITTED' THEN
      PERFORM app.notify(v_client, NEW.actor_id, 'SUBMITTED', NEW.entity_id, 'Work has been submitted on your order.');
    END IF;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;  -- notifications are best-effort; never break the business action
END
$$;

CREATE TRIGGER audit_log_fanout
  AFTER INSERT ON audit.audit_log
  FOR EACH ROW EXECUTE FUNCTION app.fanout_notifications();

-- Mark the caller's notifications read (all, or one by id).
CREATE OR REPLACE FUNCTION public.mark_notifications_read(p_id text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_clerk_id text;
  v_count    integer;
BEGIN
  v_clerk_id := app.current_clerk_id();
  IF v_clerk_id IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  UPDATE public.notifications
    SET read_at = now()
    WHERE user_id = v_clerk_id
      AND read_at IS NULL
      AND (p_id IS NULL OR id = p_id);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;

REVOKE ALL ON FUNCTION public.mark_notifications_read(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_notifications_read(text) TO authenticated, service_role;
