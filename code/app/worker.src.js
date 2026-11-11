// SlotMate v6 — мини-приложение в Телеграме + бот для уведомлений.
// Cloudflare Worker + база D1. Нужны: привязка D1 с именем DB и секрет BOT_TOKEN.
// Первый запуск: откройте адрес воркера с /setup на конце. Повторно /setup работает
// только с ключом: добавьте секрет SETUP_KEY и откройте /setup?key=<этот ключ>.
// Напоминания: в настройках воркера добавьте расписание (Cron) "0 * * * *".

const APP_HTML = __APP_HTML__;

const TZ = 'Europe/Warsaw';
const WD = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const WD_PLURAL = ['воскресеньям', 'понедельникам', 'вторникам', 'средам', 'четвергам', 'пятницам', 'субботам'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const SCHEMA_VERSION = 6;
const ACTIVE = "('scheduled', 'pending')";
// Урок списывается, если он прошёл и с ним всё ясно: не висит перенос, ученик не писал «не смогу» без решения учителя.
const USED = "(l.status = 'late' OR (l.status = 'scheduled' AND l.check_needed = 0 AND COALESCE(l.reminder_answer, '') != 'no'))";

// Демо-кабинет учителя для владельца: выдуманный учитель и ученики с отрицательными номерами.
const DEMO_T = -1000;
const DEMO_STUDENTS = [['Ола', 0, '17:00', 4], ['Марек', 1, '18:00', 0], ['Кася', 2, '16:00', 8], ['Томек', 3, '19:00', 4], ['Зося', 5, '11:00', 2], ['Бартек', 5, '12:30', -3]];

let schemaReady = false;
let botUsername = null;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!env.DB) return text('Не подключена база: добавьте привязку D1 с именем DB.');
    if (!env.BOT_TOKEN) return text('Не задан секрет BOT_TOKEN.');
    await ensureSchema(env);

    if (url.pathname === '/setup') return setup(url, env);
    if (url.pathname === '/app' || url.pathname === '/app/') {
      return new Response(APP_HTML, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' } });
    }
    if (url.pathname.startsWith('/api/') && request.method === 'POST') {
      try { return await handleApi(request, env, url); } catch (e) {
        console.error('api failed', url.pathname, (e && e.stack) || e);
        return json({ error: 'Что-то пошло не так. Попробуйте ещё раз.' }, 500);
      }
    }
    if (url.pathname.startsWith('/cal/')) return calendarFeed(url, env);
    if (url.pathname === '/telegram' && request.method === 'POST') {
      const secret = await webhookSecret(env);
      if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== secret) return new Response('forbidden', { status: 403 });
      let update;
      try { update = await request.json(); } catch (e) { return new Response('bad request', { status: 400 }); }
      try { await handleUpdate(update, env, url.origin); } catch (e) { console.error('update failed', (e && e.stack) || e); }
      return new Response('ok');
    }
    return text('SlotMate работает.');
  },

  async scheduled(event, env, ctx) {
    if (!env.DB || !env.BOT_TOKEN) return;
    await ensureSchema(env);
    const origin = env.PUBLIC_URL || (await env.DB.prepare("SELECT v FROM meta WHERE k = 'origin'").first() || {}).v || '';
    await runHourly(env, origin);
  },
};

// ---------- база данных ----------

