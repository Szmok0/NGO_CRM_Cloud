CREATE TABLE `settings` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`updated_by` char(36) NOT NULL,
	`deleted_at` datetime(3),
	`version` int NOT NULL,
	`org_name` varchar(200) NOT NULL,
	`profile` varchar(16) NOT NULL,
	`enabled_modules` json NOT NULL,
	`role_labels` json NOT NULL,
	`stale_days` int NOT NULL DEFAULT 30,
	`sensitive_fields_enabled` boolean NOT NULL DEFAULT true,
	`retention_months` int,
	`idle_logout_minutes` int NOT NULL DEFAULT 30,
	CONSTRAINT `settings_id` PRIMARY KEY(`id`)
);
