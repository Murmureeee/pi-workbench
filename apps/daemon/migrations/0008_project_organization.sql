ALTER TABLE `projects` ADD `pinned` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `position` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `removed` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `creation_input` text;
--> statement-breakpoint
UPDATE projects SET creation_input = json_object('name', name, 'workspaceId', workspace_id);
--> statement-breakpoint
UPDATE projects SET position = (SELECT COUNT(*) FROM projects AS earlier WHERE earlier.rowid < projects.rowid);
