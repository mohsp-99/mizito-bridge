-- Simple relational schema for crawled Mizito data.
-- One SQLite file holds many workspaces; every row carries workspace_id so a
-- workspace can be reloaded independently (delete-by-workspace, then re-insert).

CREATE TABLE IF NOT EXISTS workspace (
  id            TEXT PRIMARY KEY,
  name          TEXT,
  crawled_at    TEXT,
  plan_used     INTEGER,
  plan_volume   INTEGER,
  remain_days   INTEGER,
  member_count  INTEGER,
  project_count INTEGER,
  task_count    INTEGER,
  message_count INTEGER
);

-- A user can belong to multiple workspaces with the same id, so the key is
-- composite (the same person appears once per workspace they're in).
CREATE TABLE IF NOT EXISTS member (
  id           TEXT,
  workspace_id TEXT,
  first_name   TEXT,
  last_name    TEXT,
  email        TEXT,
  role         INTEGER,
  deleted      INTEGER,
  invited      INTEGER,
  PRIMARY KEY (workspace_id, id)
);

CREATE TABLE IF NOT EXISTS project (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT,
  title        TEXT,
  is_advanced  INTEGER,
  archived     INTEGER,
  owner        TEXT,
  dialog       TEXT
);

CREATE TABLE IF NOT EXISTS board (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT,
  project_id   TEXT,
  title        TEXT,
  color        TEXT
);

CREATE TABLE IF NOT EXISTS label (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT,
  title        TEXT,
  color        TEXT,
  type         TEXT,
  deleted      INTEGER
);

CREATE TABLE IF NOT EXISTS task (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT,
  project_id      TEXT,
  board_id        TEXT,
  title           TEXT,
  notes           TEXT,
  owner           TEXT,
  progress        INTEGER,
  completed       INTEGER,
  completed_at    TEXT,
  created_at      TEXT,
  modified_at     TEXT,
  has_deadline    INTEGER,
  deadline        TEXT,
  dialog          TEXT,
  dialog_message  TEXT,
  has_comments    INTEGER,
  last_comment    TEXT,
  last_comment_by TEXT,
  last_comment_at TEXT,
  raw             TEXT
);

CREATE TABLE IF NOT EXISTS task_assignee (
  workspace_id TEXT,
  task_id      TEXT,
  user_id      TEXT
);

CREATE TABLE IF NOT EXISTS task_label (
  workspace_id TEXT,
  task_id      TEXT,
  label_id     TEXT
);

-- Full comment threads per task (from tasks/getComments). last_comment on the
-- task table is the latest; this holds the whole thread.
CREATE TABLE IF NOT EXISTS comment (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT,
  task_id       TEXT,
  author        TEXT,
  body          TEXT,
  created_at    TEXT,
  replied_to    TEXT,
  edited        INTEGER,
  deleted       INTEGER,
  attachments   INTEGER
);

CREATE TABLE IF NOT EXISTS dialog (
  id                 TEXT PRIMARY KEY,
  workspace_id       TEXT,
  title              TEXT,
  kind               TEXT,
  is_project_group   INTEGER,
  project_id         TEXT,
  message_count      INTEGER,
  task_message_count INTEGER
);

CREATE TABLE IF NOT EXISTS message (
  id           TEXT,
  workspace_id TEXT,
  dialog_id    TEXT,
  from_user    TEXT,
  date         TEXT,
  type         TEXT,
  text         TEXT,
  task_id      TEXT,
  PRIMARY KEY (dialog_id, id)
);

CREATE TABLE IF NOT EXISTS file (
  id            TEXT,
  workspace_id  TEXT,
  name          TEXT,
  size          INTEGER,
  content_token TEXT,
  content_key   TEXT,
  source_type   TEXT,   -- task | comment | message
  source_id     TEXT,
  dialog_id     TEXT,
  task_id       TEXT,
  local_path    TEXT,   -- relative path under data/<workspace>/ once downloaded
  downloaded    INTEGER -- 1 if present on disk (status ok/cached)
);

CREATE INDEX IF NOT EXISTS idx_member_ws  ON member(workspace_id);
CREATE INDEX IF NOT EXISTS idx_project_ws ON project(workspace_id);
CREATE INDEX IF NOT EXISTS idx_task_ws    ON task(workspace_id);
CREATE INDEX IF NOT EXISTS idx_task_proj  ON task(project_id);
CREATE INDEX IF NOT EXISTS idx_task_board ON task(board_id);
CREATE INDEX IF NOT EXISTS idx_msg_dialog ON message(dialog_id);
CREATE INDEX IF NOT EXISTS idx_msg_task   ON message(task_id);
CREATE INDEX IF NOT EXISTS idx_file_ws    ON file(workspace_id);
CREATE INDEX IF NOT EXISTS idx_comment_task ON comment(task_id);
