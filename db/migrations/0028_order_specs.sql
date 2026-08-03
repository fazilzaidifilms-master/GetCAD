-- 0028_order_specs.sql
-- The brief: what is actually being made.
--
-- WHAT WAS MISSING. An order until now carried `product_type` (free text) and
-- a `notes` field. Everything a designer needs in order to start — stone
-- dimensions, metal, wall thickness, output format — arrived as prose, or did
-- not arrive at all. That is the single largest cause of a first version coming
-- back wrong, and every round trip costs a revision cycle on both sides.
--
-- SHAPE OF THE DATA. One row per order, plus a child table for accent stone
-- rows (there can be several, and each is a group sharing a size and setting).
-- The alternative — a JSONB blob — was rejected: this data is queried
-- ("which orders need a 4-prong head"), constrained (a seat cannot be cut for a
-- 400mm stone), and priced against. None of that survives in a blob.
--
-- MEASUREMENTS ARE INTEGERS, IN MICRONS. The same rule money follows, for the
-- same reason. A 1.30mm accent stone is 1300µm. Floats accumulate error and
-- compare badly, and these numbers decide whether a seat can physically be cut.
-- Carat weight is likewise an integer in thousandths (millicarats), so 0.75ct
-- is 750.
--
-- THE FREEZE. A spec may only be written while the order is DRAFT or SUBMITTED.
-- Once it is QUOTED the brief has been PRICED, and letting the client silently
-- enlarge the centre stone afterwards would mean the quote no longer describes
-- the work. This is enforced in the write function, not left to the UI.

-- ------------------------------------------------------------------ enums --
--
-- Native enums, matching the rest of the schema: an invalid value is refused by
-- the database rather than by whichever code path happened to check. Extending
-- one later is a forward-only `ALTER TYPE ... ADD VALUE`.

CREATE TYPE product_kind AS ENUM (
  'RING', 'PENDANT', 'EARRING', 'BRACELET', 'BANGLE', 'BROOCH', 'OTHER'
);

CREATE TYPE stone_shape AS ENUM (
  'ROUND', 'OVAL', 'CUSHION', 'PRINCESS', 'EMERALD', 'PEAR', 'MARQUISE',
  'RADIANT', 'ASSCHER', 'HEART', 'TRILLION', 'BAGUETTE', 'OTHER'
);

-- Prong count is part of the identity of a setting, not a separate number: a
-- four-prong and a six-prong head are two different builds, and storing "PRONG"
-- plus a count invites a row that says four prongs and a bezel.
CREATE TYPE setting_type AS ENUM (
  'PRONG_4', 'PRONG_6', 'BEZEL', 'HALO', 'PAVE', 'CHANNEL', 'TENSION',
  'FLUSH', 'OTHER'
);

-- Stones never move through this platform. This answers only how much tolerance
-- the designer leaves when cutting the seat.
CREATE TYPE stone_supply AS ENUM ('CLIENT', 'DESIGNER', 'PLATFORM', 'NONE');

CREATE TYPE metal_colour AS ENUM (
  'YELLOW', 'WHITE', 'ROSE', 'TWO_TONE', 'TRI_COLOUR', 'PLATINUM', 'SILVER'
);

-- The most expensive field in the brief to get wrong: it sets the minimum wall
-- thickness the designer must hold. A model built for rendering and then sent
-- to casting fails at the bench.
CREATE TYPE cad_purpose AS ENUM ('CASTING', 'DIRECT_PRINT', 'RENDER_ONLY');

CREATE TYPE output_format AS ENUM ('THREE_DM', 'STL', 'BOTH', 'STEP');

CREATE TYPE finish_type AS ENUM ('HIGH_POLISH', 'MATTE', 'BRUSHED', 'HAMMERED', 'MIXED');

CREATE TYPE priority_tier AS ENUM ('STANDARD', 'EXPRESS', 'RUSH');

-- ------------------------------------------------------------------ table --

