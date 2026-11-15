CREATE TABLE `erased_contacts` (
	`contact_id` char(36) NOT NULL,
	`erased_at` datetime(3) NOT NULL,
	`cleared_activity_ids` json NOT NULL,
	`cleared_task_ids` json NOT NULL,
	CONSTRAINT `erased_contacts_contact_id` PRIMARY KEY(`contact_id`)
);
