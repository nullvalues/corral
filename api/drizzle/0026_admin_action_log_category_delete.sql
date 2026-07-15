ALTER TABLE admin_action_log DROP CONSTRAINT admin_action_log_action_values;
ALTER TABLE admin_action_log ADD CONSTRAINT admin_action_log_action_values
  CHECK (action IN ('grant_create','grant_update','grant_review',
                    'category_create','category_update','category_delete',
                    'role_change'));