async function ensureSchema(env) {
  if (schemaReady) return;
  const create = [
    `CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)`,
    `CREATE TABLE IF NOT EXISTS users (
      tg_id INTEGER PRIMARY KEY, name TEXT, username TEXT,
      is_admin INTEGER NOT NULL DEFAULT 0, is_teacher INTEGER NOT NULL DEFAULT 0,
      invite_code TEXT, cal_key TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tg_id INTEGER NOT NULL, teacher_id INTEGER NOT NULL,
      name TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE (tg_id, teacher_id))`,
    `CREATE TABLE IF NOT EXISTS invites (
      code TEXT PRIMARY KEY, kind TEXT NOT NULL, created_by INTEGER, used_by INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT, teacher_id INTEGER NOT NULL, student_id INTEGER NOT NULL,
      starts_at TEXT NOT NULL, duration_min INTEGER NOT NULL DEFAULT 60,
      status TEXT NOT NULL DEFAULT 'scheduled', proposed_start TEXT, proposed_by TEXT,
      reminded INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS busy (
      id INTEGER PRIMARY KEY AUTOINCREMENT, teacher_id INTEGER NOT NULL, day TEXT NOT NULL,
      from_t TEXT NOT NULL, to_t TEXT NOT NULL, note TEXT)`,
    `CREATE TABLE IF NOT EXISTS teacher_settings (teacher_id INTEGER PRIMARY KEY, pack_size INTEGER NOT NULL DEFAULT 4, pack_price INTEGER NOT NULL DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, teacher_id INTEGER NOT NULL, student_id INTEGER NOT NULL,
      lessons INTEGER NOT NULL, amount INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    // Серии «каждую неделю без срока»: продлеваются сами.
    `CREATE TABLE IF NOT EXISTS series_auto (series_id INTEGER PRIMARY KEY, teacher_id INTEGER NOT NULL)`,
    // Ученик нажал «Я оплатил» — ждём, что ответит учитель.
    `CREATE TABLE IF NOT EXISTS pay_claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT, teacher_id INTEGER NOT NULL, student_id INTEGER NOT NULL,
      lessons INTEGER NOT NULL, amount INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'open',
      msg_chat INTEGER, msg_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE INDEX IF NOT EXISTS idx_lessons_teacher ON lessons (teacher_id, starts_at)`,
    `CREATE INDEX IF NOT EXISTS idx_lessons_student ON lessons (student_id, starts_at)`,
    `CREATE INDEX IF NOT EXISTS idx_users_invite ON users (invite_code)`,
    `CREATE INDEX IF NOT EXISTS idx_users_cal ON users (cal_key)`,
    `CREATE INDEX IF NOT EXISTS idx_busy ON busy (teacher_id, day)`,
  ];
  await env.DB.batch(create.map((s) => env.DB.prepare(s)));
  const ver = await env.DB.prepare("SELECT v FROM meta WHERE k = 'schema'").first();
  if (!ver || Number(ver.v) < SCHEMA_VERSION) {
    const alters = [
      'ALTER TABLE lessons ADD COLUMN series_id INTEGER',
      'ALTER TABLE lessons ADD COLUMN proposed_scope TEXT',
      'ALTER TABLE lessons ADD COLUMN proposal_chat INTEGER',
      'ALTER TABLE lessons ADD COLUMN proposal_msg INTEGER',
      'ALTER TABLE lessons ADD COLUMN proposed_at TEXT',
      'ALTER TABLE lessons ADD COLUMN pinged INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE lessons ADD COLUMN reminder_answer TEXT',
      'ALTER TABLE users ADD COLUMN last_summary TEXT',
      'ALTER TABLE teacher_settings ADD COLUMN default_duration INTEGER NOT NULL DEFAULT 60',
      'ALTER TABLE teacher_settings ADD COLUMN late_hours INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE payments ADD COLUMN kind TEXT',
      'ALTER TABLE lessons ADD COLUMN check_needed INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE lessons ADD COLUMN pay_asked INTEGER NOT NULL DEFAULT 0',
    ];
    for (const a of alters) {
      try { await env.DB.prepare(a).run(); } catch (e) { if (!/duplicate column/i.test(String(e && e.message))) console.error('migration failed', a, e && e.message); }
    }
    await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('schema', ?)").bind(String(SCHEMA_VERSION)).run();
  }
  schemaReady = true;
}

async function upsertUser(env, from) {
  const name = [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || 'Без имени';
  await env.DB.prepare(
    `INSERT INTO users (tg_id, name, username) VALUES (?, ?, ?)
     ON CONFLICT(tg_id) DO UPDATE SET name = excluded.name, username = excluded.username`
  ).bind(from.id, name, from.username || null).run();
  const user = await env.DB.prepare('SELECT * FROM users WHERE tg_id = ?').bind(from.id).first();
  const admins = await env.DB.prepare('SELECT COUNT(*) AS c FROM users WHERE is_admin = 1').first();
  if (!admins || !admins.c) {
    await env.DB.prepare('UPDATE users SET is_admin = 1 WHERE tg_id = ?').bind(user.tg_id).run();
    user.is_admin = 1;
  }
  return user;
}

async function isStudentAnywhere(env, tgId) {
  const row = await env.DB.prepare('SELECT 1 AS x FROM students WHERE tg_id = ? LIMIT 1').bind(tgId).first();
  return !!row;
}

const LESSON_SELECT = `SELECT l.*, s.tg_id AS student_tg, su.name AS student_name, tu.name AS teacher_name
  FROM lessons l JOIN students s ON s.id = l.student_id
  JOIN users su ON su.tg_id = s.tg_id JOIN users tu ON tu.tg_id = l.teacher_id`;

async function loadLesson(env, lid) {
  if (!Number.isFinite(lid)) return null;
  return env.DB.prepare(`${LESSON_SELECT} WHERE l.id = ?`).bind(lid).first();
}

function roles(lesson, uid) {
  return { t: lesson.teacher_id === uid, s: lesson.student_tg === uid };
}

async function settingsOf(env, teacherId) {
  const s = await env.DB.prepare('SELECT * FROM teacher_settings WHERE teacher_id = ?').bind(teacherId).first();
  return { pack_size: 4, pack_price: 0, default_duration: 60, late_hours: 0, ...(s || {}) };
}

async function balanceOf(env, studentId) {
  const paid = await env.DB.prepare('SELECT COALESCE(SUM(lessons), 0) AS n FROM payments WHERE student_id = ?').bind(studentId).first();
  const used = await env.DB.prepare(`SELECT COUNT(*) AS n FROM lessons l WHERE l.student_id = ? AND ${USED} AND l.starts_at < ?`).bind(studentId, nowLocal()).first();
  return { paid: Number(paid.n), used: Number(used.n), left: Number(paid.n) - Number(used.n) };
}

// ---------- помощники ----------

// Сколько строк изменил запрос (0 — условие не совпало, например кто-то успел раньше).
function changed(res) { return !!(res && res.meta && res.meta.changes > 0); }
function text(body, status = 200) {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
function lessonsWord(n) { return `${n} ${plural(n, 'урок', 'урока', 'уроков')}`; }
function balanceLine(left) { return left > 0 ? `Осталось: ${lessonsWord(left)}.` : left === 0 ? 'Оплаченных уроков: 0.' : `Долг: ${lessonsWord(-left)}.`; }
// Номер серии: время + случайная добавка, чтобы у двух учителей не совпало.
function newSeriesId() { return Date.now() * 1000 + crypto.getRandomValues(new Uint16Array(1))[0] % 1000; }
function randomCode(len) {
  const abc = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => abc[b % abc.length]).join('');
}
function hex(buf) {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}
async function hmac(keyBytes, msg) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
}
async function webhookSecret(env) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('slotmate:' + env.BOT_TOKEN));
  return hex(hash).slice(0, 48);
}

// Проверка подписи Телеграма: кто открыл приложение.
async function verifyInitData(env, initData) {
  if (!initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const pairs = [];
  for (const [k, v] of params) pairs.push(`${k}=${v}`);
  pairs.sort();
  const secret = await hmac(new TextEncoder().encode('WebAppData'), env.BOT_TOKEN);
  const check = hex(await hmac(secret, pairs.join('\n')));
  if (check !== hash) return null;
  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || Date.now() / 1000 - authDate > 7 * 24 * 3600) return null;
  try { return JSON.parse(params.get('user') || 'null'); } catch (e) { return null; }
}

// ---------- время (варшавское, вида 2026-11-07 15:00) ----------

const pad = (n) => String(n).padStart(2, '0');
function localParts(date) {
  const p = {};
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  for (const part of f.formatToParts(date)) p[part.type] = part.value;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute };
}
function nowLocal(offsetMs = 0) {
  const p = localParts(new Date(Date.now() + offsetMs));
  return `${p.y}-${pad(p.m)}-${pad(p.d)} ${pad(p.h)}:${pad(p.mi)}`;
}
function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number), [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 864e5);
}
function weekday(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
function monday(ymd) { const w = weekday(ymd); return addDays(ymd, w === 0 ? -6 : 1 - w); }
function fmtDate(ymd) {
  const [, m, d] = ymd.split('-').map(Number);
  return `${WD[weekday(ymd)]}, ${d} ${MONTHS[m - 1]}`;
}
function fmt(ts) { return `${fmtDate(ts.slice(0, 10))}, ${ts.slice(11, 16)}`; }
function isTs(ts) { return typeof ts === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(ts); }
function isYmd(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function isHm(s) { return typeof s === 'string' && /^\d{2}:\d{2}$/.test(s); }
function mins(hm) { const [h, m] = hm.split(':').map(Number); return h * 60 + m; }
function localToUtcMs(ts) {
  const [y, m, d] = ts.slice(0, 10).split('-').map(Number);
  const [h, mi] = ts.slice(11, 16).split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const offsetAt = (ms) => { const p = localParts(new Date(ms)); return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - ms; };
  let result = guess - offsetAt(guess);
  const second = guess - offsetAt(result);
  if (second !== result) result = second;
  return result;
}

// ---------- проверка накладок ----------

async function findConflict(env, teacherId, ts, dur, excludeId, excludeSeries) {
  const day = ts.slice(0, 10), a = mins(ts.slice(11, 16)), b = a + (dur || 60);
  const { results: ls } = await env.DB.prepare(
    `SELECT l.id, l.starts_at, l.duration_min, l.status, l.proposed_start, u.name AS student_name
     FROM lessons l JOIN students s ON s.id = l.student_id JOIN users u ON u.tg_id = s.tg_id
     WHERE l.teacher_id = ? AND l.status IN ('scheduled', 'pending') AND l.id != ? AND COALESCE(l.series_id, 0) != ? AND (substr(l.starts_at, 1, 10) = ? OR substr(l.proposed_start, 1, 10) = ?)`
  ).bind(teacherId, excludeId || 0, excludeSeries || -1, day, day).all();
  for (const l of ls) {
    if (l.starts_at.slice(0, 10) === day) {
      const x = mins(l.starts_at.slice(11, 16));
      if (a < x + l.duration_min && x < b) return { kind: 'lesson', name: l.student_name, at: l.starts_at.slice(11, 16) };
    }
    if (l.status === 'pending' && l.proposed_start && l.proposed_start.slice(0, 10) === day) {
      const x = mins(l.proposed_start.slice(11, 16));
      if (a < x + l.duration_min && x < b) return { kind: 'proposal', name: l.student_name, at: l.proposed_start.slice(11, 16) };
    }
  }
  const { results: bs } = await env.DB.prepare('SELECT * FROM busy WHERE teacher_id = ? AND day = ?').bind(teacherId, day).all();
  for (const x of bs) {
    if (a < mins(x.to_t) && mins(x.from_t) < b) return { kind: 'busy', note: x.note || 'занято', from: x.from_t, to: x.to_t };
  }
  return null;
}

function conflictText(c, forTeacher) {
  if (c.kind === 'busy') {
    const span = c.from === '00:00' && c.to === '23:59' ? 'весь день' : `${c.from}–${c.to}`;
    return forTeacher ? `В это время у вас отмечено: ${c.note} (${span}).` : `Учитель в это время занят: ${c.note} (${span}).`;
  }
  if (!forTeacher) return 'У учителя это время уже занято.';
  if (c.kind === 'lesson') return `В это время уже урок: ${c.name}, ${c.at}.`;
  return `Это время уже предложено другому ученику: ${c.name}, ${c.at}.`;
}

// ---------- Телеграм ----------

async function tg(env, method, payload) {
  // Демо-люди (отрицательные номера) не существуют в Телеграме — им ничего не отправляем.
  if (payload && typeof payload.chat_id === 'number' && payload.chat_id <= DEMO_T) return { ok: true, result: { message_id: 0 } };
  let res;
  try {
    res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    });
  } catch (e) {
    console.log('Telegram unreachable', method, e && e.message);
    return { ok: false, description: 'network error' };
  }
  let data;
  try { data = await res.json(); } catch (e) { data = { ok: false, description: 'bad response' }; }
  if (!data.ok) console.log('Telegram error', method, data.description);
  return data;
}
function send(env, chatId, msg, markup) {
  const payload = { chat_id: chatId, text: msg, parse_mode: 'HTML', disable_web_page_preview: true };
  if (markup) payload.reply_markup = markup;
  return tg(env, 'sendMessage', payload);
}
function editMsg(env, chatId, msgId, msg, markup) {
  return tg(env, 'editMessageText', {
    chat_id: chatId, message_id: msgId, text: msg, parse_mode: 'HTML',
    disable_web_page_preview: true, reply_markup: markup || { inline_keyboard: [] },
  });
}
function edit(env, cq, msg, markup) { return editMsg(env, cq.message.chat.id, cq.message.message_id, msg, markup); }
async function getBotUsername(env) {
  if (!botUsername) {
    const me = await tg(env, 'getMe', {});
    botUsername = me.ok ? me.result.username : 'Slot_Mate_Bot';
  }
  return botUsername;
}
function appUrl(origin, q) { return `${origin}/app${q ? '?' + q : ''}`; }
function appButton(origin, label = 'Открыть расписание', q) {
  return { inline_keyboard: [[{ text: label, web_app: { url: appUrl(origin, q) } }]] };
}

async function setup(url, env) {
  // Повторная настройка сбрасывает очередь сообщений бота, поэтому после первого раза — только с ключом.
  const done = await env.DB.prepare("SELECT v FROM meta WHERE k = 'origin'").first();
  if (done && !(env.SETUP_KEY && url.searchParams.get('key') === env.SETUP_KEY)) {
    return text('Бот уже подключён. Повторная настройка — только с ключом (секрет SETUP_KEY).', 403);
  }
  await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('origin', ?)").bind(url.origin).run();
  const r = await tg(env, 'setWebhook', {
    url: `${url.origin}/telegram`, secret_token: await webhookSecret(env),
    allowed_updates: ['message', 'callback_query'], drop_pending_updates: true,
  });
  await tg(env, 'setMyCommands', { commands: [{ command: 'start', description: 'Открыть расписание' }, { command: 'help', description: 'Как пользоваться' }] });
  await tg(env, 'setChatMenuButton', { menu_button: { type: 'web_app', text: 'Расписание', web_app: { url: `${url.origin}/app` } } });
  return text(r.ok ? 'Готово! Бот подключён. Откройте его в Телеграме и нажмите «Запустить» (Start).'
    : 'Ошибка подключения: ' + (r.description || 'неизвестно') + '. Проверьте секрет BOT_TOKEN.');
}

// ---------- сообщения в чате ----------

async function handleUpdate(update, env, origin) {
  if (update.message) return handleMessage(update.message, env, origin);
  if (update.callback_query) return handleCallback(update.callback_query, env, origin);
}

async function handleMessage(msg, env, origin) {
  if (!msg.from || !msg.chat || msg.chat.type !== 'private') return;
  const user = await upsertUser(env, msg.from);
  const t = (msg.text || '').trim();
  if (t.startsWith('/start')) {
    const payload = t.split(/\s+/)[1] || '';
    if (payload.startsWith('t_')) return acceptTeacherInvite(env, user, payload.slice(2), origin);
    if (payload.startsWith('s_')) return acceptStudentInvite(env, user, payload.slice(2), origin);
  }
  if (t === '/help') {
    return send(env, user.tg_id,
      '<b>Как это работает</b>\nВремя урока меняется только после подтверждения обеих сторон. Пока ответа нет, урок остаётся на старом времени.\n\nВсё расписание — в приложении по кнопке ниже. Когда кто-то предложит перенос, сюда придёт сообщение с кнопками «Подтвердить» и «Не подходит». За сутки до урока придёт напоминание.',
      appButton(origin));
  }
  const student = await isStudentAnywhere(env, user.tg_id);
  const lines = [`Привет, ${esc(user.name)}! Это SlotMate — расписание уроков без путаницы.`];
  if (user.is_teacher) lines.push('Ваше расписание, ученики и оплаты — в приложении по кнопке ниже.');
  else if (student) lines.push('Ваши уроки — в приложении по кнопке ниже. Если учитель предложит перенос, я пришлю сюда кнопки «Подтвердить» и «Не подходит».');
  else if (user.is_admin) lines.push('Вы владелец бота. Откройте приложение и отправьте учителю ссылку-приглашение.');
  else lines.push('Чтобы записаться, попросите у учителя ссылку-приглашение и откройте её.');
  return send(env, user.tg_id, lines.join('\n\n'), appButton(origin));
}

async function acceptTeacherInvite(env, user, code, origin) {
  const inv = await env.DB.prepare("SELECT * FROM invites WHERE code = ? AND kind = 'teacher'").bind(code).first();
  if (!inv) return send(env, user.tg_id, 'Ссылка не найдена. Попросите новую.');
  if (inv.used_by && inv.used_by !== user.tg_id) return send(env, user.tg_id, 'Эта ссылка уже использована. Попросите новую.');
  // Ссылка одноразовая: забираем её одним запросом, чтобы двое не успели одновременно.
  if (!inv.used_by) {
    const took = await env.DB.prepare('UPDATE invites SET used_by = ? WHERE code = ? AND used_by IS NULL').bind(user.tg_id, code).run();
    if (!changed(took)) return send(env, user.tg_id, 'Эта ссылка уже использована. Попросите новую.');
  }
  const inviteCode = user.invite_code || randomCode(10);
  await env.DB.prepare('UPDATE users SET is_teacher = 1, invite_code = ? WHERE tg_id = ?').bind(inviteCode, user.tg_id).run();
  await send(env, user.tg_id, 'Готово, вы учитель! Откройте расписание: на вкладке «Ученики» отправьте ученикам ссылку-приглашение, затем добавляйте уроки.', appButton(origin));
  if (inv.created_by && inv.created_by !== user.tg_id) await send(env, inv.created_by, `Учитель подключился: ${esc(user.name)}.`);
}

async function acceptStudentInvite(env, user, code, origin) {
  const teacher = await env.DB.prepare('SELECT * FROM users WHERE invite_code = ? AND is_teacher = 1').bind(code).first();
  if (!teacher) return send(env, user.tg_id, 'Ссылка не найдена. Попросите у учителя новую.');
  if (teacher.tg_id === user.tg_id) return send(env, user.tg_id, 'Это ваша собственная ссылка для учеников — отправьте её ученикам.', appButton(origin));
  const res = await env.DB.prepare('INSERT INTO students (tg_id, teacher_id, name) VALUES (?, ?, ?) ON CONFLICT(tg_id, teacher_id) DO NOTHING')
    .bind(user.tg_id, teacher.tg_id, user.name).run();
  const isNew = !!(res && res.meta && res.meta.changes > 0);
  await send(env, user.tg_id, isNew
    ? `Готово! Ваш учитель — ${esc(teacher.name)}. Когда появится урок, я пришлю его сюда.`
    : `Вы уже записаны. Ваш учитель — ${esc(teacher.name)}.`, appButton(origin));
  if (isNew) await send(env, teacher.tg_id, `Новый ученик: <b>${esc(user.name)}</b>. Откройте расписание, чтобы назначить урок.`, appButton(origin, 'Назначить урок', `s=${res.meta.last_row_id}`));
}

async function handleCallback(cq, env, origin) {
  const user = await upsertUser(env, cq.from);
  let note = '';
  try {
    if (cq.message) {
      const p = (cq.data || '').split(':');
      if (p[0] === 'ok' || p[0] === 'no') {
        const r = await answerProposal(env, user, Number(p[1]), p.slice(2).join(':'), p[0] === 'ok', origin, false);
        if (r.msg) await edit(env, cq, r.msg, r.markup);
        note = r.note || r.error || '';
      } else if (p[0] === 'nc') {
        const l = await loadLesson(env, Number(p[1]));
        if (!l || l.teacher_id !== user.tg_id) note = 'Только для учителя';
        else {
          const r = await cancelLesson(env, user, l.id, 'one');
          await edit(env, cq, r.error ? r.error : `Урок ${esc(l.student_name)} <b>${fmt(l.starts_at)}</b> отменён без списания. Ученик получил сообщение.`);
          note = r.error || 'Отменено';
        }
      } else if (p[0] === 'ex') {
        const r = await extendSeries(env, user, Number(p[1]), { auto: true });
        await edit(env, cq, r.error ? r.error : r.msg);
        note = r.error || 'Готово';
      } else if (p[0] === 'nx') {
        await edit(env, cq, 'Хорошо, серия не продлевается. Если передумаете — в приложении откройте любой урок этой серии и нажмите «Продлить».');
        note = 'Не продлеваем';
      } else if (p[0] === 'hd' || p[0] === 'nh') {
        const r = await resolveLesson(env, user, Number(p[1]), p[0] === 'hd');
        await edit(env, cq, r.error || r.msg);
        note = r.error || 'Отмечено';
      } else if (p[0] === 'pd') {
        // pd:<урок>:<сколько уроков>; в старых сообщениях числа нет — тогда абонемент.
        const r = await payForLesson(env, user, Number(p[1]), origin, Number(p[2]) || 0);
        await edit(env, cq, r.error || r.msg);
        note = r.error || 'Оплата записана';
      } else if (p[0] === 'pl') {
        await edit(env, cq, 'Хорошо. Когда ученик оплатит — откройте урок или карточку ученика в приложении и нажмите «Получил оплату».', appButton(origin, 'Открыть урок', `l=${Number(p[1])}`));
        note = 'Пока не оплатил';
      } else if (p[0] === 'ca' || p[0] === 'cr') {
        const r = await answerClaim(env, user, Number(p[1]), p[0] === 'ca', origin, cq);
        note = r.error || r.note || '';
      } else if (p[0] === 'cf' || p[0] === 'cn') {
        note = await reminderAnswer(env, cq, user, Number(p[1]), p[0] === 'cf', origin);
      } else note = 'Эта кнопка устарела';
    }
  } finally {
    const payload = { callback_query_id: cq.id };
    if (note) payload.text = note;
    await tg(env, 'answerCallbackQuery', payload);
  }
}

async function reminderAnswer(env, cq, user, lid, coming, origin) {
  const l = await loadLesson(env, lid);
  if (!l || l.student_tg !== user.tg_id) return 'Урок не найден';
  if (l.status === 'cancelled') { await edit(env, cq, 'Этот урок отменён.'); return ''; }
  if (l.starts_at <= nowLocal()) { await edit(env, cq, `Урок <b>${fmt(l.starts_at)}</b> уже начался — ответить на напоминание нельзя.`); return 'Урок уже начался'; }
  await env.DB.prepare('UPDATE lessons SET reminder_answer = ? WHERE id = ?').bind(coming ? 'yes' : 'no', lid).run();
  if (coming) {
    await edit(env, cq, `Отлично! Урок <b>${fmt(l.starts_at)}</b>, учитель: ${esc(l.teacher_name)}.`);
    return 'Ждём вас';
  }
  await edit(env, cq, `Понял, учитель получил сообщение и сам решит, списывать ли урок. Урок пока стоит: <b>${fmt(l.starts_at)}</b>.\nМожно сразу предложить другое время:`,
    appButton(origin, 'Предложить другое время', `l=${lid}`));
  await send(env, l.teacher_id, `${esc(l.student_name)} не сможет прийти на урок <b>${fmt(l.starts_at)}</b>.`, { inline_keyboard: [
    [{ text: 'Отменить без списания', callback_data: `nc:${lid}` }],
    [{ text: 'Предложить другое время', web_app: { url: appUrl(origin, `l=${lid}`) } }],
  ] });
  return 'Учитель получил сообщение';
}

// ---------- действия (общие для чата и приложения) ----------

function proposalText(l) {
  const toTeacher = l.proposed_by === 's';
  const fromName = toTeacher ? esc(l.student_name) : `Учитель ${esc(l.teacher_name)}`;
  let t = `${fromName} предлагает перенести урок.\nБыло: <s>${fmt(l.starts_at)}</s>\nСтанет: <b>${fmt(l.proposed_start)}</b>`;
  if (l.proposed_scope === 'series') t += `\n\nИ все следующие уроки этой серии: по ${WD_PLURAL[weekday(l.proposed_start.slice(0, 10))]} в ${l.proposed_start.slice(11, 16)}.`;
  return t;
}

async function sendProposal(env, l, origin, prefix) {
  const chat = l.proposed_by === 's' ? l.teacher_id : l.student_tg;
  const r = await send(env, chat, (prefix || '') + proposalText(l), { inline_keyboard: [
    [{ text: 'Подтвердить', callback_data: `ok:${l.id}:${l.proposed_start}` }, { text: 'Не подходит', callback_data: `no:${l.id}:${l.proposed_start}` }],
    [{ text: 'Предложить своё время', web_app: { url: appUrl(origin, `l=${l.id}`) } }],
  ] });
  if (r && r.ok) {
    await env.DB.prepare('UPDATE lessons SET proposal_chat = ?, proposal_msg = ? WHERE id = ?').bind(chat, r.result.message_id, l.id).run();
  }
}

async function closeProposalMsg(env, l, msg) {
  if (l.proposal_chat && l.proposal_msg) await editMsg(env, l.proposal_chat, l.proposal_msg, msg);
}

// Новые даты остальных уроков серии при переносе всей серии.
async function seriesShift(env, l, ts) {
  const delta = daysBetween(l.starts_at.slice(0, 10), ts.slice(0, 10)), hm = ts.slice(11, 16);
  const { results } = await env.DB.prepare(`SELECT id, starts_at FROM lessons WHERE series_id = ? AND id != ? AND starts_at > ? AND status IN ${ACTIVE} ORDER BY starts_at`)
    .bind(l.series_id, l.id, l.starts_at).all();
  return results.map((x) => ({ id: x.id, from: x.starts_at, to: `${addDays(x.starts_at.slice(0, 10), delta)} ${hm}` }));
}
async function seriesClashes(env, l, moves, forTeacher) {
  const out = [];
  for (const m of moves) {
    const c = await findConflict(env, l.teacher_id, m.to, l.duration_min, m.id, l.series_id);
    if (c && c.kind !== 'proposal') out.push({ ...m, why: conflictText(c, forTeacher).replace(/\.$/, '') });
  }
  return out;
}

async function proposeLesson(env, user, lid, ts, scope, origin) {
  const l = await loadLesson(env, lid);
  if (!l) return { error: 'Урок не найден' };
  const r = roles(l, user.tg_id);
  if (!r.t && !r.s) return { error: 'Это не ваш урок' };
  if (l.status === 'cancelled' || l.status === 'late') return { error: 'Этот урок отменён' };
  if (!isTs(ts)) return { error: 'Неверное время' };
  if (ts <= nowLocal()) return { error: 'Это время уже прошло' };
  if (ts === l.starts_at) return { error: 'Это то же самое время' };
  if (l.status === 'pending' && l.proposed_start === ts) return { error: 'Это время уже предложено' };
  const sc = scope === 'series' && l.series_id ? 'series' : 'one';
  // Занятое время предложить нельзя: другая сторона всё равно не смогла бы его подтвердить.
  const c = await findConflict(env, l.teacher_id, ts, l.duration_min, l.id, sc === 'series' ? l.series_id : 0);
  if (c) return { conflict: conflictText(c, r.t) };
  if (sc === 'series') {
    const bad = await seriesClashes(env, l, await seriesShift(env, l, ts), r.t);
    if (bad.length) {
      return { conflict: `Для всей серии не подходит — эти даты заняты:\n${bad.slice(0, 4).map((b) => `${fmt(b.to)} — ${b.why}`).join('\n')}${bad.length > 4 ? `\n…и ещё ${bad.length - 4}` : ''}\n\nМожно перенести только этот урок или выбрать другое время.` };
    }
  }
  const by = r.t ? 't' : 's';
  if (l.status === 'pending') await closeProposalMsg(env, l, `Предложение перенести на ${fmt(l.proposed_start)} заменено новым — смотрите ниже.`);
  await env.DB.prepare("UPDATE lessons SET status = 'pending', proposed_start = ?, proposed_by = ?, proposed_scope = ?, proposed_at = ?, pinged = 0, proposal_chat = NULL, proposal_msg = NULL WHERE id = ?")
    .bind(ts, by, sc, nowLocal(), lid).run();
  await sendProposal(env, { ...l, proposed_start: ts, proposed_by: by, proposed_scope: sc }, origin);
  return { ok: true };
}

async function withdrawProposal(env, user, lid) {
  const l = await loadLesson(env, lid);
  if (!l || l.status !== 'pending') return { error: 'Предложения нет' };
  const r = roles(l, user.tg_id);
  if (!((l.proposed_by === 't' && r.t) || (l.proposed_by === 's' && r.s))) return { error: 'Отозвать может только тот, кто предложил' };
  await env.DB.prepare("UPDATE lessons SET status = 'scheduled', proposed_start = NULL, proposed_by = NULL, proposed_scope = NULL WHERE id = ?").bind(lid).run();
  await closeProposalMsg(env, l, `Предложение перенести урок отозвано. Урок остаётся: <b>${fmt(l.starts_at)}</b>.`);
  return { ok: true };
}

async function answerProposal(env, user, lid, code, accept, origin, fromApp) {
  const l = await loadLesson(env, lid);
  if (!l) return { error: 'Урок не найден' };
  const r = roles(l, user.tg_id);
  if (l.status !== 'pending' || !l.proposed_start || l.proposed_start !== code) {
    return { msg: 'Это предложение уже неактуально.', error: 'Это предложение уже неактуально' };
  }
  const allowed = (l.proposed_by === 't' && r.s) || (l.proposed_by === 's' && r.t);
  if (!allowed) return { error: 'Ответить должна другая сторона' };
  const proposerChat = l.proposed_by === 't' ? l.teacher_id : l.student_tg;
  const responder = l.proposed_by === 't' ? esc(l.student_name) : `Учитель ${esc(l.teacher_name)}`;
  let msg, markup, note;
  if (accept) {
    let problem = null;
    if (l.proposed_start <= nowLocal()) problem = 'предложенное время уже прошло';
    else {
      const c = await findConflict(env, l.teacher_id, l.proposed_start, l.duration_min, l.id, l.proposed_scope === 'series' ? l.series_id : 0);
      if (c && c.kind !== 'proposal') problem = 'это время уже занято';
    }
    if (problem) {
      await env.DB.prepare("UPDATE lessons SET status = 'scheduled', proposed_start = NULL, proposed_by = NULL, proposed_scope = NULL WHERE id = ?").bind(lid).run();
      await send(env, proposerChat, `Перенос на ${fmt(l.proposed_start)} не состоялся: ${problem}. Урок остаётся: <b>${fmt(l.starts_at)}</b>.`, appButton(origin, 'Предложить другое время', `l=${lid}`));
      msg = `Не получилось: ${problem}. Урок остаётся: <b>${fmt(l.starts_at)}</b>.`;
      if (fromApp) await closeProposalMsg(env, l, msg);
      return { error: `Не получилось: ${problem}. Предложите другое время.`, msg, markup: appButton(origin, 'Предложить другое время', `l=${lid}`) };
    }
    // Записываем, только если предложение всё ещё то самое, на которое ответили:
    // если другая сторона в эту секунду предложила другое время, ничего не меняем.
    const done = await env.DB.prepare("UPDATE lessons SET starts_at = proposed_start, status = 'scheduled', proposed_start = NULL, proposed_by = NULL, proposed_scope = NULL, reminded = 0, reminder_answer = NULL, pay_asked = 0 WHERE id = ? AND status = 'pending' AND proposed_start = ?").bind(lid, code).run();
    if (!changed(done)) return { msg: 'Это предложение уже неактуально.', error: 'Это предложение уже неактуально' };
    const stmts = [];
    let extra = '';
    if (l.proposed_scope === 'series' && l.series_id) {
      const hm = l.proposed_start.slice(11, 16);
      const moves = await seriesShift(env, l, l.proposed_start);
      const bad = await seriesClashes(env, l, moves, true);
      const badIds = new Set(bad.map((b) => b.id));
      const ok = moves.filter((m) => !badIds.has(m.id));
      for (const m of ok) {
        stmts.push(env.DB.prepare("UPDATE lessons SET starts_at = ?, status = 'scheduled', proposed_start = NULL, proposed_by = NULL, proposed_scope = NULL, reminded = 0, reminder_answer = NULL WHERE id = ?").bind(m.to, m.id));
      }
      if (ok.length) extra = ` И ещё ${lessonsWord(ok.length)} — по ${WD_PLURAL[weekday(l.proposed_start.slice(0, 10))]} в ${hm}.`;
      if (bad.length) extra += `\nОстались на старом времени (новое уже занято): ${bad.map((b) => fmtDate(b.from.slice(0, 10)) + ' ' + b.from.slice(11, 16)).join(', ')}.`;
    }
    if (stmts.length) await env.DB.batch(stmts);
    await send(env, proposerChat, `${responder} подтверждает перенос. Урок: <b>${fmt(l.proposed_start)}</b>.${extra}`, appButton(origin, 'Открыть урок', `l=${lid}`));
    msg = `Готово! Урок перенесён на <b>${fmt(l.proposed_start)}</b>.${extra}`;
    note = 'Подтверждено';
  } else {
    const done = await env.DB.prepare("UPDATE lessons SET status = 'scheduled', proposed_start = NULL, proposed_by = NULL, proposed_scope = NULL WHERE id = ? AND status = 'pending' AND proposed_start = ?").bind(lid, code).run();
    if (!changed(done)) return { msg: 'Это предложение уже неактуально.', error: 'Это предложение уже неактуально' };
    await send(env, proposerChat, `${responder}: время ${fmt(l.proposed_start)} не подходит. Урок пока остаётся: <b>${fmt(l.starts_at)}</b>. Если будет встречное предложение, я пришлю его.`, appButton(origin, 'Предложить другое время', `l=${lid}`));
    msg = `Вы ответили «не подходит» на ${fmt(l.proposed_start)}. Урок пока остаётся: <b>${fmt(l.starts_at)}</b>.`;
    markup = appButton(origin, 'Предложить своё время', `l=${lid}`);
    note = 'Ответ отправлен';
  }
  if (fromApp) await closeProposalMsg(env, l, msg);
  return { ok: true, note, msg, markup };
}

async function cancelLesson(env, user, lid, scope) {
  const l = await loadLesson(env, lid);
  if (!l) return { error: 'Урок не найден' };
  const r = roles(l, user.tg_id);
  if (!r.t && !r.s) return { error: 'Это не ваш урок' };
  if (l.status === 'cancelled') return { error: 'Урок уже отменён' };
  if (!r.t && l.starts_at <= nowLocal()) return { error: 'Урок уже начался — отменить его может только учитель' };
  let list = [l];
  if (scope === 'series' && l.series_id) {
    const { results } = await env.DB.prepare(`${LESSON_SELECT} WHERE l.series_id = ? AND l.starts_at >= ? AND l.status IN ('scheduled', 'pending') ORDER BY l.starts_at`)
      .bind(l.series_id, l.starts_at).all();
    list = results;
  }
  const set = await settingsOf(env, l.teacher_id);
  const lateEdge = nowLocal(set.late_hours * 3600 * 1000);
  const isLate = (x) => !r.t && set.late_hours > 0 && x.starts_at <= lateEdge;
  const stmts = list.map((x) => env.DB.prepare("UPDATE lessons SET status = ?, proposed_start = NULL, proposed_by = NULL WHERE id = ?").bind(isLate(x) ? 'late' : 'cancelled', x.id));
  // «Этот и все следующие» — серия больше не продлевается сама.
  if (scope === 'series' && l.series_id) stmts.push(env.DB.prepare('DELETE FROM series_auto WHERE series_id = ?').bind(l.series_id));
  await env.DB.batch(stmts);
  const lateNote = list.some(isLate) ? `\nПоздняя отмена (меньше чем за ${set.late_hours} ч) — урок списывается по правилу учителя.` : '';
  const freeNote = r.t ? '\nС абонемента не списывается.' : '';
  for (const x of list) if (x.status === 'pending') await closeProposalMsg(env, x, `Урок ${fmt(x.starts_at)} отменён — предложение больше не действует.`);
  const other = r.t ? l.student_tg : l.teacher_id;
  const what = list.length === 1 ? `Урок <b>${fmt(l.starts_at)}</b> отменён.`
    : `Отменены ${lessonsWord(list.length)}: с ${fmtDate(l.starts_at.slice(0, 10))} все по ${WD_PLURAL[weekday(l.starts_at.slice(0, 10))]} в ${l.starts_at.slice(11, 16)}.`;
  if (other !== user.tg_id) await send(env, other, `${what}\nКто отменил: ${esc(user.name)}.${lateNote}${freeNote}`);
  return { ok: true, count: list.length, late: !!lateNote };
}

async function addLesson(env, user, sid, ts, weeks, force, duration, auto) {
  if (!user.is_teacher) return { error: 'Только для учителя' };
  const student = await env.DB.prepare('SELECT s.id, s.tg_id, u.name FROM students s JOIN users u ON u.tg_id = s.tg_id WHERE s.id = ? AND s.teacher_id = ?').bind(sid, user.tg_id).first();
  if (!student) return { error: 'Ученик не найден' };
  if (!isTs(ts)) return { error: 'Неверное время' };
  if (ts <= nowLocal()) return { error: 'Это время уже прошло' };
  // «Каждую неделю» без срока: ставим 12 недель вперёд, дальше продлевается само.
  const count = auto ? 12 : Math.min(Math.max(Number(weeks) || 1, 1), 52);
  const dur = [30, 45, 60, 90, 120].includes(Number(duration)) ? Number(duration) : (await settingsOf(env, user.tg_id)).default_duration;
  const dates = [];
  for (let i = 0; i < count; i++) dates.push(`${addDays(ts.slice(0, 10), i * 7)} ${ts.slice(11, 16)}`);
  if (!force) {
    const clashes = [];
    for (const d of dates) {
      const c = await findConflict(env, user.tg_id, d, dur, 0);
      if (c) clashes.push(`${fmt(d)} — ${conflictText(c, true).replace(/\.$/, '')}`);
    }
    if (clashes.length) return { conflict: clashes.slice(0, 4).join('\n') + (clashes.length > 4 ? `\n…и ещё ${clashes.length - 4}` : '') };
  }
  const seriesId = count > 1 ? newSeriesId() : null;
  const stmts = dates.map((d) => env.DB.prepare('INSERT INTO lessons (teacher_id, student_id, starts_at, series_id, duration_min) VALUES (?, ?, ?, ?, ?)').bind(user.tg_id, sid, d, seriesId, dur));
  if (auto && seriesId) stmts.push(env.DB.prepare('INSERT OR IGNORE INTO series_auto (series_id, teacher_id) VALUES (?, ?)').bind(seriesId, user.tg_id));
  await env.DB.batch(stmts);
  const summary = count === 1 ? `<b>${fmt(ts)}</b>`
    : `каждую неделю по ${WD_PLURAL[weekday(ts.slice(0, 10))]} в <b>${ts.slice(11, 16)}</b>, начиная с ${fmtDate(ts.slice(0, 10))} (${auto ? 'без срока' : lessonsWord(count)})`;
  await send(env, student.tg_id, `Учитель ${esc(user.name)}: ${count === 1 ? 'назначен урок' : 'назначены уроки'} — ${summary}.`);
  return { ok: true };
}

// ---------- API для приложения ----------

async function handleApi(request, env, url) {
  const from = await verifyInitData(env, request.headers.get('x-init-data') || '');
  if (!from) return json({ error: 'Откройте приложение из Телеграма' }, 401);
  let user = await upsertUser(env, from);
  let body = {};
  try { body = await request.json(); } catch (e) { body = {}; }
  const path = url.pathname.slice(5);
  if (request.headers.get('x-demo') === '1') {
    if (!user.is_admin) return json({ error: 'Демо доступно только владельцу' }, 403);
    if (path === 'demo/reset' || !(await env.DB.prepare('SELECT 1 FROM users WHERE tg_id = ?').bind(DEMO_T).first())) await seedDemo(env);
    if (path === 'demo/reset') return json({ ok: true });
    if (['invite', 'teacher_invite', 'calendar'].includes(path)) return json({ error: 'В демо это недоступно — здесь нет настоящих учеников' }, 400);
    if (path === 'demo/as_student') {
      const l = await loadLesson(env, Number(body.id));
      if (!l || l.teacher_id !== DEMO_T) return json({ error: 'Урок не найден' }, 400);
      const st = await env.DB.prepare('SELECT * FROM users WHERE tg_id = ?').bind(l.student_tg).first();
      const r = await answerProposal(env, st, l.id, l.proposed_start, !!body.accept, url.origin, true);
      return r.error ? json({ error: r.error }, 400) : json({ ok: true });
    }
    user = await env.DB.prepare('SELECT * FROM users WHERE tg_id = ?').bind(DEMO_T).first();
  }
  const origin = url.origin;
  const teacherOnly = () => (user.is_teacher ? null : json({ error: 'Только для учителя' }, 403));
  let r, deny;
  switch (path) {
    case 'me': return json(await meData(env, user, body));
    case 'lesson/add': r = await addLesson(env, user, Number(body.student_id), body.starts_at, body.weeks, !!body.force, body.duration, !!body.auto); break;
    case 'lesson/propose': r = await proposeLesson(env, user, Number(body.id), body.starts_at, body.scope, origin); break;
    case 'lesson/resolve': r = await resolveLesson(env, user, Number(body.id), !!body.held); break;
    case 'lesson/propose_many': {
      const items = Array.isArray(body.items) ? body.items.slice(0, 30) : [];
      const results = [];
      for (const it of items) {
        const x = await proposeLesson(env, user, Number(it.id), it.starts_at, 'one', origin);
        results.push({ id: Number(it.id), ok: !!x.ok, problem: x.error || x.conflict || null });
      }
      r = { results }; break;
    }
    case 'slots': r = await freeSlots(env, user, body); break;
    case 'lesson/void': {
      const l = await loadLesson(env, Number(body.id));
      if (!l || l.teacher_id !== user.tg_id) return json({ error: 'Только для учителя' }, 403);
      if (l.starts_at > nowLocal() && l.status !== 'late') return json({ error: 'Урок ещё не прошёл — его можно просто отменить' }, 400);
      if (l.status === 'pending') await closeProposalMsg(env, l, `Урок ${fmt(l.starts_at)} отмечен как несостоявшийся — предложение больше не действует.`);
      await env.DB.prepare("UPDATE lessons SET status = 'cancelled', check_needed = 0, proposed_start = NULL, proposed_by = NULL, proposed_scope = NULL WHERE id = ?").bind(l.id).run();
      await send(env, l.student_tg, `Урок <b>${fmt(l.starts_at)}</b> отмечен как несостоявшийся — он не списан с абонемента.`);
      r = { ok: true }; break;
    }
    case 'series/extend': r = await extendSeries(env, user, Number(body.series_id), { auto: true }); break;
    case 'lesson/withdraw': r = await withdrawProposal(env, user, Number(body.id)); break;
    case 'lesson/answer': r = await answerProposal(env, user, Number(body.id), body.code, !!body.accept, origin, true); break;
    case 'lesson/cancel': r = await cancelLesson(env, user, Number(body.id), body.scope); break;
    case 'busy/add': {
      if ((deny = teacherOnly())) return deny;
      const allDay = !!body.all_day;
      const f = allDay ? '00:00' : body.from, t = allDay ? '23:59' : body.to;
      if (!isYmd(body.date) || !isHm(f) || !isHm(t) || mins(t) <= mins(f)) return json({ error: 'Проверьте дату и время' }, 400);
      if (body.date < nowLocal().slice(0, 10)) return json({ error: 'Этот день уже прошёл' }, 400);
      const note = String(body.note || 'Концерт').slice(0, 60);
      await env.DB.prepare('INSERT INTO busy (teacher_id, day, from_t, to_t, note) VALUES (?, ?, ?, ?, ?)').bind(user.tg_id, body.date, f, t, note).run();
      const { results } = await env.DB.prepare(`${LESSON_SELECT} WHERE l.teacher_id = ? AND substr(l.starts_at, 1, 10) = ? AND l.status IN ('scheduled', 'pending') ORDER BY l.starts_at`)
        .bind(user.tg_id, body.date).all();
      const affected = results.filter((l) => { const x = mins(l.starts_at.slice(11, 16)); return x < mins(t) && mins(f) < x + l.duration_min; })
        .map((l) => ({ id: l.id, starts_at: l.starts_at, student_name: l.student_name, status: l.status }));
      r = { ok: true, affected }; break;
    }
    case 'busy/remove': {
      if ((deny = teacherOnly())) return deny;
      await env.DB.prepare('DELETE FROM busy WHERE id = ? AND teacher_id = ?').bind(Number(body.id), user.tg_id).run();
      r = { ok: true }; break;
    }
    case 'student/remove': {
      if ((deny = teacherOnly())) return deny;
      const st = await env.DB.prepare('SELECT * FROM students WHERE id = ? AND teacher_id = ?').bind(Number(body.id), user.tg_id).first();
      if (!st) return json({ error: 'Ученик не найден' }, 400);
      await env.DB.batch([
        env.DB.prepare('DELETE FROM series_auto WHERE series_id IN (SELECT DISTINCT series_id FROM lessons WHERE student_id = ? AND series_id IS NOT NULL)').bind(st.id),
        env.DB.prepare("UPDATE lessons SET status = 'cancelled' WHERE student_id = ? AND starts_at >= ?").bind(st.id, nowLocal()),
        env.DB.prepare('DELETE FROM students WHERE id = ?').bind(st.id),
      ]);
      await send(env, st.tg_id, `Учитель ${esc(user.name)}: вы больше не в списке учеников, будущие уроки отменены.`);
      r = { ok: true }; break;
    }
    case 'settings': {
      if ((deny = teacherOnly())) return deny;
      const size = Math.min(Math.max(Number(body.pack_size) || 4, 1), 100), price = Math.min(Math.max(Number(body.pack_price) || 0, 0), 100000);
      const dur = [30, 45, 60, 90, 120].includes(Number(body.default_duration)) ? Number(body.default_duration) : 60;
      const late = [0, 6, 12, 24, 48].includes(Number(body.late_hours)) ? Number(body.late_hours) : 0;
      await env.DB.prepare('INSERT INTO teacher_settings (teacher_id, pack_size, pack_price, default_duration, late_hours) VALUES (?, ?, ?, ?, ?) ON CONFLICT(teacher_id) DO UPDATE SET pack_size = excluded.pack_size, pack_price = excluded.pack_price, default_duration = excluded.default_duration, late_hours = excluded.late_hours')
        .bind(user.tg_id, size, price, dur, late).run();
      r = { ok: true }; break;
    }
    case 'pay/add': {
      if ((deny = teacherOnly())) return deny;
      const st = await env.DB.prepare('SELECT * FROM students WHERE id = ? AND teacher_id = ?').bind(Number(body.student_id), user.tg_id).first();
      if (!st) return json({ error: 'Ученик не найден' }, 400);
      if (!(Number(body.lessons) >= 1)) return json({ error: 'Укажите, сколько уроков оплачено' }, 400);
      const id = await recordPayment(env, user, st, body.lessons, body.amount, body.kind === 'initial' ? 'initial' : 'pay', origin);
      r = { ok: true, id }; break;
    }
    case 'pay/lesson': r = await payForLesson(env, user, Number(body.id), origin); break;
    case 'pay/claim': r = await claimPayment(env, user, Number(body.sub_id), body.lessons, body.amount, origin); break;
    case 'pay/claim_answer': r = await answerClaim(env, user, Number(body.id), !!body.ok, origin); break;
    case 'pay/undo': {
      if ((deny = teacherOnly())) return deny;
      const p = await env.DB.prepare('SELECT p.*, s.tg_id FROM payments p JOIN students s ON s.id = p.student_id WHERE p.id = ? AND p.teacher_id = ?').bind(Number(body.id), user.tg_id).first();
      if (!p) return json({ error: 'Оплата не найдена' }, 400);
      await env.DB.prepare('DELETE FROM payments WHERE id = ?').bind(p.id).run();
      if (p.kind !== 'initial') await send(env, p.tg_id, `Отметка об оплате (${lessonsWord(p.lessons)}) отменена учителем — это была ошибка.`);
      r = { ok: true }; break;
    }
    case 'pay/remind': {
      if ((deny = teacherOnly())) return deny;
      const ids = Array.isArray(body.student_ids) ? body.student_ids.map(Number) : [Number(body.student_id)];
      const set = await settingsOf(env, user.tg_id);
      let sent = 0;
      for (const id of ids.slice(0, 50)) {
        const st = await env.DB.prepare('SELECT * FROM students WHERE id = ? AND teacher_id = ?').bind(id, user.tg_id).first();
        if (!st) continue;
        const b = await balanceOf(env, st.id);
        if (b.left > 0) continue;
        const price = set.pack_price ? ` Абонемент: ${lessonsWord(set.pack_size)} — ${set.pack_price} zł.` : '';
        await send(env, st.tg_id, `Напоминание об оплате: ${!b.paid && !b.used ? 'оплаты за уроки ещё не было' : 'оплаченные уроки закончились'}${b.left < 0 ? ` (в долг: ${lessonsWord(-b.left)})` : ''}.${price} Учитель: ${esc(user.name)}.`);
        sent++;
      }
      r = { ok: true, sent }; break;
    }
    case 'invite': {
      if ((deny = teacherOnly())) return deny;
      let code = user.invite_code;
      if (!code) { code = randomCode(10); await env.DB.prepare('UPDATE users SET invite_code = ? WHERE tg_id = ?').bind(code, user.tg_id).run(); }
      r = { link: `https://t.me/${await getBotUsername(env)}?start=s_${code}` }; break;
    }
    case 'teacher_invite': {
      if (!user.is_admin) return json({ error: 'Только для владельца' }, 403);
      const code = randomCode(12);
      await env.DB.prepare('INSERT INTO invites (code, kind, created_by) VALUES (?, ?, ?)').bind(code, 'teacher', user.tg_id).run();
      r = { link: `https://t.me/${await getBotUsername(env)}?start=t_${code}` }; break;
    }
    case 'calendar': {
      let key = user.cal_key;
      if (!key) { key = randomCode(24); await env.DB.prepare('UPDATE users SET cal_key = ? WHERE tg_id = ?').bind(key, user.tg_id).run(); }
      r = { link: `${origin}/cal/${key}.ics` }; break;
    }
    default: return json({ error: 'not found' }, 404);
  }
  if (r.error) return json({ error: r.error }, 400);
  return json(r);
}

