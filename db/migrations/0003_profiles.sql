-- 0003_profiles.sql
-- IDENTITY IS ISOLATED HERE, in two separate tables — one per side of the
-- double-blind marketplace. A client's identity and a designer's identity never
-- share a table, and neither shares a table with `orders`. This is what keeps
-- the marketplace blind: knowing an order tells you nothing about the people,
-- and a leak of one profile table does not expose the other side.
--
-- Each profile links 1:1 to a row in `users` via an opaque FK. All FKs are
-- ON DELETE RESTRICT: you cannot delete a user out from under their identity or
-- their orders — lifecycle is handled by `deleted_at`, not hard deletes.

CREATE TABLE client_profiles (
  id              text        PRIMARY KEY,
  user_id         text        NOT NULL UNIQUE
                                REFERENCES users (id) ON DELETE RESTRICT,
  -- identifying data (kept ONLY here):
  legal_name      text        NOT NULL,
  email           text        NOT NULL,
  phone           text,
  billing_address text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

CREATE TABLE designer_profiles (
  id              text        PRIMARY KEY,
  user_id         text        NOT NULL UNIQUE
                                REFERENCES users (id) ON DELETE RESTRICT,
  -- identifying data (kept ONLY here):
  legal_name      text        NOT NULL,
  email           text        NOT NULL,
  country         text,
  payout_details  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
