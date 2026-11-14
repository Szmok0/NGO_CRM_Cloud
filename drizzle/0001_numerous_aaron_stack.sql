CREATE TABLE `change_log` (
	`id` char(36) NOT NULL,
	`entity` varchar(64) NOT NULL,
	`entity_id` char(36) NOT NULL,
	`op` varchar(16) NOT NULL,
	`changed_fields` json NOT NULL,
	`user_id` char(36) NOT NULL,
	`at` datetime(3) NOT NULL,
	CONSTRAINT `change_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `change_log_entity_idx` ON `change_log` (`entity`,`entity_id`);--> statement-breakpoint
CREATE INDEX `change_log_at_idx` ON `change_log` (`at`);