async function meData(env, user, body) {
  const now = nowLocal(), today = now.slice(0, 10);
  const isStudent = await isStudentAnywhere(env, user.tg_id);
  const from = isYmd(body.week) ? body.week : monday(today);
  let to = addDays(from, 7);
  if (to < addDays(today, 60)) to = addDays(today, 60);
  const lo = from < today ? from : today;
  const { results } = await env.DB.prepare(
    `${LESSON_SELECT} WHERE (l.teacher_id = ? OR s.tg_id = ?) AND l.status IN ('scheduled', 'pending', 'late') AND l.starts_at >= ? AND l.starts_at < ? ORDER BY l.starts_at LIMIT 500`
  ).bind(user.tg_id, user.tg_id, `${lo} 00:00`, `${to} 00:00`).all();
  const teacherIds = [...new Set(results.map((l) => l.teacher_id))];
  const busyAll = [];
  for (const tid of teacherIds) {
    const { results: b } = await env.DB.prepare('SELECT * FROM busy WHERE teacher_id = ? AND day >= ? AND day < ?').bind(tid, lo, to).all();
    busyAll.push(...b);
  }
  const seriesIds = [...new Set(results.filter((l) => l.series_id).map((l) => l.series_id))];
  const seriesDates = {}, autoSeries = new Set();
  if (seriesIds.length) {
    const qs = seriesIds.map(() => '?').join(',');
    const { results: sr } = await env.DB.prepare(`SELECT series_id, starts_at FROM lessons WHERE series_id IN (${qs}) AND status IN ${ACTIVE} AND starts_at >= ? ORDER BY starts_at`).bind(...seriesIds, now).all();
    for (const x of sr) (seriesDates[x.series_id] = seriesDates[x.series_id] || []).push(x.starts_at);
    const { results: au } = await env.DB.prepare(`SELECT series_id FROM series_auto WHERE series_id IN (${qs})`).bind(...seriesIds).all();
    for (const x of au) autoSeries.add(x.series_id);
  }
  const lateSet = {};
  for (const tid of teacherIds) lateSet[tid] = (await settingsOf(env, tid)).late_hours;
  const lessons = results.map((l) => {
    const day = l.starts_at.slice(0, 10), x = mins(l.starts_at.slice(11, 16));
    const clash = l.status === 'late' ? null : busyAll.find((b) => b.teacher_id === l.teacher_id && b.day === day && x < mins(b.to_t) && mins(b.from_t) < x + l.duration_min);
    const sd = l.series_id ? seriesDates[l.series_id] || [] : [];
    const later = sd.filter((d) => d > l.starts_at).length;
    const lh = lateSet[l.teacher_id] || 0;
    return {
      id: l.id, teacher_id: l.teacher_id, starts_at: l.starts_at, status: l.status, proposed_start: l.proposed_start, proposed_by: l.proposed_by,
      proposed_scope: l.proposed_scope, series: !!l.series_id, later, student_id: l.student_id, student_name: l.student_name, teacher_name: l.teacher_name,
      is_mine: l.student_tg === user.tg_id, is_teaching: l.teacher_id === user.tg_id, past: l.starts_at < now,
      clash: clash ? `${clash.note || 'занято'}${clash.from_t === '00:00' && clash.to_t === '23:59' ? '' : ` ${clash.from_t}–${clash.to_t}`}` : null,
      reminder_answer: l.reminder_answer || null, duration: l.duration_min, series_id: l.series_id || null,
      series_end: sd.length ? sd[sd.length - 1] : null, series_auto: autoSeries.has(l.series_id), check_needed: !!l.check_needed,
      late_charge: lh > 0 && l.starts_at > now && l.starts_at <= nowLocal(lh * 3600 * 1000), late_hours: lh,
    };
  });
  const out = { name: user.name, is_admin: !!user.is_admin, is_teacher: !!user.is_teacher, is_student: isStudent, today, now, lessons, students: [], busy: [], settings: null, month: null, my_subs: [] };
  if (user.is_teacher) {
    const set = await settingsOf(env, user.tg_id);
    out.settings = set;
    const { results: st } = await env.DB.prepare(
      `SELECT s.id, u.name,
        (SELECT MIN(starts_at) FROM lessons l WHERE l.student_id = s.id AND l.status IN ('scheduled', 'pending') AND l.starts_at >= ?) AS next,
        (SELECT COALESCE(SUM(lessons), 0) FROM payments p WHERE p.student_id = s.id) AS paid,
        (SELECT COUNT(*) FROM lessons l WHERE l.student_id = s.id AND ${USED} AND l.starts_at < ?) AS used
       FROM students s JOIN users u ON u.tg_id = s.tg_id WHERE s.teacher_id = ? ORDER BY u.name`
    ).bind(now, now, user.tg_id).all();
    out.students = st.map((s) => ({ ...s, paid: Number(s.paid), used: Number(s.used), left: Number(s.paid) - Number(s.used) }));
    const { results: own } = await env.DB.prepare('SELECT * FROM busy WHERE teacher_id = ? AND day >= ? AND day < ?').bind(user.tg_id, lo, to).all();
    out.busy = own.map((b) => ({ id: b.id, day: b.day, from_t: b.from_t, to_t: b.to_t, note: b.note }));
    const monthStart = `${today.slice(0, 7)}-01`;
    const m = await env.DB.prepare('SELECT COALESCE(SUM(amount), 0) AS got, COUNT(*) AS n FROM payments WHERE teacher_id = ? AND created_at >= ?').bind(user.tg_id, monthStart).first();
    // Ждём оплату: уроки закончились — или оплат ещё не было, а урок уже назначен
    // (если учитель ведёт оплаты в приложении: указал цену или уже вносил оплату).
    const usesPay = !!(set.pack_price || (await env.DB.prepare('SELECT 1 FROM payments WHERE teacher_id = ? LIMIT 1').bind(user.tg_id).first()));
    for (const s of out.students) s.due = s.left <= 0 && !!(s.paid || s.used || (usesPay && s.next));
    const due = out.students.filter((s) => s.due).length;
    out.month = { got: Number(m.got), due_count: due, due_sum: due * set.pack_price };
    const { results: pays } = await env.DB.prepare(
      `SELECT p.id, p.student_id, p.lessons, p.amount, p.kind, p.created_at, u.name FROM payments p JOIN students s ON s.id = p.student_id JOIN users u ON u.tg_id = s.tg_id
       WHERE p.teacher_id = ? ORDER BY p.id DESC LIMIT 100`).bind(user.tg_id).all();
    out.payments = pays;
    // Прошедшие уроки с открытым вопросом: учитель решает, списывать ли.
    const { results: chk } = await env.DB.prepare(
      `${LESSON_SELECT} WHERE l.teacher_id = ? AND l.starts_at < ? AND (l.check_needed = 1 OR l.status = 'pending' OR (l.status = 'scheduled' AND l.reminder_answer = 'no')) ORDER BY l.starts_at DESC LIMIT 30`
    ).bind(user.tg_id, now).all();
    out.to_check = chk.map((l) => ({ id: l.id, starts_at: l.starts_at, student_name: l.student_name, why: l.reminder_answer === 'no' ? 'no' : 'move' }));
    // Ученики нажали «Я оплатил» — ждут ответа учителя.
    const { results: cl } = await env.DB.prepare(
      `SELECT c.id, c.student_id, c.lessons, c.amount, u.name FROM pay_claims c JOIN students s ON s.id = c.student_id JOIN users u ON u.tg_id = s.tg_id
       WHERE c.teacher_id = ? AND c.status = 'open' ORDER BY c.id`).bind(user.tg_id).all();
    out.claims = cl;
    out.uses_pay = !!(set.pack_price || pays.length);
  }
  if (isStudent) {
    const { results: subs } = await env.DB.prepare(
      `SELECT s.id, s.teacher_id, u.name AS teacher_name,
        (SELECT lessons || ':' || amount FROM pay_claims c WHERE c.student_id = s.id AND c.status = 'open' LIMIT 1) AS claim,
        (SELECT COALESCE(SUM(lessons), 0) FROM payments p WHERE p.student_id = s.id) AS paid,
        (SELECT COUNT(*) FROM lessons l WHERE l.student_id = s.id AND ${USED} AND l.starts_at < ?) AS used
       FROM students s JOIN users u ON u.tg_id = s.teacher_id WHERE s.tg_id = ?`
    ).bind(now, user.tg_id).all();
    for (const s of subs) {
      const set = await settingsOf(env, s.teacher_id);
      const claim = s.claim ? { lessons: Number(s.claim.split(':')[0]), amount: Number(s.claim.split(':')[1]) } : null;
      out.my_subs.push({ id: s.id, teacher_id: s.teacher_id, teacher_name: s.teacher_name, paid: Number(s.paid), used: Number(s.used), left: Number(s.paid) - Number(s.used), pack_size: set.pack_size, pack_price: set.pack_price, late_hours: set.late_hours, claim });
    }
  }
  markPaidLessons(out);
  return out;
}

