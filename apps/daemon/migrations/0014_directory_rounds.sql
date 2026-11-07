CREATE TABLE `directory_rounds` (
  `turn_id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL,
  `directory_key` text NOT NULL,
  `cwd` text NOT NULL,
  `runtime_pid` integer,
  `state` text NOT NULL,
  `data` text NOT NULL,
  `started_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `directory_rounds_session` ON `directory_rounds` (`session_id`, `started_at`);