CREATE TABLE order_specs (
  order_id            text          PRIMARY KEY
                                      REFERENCES orders (id) ON DELETE RESTRICT,

  -- The client's own label. Nobody else's view of the order uses it: it exists
  -- so a person can find their own job in a list two months later.
  reference_name      text          NOT NULL
                                      CHECK (char_length(reference_name) BETWEEN 1 AND 120),

  -- Lineage. A revision of an earlier job carries the original brief with it,
  -- so only the CHANGES need describing.
  based_on_order_id   text          REFERENCES orders (id) ON DELETE RESTRICT,
  change_summary      text          CHECK (change_summary IS NULL
                                           OR char_length(change_summary) <= 4000),

  product             product_kind  NOT NULL,

  -- --- centre stone -------------------------------------------------------
  -- Everything about the head follows from whether there is one at all, so the
  -- flag is explicit rather than inferred from nulls. The CHECK at the bottom
  -- keeps the two halves from disagreeing.
  has_centre_stone    boolean       NOT NULL DEFAULT false,
  centre_shape        stone_shape,
  centre_length_um    integer       CHECK (centre_length_um IS NULL
                                           OR centre_length_um BETWEEN 500 AND 60000),
  centre_width_um     integer       CHECK (centre_width_um IS NULL
                                           OR centre_width_um BETWEEN 500 AND 60000),
  centre_depth_um     integer       CHECK (centre_depth_um IS NULL
                                           OR centre_depth_um BETWEEN 200 AND 40000),
  -- Thousandths of a carat. Either this or the millimetre dimensions is enough;
  -- the app converts and shows both.
  centre_carat_mct    integer       CHECK (centre_carat_mct IS NULL
                                           OR centre_carat_mct BETWEEN 1 AND 100000),
  -- A certified stone's dimensions are fixed, so the seat is cut with no
  -- tolerance either way. It changes the work, which is why it is a column.
  centre_certified    boolean       NOT NULL DEFAULT false,
  centre_quantity     integer       NOT NULL DEFAULT 0
                                      CHECK (centre_quantity BETWEEN 0 AND 50),
  centre_setting      setting_type,

  -- --- material and output ------------------------------------------------
  stones_supplied_by  stone_supply  NOT NULL DEFAULT 'NONE',
  metal               metal_colour  NOT NULL,
  -- Free text on purpose: alloy naming is regional and open-ended ('18K',
  -- '750', 'PT950'), and an enum here would reject a legitimate answer.
  karatage            text          NOT NULL
                                      CHECK (char_length(karatage) BETWEEN 2 AND 24),
  purpose             cad_purpose   NOT NULL,
  -- Parts that come off the tree separately and are assembled at the bench.
  component_count     integer       NOT NULL DEFAULT 1
                                      CHECK (component_count BETWEEN 1 AND 20),
  format              output_format NOT NULL,
  finish              finish_type   NOT NULL,
  render_views        integer       NOT NULL DEFAULT 0
                                      CHECK (render_views BETWEEN 0 AND 12),
  priority            priority_tier NOT NULL DEFAULT 'STANDARD',

  notes               text          CHECK (notes IS NULL OR char_length(notes) <= 4000),

  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now(),

  -- A stone that exists needs a shape and a way of being held; one that does
  -- not must not carry dimensions left behind by an earlier answer. Without
  -- this, clearing "is there a centre stone?" leaves a ghost 6.5mm round in the
  -- brief and the designer builds a head for it.
  CONSTRAINT order_specs_centre_coherent CHECK (
    (has_centre_stone
      AND centre_shape IS NOT NULL
      AND centre_setting IS NOT NULL
      AND centre_quantity >= 1
      AND (centre_carat_mct IS NOT NULL
           OR (centre_length_um IS NOT NULL AND centre_width_um IS NOT NULL)))
    OR
    (NOT has_centre_stone
      AND centre_shape IS NULL
      AND centre_setting IS NULL
      AND centre_length_um IS NULL
      AND centre_width_um IS NULL
      AND centre_depth_um IS NULL
      AND centre_carat_mct IS NULL
      AND centre_quantity = 0)
  ),

  -- Describing a change to nothing is incoherent, and so is basing a job on an
  -- earlier one without saying what differs.
  CONSTRAINT order_specs_lineage_coherent CHECK (
    (based_on_order_id IS NULL AND change_summary IS NULL)
    OR (based_on_order_id IS NOT NULL AND change_summary IS NOT NULL)
  ),

  -- An order cannot be a revision of itself.
  CONSTRAINT order_specs_no_self_lineage CHECK (based_on_order_id <> order_id)
);

CREATE INDEX order_specs_based_on_idx ON order_specs (based_on_order_id);

-- One row per GROUP of accent stones sharing a size and a setting — "eighteen
-- 1.30mm rounds, pavé, on the shoulders" is one row, not eighteen.
CREATE TABLE order_spec_accents (
  id            text         PRIMARY KEY DEFAULT gen_random_uuid()::text,
  order_id      text         NOT NULL
                               REFERENCES order_specs (order_id) ON DELETE CASCADE,
  -- Display order, and what the UI calls "Row 1", "Row 2".
  position      integer      NOT NULL CHECK (position BETWEEN 1 AND 40),
  shape         stone_shape  NOT NULL,
  width_um      integer      NOT NULL CHECK (width_um BETWEEN 200 AND 20000),
  quantity      integer      NOT NULL CHECK (quantity BETWEEN 1 AND 2000),
  setting       setting_type NOT NULL,

  UNIQUE (order_id, position)
);

