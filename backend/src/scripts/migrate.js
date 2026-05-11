import 'dotenv/config';
import pino from 'pino';
import { createPool, runMigrations } from '../db.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const pool = createPool();
try {
  await runMigrations(pool, logger);
  logger.info('migrations applied');
} catch (err) {
  logger.error({ err }, 'migration failed');
  process.exit(1);
} finally {
  await pool.end();
}
