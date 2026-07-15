CREATE UNIQUE INDEX mentor_grants_active_pair_uq
  ON mentor_grants (mentor_user_id, applicant_user_id)
  WHERE status = 'active';