// ---------- оплаты ----------

// Записать оплату и сообщить ученику. st — строка students (id, tg_id).
async function recordPayment(env, teacher, st, lessons, amount, kind, origin) {
  const n = Math.min(Math.max(Math.round(Number(lessons) || 0), 1), 100), sum = kind === 'initial' ? 0 : Math.max(Math.round(Number(amount) || 0), 0);
  const res = await env.DB.prepare('INSERT INTO payments (teacher_id, student_id, lessons, amount, kind) VALUES (?, ?, ?, ?, ?)').bind(teacher.tg_id, st.id, n, sum, kind).run();
  if (kind !== 'initial') {
    const b = await balanceOf(env, st.id);
    await send(env, st.tg_id, `Учитель ${esc(teacher.name)} отметил оплату: ${lessonsWord(n)}${sum ? ` (${sum} zł)` : ''}. ${balanceLine(b.left)}`, appButton(origin, 'Мои уроки'));
  }
  return res && res.meta ? res.meta.last_row_id : null;
}

// Оплачен ли урок: хватает ли остатка абонемента с учётом уроков, которые будут раньше этого.
async function lessonCovered(env, l) {
  const now = nowLocal(), b = await balanceOf(env, l.student_id);
  if (l.starts_at <= now) return b.left >= 0;
  const before = await env.DB.prepare(`SELECT COUNT(*) AS n FROM lessons WHERE student_id = ? AND status IN ${ACTIVE} AND starts_at > ? AND starts_at < ?`).bind(l.student_id, now, l.starts_at).first();
  return b.left - Number(before.n) >= 1;
}

