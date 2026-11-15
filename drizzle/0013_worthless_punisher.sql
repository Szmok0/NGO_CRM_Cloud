CREATE TABLE `backups` (
	`id` char(36) NOT NULL,
	`started_at` datetime(3) NOT NULL,
	`finished_at` datetime(3),
	`status` varchar(16) NOT NULL,
	`kind` varchar(8) NOT NULL,
	`started_by` char(36),
	`running_lock` varchar(8),
	`size_bytes` bigint,
	`sha256` char(64),
	`program_version` varchar(32) NOT NULL,
	`migrations` int NOT NULL,
	`downloaded_at` datetime(3),
	`restore_tested_at` datetime(3),
	`restore_test_result` varchar(255),
	CONSTRAINT `backups_id` PRIMARY KEY(`id`),
	CONSTRAINT `backups_running_uq` UNIQUE(`running_lock`)
);
--> statement-breakpoint
CREATE INDEX `backups_started_idx` ON `backups` (`started_at`);