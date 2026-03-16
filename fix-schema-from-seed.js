// fix-schema-from-seed.js
// Reads seed.js, extracts ALL INSERT statements with columns, rebuilds database.js schema

const fs = require('fs');
const path = require('path');

const seed = fs.readFileSync(path.join(__dirname, 'server', 'seed.js'), 'utf8');

// Find all INSERT INTO xxx (col1, col2, ...) patterns
const insertPattern = /INSERT INTO (\w+)\s*\(([^)]+)\)/g;
const tableColumns = {};

let match;
while ((match = insertPattern.exec(seed)) !== null) {
  const table = match[1];
  const cols = match[2].split(',').map(c => c.trim());
  if (!tableColumns[table]) tableColumns[table] = new Set();
  cols.forEach(c => tableColumns[table].add(c));
}

// Also find DELETE FROM references
const deletePattern = /DELETE FROM (\w+)/g;
while ((match = deletePattern.exec(seed)) !== null) {
  if (!tableColumns[match[1]]) tableColumns[match[1]] = new Set();
}

console.log('Tables and columns found in seed.js:');
for (const [table, cols] of Object.entries(tableColumns)) {
  console.log('  ' + table + ': ' + [...cols].join(', '));
}

// Build CREATE TABLE statements
function colType(table, col) {
  if (col === 'id') return 'TEXT PRIMARY KEY';
  if (col.endsWith('_id')) return 'TEXT';
  if (col.endsWith('_at')) return 'INTEGER';
  if (col === 'is_active' || col === 'totp_enabled' || col === 'requires_comment') return 'INTEGER DEFAULT 0';
  if (col === 'size' || col === 'response_minutes' || col === 'resolve_minutes' || col === 'expiry_date') return 'INTEGER';
  return 'TEXT';
}

const createStatements = [];
for (const [table, cols] of Object.entries(tableColumns)) {
  const colDefs = [...cols].map(c => c + ' ' + colType(table, c)).join(', ');
  createStatements.push("  rawDb.run('CREATE TABLE IF NOT EXISTS " + table + " (" + colDefs + ")');");
}

// Also add tables needed by the app but not in seed
const extraTables = [
  "  rawDb.run('CREATE TABLE IF NOT EXISTS gmail_tokens (id TEXT PRIMARY KEY, user_id TEXT, access_token TEXT, refresh_token TEXT, expiry_date INTEGER, email TEXT)');",
  "  rawDb.run('CREATE TABLE IF NOT EXISTS email_filters (id TEXT PRIMARY KEY, domain TEXT, sender TEXT, subject_contains TEXT, action TEXT, created_by TEXT, created_at INTEGER)');",
  "  rawDb.run('CREATE TABLE IF NOT EXISTS email_sync_state (user_id TEXT PRIMARY KEY, last_history_id TEXT, last_sync_at INTEGER)');",
];

// Rebuild database.js
const dbContent = `const initSqlJs = require('sql.js');
const fs = require('fs');
const pathMod = require('path');

const DB_PATH = pathMod.join(__dirname, 'carecoord.db');

let rawDb = null;

async function initDb() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    rawDb = new SQL.Database(fileBuffer);
    console.log('[DB] Loaded existing database from disk (' + fileBuffer.length + ' bytes)');
  } else {
    rawDb = new SQL.Database();
    console.log('[DB] Created new empty database');
  }

  // Create all tables
${createStatements.join('\n')}

  // App-only tables
${extraTables.join('\n')}

  saveDb();

  // Return wrapper compatible with seed.js (db.exec, db.prepare().run/all/get)
  return {
    exec: (sql) => rawDb.exec(sql),
    prepare: (sql) => ({
      run: (...params) => {
        rawDb.run(sql, params);
        return { changes: rawDb.getRowsModified() };
      },
      all: (...params) => {
        const stmt = rawDb.prepare(sql);
        if (params.length) stmt.bind(params);
        const results = [];
        while (stmt.step()) results.push(stmt.getAsObject());
        stmt.free();
        return results;
      },
      get: (...params) => {
        const stmt = rawDb.prepare(sql);
        if (params.length) stmt.bind(params);
        const result = stmt.step() ? stmt.getAsObject() : undefined;
        stmt.free();
        return result;
      },
    }),
  };
}

function getDb() {
  if (!rawDb) throw new Error('Database not initialized. Call initDb() first.');

  return {
    prepare: (sql) => ({
      all: (...params) => {
        try {
          const stmt = rawDb.prepare(sql);
          if (params.length) stmt.bind(params);
          const results = [];
          while (stmt.step()) results.push(stmt.getAsObject());
          stmt.free();
          return results;
        } catch (e) {
          if (e.message && e.message.includes('no such table')) return [];
          throw e;
        }
      },
      get: (...params) => {
        try {
          const stmt = rawDb.prepare(sql);
          if (params.length) stmt.bind(params);
          const result = stmt.step() ? stmt.getAsObject() : undefined;
          stmt.free();
          return result;
        } catch (e) {
          if (e.message && e.message.includes('no such table')) return undefined;
          throw e;
        }
      },
      run: (...params) => {
        try {
          rawDb.run(sql, params);
          return { changes: rawDb.getRowsModified() };
        } catch (e) {
          if (e.message && e.message.includes('no such table')) return { changes: 0 };
          throw e;
        }
      },
    }),
    exec: (sql) => rawDb.exec(sql),
    run: (sql, params) => rawDb.run(sql, params || []),
  };
}

function saveDb() {
  if (!rawDb) return;
  try {
    const data = rawDb.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  } catch (e) {
    console.error('[DB] Save error:', e.message);
  }
}

function closeDb() { saveDb(); }

module.exports = { initDb, getDb, saveDb, closeDb };
`;

fs.writeFileSync(path.join(__dirname, 'server', 'database.js'), dbContent, 'utf8');
console.log('\n✓ database.js rebuilt with ALL tables from seed.js');
console.log('Now: del server\\carecoord.db && npm run seed');