function packText(set) { return `${lessonsWord(set.pack_size)}${set.pack_price ? ` · ${set.pack_price} zł` : ''}`; }
// Сумма за n уроков по цене абонемента: 4 за 600 → 1 урок 150, 8 уроков 1200 (так же считает экран).
function priceFor(set, n) {
  if (!set.pack_price || !(n >= 1)) return 0;
  const k = n / set.pack_size;
  return Number.isInteger(k) ? set.pack_price * k : Math.round((n * set.pack_price) / set.pack_size);
}
// Варианты для кнопок: 1 урок, абонемент, два абонемента.
function payPresets(set) {
  const p = set.pack_size || 4, a = p === 1 ? [1, 4, 8] : [1, p, 2 * p];
  return a.filter((x, i) => a.indexOf(x) === i);
}
function payText(set, n) { const sum = priceFor(set, n); return `${lessonsWord(n)}${sum ? ` · ${sum} zł` : ''}`; }

// «Получил оплату» кнопкой в сообщении бота: за сколько уроков — выбрал учитель, сумма по цене урока.
async function payForLesson(env, user, lid, origin, lessons = 0) {
  const l = await loadLesson(env, lid);
  if (!l || l.teacher_id !== user.tg_id) return { error: 'Только для учителя' };
  if (await lessonCovered(env, l)) return { error: 'Этот урок уже оплачен' };
  const took = await env.DB.prepare('UPDATE lessons SET pay_asked = 2 WHERE id = ? AND pay_asked != 2').bind(lid).run();
  if (!changed(took)) return { error: 'Оплата по этому уроку уже записана' };
  const set = await settingsOf(env, l.teacher_id);
  const n = Math.min(Math.max(Math.round(lessons) || set.pack_size, 1), 100);
  const id = await recordPayment(env, user, { id: l.student_id, tg_id: l.student_tg }, n, priceFor(set, n), 'pay', origin);
  return { ok: true, id, msg: `Записано: ${esc(l.student_name)}, ${payText(set, n)}. Ученик получил подтверждение. Ошиблись — «Все оплаты» в приложении → «Отменить».` };
}

