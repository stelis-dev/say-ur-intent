import { EXTERNAL_ACTIVITY_SCAN_MAX_LIMIT } from "./activityStore.js";
import { DB_USER_VERSION } from "./schemaVersion.js";
import { ActivityStoreError, type SqliteDatabase } from "./sqliteActivityStoreTypes.js";

const EXTERNAL_ACTIVITY_SCAN_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_external_activity_scans_account_fetched
  ON external_activity_scans(account_id, fetched_at)`;

export function configureDatabase(db: SqliteDatabase): void {
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA synchronous=NORMAL");
  db.exec("PRAGMA foreign_keys=ON");
  // Multiple client processes share this database; wait instead of failing with
  // SQLITE_BUSY when another process holds the write lock.
  db.exec("PRAGMA busy_timeout=5000");
}

export function initializeDatabase(db: SqliteDatabase): void {
  const currentUserVersion = db.pragma("user_version", { simple: true }) as number;
  if (currentUserVersion > DB_USER_VERSION) {
    throw new ActivityStoreError(
      `Local activity database version ${currentUserVersion} is newer than this runtime supports (${DB_USER_VERSION}).`
    );
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sui_address TEXT NOT NULL UNIQUE,
      first_seen_at TEXT NOT NULL,
      last_used_at TEXT NOT NULL,
      first_source TEXT NOT NULL CHECK (first_source IN ('wallet_identity', 'review_execution')),
      last_source TEXT NOT NULL CHECK (last_source IN ('wallet_identity', 'review_execution'))
    );

    CREATE TABLE IF NOT EXISTS active_account_context (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
      source TEXT NOT NULL CHECK (source IN ('wallet_identity', 'cleared')),
      set_at TEXT NOT NULL,
      wallet_name TEXT,
      wallet_id TEXT,
      CHECK (
        (source = 'cleared' AND account_id IS NULL)
        OR (source = 'wallet_identity' AND account_id IS NOT NULL)
      )
    );

    CREATE TABLE IF NOT EXISTS review_sessions (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      action_kind TEXT NOT NULL,
      adapter_id TEXT NOT NULL,
      protocol TEXT NOT NULL,
      account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
      current_status TEXT NOT NULL,
      plan_json TEXT NOT NULL,
      intent_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_review_sessions_account_created
      ON review_sessions(account_id, created_at);

    CREATE INDEX IF NOT EXISTS idx_review_sessions_status_account
      ON review_sessions(current_status, account_id, created_at);

    CREATE TABLE IF NOT EXISTS review_state_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      review_session_id TEXT NOT NULL REFERENCES review_sessions(id) ON DELETE RESTRICT,
      plan_id TEXT NOT NULL,
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
      status TEXT NOT NULL CHECK (status IN ('ready_for_wallet_review', 'refresh_required', 'blocked')),
      blocked_reason TEXT,
      refresh_reason TEXT,
      state_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      CHECK (
        (status = 'blocked' AND blocked_reason IS NOT NULL AND refresh_reason IS NULL)
        OR (status = 'refresh_required' AND refresh_reason IS NOT NULL AND blocked_reason IS NULL)
        OR (status = 'ready_for_wallet_review' AND blocked_reason IS NULL AND refresh_reason IS NULL)
      )
    );

    CREATE INDEX IF NOT EXISTS idx_review_state_snapshots_session_recorded
      ON review_state_snapshots(review_session_id, recorded_at);

    CREATE TABLE IF NOT EXISTS review_status_transitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      review_session_id TEXT NOT NULL REFERENCES review_sessions(id) ON DELETE RESTRICT,
      event TEXT NOT NULL CHECK (
        event IN ('created', 'opened', 'wallet_connected', 'state_computed', 'result_recorded', 'expired')
      ),
      from_status TEXT,
      to_status TEXT NOT NULL,
      account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
      reason TEXT,
      transitioned_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_review_transitions_session_time
      ON review_status_transitions(review_session_id, transitioned_at);

    CREATE TABLE IF NOT EXISTS review_executions (
      review_session_id TEXT PRIMARY KEY REFERENCES review_sessions(id) ON DELETE RESTRICT,
      plan_id TEXT NOT NULL,
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
      status TEXT NOT NULL CHECK (status IN ('signed_pending_result', 'success', 'failure')),
      tx_digest TEXT,
      explorer_url TEXT,
      failure_reason TEXT,
      result_json TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (
        (status = 'failure' AND failure_reason IS NOT NULL)
        OR (status != 'failure' AND failure_reason IS NULL)
      )
    );

    CREATE INDEX IF NOT EXISTS idx_review_executions_account_updated
      ON review_executions(account_id, updated_at);

    CREATE INDEX IF NOT EXISTS idx_review_executions_digest
      ON review_executions(tx_digest);

    ${externalActivityScansTableSql("external_activity_scans", { ifNotExists: true })};

    ${EXTERNAL_ACTIVITY_SCAN_INDEX_SQL};

    CREATE TABLE IF NOT EXISTS external_activity_transactions (
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
      digest TEXT NOT NULL,
      relationship TEXT NOT NULL CHECK (relationship IN ('affected', 'sent')),
      checkpoint TEXT,
      timestamp TEXT,
      status TEXT NOT NULL CHECK (status IN ('success', 'failure', 'unknown')),
      known_sender_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
      first_scan_id TEXT NOT NULL REFERENCES external_activity_scans(scan_id) ON DELETE RESTRICT,
      last_scan_id TEXT NOT NULL REFERENCES external_activity_scans(scan_id) ON DELETE RESTRICT,
      first_fetched_at TEXT NOT NULL,
      last_fetched_at TEXT NOT NULL,
      detail_json TEXT,
      PRIMARY KEY (account_id, digest, relationship)
    );

    CREATE INDEX IF NOT EXISTS idx_external_activity_transactions_account_time
      ON external_activity_transactions(account_id, timestamp);

    CREATE INDEX IF NOT EXISTS idx_external_activity_transactions_digest
      ON external_activity_transactions(digest);

    CREATE TABLE IF NOT EXISTS local_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS coin_metadata_cache (
      coin_type TEXT NOT NULL,
      chain_identifier TEXT NOT NULL,
      decimals INTEGER NOT NULL CHECK (decimals >= 0 AND decimals <= 255),
      symbol TEXT NOT NULL,
      name TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      PRIMARY KEY (coin_type, chain_identifier)
    );

  `);

  // Live multi-client state (Option B): runtime session state lives in the shared
  // database so any review-server process can serve any session. Added WITHOUT a
  // DB_USER_VERSION bump — older runtimes ignore unknown tables, so a newer client can
  // introduce them without breaking a concurrently-running older client.
  db.exec(`
    CREATE TABLE IF NOT EXISTS live_transaction_materials (
      material_id TEXT PRIMARY KEY,
      review_session_id TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      account TEXT NOT NULL,
      kind TEXT NOT NULL,
      source TEXT NOT NULL,
      transaction_bytes BLOB NOT NULL,
      redacted_diagnostics_json TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_live_transaction_materials_session
      ON live_transaction_materials(review_session_id);
  `);
  migrateDatabase(db, currentUserVersion);
  if ((db.pragma("user_version", { simple: true }) as number) !== DB_USER_VERSION) {
    db.pragma(`user_version = ${DB_USER_VERSION}`);
  }
}

