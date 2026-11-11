// Общий стенд: воркер + SQLite вместо D1 + поддельный Телеграм.
import { DatabaseSync } from 'node:sqlite';
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import { build } from '../app/build.mjs';

// bot5.mjs собирается заново из app/worker.src.js + app/app.html при каждом запуске,
// поэтому тесты всегда проверяют свежий код (не нужно сначала запускать build).
fs.writeFileSync(new URL('./bot5.mjs', import.meta.url), build());
const worker = (await import('./bot5.mjs')).default;

// Общий счёт проверок: любой FAIL → код выхода 1 (его видит run-all и npm test).
let fails = 0;
export function expect(cond, label) {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}`);
  if (!cond) { fails++; process.exitCode = 1; }
}
export function done() {
  console.log(`\n${fails ? fails + ' FAILED' : 'ALL PASSED'}`);
}

export const db = new DatabaseSync(':memory:');
function stmt(sql, args = []) {
  return {
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
    _exec: () => db.prepare(sql).run(...args),
  };
}
const DB = { prepare: (sql) => stmt(sql), batch: async (list) => { db.exec('BEGIN'); try { for (const s of list) s._exec(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } return []; } };
export const TOKEN = '123:TESTTOKEN';
export const env = { DB, BOT_TOKEN: TOKEN };
export const sent = [];
let msgId = 1000;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (typeof url === 'string' && url.startsWith('https://api.telegram.org/')) {
    const method = url.split('/').pop();
    const body = JSON.parse(opts.body);
    sent.push({ method, body });
    if (method === 'getMe') return { json: async () => ({ ok: true, result: { username: 'Slot_Mate_Bot' } }) };
    return { json: async () => ({ ok: true, result: { message_id: ++msgId } }) };
  }
  return realFetch(url, opts);
};
export const ORIGIN = 'https://slotmate.test';
export const call = (path, opts = {}) => worker.fetch(new Request(ORIGIN + path, opts), env);
export const scheduled = () => worker.scheduled({}, env, {});
await call('/setup');
export const secret = sent.find((s) => s.method === 'setWebhook').body.secret_token;

export function initData(user) {
  const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify(user), query_id: 'q1' });
  const pairs = [...p].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const sec = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  p.set('hash', createHmac('sha256', sec).update(pairs).digest('hex'));
  return p.toString();
}
export async function api(user, path, body) {
  sent.length = 0;
  const r = await call('/api/' + path, { method: 'POST', headers: { 'x-init-data': initData(user) }, body: JSON.stringify(body || {}) });
  return { status: r.status, j: await r.json(), sent: [...sent] };
}
export async function msg(user, text) {
  sent.length = 0;
  await call('/telegram', { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': secret }, body: JSON.stringify({ message: { from: user, chat: { id: user.id, type: 'private' }, text } }) });
  return [...sent];
}
export async function cb(user, data, messageId = 5) {
  sent.length = 0;
  await call('/telegram', { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': secret }, body: JSON.stringify({ callback_query: { id: 'q', from: user, data, message: { chat: { id: user.id }, message_id: messageId } } }) });
  return [...sent];
}
export function show(label, calls) {
  console.log(`\n=== ${label}`);
  for (const c of calls) {
    if (c.method === 'answerCallbackQuery') { if (c.body.text) console.log(`  [toast] ${c.body.text}`); continue; }
    const kb = c.body.reply_markup?.inline_keyboard?.flat().map((b) => b.text + (b.web_app ? '→app' : '→' + b.callback_data));
    console.log(`  ${c.method} to ${c.body.chat_id}${c.body.message_id ? '#' + c.body.message_id : ''}: ${(c.body.text || '').replace(/\n/g, ' | ').slice(0, 200)}`);
    if (kb && kb.length) console.log(`     buttons: ${kb.join(', ')}`);
  }
}
export const day = (n) => new Date(Date.now() + n * 864e5).toLocaleString('sv-SE', { timeZone: 'Europe/Warsaw' }).slice(0, 10);