// Ученик нажал «Я оплатил»: абонемент засчитается, только когда учитель подтвердит.
async function claimPayment(env, user, subId, lessons, amount, origin) {
  const st = await env.DB.prepare('SELECT s.*, u.name AS teacher_name FROM students s JOIN users u ON u.tg_id = s.teacher_id WHERE s.id = ? AND s.tg_id = ?').bind(subId, user.tg_id).first();
  if (!st) return { error: 'Учитель не найден' };
  if (await env.DB.prepare("SELECT 1 FROM pay_claims WHERE student_id = ? AND status = 'open'").bind(st.id).first()) return { error: 'Уже отправлено — ждём, что ответит учитель' };
  const set = await settingsOf(env, st.teacher_id);
  const n = Math.min(Math.max(Math.round(Number(lessons) || set.pack_size), 1), 100), sum = Math.max(Math.round(Number(amount) || 0), 0);
  const res = await env.DB.prepare('INSERT INTO pay_claims (teacher_id, student_id, lessons, amount) VALUES (?, ?, ?, ?)').bind(st.teacher_id, st.id, n, sum).run();
  const cid = res.meta.last_row_id;
  const m = await send(env, st.teacher_id, `${esc(user.name)} пишет, что оплатил: <b>${lessonsWord(n)}${sum ? ` · ${sum} zł` : ''}</b>. Деньги получили?`, { inline_keyboard: [
    [{ text: 'Получил', callback_data: `ca:${cid}` }, { text: 'Не получал', callback_data: `cr:${cid}` }],
  ] });
  if (m && m.ok) await env.DB.prepare('UPDATE pay_claims SET msg_chat = ?, msg_id = ? WHERE id = ?').bind(st.teacher_id, m.result.message_id, cid).run();
  return { ok: true };
}

async function answerClaim(env, user, cid, ok, origin, cq) {
  const c = await env.DB.prepare('SELECT c.*, s.tg_id AS student_tg, u.name AS student_name FROM pay_claims c JOIN students s ON s.id = c.student_id JOIN users u ON u.tg_id = s.tg_id WHERE c.id = ?').bind(cid).first();
  if (!c || c.teacher_id !== user.tg_id) return { error: 'Только для учителя' };
  const what = `${lessonsWord(c.lessons)}${c.amount ? ` · ${c.amount} zł` : ''}`;
  const took = await env.DB.prepare("UPDATE pay_claims SET status = ? WHERE id = ? AND status = 'open'").bind(ok ? 'ok' : 'no', cid).run();
  if (!changed(took)) {
    if (cq) await edit(env, cq, `${esc(c.student_name)}: ${what} — уже отвечено.`);
    return { error: 'Уже отвечено' };
  }
  let msg;
  if (ok) {
    await recordPayment(env, user, { id: c.student_id, tg_id: c.student_tg }, c.lessons, c.amount, 'pay', origin);
    msg = `Оплата записана: ${esc(c.student_name)}, ${what}. Ученик получил подтверждение.`;
  } else {
    await send(env, c.student_tg, `Учитель ${esc(user.name)} пока не видит вашу оплату (${what}). Если это ошибка — напишите учителю.`);
    msg = `${esc(c.student_name)}: ${what} — отмечено «не получал». Ученик получил сообщение.`;
  }
  if (cq) await edit(env, cq, msg);
  else if (c.msg_chat && c.msg_id) await editMsg(env, c.msg_chat, c.msg_id, msg);
  return { ok: true, note: ok ? 'Оплата записана' : 'Ответ отправлен' };
}

// Какие будущие уроки уже оплачены: остаток абонемента «раскладываем» по ближайшим урокам.
// paid_ok — урок оплачен; pay_due — первый неоплаченный (тут учитель ждёт деньги).
function markPaidLessons(out) {
  const left = {};
  for (const s of out.students) left[s.id] = s.left;
  for (const s of out.my_subs) left[s.id] = s.left;
  const usesPay = (l) => (l.is_teaching ? out.uses_pay : !!out.my_subs.find((x) => x.id === l.student_id && (x.paid || x.pack_price)));
  const idx = {}, until = {};
  for (const l of out.lessons) {
    if (l.past || !['scheduled', 'pending'].includes(l.status) || !(l.student_id in left) || !usesPay(l)) continue;
    const i = idx[l.student_id] = (idx[l.student_id] || 0) + 1;
    l.paid_ok = i <= left[l.student_id];
    l.pay_due = i === Math.max(left[l.student_id], 0) + 1;
    if (l.paid_ok) until[l.student_id] = l.starts_at;
  }
  for (const s of out.my_subs) s.paid_until = until[s.id] || null;
}

// ---------- демо ----------

