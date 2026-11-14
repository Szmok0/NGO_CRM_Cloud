CREATE TABLE `task_items` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`updated_by` char(36) NOT NULL,
	`deleted_at` datetime(3),
	`version` int NOT NULL,
	`task_id` char(36) NOT NULL,
	`label` varchar(500) NOT NULL,
	`done` boolean NOT NULL DEFAULT false,
	`position` int NOT NULL,
	CONSTRAINT `task_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`updated_by` char(36) NOT NULL,
	`deleted_at` datetime(3),
	`version` int NOT NULL,
	`title` varchar(255) NOT NULL,
	`due_date` date,
	`assignee_user_id` char(36),
	`status` varchar(16) NOT NULL,
	`priority` varchar(16) NOT NULL,
	`target_type` varchar(16),
	`target_id` char(36),
	`description` text,
	CONSTRAINT `tasks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `task_items` ADD CONSTRAINT `task_items_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tasks` ADD CONSTRAINT `tasks_assignee_user_id_users_id_fk` FOREIGN KEY (`assignee_user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `task_items_task_idx` ON `task_items` (`task_id`);--> statement-breakpoint
CREATE INDEX `tasks_due_idx` ON `tasks` (`due_date`);--> statement-breakpoint
CREATE INDEX `tasks_assignee_idx` ON `tasks` (`assignee_user_id`);--> statement-breakpoint
CREATE INDEX `tasks_target_idx` ON `tasks` (`target_type`,`target_id`);