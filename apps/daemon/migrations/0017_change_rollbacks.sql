CREATE TABLE `change_rollbacks` (
  `sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `id` text NOT NULL UNIQUE,
  `session_id` text NOT NULL,
  `turn_id` text NOT NULL,
  `directory_key` text NOT NULL,
  `cwd` text NOT NULL,
  `state` text NOT NULL,
  `data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `change_rollbacks_owner` ON `change_rollbacks` (`session_id`, `sequence`);
