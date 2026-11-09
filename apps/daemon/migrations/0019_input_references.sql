CREATE TABLE input_references (
  id TEXT PRIMARY KEY NOT NULL,
  draft_id TEXT NOT NULL,
  data TEXT NOT NULL,
  scope TEXT,
  content BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  session_id TEXT,
  request_id TEXT
);
--> statement-breakpoint
CREATE INDEX input_references_draft ON input_references(draft_id);
