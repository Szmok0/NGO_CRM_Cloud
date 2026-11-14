CREATE TABLE `access_log` (
	`id` char(36) NOT NULL,
	`user_id` char(36),
	`action` varchar(32) NOT NULL,
	`target_type` varchar(32),
	`target_id` char(36),
	`at` datetime(3) NOT NULL,
	CONSTRAINT `access_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`id` char(36) NOT NULL,
	`token_hash` char(64) NOT NULL,
	`user_id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`last_seen_at` datetime(3) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`mfa_passed` boolean NOT NULL,
	`user_agent_hash` char(64),
	CONSTRAINT `auth_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `auth_sessions_token_uq` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`updated_by` char(36) NOT NULL,
	`deleted_at` datetime(3),
	`version` int NOT NULL,
	`email` varchar(254) NOT NULL,
	`name` varchar(200) NOT NULL,
	`role` varchar(16) NOT NULL,
	`status` varchar(16) NOT NULL,
	`kdf_salt` varchar(64),
	`kdf_iterations` int,
	`auth_hash` varchar(255),
	`totp_secret_enc` varchar(255),
	`totp_enabled_at` datetime(3),
	`totp_last_step` bigint,
	`failed_attempts` int NOT NULL DEFAULT 0,
	`locked_until` datetime(3),
	`public_key` text,
	`private_key_enc` text,
	`last_login_at` datetime(3),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_uq` UNIQUE(`email`)
);
--> statement-breakpoint
ALTER TABLE `auth_sessions` ADD CONSTRAINT `auth_sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `access_log_user_idx` ON `access_log` (`user_id`);--> statement-breakpoint
CREATE INDEX `access_log_at_idx` ON `access_log` (`at`);--> statement-breakpoint
CREATE INDEX `auth_sessions_user_idx` ON `auth_sessions` (`user_id`);