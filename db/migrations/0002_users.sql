-- 0002_users.sql
-- The users table is Clerk-synced and deliberately CONTAINS NO IDENTITY.
-- It holds only the opaque account: who they are (role), whether they are
-- usable (status), and lifecycle timestamps. Names, emails, phone numbers, and
-- any other identifying data live in the SEPARATE profile tables (0003) so that
-- nothing on a shared/joined row links a human to an order.
--
-- `id` is the Clerk-synced opaque user id (a nanoid-style text key). There is NO
-- sequential integer anywhere — never a serial/identity column.

CREATE TABLE users (
  id          text        PRIMARY KEY,
  role        role        NOT NULL,
  status      user_status NOT NULL DEFAULT 'PENDING',
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
