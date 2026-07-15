UPDATE admin_action_log SET action = 'grant_create'    WHERE action = 'grant.create';
UPDATE admin_action_log SET action = 'grant_update'    WHERE action = 'grant.update';
UPDATE admin_action_log SET action = 'category_create' WHERE action = 'category.create';
UPDATE admin_action_log SET action = 'category_update' WHERE action = 'category.update';
ALTER TABLE "admin_action_log" ADD CONSTRAINT "admin_action_log_action_values" CHECK ("admin_action_log"."action" IN ('grant_create','grant_update','grant_review','category_create','category_update','role_change'));