CREATE INDEX order_spec_accents_order_idx ON order_spec_accents (order_id);

-- ---------------------------------------------------------------- derived --

/**
 * The minimum wall thickness the designer must hold, in microns.
 *
 * Derived from `purpose` rather than stored, so it cannot drift from it. These
 * are the thresholds below which a piece fails at the bench: casting needs the
 * most material, direct printing tolerates less, and a render-only model is
 * never physically made.
 */
CREATE OR REPLACE FUNCTION public.min_wall_um(p_purpose cad_purpose)
RETURNS integer
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE p_purpose
    WHEN 'CASTING'      THEN 800
    WHEN 'DIRECT_PRINT' THEN 600
    WHEN 'RENDER_ONLY'  THEN 0
  END;
$$;

-- ----------------------------------------------------------------- writes --

/**
 * Create or replace the brief for an order.
 *
 * Identity comes from the token, never from an argument: passing a user id
 * would let a caller write someone else's brief.
 *
 * THE FREEZE. Writable only while the order is DRAFT or SUBMITTED. After a
 * quote exists the brief has been priced, and a silently enlarged centre stone
 * would mean the client is paying for one job and the designer building
 * another. Changing the work after that point is a new order — which is exactly
 * what `based_on_order_id` is for.
 */
CREATE OR REPLACE FUNCTION public.upsert_order_spec(
  p_order_id           text,
  p_reference_name     text,
  p_product            product_kind,
  p_metal              metal_colour,
  p_karatage           text,
  p_purpose            cad_purpose,
  p_format             output_format,
  p_finish             finish_type,
  p_has_centre_stone   boolean       DEFAULT false,
  p_centre_shape       stone_shape   DEFAULT NULL,
  p_centre_length_um   integer       DEFAULT NULL,
  p_centre_width_um    integer       DEFAULT NULL,
  p_centre_depth_um    integer       DEFAULT NULL,
  p_centre_carat_mct   integer       DEFAULT NULL,
  p_centre_certified   boolean       DEFAULT false,
  p_centre_quantity    integer       DEFAULT 0,
  p_centre_setting     setting_type  DEFAULT NULL,
  p_stones_supplied_by stone_supply  DEFAULT 'NONE',
  p_component_count    integer       DEFAULT 1,
  p_render_views       integer       DEFAULT 0,
  p_priority           priority_tier DEFAULT 'STANDARD',
  p_based_on_order_id  text          DEFAULT NULL,
  p_change_summary     text          DEFAULT NULL,
  p_notes              text          DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_clerk_id text := app.current_clerk_id();
  v_order    public.orders%ROWTYPE;
BEGIN
  IF v_clerk_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such order';
  END IF;

  -- The brief belongs to the person who is buying. Staff do not write it on
  -- someone's behalf: a brief nobody typed is a brief nobody agreed to.
  IF v_order.client_id <> v_clerk_id THEN
    RAISE EXCEPTION 'only the client who owns an order may write its brief';
  END IF;

  IF v_order.status NOT IN ('DRAFT', 'SUBMITTED') THEN
    RAISE EXCEPTION
      'the brief is fixed once the order has been quoted (order is %). Start a revision instead.',
      v_order.status;
  END IF;

  -- A revision must point at an order this same client owns, or the lineage
  -- link becomes a way to read the existence of a stranger's order.
  IF p_based_on_order_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.orders
       WHERE id = p_based_on_order_id AND client_id = v_clerk_id
     ) THEN
    RAISE EXCEPTION 'the order this is based on is not one of yours';
  END IF;

  INSERT INTO public.order_specs AS s (
    order_id, reference_name, based_on_order_id, change_summary, product,
    has_centre_stone, centre_shape, centre_length_um, centre_width_um,
    centre_depth_um, centre_carat_mct, centre_certified, centre_quantity,
    centre_setting, stones_supplied_by, metal, karatage, purpose,
    component_count, format, finish, render_views, priority, notes
  ) VALUES (
    p_order_id, p_reference_name, p_based_on_order_id, p_change_summary, p_product,
    p_has_centre_stone, p_centre_shape, p_centre_length_um, p_centre_width_um,
    p_centre_depth_um, p_centre_carat_mct, p_centre_certified, p_centre_quantity,
    p_centre_setting, p_stones_supplied_by, p_metal, p_karatage, p_purpose,
    p_component_count, p_format, p_finish, p_render_views, p_priority, p_notes
  )
  ON CONFLICT (order_id) DO UPDATE SET
    reference_name    = EXCLUDED.reference_name,
    based_on_order_id = EXCLUDED.based_on_order_id,
    change_summary    = EXCLUDED.change_summary,
    product           = EXCLUDED.product,
    has_centre_stone  = EXCLUDED.has_centre_stone,
    centre_shape      = EXCLUDED.centre_shape,
    centre_length_um  = EXCLUDED.centre_length_um,
    centre_width_um   = EXCLUDED.centre_width_um,
    centre_depth_um   = EXCLUDED.centre_depth_um,
    centre_carat_mct  = EXCLUDED.centre_carat_mct,
    centre_certified  = EXCLUDED.centre_certified,
    centre_quantity   = EXCLUDED.centre_quantity,
    centre_setting    = EXCLUDED.centre_setting,
    stones_supplied_by = EXCLUDED.stones_supplied_by,
    metal             = EXCLUDED.metal,
    karatage          = EXCLUDED.karatage,
    purpose           = EXCLUDED.purpose,
    component_count   = EXCLUDED.component_count,
    format            = EXCLUDED.format,
    finish            = EXCLUDED.finish,
    render_views      = EXCLUDED.render_views,
    priority          = EXCLUDED.priority,
    notes             = EXCLUDED.notes,
    updated_at        = now();

  -- The brief is what the quote is priced against and what the designer is
  -- held to, so each save is a recorded decision. The payload carries the two
  -- fields that most change the work, never the client's own reference name —
  -- that is the one field in the brief a person might put their company in.
  PERFORM audit.log_event(
    'ORDER_SPEC_SAVED', 'order', p_order_id, v_clerk_id, app.current_user_role(),
    jsonb_build_object('product', p_product, 'purpose', p_purpose)
  );