function migrateDatabase(db: SqliteDatabase, currentUserVersion: number): void {
  if (currentUserVersion < 3 && !tableHasColumn(db, "external_activity_transactions", "detail_json")) {
    db.exec("ALTER TABLE external_activity_transactions ADD COLUMN detail_json TEXT");
  }
  if (currentUserVersion > 0 && currentUserVersion < 4 && tableExists(db, "external_activity_scans")) {
    rebuildExternalActivityScansForFunctionScan(db);
  }
  if (currentUserVersion > 0 && currentUserVersion < 5 && tableExists(db, "active_account_context")) {
    if (!tableHasColumn(db, "active_account_context", "wallet_name")) {
      db.exec("ALTER TABLE active_account_context ADD COLUMN wallet_name TEXT");
    }
    if (!tableHasColumn(db, "active_account_context", "wallet_id")) {
      db.exec("ALTER TABLE active_account_context ADD COLUMN wallet_id TEXT");
    }
  }
}

function tableHasColumn(db: SqliteDatabase, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

function tableExists(db: SqliteDatabase, table: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { name: string } | undefined;
  return row !== undefined;
}

function rebuildExternalActivityScansForFunctionScan(db: SqliteDatabase): void {
  const previousForeignKeys = db.pragma("foreign_keys", { simple: true }) as number;
  const rebuild = db.transaction(() => {
    db.exec(`
      DROP TABLE IF EXISTS external_activity_scans_new;

      ${externalActivityScansTableSql("external_activity_scans_new", { ifNotExists: false })};

      INSERT INTO external_activity_scans_new
        (scan_id, kind, account_id, relationship, input_digest, from_checkpoint, to_checkpoint,
         from_timestamp, to_timestamp, limit_count, request_cursor, response_cursor, endpoint_host,
         chain_identifier, fetched_at, stored_count, skipped_count, has_more, window_complete,
         incomplete_reason)
      SELECT
        scan_id, kind, account_id, relationship, input_digest, from_checkpoint, to_checkpoint,
        from_timestamp, to_timestamp, limit_count, request_cursor, response_cursor, endpoint_host,
        chain_identifier, fetched_at, stored_count, skipped_count, has_more, window_complete,
        incomplete_reason
      FROM external_activity_scans;

      DROP TABLE external_activity_scans;
      ALTER TABLE external_activity_scans_new RENAME TO external_activity_scans;
      ${EXTERNAL_ACTIVITY_SCAN_INDEX_SQL};
    `);
    const foreignKeyFailures = db.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeyFailures.length > 0) {
      throw new ActivityStoreError("Local activity database migration failed foreign key check");
    }
    db.pragma(`user_version = ${DB_USER_VERSION}`);
  });

  db.pragma("foreign_keys = OFF");
  try {
    rebuild();
  } finally {
    db.pragma(`foreign_keys = ${previousForeignKeys === 0 ? "OFF" : "ON"}`);
  }
}

