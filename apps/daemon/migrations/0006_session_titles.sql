ALTER TABLE `session_configurations` ADD `title_source` text DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE `session_configurations` ADD `title_version` integer DEFAULT 1 NOT NULL;