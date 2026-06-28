-- 0004_orders.sql
-- The order. Carries NO identity — only opaque FKs to users. Money is stored as
-- INTEGER MINOR UNITS (e.g. cents), never floats: floats round badly and would
-- corrupt payouts and commission. Every money column is CHECK (>= 0).
--
-- `status` is a DB-level enum, so an invalid status is rejected by the database
-- (Test B). `id` is an opaque nanoid text key (Test C). All FKs are
-- ON DELETE RESTRICT — you cannot delete a referenced user.

CREATE TABLE orders (
  id                  text         PRIMARY KEY,

  -- opaque participants (identity lives only in the profile tables):
  client_id           text         NOT NULL
                                     REFERENCES users (id) ON DELETE RESTRICT,
  designer_id         text         REFERENCES users (id) ON DELETE RESTRICT,

  product_type        text         NOT NULL,
  status              order_status NOT NULL DEFAULT 'DRAFT',

  -- money: integer minor units only, never negative:
  currency            text         NOT NULL,
  price_total         integer      NOT NULL CHECK (price_total >= 0),
  designer_payout     integer      NOT NULL CHECK (designer_payout >= 0),
  qc_payout           integer      NOT NULL CHECK (qc_payout >= 0),
  platform_commission integer      NOT NULL CHECK (platform_commission >= 0),

  deadline_at         timestamptz,
  -- nullable; the versions table arrives in a later slice, so no FK yet:
  current_version_id  text,
  org_id              text,

  created_at          timestamptz  NOT NULL DEFAULT now(),
  deleted_at          timestamptz,

  -- currency is a 3-letter ISO code (e.g. 'USD'):
  CONSTRAINT orders_currency_iso CHECK (char_length(currency) = 3)
);

CREATE INDEX orders_client_id_idx ON orders (client_id);
CREATE INDEX orders_designer_id_idx ON orders (designer_id);
CREATE INDEX orders_status_idx ON orders (status);