async function seedDemo(env) {
  const ids = DEMO_STUDENTS.map((_, i) => DEMO_T - 1 - i);
  const wipe = [
    env.DB.prepare('DELETE FROM lessons WHERE teacher_id = ?').bind(DEMO_T),
    env.DB.prepare('DELETE FROM payments WHERE teacher_id = ?').bind(DEMO_T),
    env.DB.prepare('DELETE FROM pay_claims WHERE teacher_id = ?').bind(DEMO_T),
    env.DB.prepare('DELETE FROM series_auto WHERE teacher_id = ?').bind(DEMO_T),
    env.DB.prepare('DELETE FROM busy WHERE teacher_id = ?').bind(DEMO_T),
    env.DB.prepare('DELETE FROM students WHERE teacher_id = ?').bind(DEMO_T),
    env.DB.prepare('DELETE FROM teacher_settings WHERE teacher_id = ?').bind(DEMO_T),
    env.DB.prepare('DELETE FROM users WHERE tg_id <= ? AND tg_id >= ?').bind(DEMO_T, DEMO_T - 50),
    env.DB.prepare('INSERT INTO users (tg_id, name, is_teacher) VALUES (?, ?, 1)').bind(DEMO_T, 'Павел (демо)'),
    env.DB.prepare('INSERT INTO teacher_settings (teacher_id, pack_size, pack_price, default_duration, late_hours) VALUES (?, 4, 600, 60, 0)').bind(DEMO_T),
  ];
  DEMO_STUDENTS.forEach(([name], i) => {
    wipe.push(env.DB.prepare('INSERT INTO users (tg_id, name) VALUES (?, ?)').bind(ids[i], name));
    wipe.push(env.DB.prepare('INSERT INTO students (tg_id, teacher_id, name) VALUES (?, ?, ?)').bind(ids[i], DEMO_T, name));
  });
  await env.DB.batch(wipe);
  const now = nowLocal(), mon = monday(now.slice(0, 10));
  const stmts = [];
  for (let i = 0; i < DEMO_STUDENTS.length; i++) {
    const [, wd, hm, paid] = DEMO_STUDENTS[i];
    const st = await env.DB.prepare('SELECT id FROM students WHERE tg_id = ?').bind(ids[i]).first();
    const series = Date.now() * 10 + i;
    stmts.push(env.DB.prepare('INSERT OR IGNORE INTO series_auto (series_id, teacher_id) VALUES (?, ?)').bind(series, DEMO_T));
    for (let k = 0; k < 10; k++) {
      stmts.push(env.DB.prepare('INSERT INTO lessons (teacher_id, student_id, starts_at, series_id, reminded) VALUES (?, ?, ?, ?, 1)')
        .bind(DEMO_T, st.id, `${addDays(mon, wd - 14 + k * 7)} ${hm}`, series));
    }
    if (paid > 0) stmts.push(env.DB.prepare("INSERT INTO payments (teacher_id, student_id, lessons, amount, kind) VALUES (?, ?, ?, ?, 'pay')").bind(DEMO_T, st.id, paid, paid / 4 * 600));
    if (paid < 0) stmts.push(env.DB.prepare("INSERT INTO payments (teacher_id, student_id, lessons, amount, kind) VALUES (?, ?, ?, 0, 'initial')").bind(DEMO_T, st.id, -paid));
  }
  await env.DB.batch(stmts);
  const next = async (i) => {
    const st = await env.DB.prepare('SELECT id FROM students WHERE tg_id = ?').bind(ids[i]).first();
    return env.DB.prepare("SELECT * FROM lessons WHERE student_id = ? AND starts_at > ? ORDER BY starts_at LIMIT 1").bind(st.id, now).first();
  };
  const sidOf = async (i) => (await env.DB.prepare('SELECT id FROM students WHERE tg_id = ?').bind(ids[i]).first()).id;
  // Кася просит перенести ближайший урок на день позже
  const k = await next(2);
  await env.DB.prepare("UPDATE lessons SET status = 'pending', proposed_start = ?, proposed_by = 's', proposed_scope = 'one', proposed_at = ? WHERE id = ?")
    .bind(`${addDays(k.starts_at.slice(0, 10), 1)} ${k.starts_at.slice(11, 16)}`, now, k.id).run();
  // Марек ответил на напоминание «не смогу»
  const m = await next(1);
  await env.DB.prepare("UPDATE lessons SET reminder_answer = 'no' WHERE id = ?").bind(m.id).run();
  // Прошедший урок Олы с открытым вопросом
  const o = await env.DB.prepare("SELECT id FROM lessons WHERE student_id = ? AND starts_at < ? ORDER BY starts_at DESC LIMIT 1").bind(await sidOf(0), now).first();
  if (o) await env.DB.prepare("UPDATE lessons SET reminder_answer = 'no', check_needed = 1 WHERE id = ?").bind(o.id).run();
  // Концерт в день ближайшего урока Томека
  const t = await next(3);
  await env.DB.prepare("INSERT INTO busy (teacher_id, day, from_t, to_t, note) VALUES (?, ?, '17:00', '23:00', 'Концерт')").bind(DEMO_T, t.starts_at.slice(0, 10)).run();
}

// ---------- свободные окна ----------

