CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`name` text NOT NULL,
	`workspace_id` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_request_id_unique` ON `projects` (`request_id`);--> statement-breakpoint
CREATE TABLE `session_configurations` (
	`session_id` text PRIMARY KEY NOT NULL,
	`creation_request_id` text NOT NULL,
	`project_id` text,
	`workspace_id` text NOT NULL,
	`configuration` text NOT NULL,
	`title` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_configurations_creation_request_id_unique` ON `session_configurations` (`creation_request_id`);--> statement-breakpoint
CREATE TABLE `session_submissions` (
	`request_id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`message_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`digest` text NOT NULL,
	`text` text,
	`status` text NOT NULL,
	`retry_of` text,
	`error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_submissions_message_id_unique` ON `session_submissions` (`message_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_submissions_turn_id_unique` ON `session_submissions` (`turn_id`);