ALTER TABLE `session_configurations` ADD `membership_version` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
CREATE TABLE `session_origins` (
  `session_id` text PRIMARY KEY NOT NULL REFERENCES `sessions`(`id`),
  `kind` text NOT NULL,
  `cwd` text NOT NULL,
  `workspace_id` text NOT NULL,
  `project_id` text,
  `recorded_at` integer NOT NULL,
  `provenance` text NOT NULL
);
--> statement-breakpoint
-- Existing organization may already have changed. Label this as migration observation,
-- never claim it is the original project or reconstruct provenance from directory names.
INSERT INTO `session_origins`
  (`session_id`, `kind`, `cwd`, `workspace_id`, `project_id`, `recorded_at`, `provenance`)
SELECT c.session_id,
  CASE WHEN json_extract(c.configuration, '$.workspaceId') IS NULL THEN 'standalone' ELSE 'workspace' END,
  s.cwd, c.workspace_id, c.project_id, CAST(unixepoch('subsec') * 1000 AS integer), 'legacy-observed'
FROM session_configurations c JOIN sessions s ON s.id = c.session_id;
