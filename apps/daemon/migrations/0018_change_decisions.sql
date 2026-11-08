CREATE TABLE `change_decisions` (
  `turn_id` text NOT NULL,
  `file_id` text NOT NULL,
  `session_id` text NOT NULL,
  `data` text NOT NULL,
  PRIMARY KEY(`turn_id`, `file_id`)
);
--> statement-breakpoint
CREATE TRIGGER `change_decisions_no_update` BEFORE UPDATE ON `change_decisions`
BEGIN SELECT RAISE(ABORT, 'Review decisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `change_decisions_no_delete` BEFORE DELETE ON `change_decisions`
BEGIN SELECT RAISE(ABORT, 'Review decisions are retained'); END;