function externalActivityScansTableSql(
  tableName: "external_activity_scans" | "external_activity_scans_new",
  options: { ifNotExists: boolean }
): string {
  return `CREATE TABLE ${options.ifNotExists ? "IF NOT EXISTS " : ""}${tableName} (
    scan_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('digest_lookup', 'account_scan', 'function_scan')),
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    relationship TEXT NOT NULL CHECK (relationship IN ('affected', 'sent')),
    input_digest TEXT,
    from_checkpoint TEXT,
    to_checkpoint TEXT,
    from_timestamp TEXT,
    to_timestamp TEXT,
    limit_count INTEGER NOT NULL CHECK (limit_count >= 1 AND limit_count <= ${EXTERNAL_ACTIVITY_SCAN_MAX_LIMIT}),
    request_cursor TEXT,
    response_cursor TEXT,
    endpoint_host TEXT NOT NULL,
    chain_identifier TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    stored_count INTEGER NOT NULL CHECK (stored_count >= 0),
    skipped_count INTEGER NOT NULL CHECK (skipped_count >= 0),
    has_more INTEGER NOT NULL CHECK (has_more IN (0, 1)),
    window_complete INTEGER CHECK (window_complete IN (0, 1)),
    incomplete_reason TEXT CHECK (
      incomplete_reason IS NULL
      OR incomplete_reason IN ('limit_reached', 'ordering_unverified', 'cursor_invalid', 'provider_error')
    )
  )`;
}
