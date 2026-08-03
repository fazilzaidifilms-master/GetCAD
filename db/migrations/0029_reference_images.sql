-- 0029_reference_images.sql
-- Reference pictures, and pins on them.
--
-- WHY PINS AND NOT JUST PICTURES. A client attaches three photos and writes
-- "like this but with a thinner band". The designer does not know which of the
-- three is the shape, which is the setting they liked, and which was only about
-- the finish — so they pick, and half the time they pick wrong. That is the
-- most common single cause of a first version coming back wrong, and it costs a
-- full revision cycle on both sides every time.
--
-- A pin is a point on a picture with a label: "this prong style", "this band
-- width". It converts an ambiguous pile of images into instructions.
--
-- COORDINATES ARE INTEGER BASIS POINTS, NOT PIXELS AND NOT FLOATS.
--   * Not pixels, because the same pin has to land in the same place on a
--     phone, on a desktop, and on whatever the designer views it at. A pin is a
--     position within the IMAGE, not within one rendering of it.
--   * Not floats, for the reason every other measurement in this schema is an
--     integer: 0.1 is not representable in binary, and "did this pin move?"
--     becomes an unanswerable question the moment you compare two of them.
-- So: 0–10000 across the width, 0–10000 down the height. 10000 is the right
-- edge. That is a tenth of a percent of resolution, far finer than a fingertip.
--
-- ANONYMITY. Photographs are the richest source of identifying metadata in this
-- whole system — EXIF carries GPS, camera serial numbers and often an owner
-- name. Every byte goes through the same sanitization gate as deliverables
-- (`sanitizeUpload` with `requireMetadataStrip`), which is enforced in the
-- upload action, not here; this table only ever sees an opaque object key.

CREATE TABLE order_reference_images (
  id           text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  order_id     text        NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,

  -- Opaque storage key. Never the client's filename: "our-logo-final-v2.jpg"
  -- would put a company name in the one place both sides can see.
  object_key   text        NOT NULL UNIQUE,
  content_type text        NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes   integer     NOT NULL CHECK (size_bytes > 0),

  -- Display order, and what the UI calls "Picture 1".
  position     integer     NOT NULL CHECK (position BETWEEN 1 AND 20),

  -- The picture the designer starts from. Exactly one per order, enforced by
  -- the partial unique index below: "which of these is the main one" is the
  -- question the pile of images creates, so the schema insists on an answer.
  is_primary   boolean     NOT NULL DEFAULT false,

  created_at   timestamptz NOT NULL DEFAULT now(),

  UNIQUE (order_id, position)
);

CREATE INDEX order_reference_images_order_idx ON order_reference_images (order_id);

CREATE UNIQUE INDEX order_reference_images_one_primary
  ON order_reference_images (order_id) WHERE is_primary;

CREATE TABLE order_reference_pins (
  id        text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  image_id  text        NOT NULL
                          REFERENCES order_reference_images (id) ON DELETE CASCADE,

  -- Basis points of the image's own width and height. See the header.
  x_bp      integer     NOT NULL CHECK (x_bp BETWEEN 0 AND 10000),
  y_bp      integer     NOT NULL CHECK (y_bp BETWEEN 0 AND 10000),

  -- What the pin is pointing at. An unlabelled pin is a dot, and a dot is the
  -- ambiguity this table exists to remove — so the label is NOT NULL.
  label     text        NOT NULL CHECK (char_length(label) BETWEEN 1 AND 120),

  position  integer     NOT NULL CHECK (position BETWEEN 1 AND 30),

  UNIQUE (image_id, position)
);

CREATE INDEX order_reference_pins_image_idx ON order_reference_pins (image_id);

-- ----------------------------------------------------------------- writes --

/**
 * Record a reference image that has already been stored.
 *
 * The bytes are sanitized and uploaded by the server action before this is
 * called; by the time we are here the object key is opaque and the metadata is
 * gone. This records it, under the caller's identity, with the same ownership
 * and freeze rules as the rest of the brief.
 */