END;
$$;

/**
 * Replace the accent stone rows for an order, wholesale.
 *
 * Whole-list replacement rather than per-row edits: the rows are a description,
 * not entities with their own history, and a partial update leaves a brief that
 * is half old and half new with no way to tell which.
 *
 * Takes arrays rather than a composite type so the app layer does not need to
 * know a Postgres type name to call it.
 */
CREATE OR REPLACE FUNCTION public.set_order_accents(
  p_order_id   text,
  p_shapes     stone_shape[],
  p_widths_um  integer[],
  p_quantities integer[],
  p_settings   setting_type[]
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_clerk_id text := app.current_clerk_id();
  v_status   public.order_status;
  v_client   text;
  v_n        integer := coalesce(array_length(p_shapes, 1), 0);
  i          integer;
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
    RAISE EXCEPTION 'only the client who owns an order may write its brief';
  END IF;
  IF v_status NOT IN ('DRAFT', 'SUBMITTED') THEN
    RAISE EXCEPTION 'the brief is fixed once the order has been quoted (order is %)', v_status;
  END IF;

  -- Four parallel arrays that disagree in length would silently drop or
  -- mis-pair rows, so refuse rather than guess.
  IF coalesce(array_length(p_widths_um, 1), 0) <> v_n
     OR coalesce(array_length(p_quantities, 1), 0) <> v_n
     OR coalesce(array_length(p_settings, 1), 0) <> v_n THEN
    RAISE EXCEPTION 'accent row arrays must be the same length';
  END IF;

  DELETE FROM public.order_spec_accents WHERE order_id = p_order_id;

  FOR i IN 1..v_n LOOP
    INSERT INTO public.order_spec_accents
      (order_id, position, shape, width_um, quantity, setting)
    VALUES
      (p_order_id, i, p_shapes[i], p_widths_um[i], p_quantities[i], p_settings[i]);
  END LOOP;

  RETURN v_n;
END;
$$;

-- ------------------------------------------------------------------ grants --
-- The locked invariant: no direct write grants on the tables. Reads are opened
-- by RLS in policies/0023; every write goes through the functions above.

REVOKE ALL ON public.order_specs FROM anon, authenticated;
REVOKE ALL ON public.order_spec_accents FROM anon, authenticated;
GRANT SELECT ON public.order_specs TO authenticated;
GRANT SELECT ON public.order_spec_accents TO authenticated;

GRANT EXECUTE ON FUNCTION public.upsert_order_spec(
  text, text, product_kind, metal_colour, text, cad_purpose, output_format,
  finish_type, boolean, stone_shape, integer, integer, integer, integer,
  boolean, integer, setting_type, stone_supply, integer, integer, priority_tier,
  text, text, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_order_accents(
  text, stone_shape[], integer[], integer[], setting_type[]
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.min_wall_um(cad_purpose) TO authenticated;
