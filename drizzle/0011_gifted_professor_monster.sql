CREATE TABLE `attachments` (
	`id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`updated_by` char(36) NOT NULL,
	`deleted_at` datetime(3),
	`version` int NOT NULL,
	`target_type` varchar(16) NOT NULL,
	`target_id` char(36) NOT NULL,
	`purpose` varchar(32) NOT NULL,
	`key_version` int NOT NULL,
	`meta_enc` text NOT NULL,
	`size_bytes` int NOT NULL,
	`storage_key` char(32) NOT NULL,
	CONSTRAINT `attachments_id` PRIMARY KEY(`id`),
	CONSTRAINT `attachments_storage_key_uq` UNIQUE(`storage_key`)
);
--> statement-breakpoint
ALTER TABLE `attachments` ADD CONSTRAINT `attachments_key_version_org_keys_version_fk` FOREIGN KEY (`key_version`) REFERENCES `org_keys`(`version`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `attachments_target_idx` ON `attachments` (`target_type`,`target_id`);