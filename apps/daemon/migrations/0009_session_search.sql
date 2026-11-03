CREATE TABLE IF NOT EXISTS `session_search_documents` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL REFERENCES `sessions`(`id`) ON DELETE CASCADE,
  `message_id` text NOT NULL,
  `role` text NOT NULL,
  `position` integer NOT NULL,
  `body` text NOT NULL,
  `folded` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `session_search_owner` ON `session_search_documents` (`session_id`);
