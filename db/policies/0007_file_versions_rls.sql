-- 0007_file_versions_rls.sql
-- You can read a file version exactly when you can read its order. The subquery
-- runs under the caller's RLS on `orders`, so it returns the order only if the
-- caller is allowed to see it — inheriting all the client/designer/QC/staff
-- visibility rules for free. Writes go only through add_file_version().

ALTER TABLE file_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_versions FORCE  ROW LEVEL SECURITY;

GRANT SELECT ON file_versions TO authenticated;

CREATE POLICY file_versions_read ON file_versions
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM orders o WHERE o.id = file_versions.order_id));
