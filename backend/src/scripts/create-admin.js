import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import argon2 from 'argon2';
import pino from 'pino';
import { createPool, runMigrations } from '../db.js';

const logger = pino({ level: 'info' });
const pool = createPool();
await runMigrations(pool, logger);

async function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await rl.question(question)).trim(); } finally { rl.close(); }
}

// Support both interactive (TTY) and non-interactive (env or piped stdin)
let email = process.env.ADMIN_EMAIL;
let password = process.env.ADMIN_PASSWORD;

if (!email || !password) {
  if (process.stdin.isTTY) {
    email = email || (await prompt('Admin Email: ')).toLowerCase();
    password = password || await prompt('Admin Passwort (min. 12 Zeichen): ');
  } else {
    // Read piped stdin lines
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    const lines = Buffer.concat(chunks).toString('utf8').split('\n');
    email = email || (lines[0] || '').trim().toLowerCase();
    password = password || (lines[1] || '').trim();
  }
}

if (!email || !email.includes('@') || !password || password.length < 12) {
  console.error('Ungültige Eingabe. Email muss gültig sein, Passwort mind. 12 Zeichen.');
  process.exit(1);
}

const hash = await argon2.hash(password, {
  type: argon2.argon2id,
  memoryCost: 64 * 1024,
  timeCost: 3,
  parallelism: 4,
});

await pool.query(
  `insert into admins (email, password_hash, must_change_password)
   values ($1, $2, false)
   on conflict (email) do update set password_hash = excluded.password_hash, must_change_password = false`,
  [email, hash]
);

console.log(`Admin ${email} angelegt/aktualisiert. 2FA-Setup folgt beim ersten Login.`);
await pool.end();
