CREATE TABLE `activities` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`updated_by` char(36) NOT NULL,
	`deleted_at` datetime(3),
	`version` int NOT NULL,
	`type` varchar(16) NOT NULL,
	`channel` varchar(16),
	`form` varchar(255),
	`duration_minutes` int,
	`occurred_at` datetime(3) NOT NULL,
	`content` text NOT NULL,
	`action_id` char(36),
	CONSTRAINT `activities_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `activity_contacts` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`updated_by` char(36) NOT NULL,
	`deleted_at` datetime(3),
	`version` int NOT NULL,
	`activity_id` char(36) NOT NULL,
	`contact_id` char(36) NOT NULL,
	CONSTRAINT `activity_contacts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `activity_contacts` ADD CONSTRAINT `activity_contacts_activity_id_activities_id_fk` FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `activity_contacts` ADD CONSTRAINT `activity_contacts_contact_id_contacts_id_fk` FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `activities_action_idx` ON `activities` (`action_id`);--> statement-breakpoint
CREATE INDEX `activities_occurred_idx` ON `activities` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `activity_contacts_activity_idx` ON `activity_contacts` (`activity_id`);--> statement-breakpoint
CREATE INDEX `activity_contacts_contact_idx` ON `activity_contacts` (`contact_id`);