CREATE OR REPLACE FUNCTION public.add_reference_image(
  p_order_id     text,
  p_object_key   text,
  p_content_type text,
  p_size_bytes   integer
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_clerk_id text := app.current_clerk_id();
  v_status   public.order_status;
  v_client   text;
  v_next     integer;
  v_id       text;
  v_first    boolean;
BEGIN
  IF v_clerk_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT status, client_id INTO v_status, v_client
  FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such order';
  END IF;
  IF v_client <> v_clerk_id THEN
    RAISE EXCEPTION 'only the client who owns an order may add references to it';
  END IF;
  IF v_status NOT IN ('DRAFT', 'SUBMITTED') THEN
    RAISE EXCEPTION 'references are fixed once the order has been quoted (order is %)', v_status;
  END IF;

  SELECT coalesce(max(position), 0) + 1 INTO v_next
  FROM public.order_reference_images WHERE order_id = p_order_id;

  -- The first picture is the main one by default. Somebody who uploads exactly
  -- one image should never have to also nominate it.
  v_first := v_next = 1;

  INSERT INTO public.order_reference_images
    (order_id, object_key, content_type, size_bytes, position, is_primary)
  VALUES
    (p_order_id, p_object_key, p_content_type, p_size_bytes, v_next, v_first)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

/**
 * Replace every pin on one image.
 *
 * Wholesale, like the accent rows and for the same reason: pins are a
 * description of a picture, not entities with their own history, and a partial
 * update leaves a set that is half old and half new with no way to tell which.
 */
CREATE OR REPLACE FUNCTION public.set_reference_pins(
  p_image_id text,
  p_xs       integer[],
  p_ys       integer[],
  p_labels   text[]
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_clerk_id text := app.current_clerk_id();
  v_order    text;
  v_status   public.order_status;
  v_client   text;
  v_n        integer := coalesce(array_length(p_xs, 1), 0);
  i          integer;
BEGIN
  IF v_clerk_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT order_id INTO v_order
  FROM public.order_reference_images WHERE id = p_image_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such image';
  END IF;

  SELECT status, client_id INTO v_status, v_client
  FROM public.orders WHERE id = v_order;
  IF v_client <> v_clerk_id THEN
    RAISE EXCEPTION 'only the client who owns an order may pin its references';
  END IF;
  IF v_status NOT IN ('DRAFT', 'SUBMITTED') THEN
    RAISE EXCEPTION 'references are fixed once the order has been quoted (order is %)', v_status;
  END IF;

  IF coalesce(array_length(p_ys, 1), 0) <> v_n
     OR coalesce(array_length(p_labels, 1), 0) <> v_n THEN
    RAISE EXCEPTION 'pin arrays must be the same length';
  END IF;

  DELETE FROM public.order_reference_pins WHERE image_id = p_image_id;

  FOR i IN 1..v_n LOOP
    INSERT INTO public.order_reference_pins (image_id, x_bp, y_bp, label, position)
    VALUES (p_image_id, p_xs[i], p_ys[i], p_labels[i], i);
  END LOOP;

  RETURN v_n;
END;
$$;

/** Nominate the picture the designer should start from. */
CREATE OR REPLACE FUNCTION public.set_primary_reference(p_image_id text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_clerk_id text := app.current_clerk_id();
  v_order    text;
  v_client   text;
BEGIN
  IF v_clerk_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT i.order_id, o.client_id INTO v_order, v_client
  FROM public.order_reference_images i
  JOIN public.orders o ON o.id = i.order_id
  WHERE i.id = p_image_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such image';
  END IF;
  IF v_client <> v_clerk_id THEN
    RAISE EXCEPTION 'only the client who owns an order may pin its references';
  END IF;

  -- Cleared first: the partial unique index allows exactly one primary per
  -- order, so setting the new one before clearing the old would be rejected.
  UPDATE public.order_reference_images SET is_primary = false
  WHERE order_id = v_order AND is_primary;

  UPDATE public.order_reference_images SET is_primary = true WHERE id = p_image_id;
END;
$$;

/** Remove a picture and, by cascade, its pins. */
CREATE OR REPLACE FUNCTION public.remove_reference_image(p_image_id text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_clerk_id  text := app.current_clerk_id();
  v_order     text;
  v_client    text;
  v_status    public.order_status;
  v_was_main  boolean;
BEGIN
  IF v_clerk_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT i.order_id, i.is_primary, o.client_id, o.status
    INTO v_order, v_was_main, v_client, v_status
  FROM public.order_reference_images i
  JOIN public.orders o ON o.id = i.order_id
  WHERE i.id = p_image_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such image';
  END IF;
  IF v_client <> v_clerk_id THEN
    RAISE EXCEPTION 'only the client who owns an order may remove its references';
  END IF;
  IF v_status NOT IN ('DRAFT', 'SUBMITTED') THEN
    RAISE EXCEPTION 'references are fixed once the order has been quoted (order is %)', v_status;
  END IF;

  DELETE FROM public.order_reference_images WHERE id = p_image_id;

  -- Deleting the main picture must not leave an order whose references have no
  -- starting point; the lowest-numbered survivor takes over.
  IF v_was_main THEN
    UPDATE public.order_reference_images SET is_primary = true
    WHERE id = (
      SELECT id FROM public.order_reference_images
      WHERE order_id = v_order ORDER BY position LIMIT 1
    );
  END IF;
END;
$$;

-- ------------------------------------------------------------------ grants --
-- Same locked pattern: reads via RLS (policies/0024), writes only through the
-- functions above.

REVOKE ALL ON public.order_reference_images FROM anon, authenticated;
REVOKE ALL ON public.order_reference_pins   FROM anon, authenticated;
GRANT SELECT ON public.order_reference_images TO authenticated;
GRANT SELECT ON public.order_reference_pins   TO authenticated;

GRANT EXECUTE ON FUNCTION public.add_reference_image(text, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_reference_pins(text, integer[], integer[], text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_primary_reference(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_reference_image(text) TO authenticated;
