// One-shot Test: schickt eine Reminder-Mail mit synthetischen Daten.
// Usage: railway run --service backend node scripts/test-reminder.js timo.sieber@trendingmedia.ch
import 'dotenv/config';
import { Resend } from 'resend';
import ejs from 'ejs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAILS = join(__dirname, '..', 'src', 'mails');

const to = process.argv[2];
if (!to) { console.error('Usage: node test-reminder.js <email>'); process.exit(1); }

const variant = process.argv[3] === 'classic' ? 'classic' : 'elearning';
const ctx = {
  fullName: 'Timo Sieber',
  reg: { course_no: variant === 'classic' ? 'NHK-2026-C01' : 'NHK-2026-E01', price_chf: variant === 'classic' ? 140 : 99 },
  variantLabel: variant === 'classic' ? 'Klassischer Nothelferkurs' : 'eNothelferkurs',
  isElearning: variant === 'elearning',
  startsAtPretty: 'Mi, 20.05.2026, 18:00',
  sessionsText: 'Mi 20.05.2026  18:00 – 22:00\nDo 21.05.2026  18:00 – 22:00',
  roomAddress: 'Verkehrsschule Mittelland\nFrohburgstrasse 1\n4600 Olten',
  hasRoom: true,
};

const html = ejs.render(await readFile(join(MAILS, 'participant-reminder.html.ejs'), 'utf8'), ctx);
const text = ejs.render(await readFile(join(MAILS, 'participant-reminder.txt.ejs'), 'utf8'), ctx);

const resend = new Resend(process.env.RESEND_API_KEY);
const from = process.env.MAIL_FROM || 'bestaetigung@verkehrsschule-mittelland.ch';
const resp = await resend.emails.send({
  from,
  to,
  subject: `[TEST ${variant}] Erinnerung: Nothelferkurs morgen — ${ctx.reg.course_no}`,
  html, text,
  replyTo: process.env.MAIL_TO_SCHOOL,
});
console.log('From:', from, '→ To:', to);
console.log('Resend response:', resp);
