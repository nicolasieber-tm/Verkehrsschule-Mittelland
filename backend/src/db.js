import pg from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { Pool } = pg;

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createPool() {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
  });
}

export async function runMigrations(pool, logger) {
  await pool.query(`
    create table if not exists _migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `);
  const dir = join(__dirname, 'migrations');
  const files = (await readdir(dir)).filter(f => f.endsWith('.sql')).sort();
  for (const file of files) {
    const { rows } = await pool.query('select 1 from _migrations where name=$1', [file]);
    if (rows.length) continue;
    const sql = await readFile(join(dir, file), 'utf8');
    logger.info({ migration: file }, 'applying migration');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into _migrations(name) values($1)', [file]);
      await client.query('commit');
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }
}
