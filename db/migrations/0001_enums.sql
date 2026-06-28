-- 0001_enums.sql
-- Native Postgres enum types. Using DB-level enums (not free-text + app checks)
-- means an invalid value like an order status of 'BANANA' is rejected by the
-- database itself — the strongest possible guarantee (see Test B).

-- All 8 roles defined now, even though only some are used this slice.
CREATE TYPE role AS ENUM (
  'CLIENT',
  'DESIGNER',
  'QC',
  'SALES',
  'OPS',
  'FINANCE',
  'ADMIN',
  'SUPER_ADMIN'
);

CREATE TYPE user_status AS ENUM (
  'PENDING',
  'ACTIVE',
  'SUSPENDED'
);

CREATE TYPE order_status AS ENUM (
  'DRAFT',
  'SUBMITTED',
  'QUOTED',
  'PAYMENT_HELD',
  'ASSIGNED',
  'IN_PROGRESS',
  'DESIGNER_SUBMITTED',
  'QC_REVIEW',
  'REVISION_REQUESTED',
  'CLIENT_PREVIEW',
  'APPROVED',
  'DELIVERED',
  'CLOSED',
  'PAYOUT_RELEASED',
  'CANCELLED',
  'DISPUTED',
  'REFUNDED'
);
