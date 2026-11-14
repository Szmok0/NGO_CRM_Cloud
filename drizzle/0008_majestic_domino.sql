CREATE TABLE `action_participants` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`updated_by` char(36) NOT NULL,
	`deleted_at` datetime(3),
	`version` int NOT NULL,
	`action_id` char(36) NOT NULL,
	`contact_id` char(36) NOT NULL,
	`status` varchar(16) NOT NULL,
	`note` text,
	CONSTRAINT `action_participants_id` PRIMARY KEY(`id`),
	CONSTRAINT `action_participants_pair_uq` UNIQUE(`action_id`,`contact_id`)
);
--> statement-breakpoint
CREATE TABLE `action_sessions` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`updated_by` char(36) NOT NULL,
	`deleted_at` datetime(3),
	`version` int NOT NULL,
	`action_id` char(36) NOT NULL,
	`date` date NOT NULL,
	`start_time` char(5),
	`end_time` char(5),
	`leader_contact_id` char(36),
	`note` text,
	CONSTRAINT `action_sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `actions` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`updated_by` char(36) NOT NULL,
	`deleted_at` datetime(3),
	`version` int NOT NULL,
	`type` varchar(16) NOT NULL,
	`framework` varchar(16) NOT NULL,
	`title` varchar(255) NOT NULL,
	`status` varchar(16) NOT NULL,
	`start_date` date,
	`end_date` date,
	`place` varchar(255),
	`topic_id` char(36),
	`description` text,
	`expected_participants` int,
	CONSTRAINT `actions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `attendance` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`updated_by` char(36) NOT NULL,
	`deleted_at` datetime(3),
	`version` int NOT NULL,
	`session_id` char(36) NOT NULL,
	`contact_id` char(36) NOT NULL,
	`status` varchar(16) NOT NULL,
	CONSTRAINT `attendance_id` PRIMARY KEY(`id`),
	CONSTRAINT `attendance_pair_uq` UNIQUE(`session_id`,`contact_id`)
);
--> statement-breakpoint
CREATE TABLE `topics` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`updated_by` char(36) NOT NULL,
	`deleted_at` datetime(3),
	`version` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`program` text,
	`duration_hours` int,
	CONSTRAINT `topics_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `action_participants` ADD CONSTRAINT `action_participants_action_id_actions_id_fk` FOREIGN KEY (`action_id`) REFERENCES `actions`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `action_participants` ADD CONSTRAINT `action_participants_contact_id_contacts_id_fk` FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `action_sessions` ADD CONSTRAINT `action_sessions_action_id_actions_id_fk` FOREIGN KEY (`action_id`) REFERENCES `actions`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `action_sessions` ADD CONSTRAINT `action_sessions_leader_contact_id_contacts_id_fk` FOREIGN KEY (`leader_contact_id`) REFERENCES `contacts`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `actions` ADD CONSTRAINT `actions_topic_id_topics_id_fk` FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `attendance` ADD CONSTRAINT `attendance_session_id_action_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `action_sessions`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `attendance` ADD CONSTRAINT `attendance_contact_id_contacts_id_fk` FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `action_participants_contact_idx` ON `action_participants` (`contact_id`);--> statement-breakpoint
CREATE INDEX `action_sessions_action_idx` ON `action_sessions` (`action_id`);--> statement-breakpoint
CREATE INDEX `action_sessions_date_idx` ON `action_sessions` (`date`);--> statement-breakpoint
CREATE INDEX `actions_start_idx` ON `actions` (`start_date`);--> statement-breakpoint
CREATE INDEX `actions_topic_idx` ON `actions` (`topic_id`);--> statement-breakpoint
CREATE INDEX `attendance_contact_idx` ON `attendance` (`contact_id`);--> statement-breakpoint
ALTER TABLE `activities` ADD CONSTRAINT `activities_action_id_actions_id_fk` FOREIGN KEY (`action_id`) REFERENCES `actions`(`id`) ON DELETE restrict ON UPDATE no action;