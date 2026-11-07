CREATE TABLE `change_tool_observations` (
 `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
 `request_id` text NOT NULL UNIQUE,
 `turn_id` text NOT NULL,
 `data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `change_tool_observations_turn` ON `change_tool_observations` (`turn_id`, `id`);
