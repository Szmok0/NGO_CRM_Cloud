CREATE TABLE `consents` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`updated_by` char(36) NOT NULL,
	`deleted_at` datetime(3),
	`version` int NOT NULL,
	`contact_id` char(36) NOT NULL,
	`type` varchar(32) NOT NULL,
	`basis` varchar(255),
	`given_at` date NOT NULL,
	`valid_until` date,
	`withdrawn_at` date,
	`note` text,
	CONSTRAINT `consents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `contact_identity` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`updated_by` char(36) NOT NULL,
	`deleted_at` datetime(3),
	`version` int NOT NULL,
	`contact_id` char(36) NOT NULL,
	`first_name` varchar(100),
	`last_name` varchar(100),
	`name` varchar(255),
	`email` varchar(254),
	`phone` varchar(50),
	`address` varchar(255),
	`city` varchar(100),
	`notes` text,
	CONSTRAINT `contact_identity_id` PRIMARY KEY(`id`),
	CONSTRAINT `contact_identity_contact_uq` UNIQUE(`contact_id`)
);
--> statement-breakpoint
CREATE TABLE `contact_roles` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`updated_by` char(36) NOT NULL,
	`deleted_at` datetime(3),
	`version` int NOT NULL,
	`contact_id` char(36) NOT NULL,
	`role` varchar(16) NOT NULL,
	`since` date,
	`until` date,
	`note` text,
	CONSTRAINT `contact_roles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`updated_by` char(36) NOT NULL,
	`deleted_at` datetime(3),
	`version` int NOT NULL,
	`kind` varchar(16) NOT NULL,
	`tags` json NOT NULL,
	`anonymized_at` datetime(3),
	CONSTRAINT `contacts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `relationships` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`updated_by` char(36) NOT NULL,
	`deleted_at` datetime(3),
	`version` int NOT NULL,
	`contact_a_id` char(36) NOT NULL,
	`contact_b_id` char(36) NOT NULL,
	`type` varchar(32) NOT NULL,
	`note` text,
	CONSTRAINT `relationships_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `consents` ADD CONSTRAINT `consents_contact_id_contacts_id_fk` FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `contact_identity` ADD CONSTRAINT `contact_identity_contact_id_contacts_id_fk` FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `contact_roles` ADD CONSTRAINT `contact_roles_contact_id_contacts_id_fk` FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `relationships` ADD CONSTRAINT `relationships_contact_a_id_contacts_id_fk` FOREIGN KEY (`contact_a_id`) REFERENCES `contacts`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `relationships` ADD CONSTRAINT `relationships_contact_b_id_contacts_id_fk` FOREIGN KEY (`contact_b_id`) REFERENCES `contacts`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `consents_contact_idx` ON `consents` (`contact_id`);--> statement-breakpoint
CREATE INDEX `contact_roles_contact_idx` ON `contact_roles` (`contact_id`);--> statement-breakpoint
CREATE INDEX `relationships_a_idx` ON `relationships` (`contact_a_id`);--> statement-breakpoint
CREATE INDEX `relationships_b_idx` ON `relationships` (`contact_b_id`);