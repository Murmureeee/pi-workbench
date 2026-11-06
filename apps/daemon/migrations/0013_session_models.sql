CREATE TABLE session_model_settings (
  session_id TEXT PRIMARY KEY NOT NULL REFERENCES sessions(id),
  revision INTEGER NOT NULL,
  requested TEXT NOT NULL,
  effective TEXT NOT NULL,
  effective_revision INTEGER NOT NULL
);
