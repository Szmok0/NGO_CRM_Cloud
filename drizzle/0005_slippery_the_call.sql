CREATE TABLE `invitations` (
	`id` char(36) NOT NULL,
	`token_hash` char(64) NOT NULL,
	`user_id` char(36) NOT NULL,
	`invited_by` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`used_at` datetime(3),
	CONSTRAINT `invitations_id` PRIMARY KEY(`id`),
	CONSTRAINT `invitations_token_uq` UNIQUE(`token_hash`)
);
--> statement-breakpoint
ALTER TABLE `invitations` ADD CONSTRAINT `invitations_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `invitations_user_idx` ON `invitations` (`user_id`);