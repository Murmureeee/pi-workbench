CREATE TABLE `operation_audit` (
  `sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `id` text NOT NULL UNIQUE,
  `kind` text NOT NULL,
  `session_id` text,
  `data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `operation_audit_session` ON `operation_audit` (`session_id`, `sequence`);
--> statement-breakpoint
CREATE TRIGGER `operation_audit_no_update` BEFORE UPDATE ON `operation_audit`
BEGIN SELECT RAISE(ABORT, 'audit records are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER `operation_audit_no_delete` BEFORE DELETE ON `operation_audit`
BEGIN SELECT RAISE(ABORT, 'audit originals are retained'); END;
