CREATE TABLE `contact_sensitive` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`updated_by` char(36) NOT NULL,
	`deleted_at` datetime(3),
	`version` int NOT NULL,
	`contact_id` char(36) NOT NULL,
	`key_version` int NOT NULL,
	`iv` varchar(24) NOT NULL,
	`ciphertext` mediumtext NOT NULL,
	CONSTRAINT `contact_sensitive_id` PRIMARY KEY(`id`),
	CONSTRAINT `contact_sensitive_contact_uq` UNIQUE(`contact_id`)
);
--> statement-breakpoint
ALTER TABLE `settings` MODIFY COLUMN `sensitive_fields_enabled` boolean NOT NULL DEFAULT false;--> statement-breakpoint
UPDATE `settings` SET `sensitive_fields_enabled` = false;--> statement-breakpoint
ALTER TABLE `contact_sensitive` ADD CONSTRAINT `contact_sensitive_contact_id_contacts_id_fk` FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `contact_sensitive` ADD CONSTRAINT `contact_sensitive_key_version_org_keys_version_fk` FOREIGN KEY (`key_version`) REFERENCES `org_keys`(`version`) ON DELETE no action ON UPDATE no action;