async function freeSlots(env, user, body) {
  let teacherId, dur = 60, base = null, exclude = 0;
  if (body.lesson_id) {
    const l = await loadLesson(env, Number(body.lesson_id));
    if (!l) return { error: 'Урок не найден' };
    const r = roles(l, user.tg_id);
    if (!r.t && !r.s) return { error: 'Это не ваш урок' };
    teacherId = l.teacher_id; dur = l.duration_min; base = l.starts_at; exclude = l.id;
  } else {
    if (!user.is_teacher) return { error: 'Только для учителя' };
    teacherId = user.tg_id; dur = Number(body.duration) || 60; base = isTs(body.around) ? body.around : null;
  }
  const now = nowLocal(), today = now.slice(0, 10);
  if (!base || base < now) base = `${addDays(today, 1)} ${base ? base.slice(11, 16) : '15:00'}`;
  const baseDay = base.slice(0, 10), baseHm = base.slice(11, 16);
  const from = addDays(baseDay, -3) < today ? today : addDays(baseDay, -3), to = addDays(baseDay, 15);
  const { results: ls } = await env.DB.prepare(`SELECT id, starts_at, duration_min, status, proposed_start FROM lessons WHERE teacher_id = ? AND status IN ${ACTIVE} AND ((starts_at >= ? AND starts_at < ?) OR (proposed_start >= ? AND proposed_start < ?))`)
    .bind(teacherId, `${from} 00:00`, `${to} 00:00`, `${from} 00:00`, `${to} 00:00`).all();
  const { results: bs } = await env.DB.prepare('SELECT * FROM busy WHERE teacher_id = ? AND day >= ? AND day < ?').bind(teacherId, from, to).all();
  const taken = [];
  for (const l of ls) {
    if (l.id === exclude) continue;
    taken.push([l.starts_at.slice(0, 10), mins(l.starts_at.slice(11, 16)), l.duration_min]);
    if (l.status === 'pending' && l.proposed_start) taken.push([l.proposed_start.slice(0, 10), mins(l.proposed_start.slice(11, 16)), l.duration_min]);
  }
  for (const b of bs) taken.push([b.day, mins(b.from_t), mins(b.to_t) - mins(b.from_t)]);
  const free = (day, m) => !taken.some(([d, a, len]) => d === day && m < a + len && a < m + dur);
  const usual = new Set([mins(baseHm)]);
  for (const l of ls) usual.add(mins(l.starts_at.slice(11, 16)));
  const cands = [];
  for (let dd = -3; dd <= 14; dd++) {
    const day = addDays(baseDay, dd);
    if (day < today) continue;
    for (let m = 9 * 60; m <= 21 * 60; m += 30) {
      const ts = `${day} ${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
      if (ts <= now || ts === base || !free(day, m)) continue;
      const score = Math.abs(dd) * 30 + Math.abs(m - mins(baseHm)) / 30 * 12 + (usual.has(m) ? 0 : 15) + (dd < 0 ? 20 : 0);
      cands.push({ ts, score });
    }
  }
  cands.sort((a, b) => a.score - b.score);
  // Выбираем самые близкие к обычному времени, а показываем по порядку дат.
  const top = cands.slice(0, Number(body.limit) || 6).map((c) => c.ts);
  return { slots: top.slice().sort(), best: top[0] || null };
}

// Продлить серию на 12 недель. auto — дальше продлевать самим (без вопросов);
// system — вызов из ежечасной задачи (ученику не пишем, учителю — только если недели пропущены).
async function extendSeries(env, user, seriesId, opts = {}) {
  const { results } = await env.DB.prepare(`${LESSON_SELECT} WHERE l.series_id = ? AND l.status IN ${ACTIVE} ORDER BY l.starts_at DESC LIMIT 1`).bind(seriesId).all();
  const last = results[0];
  if (!last || (!opts.system && last.teacher_id !== user.tg_id)) return { error: 'Серия не найдена' };
  if (opts.auto) await env.DB.prepare('INSERT OR IGNORE INTO series_auto (series_id, teacher_id) VALUES (?, ?)').bind(seriesId, last.teacher_id).run();
  const hm = last.starts_at.slice(11, 16), wdName = WD_PLURAL[weekday(last.starts_at.slice(0, 10))];
  // Уже запланировано больше чем на 8 недель вперёд — добавлять рано (и повторное нажатие ничего не удвоит).
  if (last.starts_at > nowLocal(56 * 24 * 3600 * 1000)) {
    return { ok: true, added: 0, skipped: [], msg: opts.auto
      ? `Готово: уроки ${esc(last.student_name)} по ${wdName} в ${hm} будут продлеваться сами. Остановить — «Отменить урок → этот и все следующие».`
      : `Уроки уже запланированы до ${fmtDate(last.starts_at.slice(0, 10))}.` };
  }
  const dates = [], skipped = [];
  for (let i = 1; i <= 12; i++) {
    const d = `${addDays(last.starts_at.slice(0, 10), i * 7)} ${hm}`;
    const c = await findConflict(env, last.teacher_id, d, last.duration_min, 0);
    if (c) skipped.push(`${fmtDate(d.slice(0, 10))} — ${esc(conflictText(c, true).replace(/\.$/, ''))}`); else dates.push(d);
  }
  if (!dates.length) return { error: 'Все 12 следующих недель в это время заняты. Добавьте уроки на другое время.' };
  await env.DB.batch(dates.map((d) => env.DB.prepare('INSERT INTO lessons (teacher_id, student_id, starts_at, series_id, duration_min) VALUES (?, ?, ?, ?, ?)').bind(last.teacher_id, last.student_id, d, seriesId, last.duration_min)));
  const until = fmtDate(dates[dates.length - 1].slice(0, 10));
  const skipNote = skipped.length ? `\nПропущены (время занято): ${skipped.map((x) => x.split(' — ')[0]).join(', ')}.` : '';
  const skipList = skipped.length ? `\nПропущены, потому что время занято:\n${skipped.join('\n')}` : '';
  if (opts.system) {
    if (skipped.length) await send(env, last.teacher_id, `Регулярные уроки ${esc(last.student_name)} продлены до ${until}.${skipList}`);
  } else {
    await send(env, last.student_tg, `Учитель ${esc(last.teacher_name)}: уроки продлены — по ${wdName} в ${hm}${opts.auto ? ', без срока' : `, до ${until}`}.${skipNote}`);
  }
  const head = opts.auto ? `Готово: уроки ${esc(last.student_name)} по ${wdName} в ${hm} будут продлеваться сами.` : `Продлено: ${esc(last.student_name)}, по ${wdName} в ${hm}, до ${until} (${lessonsWord(dates.length)}).`;
  return { ok: true, added: dates.length, skipped, msg: head + skipList };
}

// Учитель решает, состоялся ли прошедший урок, по которому был открытый вопрос.
async function resolveLesson(env, user, lid, held) {
  const l = await loadLesson(env, lid);
  if (!l || l.teacher_id !== user.tg_id) return { error: 'Только для учителя' };
  if (l.starts_at > nowLocal()) return { error: 'Урок ещё не прошёл' };
  if (l.status === 'cancelled') return { msg: `Урок ${esc(l.student_name)} ${fmt(l.starts_at)} уже отмечен как несостоявшийся.` };
  if (l.status === 'pending') await closeProposalMsg(env, l, `Урок ${fmt(l.starts_at)} уже прошёл — предложение перенести больше не действует.`);
  if (held) {
    await env.DB.prepare("UPDATE lessons SET status = 'scheduled', check_needed = 0, reminder_answer = 'held', proposed_start = NULL, proposed_by = NULL, proposed_scope = NULL WHERE id = ?").bind(lid).run();
    return { ok: true, msg: `Отмечено: урок ${esc(l.student_name)} ${fmt(l.starts_at)} состоялся и списан с абонемента.` };
  }
  await env.DB.prepare("UPDATE lessons SET status = 'cancelled', check_needed = 0, proposed_start = NULL, proposed_by = NULL, proposed_scope = NULL WHERE id = ?").bind(lid).run();
  await send(env, l.student_tg, `Урок <b>${fmt(l.starts_at)}</b> не состоялся — с абонемента не списан.`);
  return { ok: true, msg: `Отмечено: урок ${esc(l.student_name)} ${fmt(l.starts_at)} не состоялся, не списан.` };
}

// ---------- календарь ----------

async function calendarFeed(url, env) {
  const m = url.pathname.match(/^\/cal\/([A-Za-z0-9]+)\.ics$/);
  if (!m) return text('not found', 404);
  const user = await env.DB.prepare('SELECT * FROM users WHERE cal_key = ?').bind(m[1]).first();
  if (!user) return text('not found', 404);
  const since = `${addDays(nowLocal().slice(0, 10), -60)} 00:00`;
  const { results } = await env.DB.prepare(`${LESSON_SELECT} WHERE (l.teacher_id = ? OR s.tg_id = ?) AND l.status IN ('scheduled', 'pending') AND l.starts_at >= ? ORDER BY l.starts_at LIMIT 500`)
    .bind(user.tg_id, user.tg_id, since).all();
  const stamp = icsUtc(Date.now());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SlotMate//RU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:Уроки (SlotMate)', 'X-PUBLISHED-TTL:PT1H', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H'];
  for (const l of results) {
    const start = localToUtcMs(l.starts_at), end = start + l.duration_min * 60000;
    const asTeacher = l.teacher_id === user.tg_id;
    const desc = l.status === 'pending' && l.proposed_start ? `Предложен перенос на ${fmt(l.proposed_start)}, ждём ответа.` : 'Из SlotMate.';
    lines.push('BEGIN:VEVENT', `UID:lesson-${l.id}-${asTeacher ? 't' : 's'}@slotmate`, `DTSTAMP:${stamp}`, `DTSTART:${icsUtc(start)}`, `DTEND:${icsUtc(end)}`,
      `SUMMARY:${icsText(`Урок · ${asTeacher ? l.student_name : l.teacher_name}`)}`, `DESCRIPTION:${icsText(desc)}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return new Response(lines.map(foldLine).join('\r\n') + '\r\n', { headers: { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'no-cache' } });
}
function icsUtc(ms) { return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }
function icsText(s) { return String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;'); }
function foldLine(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = []; let cur = '', curBytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length, limit = out.length ? 74 : 75;
    if (curBytes + b > limit) { out.push(cur); cur = ''; curBytes = 0; }
    cur += ch; curBytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

// ---------- напоминания (раз в час по расписанию) ----------

async function runHourly(env, origin) {
  const now = nowLocal(), until = nowLocal(24 * 3600 * 1000), today = now.slice(0, 10), hour = Number(now.slice(11, 13));
  // Каждый шаг — отдельно: если один упадёт (например, нет связи), остальные всё равно выполнятся.
  const step = async (name, fn) => { try { await fn(); } catch (e) { console.error('hourly step failed', name, (e && e.stack) || e); } };

  await step('reminders', async () => {
  // 1. Ученикам — за сутки до урока, с кнопками «Буду / Не смогу».
  const { results: soon } = await env.DB.prepare(`${LESSON_SELECT} WHERE l.reminded = 0 AND l.status IN ('scheduled', 'pending') AND l.starts_at > ? AND l.starts_at <= ?`).bind(now, until).all();
  for (const l of soon) {
    const b = await balanceOf(env, l.student_id);
    const sub = b.paid > 0 ? `\nАбонемент: ${b.left > 0 ? `осталось ${lessonsWord(b.left)}` : 'оплаченные уроки закончились'}.` : '';
    const pend = l.status === 'pending' && l.proposed_start ? `\nПредложен перенос на ${fmt(l.proposed_start)} — ответа пока нет, урок пока на этом времени.` : '';
    await send(env, l.student_tg, `Напоминание: урок <b>${fmt(l.starts_at)}</b> (учитель: ${esc(l.teacher_name)}).${pend}${sub}`,
      { inline_keyboard: [[{ text: 'Буду', callback_data: `cf:${l.id}` }, { text: 'Не смогу', callback_data: `cn:${l.id}` }]] });
    await env.DB.prepare('UPDATE lessons SET reminded = 1 WHERE id = ?').bind(l.id).run();
  }
  });

  await step('summary', async () => {
  // 2. Учителям — вечером список уроков на завтра.
  if (hour >= 19) {
    const tomorrow = addDays(today, 1);
    const { results: teachers } = await env.DB.prepare('SELECT * FROM users WHERE is_teacher = 1 AND (last_summary IS NULL OR last_summary != ?)').bind(today).all();
    for (const t of teachers) {
      const { results: ls } = await env.DB.prepare(`${LESSON_SELECT} WHERE l.teacher_id = ? AND substr(l.starts_at, 1, 10) = ? AND l.status IN ('scheduled', 'pending') ORDER BY l.starts_at`).bind(t.tg_id, tomorrow).all();
      if (ls.length) {
        const rows = ls.map((l) => `${l.starts_at.slice(11, 16)} — ${esc(l.student_name)}${l.status === 'pending' ? ' (ждёт ответа на перенос)' : ''}${l.reminder_answer === 'no' ? ' (не сможет)' : ''}`);
        await send(env, t.tg_id, `Завтра, ${fmtDate(tomorrow)}: ${lessonsWord(ls.length)}\n${rows.join('\n')}`, origin ? appButton(origin) : undefined);
      }
      await env.DB.prepare('UPDATE users SET last_summary = ? WHERE tg_id = ?').bind(today, t.tg_id).run();
    }
  }
  });

  await step('open-questions', async () => {
  // 3а. Урок уже начался, а вопрос не решён (перенос не подтвердили или ученик писал «не смогу»).
  //     Урок не списывается, пока учитель не ответит «состоялся / не состоялся».
  const { results: open } = await env.DB.prepare(`${LESSON_SELECT} WHERE l.check_needed = 0 AND l.starts_at <= ? AND (l.status = 'pending' OR (l.status = 'scheduled' AND l.reminder_answer = 'no'))`).bind(now).all();
  for (const l of open) {
    let why;
    if (l.status === 'pending') {
      why = `Перенос на ${fmt(l.proposed_start)} так и не подтвердили.`;
      await closeProposalMsg(env, l, `Урок ${fmt(l.starts_at)} уже начался — предложение перенести на ${fmt(l.proposed_start)} больше не действует.`);
      const proposer = l.proposed_by === 't' ? l.teacher_id : l.student_tg;
      if (proposer !== l.teacher_id) await send(env, proposer, `На ваше предложение перенести урок ${fmt(l.starts_at)} не ответили до начала урока — оно больше не действует. Учитель решит, как быть с этим уроком.`);
    } else why = 'Ученик ответил на напоминание «не смогу».';
    await env.DB.prepare("UPDATE lessons SET status = 'scheduled', check_needed = 1, proposed_start = NULL, proposed_by = NULL, proposed_scope = NULL WHERE id = ?").bind(l.id).run();
    await send(env, l.teacher_id, `Урок ${esc(l.student_name)} <b>${fmt(l.starts_at)}</b> прошёл, но вопрос остался открытым. ${why}\nУрок состоялся?`, { inline_keyboard: [
      [{ text: 'Да, списать', callback_data: `hd:${l.id}` }, { text: 'Нет, не списывать', callback_data: `nh:${l.id}` }],
    ] });
  }
  });

  await step('expired-proposals', async () => {
  // 3б. Предложенное время наступило раньше урока, а ответа нет — закрыть предложение, сообщить обоим.
  const { results: expired } = await env.DB.prepare(`${LESSON_SELECT} WHERE l.status = 'pending' AND l.proposed_start <= ?`).bind(now).all();
  for (const l of expired) {
    await env.DB.prepare("UPDATE lessons SET status = 'scheduled', proposed_start = NULL, proposed_by = NULL, proposed_scope = NULL WHERE id = ?").bind(l.id).run();
    await closeProposalMsg(env, l, `Предложенное время ${fmt(l.proposed_start)} прошло без ответа. Урок остаётся: <b>${fmt(l.starts_at)}</b>.`);
    const proposer = l.proposed_by === 't' ? l.teacher_id : l.student_tg;
    await send(env, proposer, `На ваше предложение перенести урок на ${fmt(l.proposed_start)} не ответили, и это время прошло. Урок остаётся: <b>${fmt(l.starts_at)}</b>.`, origin ? appButton(origin, 'Предложить другое время', `l=${l.id}`) : undefined);
  }
  });

  await step('auto-extend', async () => {
  // 4а. Серии «без срока»: когда запланировано меньше чем на 4 недели вперёд — продлить на 12 недель.
  const { results: autos } = await env.DB.prepare(`SELECT sa.series_id FROM series_auto sa JOIN lessons l ON l.series_id = sa.series_id AND l.status IN ${ACTIVE} GROUP BY sa.series_id HAVING MAX(l.starts_at) <= ?`)
    .bind(nowLocal(28 * 24 * 3600 * 1000)).all();
  for (const a of autos) await extendSeries(env, null, a.series_id, { system: true });
  });

  await step('extend-prompt', async () => {
  // 4б. Обычная серия заканчивается через 2 недели — спросить учителя.
  const { results: ends } = await env.DB.prepare(`SELECT series_id, MAX(starts_at) AS last FROM lessons WHERE series_id IS NOT NULL AND status IN ${ACTIVE} AND series_id NOT IN (SELECT series_id FROM series_auto) GROUP BY series_id HAVING MAX(starts_at) > ? AND MAX(starts_at) <= ?`)
    .bind(now, nowLocal(14 * 24 * 3600 * 1000)).all();
  for (const e of ends) {
    const key = `ext:${e.series_id}`;
    if (await env.DB.prepare('SELECT 1 FROM meta WHERE k = ?').bind(key).first()) continue;
    const { results: ls } = await env.DB.prepare(`${LESSON_SELECT} WHERE l.series_id = ? AND l.starts_at = ?`).bind(e.series_id, e.last).all();
    const l = ls[0];
    if (!l) continue;
    await send(env, l.teacher_id, `Заканчиваются регулярные уроки: ${esc(l.student_name)}, последний — ${fmt(l.starts_at)}. Продолжать каждую неделю?`,
      { inline_keyboard: [[{ text: 'Продлевать автоматически', callback_data: `ex:${e.series_id}` }], [{ text: 'Не продлевать', callback_data: `nx:${e.series_id}` }]] });
    await env.DB.prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)').bind(key, today).run();
  }
  });

  await step('pay-reminders', async () => {
  // 5. За 3 часа до урока: если оплаченные уроки закончились — учителю кнопки «за сколько уроков получил оплату» (одно нажатие).
  const { results: due } = await env.DB.prepare(`${LESSON_SELECT} WHERE l.pay_asked = 0 AND l.teacher_id > 0 AND l.status IN ${ACTIVE} AND COALESCE(l.reminder_answer, '') != 'no' AND l.starts_at > ? AND l.starts_at <= ? ORDER BY l.starts_at`)
    .bind(now, nowLocal(3 * 3600 * 1000)).all();
  for (const l of due) {
    await env.DB.prepare('UPDATE lessons SET pay_asked = 1 WHERE id = ?').bind(l.id).run();
    const set = await settingsOf(env, l.teacher_id);
    const used = set.pack_price || await env.DB.prepare('SELECT 1 FROM payments WHERE teacher_id = ? LIMIT 1').bind(l.teacher_id).first();
    if (!used) continue; // учитель не ведёт оплаты в приложении — не беспокоим
    if (await env.DB.prepare("SELECT 1 FROM pay_claims WHERE student_id = ? AND status = 'open'").bind(l.student_id).first()) continue;
    if (await lessonCovered(env, l)) continue;
    const b = await balanceOf(env, l.student_id);
    const debt = b.left < 0 ? ` Долг: ${lessonsWord(-b.left)}.` : '';
    const none = !b.paid && !b.used;
    // Кнопки: за сколько уроков получили оплату (1 / абонемент / два), «Другое…» — окно оплаты в приложении.
    const opts = payPresets(set).map((n) => ({ text: payText(set, n), callback_data: `pd:${l.id}:${n}` }));
    opts.push({ text: 'Другое…', web_app: { url: appUrl(origin, `s=${l.student_id}&pay=1`) } });
    await send(env, l.teacher_id, `Сегодня в <b>${l.starts_at.slice(11, 16)}</b> — ${esc(l.student_name)}. ${none ? 'Оплаты ещё не было.' : 'Оплаченные уроки закончились.'}${debt}\nПолучили оплату? Нажмите, за сколько уроков:`, { inline_keyboard: [
      opts.slice(0, 2), opts.slice(2),
      [{ text: 'Пока не оплатил', callback_data: `pl:${l.id}` }],
    ] });
  }
  });

  await step('stale-proposals', async () => {
  // 6. Предложение без ответа больше суток — напомнить тому, кто должен ответить.
  const dayAgo = nowLocal(-24 * 3600 * 1000);
  const { results: stale } = await env.DB.prepare(`${LESSON_SELECT} WHERE l.status = 'pending' AND l.pinged = 0 AND l.proposed_at IS NOT NULL AND l.proposed_at <= ? AND l.proposed_start > ?`).bind(dayAgo, now).all();
  for (const l of stale) {
    await closeProposalMsg(env, l, 'Это предложение продублировано ниже.');
    await env.DB.prepare('UPDATE lessons SET pinged = 1, proposal_chat = NULL, proposal_msg = NULL WHERE id = ?').bind(l.id).run();
    if (origin) await sendProposal(env, l, origin, 'Ждём вашего ответа уже сутки.\n\n');
  }
  });
}
