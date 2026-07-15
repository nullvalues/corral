ALTER TABLE mentor_grants
  ADD CONSTRAINT mentor_grants_permissions_values
  CHECK (permissions <@ ARRAY['read','write']::text[]);
