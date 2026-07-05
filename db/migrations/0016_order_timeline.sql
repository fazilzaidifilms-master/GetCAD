-- 0016_order_timeline.sql
-- A client-safe, order-scoped view of the audit log: "every state explicit,
-- visible, timestamped" — the flagship trust surface. The raw audit log
-- (audit.audit_log) is staff/service-role only, so this is a narrow, read-only
-- window: a whitelist of order-lifecycle actions, with every row stripped of
-- actor_id. Only actor_role travels (e.g. 'QC') — never an identity, never even
-- an opaque id that could be correlated across orders.
--
-- Visibility mirrors the existing orders RLS (0003 client/designer/QC + 0006
-- staff-queue) exactly, re-implemented here because a SECURITY DEFINER function
-- bypasses RLS and must therefore re-derive the same rule explicitly.

CREATE OR REPLACE FUNCTION public.order_timeline(p_order_id text)
RETURNS TABLE (
  seq         bigint,
  created_at  timestamptz,
  action      text,
  actor_role  public.role,
  from_status text,
  to_status   text,
  amount      integer,
  detail      text
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_clerk_id text;
  v_role     public.role;
  v_order    public.orders%ROWTYPE;
BEGIN
  v_clerk_id := app.current_clerk_id();
  IF v_clerk_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  v_role := app.current_user_role();

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found';
  END IF;

  IF NOT (
    v_order.client_id = v_clerk_id
    OR v_order.designer_id = v_clerk_id
    OR (v_role = 'QC' AND v_order.status IN ('QC_REVIEW', 'REVISION_REQUESTED'))
    OR EXISTS (
      SELECT 1 FROM public.order_transitions t
      WHERE t.from_status = v_order.status
        AND t.actor_role  = v_role
        AND t.actor_scope = 'STAFF'
    )
  ) THEN
    RAISE EXCEPTION 'order not found or not visible';
  END IF;

  -- Every action already carries 'from'/'to' in its payload EXCEPT ORDER_CREATED
  -- (an order always starts DRAFT) and DISPUTE_RESOLVED (which carries a
  -- resolution instead — REWORK implies -> IN_PROGRESS, REFUND -> REFUNDED).
  RETURN QUERY
  SELECT
    a.seq,
    a.created_at,
    a.action,
    a.actor_role,
    a.payload ->> 'from',
    coalesce(
      a.payload ->> 'to',
      CASE WHEN a.action = 'ORDER_CREATED' THEN 'DRAFT' END,
      CASE WHEN a.action = 'DISPUTE_RESOLVED' AND a.payload ->> 'resolution' = 'REWORK' THEN 'IN_PROGRESS' END,
      CASE WHEN a.action = 'DISPUTE_RESOLVED' AND a.payload ->> 'resolution' = 'REFUND' THEN 'REFUNDED' END
    ),
    CASE
      WHEN a.action = 'ORDER_QUOTED'    THEN (a.payload ->> 'price_total')::integer
      WHEN a.action = 'ESCROW_HELD'     THEN (a.payload ->> 'amount')::integer
      WHEN a.action = 'ESCROW_REFUNDED' THEN (a.payload ->> 'amount')::integer
      ELSE NULL
    END,
    CASE
      WHEN a.action = 'DISPUTE_RESOLVED' THEN a.payload ->> 'resolution'
      ELSE NULL
    END
  FROM audit.audit_log a
  WHERE a.entity_type = 'order'
    AND a.entity_id = p_order_id
    AND a.action IN (
      'ORDER_CREATED', 'ORDER_STATUS_CHANGED', 'ORDER_QUOTED',
      'ESCROW_HELD', 'ESCROW_RELEASED', 'ESCROW_REFUNDED',
      'DISPUTE_RAISED', 'DISPUTE_RESOLVED'
    )
  ORDER BY a.seq ASC;
END
$$;

REVOKE ALL ON FUNCTION public.order_timeline(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.order_timeline(text) TO authenticated, service_role;
