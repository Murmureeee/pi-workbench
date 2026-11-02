CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`directory_key` text NOT NULL,
	`canonical_path` text NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_directory_key_unique` ON `workspaces` (`directory_key`);