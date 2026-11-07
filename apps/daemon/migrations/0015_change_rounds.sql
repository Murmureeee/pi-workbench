CREATE TABLE `change_rounds` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `turn_id` text NOT NULL UNIQUE,
  `session_id` text NOT NULL,
  `directory_key` text NOT NULL,
  `cwd` text NOT NULL,
  `outcome` text NOT NULL,
  `data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `change_rounds_session` ON `change_rounds` (`session_id`, `id`);
