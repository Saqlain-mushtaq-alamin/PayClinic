/** SQLite DDL from TECH_DESIGN §11. */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, target TEXT NOT NULL, mode TEXT NOT NULL, scenario_keys TEXT NOT NULL,
  status TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT,
  score_before REAL, score_after REAL, error TEXT
);
CREATE TABLE IF NOT EXISTS scenarios (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  key TEXT NOT NULL, status TEXT NOT NULL, started_at TEXT, finished_at TEXT, error TEXT
);
CREATE TABLE IF NOT EXISTS steps (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE, seq INTEGER NOT NULL,
  actor TEXT NOT NULL, label TEXT, method TEXT NOT NULL, url TEXT NOT NULL,
  request_headers TEXT NOT NULL, request_body TEXT, response_status INTEGER NOT NULL,
  response_headers TEXT NOT NULL, response_body TEXT, paypal_debug_id TEXT,
  duration_ms REAL NOT NULL, timestamp TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_steps_scenario ON steps(scenario_id, seq);
CREATE TABLE IF NOT EXISTS invariant_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  key TEXT NOT NULL, passed INTEGER NOT NULL, severity TEXT NOT NULL, message TEXT NOT NULL,
  evidence_step_ids TEXT NOT NULL, details TEXT
);
CREATE TABLE IF NOT EXISTS findings (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  scenario_key TEXT NOT NULL, invariant_key TEXT NOT NULL, severity TEXT NOT NULL, state TEXT NOT NULL,
  title TEXT NOT NULL, summary TEXT NOT NULL, evidence_step_ids TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS explanations (
  finding_id TEXT PRIMARY KEY REFERENCES findings(id) ON DELETE CASCADE,
  root_cause TEXT NOT NULL, impact TEXT NOT NULL, where_in_code TEXT NOT NULL,
  fix_summary TEXT NOT NULL, model TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS patches (
  id TEXT PRIMARY KEY, finding_id TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  edits TEXT NOT NULL, diff TEXT NOT NULL, test_file TEXT, source TEXT NOT NULL,
  model TEXT, rationale TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS verify_results (
  patch_id TEXT PRIMARY KEY REFERENCES patches(id) ON DELETE CASCADE,
  applied INTEGER NOT NULL, started INTEGER NOT NULL, invariant_passed INTEGER NOT NULL,
  tests_passed INTEGER, verified INTEGER NOT NULL, duration_ms REAL NOT NULL,
  log TEXT NOT NULL, rerun_step_ids TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  policy TEXT NOT NULL, yaml TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS firewall_decisions (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  action TEXT NOT NULL, rule_id TEXT, reason TEXT NOT NULL, request TEXT NOT NULL, ts TEXT NOT NULL
);
`;
