ALTER TABLE `workspaces` ADD `custom_name` text;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `last_opened_at` integer;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX `workspaces_recent_order` ON `workspaces` (`last_opened_at`);