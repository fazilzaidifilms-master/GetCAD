-- 0030_file_kinds.sql
-- What a file IS, so the approval gate has something to decide on.
--
-- THE PROBLEM THIS FIXES. `file_versions` records that an order has files and
-- nothing about what they are. That was fine while delivery was one artefact,
-- but it is not: a delivery is four render images, a gold weight chart and a
-- diamond details sheet — which the client looks at in order to decide — plus
-- an STL, a 3DM and an order summary sheet, which are the thing they are
-- buying. The first set has to be visible BEFORE approval or there is nothing
-- to approve. The second must not be, or approval is optional and the escrow
-- means nothing.
--
-- Without a kind column the only rules expressible are "all files" or "no
-- files", so the gate has to choose between showing the client nothing to judge
-- and handing over the deliverable early. Neither is the product.
--
-- Kinds are a native enum rather than free text for the usual reason: the
-- visibility rule branches on this value, and a typo'd 'stl' silently landing
-- in the wrong bucket is a disclosure, not a display bug.

CREATE TYPE file_kind AS ENUM (
  -- The client's own material — a spec sheet, a quote from elsewhere, a PDF of
  -- what they want. Reference PHOTOS live in order_reference_images; this is
  -- for everything that is not an image with pins on it.
  'CLIENT_REFERENCE',
  -- The review set: what the client judges the work on.
  'RENDER',
  'WEIGHT_CHART',
  'DIAMOND_DETAILS',
  -- The release set: what they are buying.
  'STL',
  'RHINO_3DM',
  'SUMMARY_SHEET',
  -- Anything not yet classified. Deliberately in the RELEASE set, not the
  -- review set, so an unclassified file fails CLOSED.
  'OTHER'
);

-- DEFAULT 'OTHER' rather than backfilling a guess: every row that predates this
-- migration was uploaded before kinds existed, and inferring one from the
-- content type would be a guess that the gate then treats as fact. 'OTHER' is
-- the honest answer and it withholds rather than releases.
ALTER TABLE file_versions
  ADD COLUMN kind file_kind NOT NULL DEFAULT 'OTHER';

-- The gate reads (order_id, kind) on every download; the existing index is on
-- order_id alone.
CREATE INDEX file_versions_order_kind_idx ON file_versions (order_id, kind);

-- Replace the un-kinded writer. The old five-argument signature is DROPped
-- rather than kept as an overload: leaving it callable leaves a path that
-- writes 'OTHER' by omission, and a file whose kind is wrong is a file the gate
-- shows to the wrong person.
DROP FUNCTION IF EXISTS public.add_file_version(text, text, text, text, integer);

CREATE OR REPLACE FUNCTION public.add_file_version(
  p_id           text,
  p_order_id     text,
  p_object_key   text,
  p_content_type text,
  p_size_bytes   integer,
  p_kind         file_kind
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

  -- Who you are decides what you can be uploading. A client labelling their own
  -- attachment 'RENDER' would put it in the review set, where the gate reasons
  -- about it as though the designer had produced it; a designer labelling a
  -- deliverable 'CLIENT_REFERENCE' would hand it over before approval, since
  -- the client always gets their own material back.
  IF v_order.client_id = v_clerk_id AND p_kind <> 'CLIENT_REFERENCE' THEN
    RAISE EXCEPTION 'a client may only attach reference material, not % — deliverables come from the designer', p_kind;
  END IF;
  IF v_order.designer_id = v_clerk_id AND p_kind = 'CLIENT_REFERENCE' THEN
    RAISE EXCEPTION 'CLIENT_REFERENCE is the client''s own material';
  END IF;

  SELECT coalesce(max(version_no), 0) + 1 INTO v_no
  FROM public.file_versions WHERE order_id = p_order_id;

  INSERT INTO public.file_versions
    (id, order_id, version_no, object_key, content_type, size_bytes, uploaded_by, kind)
  VALUES
    (p_id, p_order_id, v_no, p_object_key, p_content_type, p_size_bytes, v_clerk_id, p_kind);

  -- Only a deliverable moves the order's pointer. current_version_id means "the
  -- work as it currently stands"; a client attaching a PDF mid-job must not
  -- redefine what the designer submitted.
  IF p_kind <> 'CLIENT_REFERENCE' THEN
    UPDATE public.orders SET current_version_id = p_id WHERE id = p_order_id;
  END IF;

  PERFORM audit.log_event(
    'FILE_VERSION_ADDED', 'order', p_order_id, v_clerk_id, app.current_user_role(),
    jsonb_build_object('version_id', p_id, 'version_no', v_no, 'kind', p_kind,
                       'content_type', p_content_type, 'size_bytes', p_size_bytes)
  );

  RETURN p_id;
END
$$;

REVOKE ALL ON FUNCTION public.add_file_version(text, text, text, text, integer, file_kind) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_file_version(text, text, text, text, integer, file_kind) TO authenticated, service_role;
