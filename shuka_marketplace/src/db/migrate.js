const fs = require('fs');
const path = require('path');
const { db } = require('./index');

function runMigrations() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);

  const migrationsDir = path.join(__dirname, '../../migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const applied = new Set(
    db.prepare('SELECT filename FROM _migrations').all().map(r => r.filename)
  );

  for (const file of files) {
    if (!applied.has(file)) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      const migrateTx = db.transaction(() => {
        db.exec(sql);
        db.prepare('INSERT INTO _migrations (filename, applied_at) VALUES (?, ?)')
          .run(file, new Date().toISOString());
      });
      migrateTx();
      console.log(`Applied migration: ${file}`);
    }
  }
}

if (require.main === module) {
  runMigrations();
  console.log('All migrations applied successfully.');
}

module.exports = { runMigrations };
