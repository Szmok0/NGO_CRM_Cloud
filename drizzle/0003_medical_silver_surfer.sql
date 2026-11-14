CREATE TABLE `key_slots` (
	`id` char(36) NOT NULL,
	`user_id` char(36),
	`key_version` int NOT NULL,
	`wrapped_key` text NOT NULL,
	`granted_by` char(36) NOT NULL,
	`granted_at` datetime(3) NOT NULL,
	CONSTRAINT `key_slots_id` PRIMARY KEY(`id`),
	CONSTRAINT `key_slots_user_version_uq` UNIQUE(`user_id`,`key_version`)
);
--> statement-breakpoint
CREATE TABLE `org_keys` (
	`version` int NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`created_by` char(36) NOT NULL,
	`retired_at` datetime(3),
	CONSTRAINT `org_keys_version` PRIMARY KEY(`version`)
);
--> statement-breakpoint
ALTER TABLE `key_slots` ADD CONSTRAINT `key_slots_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `key_slots` ADD CONSTRAINT `key_slots_key_version_org_keys_version_fk` FOREIGN KEY (`key_version`) REFERENCES `org_keys`(`version`) ON DELETE no action ON UPDATE no action;