CREATE TABLE `session_organization` (
	`session_id` text PRIMARY KEY NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`manual_unread` integer DEFAULT false NOT NULL,
	`result_version` integer DEFAULT 0 NOT NULL,
	`read_version` integer DEFAULT 0 NOT NULL,
	`result_request_id` text,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
-- Existing results start read. Only new terminal results after this migration become unread.
INSERT INTO session_organization (session_id, result_version, read_version, result_request_id, updated_at)
SELECT c.session_id,
  (SELECT COUNT(*) FROM session_submissions t WHERE t.session_id = c.session_id AND t.status NOT IN ('pending', 'executing')),
  (SELECT COUNT(*) FROM session_submissions t WHERE t.session_id = c.session_id AND t.status NOT IN ('pending', 'executing')),
  (SELECT t.request_id FROM session_submissions t WHERE t.session_id = c.session_id AND t.status NOT IN ('pending', 'executing') ORDER BY t.created_at DESC, t.request_id DESC LIMIT 1),
  COALESCE((SELECT MAX(t.created_at) FROM session_submissions t WHERE t.session_id = c.session_id), s.created_at)
FROM session_configurations c JOIN sessions s ON s.id = c.session_id;
