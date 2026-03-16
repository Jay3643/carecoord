// fix-schema-final.js
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'server', 'database.js');
let db = fs.readFileSync(dbPath, 'utf8');

// Add routing_aliases to regions
db = db.replace(
  "regions (id TEXT PRIMARY KEY, name TEXT, description TEXT, is_active INTEGER DEFAULT 1)",
  "regions (id TEXT PRIMARY KEY, name TEXT, description TEXT, routing_aliases TEXT, is_active INTEGER DEFAULT 1)"
);

// The seed calls db.prepare() directly on what initDb() returns (the raw db)
// But seed also imports closeDb which doesn't exist — fix the exports
// and make initDb return a compatible wrapper

// The seed does: const db = await initDb(); then db.exec(...) and db.prepare(...)
// So initDb needs to return an object with exec, prepare that work like better-sqlite3

db = db.replace(
  "module.exports = { initDb, getDb, saveDb };",
  `// closeDb for seed compatibility
function closeDb() { saveDb(); }

module.exports = { initDb, getDb, saveDb, closeDb };`
);

// Make initDb return an object that seed can use directly
// Currently initDb returns rawDb, but seed needs .prepare().run() to work like better-sqlite3
db = db.replace(
  "  saveDb();\n  return rawDb;\n}",
  `  saveDb();

  // Return a wrapper compatible with seed.js
  return {
    exec: (sql) => rawDb.exec(sql),
    prepare: (sql) => ({
      run: (...params) => {
        rawDb.run(sql, params);
        saveDb();
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
}`
);

fs.writeFileSync(dbPath, db, 'utf8');
console.log('✓ Added routing_aliases column');
console.log('✓ Made initDb() return seed-compatible wrapper');
console.log('✓ Added closeDb export');
console.log('\nNow: del server\\carecoord.db && npm run seed');
