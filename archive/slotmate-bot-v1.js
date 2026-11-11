// SlotMate — бот для записи на уроки (первая версия).
// Работает на Cloudflare Workers с базой D1.
// Нужно в настройках воркера: привязка базы D1 с именем DB и секрет BOT_TOKEN.
// После публикации один раз откройте в браузере адрес воркера с /setup на конце.

const TZ = 'Europe/Warsaw';
const WD = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const WD_PLURAL = ['воскресеньям', 'понедельникам', 'вторникам', 'средам', 'четвергам', 'пятницам', 'субботам'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WEEKS_AHEAD = 8;

let schemaReady = false;
let botUsername = null;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!env.DB) return text('Не подключена база: добавьте привязку D1 с именем DB.');
    if (!env.BOT_TOKEN) return text('Не задан секрет BOT_TOKEN.');
    await ensureSchema(env);

    if (url.pathname === '/setup') return setup(url, env);
    if (url.pathname.startsWith('/cal/')) return calendarFeed(url, env);
    if (url.pathname === '/telegram' && request.method === 'POST') {
      const secret = await webhookSecret(env);
      if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== secret) {
        return new Response('forbidden', { status: 403 });
      }
      let update;
      try {
        update = await request.json();
      } catch (e) {
        return new Response('bad request', { status: 400 });
      }
      try {
        await handleUpdate(update, env, url.origin);
      } catch (e) {
        console.error('update failed', (e && e.stack) || e);
      }
      return new Response('ok');
    }
    return text('SlotMate работает.');
  },

  async scheduled(event, env, ctx) {
    if (!env.DB || !env.BOT_TOKEN) return;
    await ensureSchema(env);
    await sendReminders(env);
  },
};

// ---------- база данных ----------

async function ensureSchema(env) {
  if (schemaReady) return;
  const statements = [
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
    `CREATE INDEX IF NOT EXISTS idx_lessons_teacher ON lessons (teacher_id, starts_at)`,
    `CREATE INDEX IF NOT EXISTS idx_lessons_student ON lessons (student_id, starts_at)`,
    `CREATE INDEX IF NOT EXISTS idx_users_invite ON users (invite_code)`,
    `CREATE INDEX IF NOT EXISTS idx_users_cal ON users (cal_key)`,
  ];
  await env.DB.batch(statements.map((s) => env.DB.prepare(s)));
  schemaReady = true;
}

async function upsertUser(env, from) {
  const name = [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || 'Без имени';
  await env.DB.prepare(
    `INSERT INTO users (tg_id, name, username) VALUES (?, ?, ?)
     ON CONFLICT(tg_id) DO UPDATE SET name = excluded.name, username = excluded.username`
  ).bind(from.id, name, from.username || null).run();
  return env.DB.prepare('SELECT * FROM users WHERE tg_id = ?').bind(from.id).first();
}

async function isStudentAnywhere(env, tgId) {
  const row = await env.DB.prepare('SELECT 1 AS x FROM students WHERE tg_id = ? LIMIT 1').bind(tgId).first();
  return !!row;
}

async function loadLesson(env, lid) {
  if (!Number.isFinite(lid)) return null;
  return env.DB.prepare(
    `SELECT l.*, s.tg_id AS student_tg, su.name AS student_name, tu.name AS teacher_name
     FROM lessons l
     JOIN students s ON s.id = l.student_id
     JOIN users su ON su.tg_id = s.tg_id
     JOIN users tu ON tu.tg_id = l.teacher_id
     WHERE l.id = ?`
  ).bind(lid).first();
}

function roles(lesson, uid) {
  return { t: lesson.teacher_id === uid, s: lesson.student_tg === uid };
}

function lessonTitle(lesson, r) {
  return r.t ? `(ученик: ${esc(lesson.student_name)})` : `(учитель: ${esc(lesson.teacher_name)})`;
}

// ---------- мелкие помощники ----------

function text(body, status = 200) {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function randomCode(len) {
  const abc = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => abc[b % abc.length]).join('');
}

async function webhookSecret(env) {
  const data = new TextEncoder().encode('slotmate:' + env.BOT_TOKEN);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 48);
}

// ---------- время (всё хранится по варшавскому времени, вида 2026-11-07 15:00) ----------

const pad = (n) => String(n).padStart(2, '0');

function localParts(date) {
  const p = {};
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
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

function weekday(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function ymdFrom8(ymd8) {
  return `${ymd8.slice(0, 4)}-${ymd8.slice(4, 6)}-${ymd8.slice(6, 8)}`;
}

function fmtDate(ymd) {
  const [, m, d] = ymd.split('-').map(Number);
  return `${WD[weekday(ymd)]}, ${d} ${MONTHS[m - 1]}`;
}

function fmt(ts) {
  return `${fmtDate(ts.slice(0, 10))}, ${ts.slice(11, 16)}`;
}

function fmtShort(ts) {
  const ymd = ts.slice(0, 10);
  const [, m, d] = ymd.split('-').map(Number);
  return `${WD[weekday(ymd)]} ${d}.${pad(m)} ${ts.slice(11, 16)}`;
}

function compactToTs(ymd8, hhmm) {
  return `${ymdFrom8(ymd8)} ${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}`;
}

function tsToCompact(ts) {
  return ts.replace(/[-: ]/g, '');
}

function isValidSlot(ymd8, hhmm) {
  return /^\d{8}$/.test(ymd8 || '') && /^\d{4}$/.test(hhmm || '');
}

function localToUtcMs(ts) {
  const [y, m, d] = ts.slice(0, 10).split('-').map(Number);
  const [h, mi] = ts.slice(11, 16).split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const offsetAt = (ms) => {
    const p = localParts(new Date(ms));
    return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - ms;
  };
  let result = guess - offsetAt(guess);
  const second = guess - offsetAt(result);
  if (second !== result) result = second;
  return result;
}

// ---------- Телеграм ----------

async function tg(env, method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  let data;
  try {
    data = await res.json();
  } catch (e) {
    data = { ok: false, description: 'bad response' };
  }
  if (!data.ok) console.log('Telegram error', method, data.description);
  return data;
}

function send(env, chatId, msg, markup) {
  const payload = { chat_id: chatId, text: msg, parse_mode: 'HTML', disable_web_page_preview: true };
  if (markup) payload.reply_markup = markup;
  return tg(env, 'sendMessage', payload);
}

function edit(env, cq, msg, markup) {
  return tg(env, 'editMessageText', {
    chat_id: cq.message.chat.id,
    message_id: cq.message.message_id,
    text: msg,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: markup || { inline_keyboard: [] },
  });
}

async function getBotUsername(env) {
  if (!botUsername) {
    const me = await tg(env, 'getMe', {});
    botUsername = me.ok ? me.result.username : 'Slot_Mate_Bot';
  }
  return botUsername;
}

async function setup(url, env) {
  const r = await tg(env, 'setWebhook', {
    url: `${url.origin}/telegram`,
    secret_token: await webhookSecret(env),
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
  });
  await tg(env, 'setMyCommands', {
    commands: [
      { command: 'start', description: 'Главное меню' },
      { command: 'help', description: 'Как пользоваться' },
    ],
  });
  return text(r.ok
    ? 'Готово! Бот подключён. Откройте его в Телеграме и нажмите «Запустить» (Start).'
    : 'Ошибка подключения: ' + (r.description || 'неизвестно') + '. Проверьте секрет BOT_TOKEN.');
}

// ---------- клавиатуры ----------

async function menuFor(env, user) {
  const student = await isStudentAnywhere(env, user.tg_id);
  const rows = [];
  if (user.is_teacher) rows.push(['Расписание', 'Добавить урок'], ['Ученики', 'Пригласить ученика']);
  if (student) rows.push(['Мои уроки']);
  if (user.is_teacher || student) rows.push(['Календарь']);
  if (user.is_admin) rows.push(['Пригласить учителя']);
  if (!rows.length) return { remove_keyboard: true };
  return { keyboard: rows.map((r) => r.map((t) => ({ text: t }))), resize_keyboard: true, is_persistent: true };
}

function dateKeyboard(prefix, cancelLabel = 'Отмена') {
  const today = nowLocal().slice(0, 10);
  const rows = [];
  let row = [];
  for (let i = 0; i < 14; i++) {
    const ymd = addDays(today, i);
    const [, m, d] = ymd.split('-').map(Number);
    const label = i === 0 ? `Сегодня ${d}.${pad(m)}` : i === 1 ? `Завтра ${d}.${pad(m)}` : `${WD[weekday(ymd)]} ${d}.${pad(m)}`;
    row.push({ text: label, callback_data: `${prefix}:${ymd.replace(/-/g, '')}` });
    if (row.length === 3) {
      rows.push(row);
      row = [];
    }
  }
  if (row.length) rows.push(row);
  rows.push([{ text: cancelLabel, callback_data: 'x' }]);
  return { inline_keyboard: rows };
}

function hourKeyboard(prefix) {
  const rows = [];
  let row = [];
  for (let h = 8; h <= 21; h++) {
    row.push({ text: `${pad(h)}:00`, callback_data: `${prefix}:${pad(h)}` });
    if (row.length === 4) {
      rows.push(row);
      row = [];
    }
  }
  if (row.length) rows.push(row);
  rows.push([{ text: 'Отмена', callback_data: 'x' }]);
  return { inline_keyboard: rows };
}

function minuteKeyboard(prefix, hh) {
  return {
    inline_keyboard: [
      ['00', '15', '30', '45'].map((mm) => ({ text: `${hh}:${mm}`, callback_data: `${prefix}:${hh}${mm}` })),
      [{ text: 'Отмена', callback_data: 'x' }],
    ],
  };
}

// ---------- обработка сообщений ----------

async function handleUpdate(update, env, origin) {
  if (update.message) return handleMessage(update.message, env, origin);
  if (update.callback_query) return handleCallback(update.callback_query, env);
}

async function handleMessage(msg, env, origin) {
  if (!msg.from || !msg.chat || msg.chat.type !== 'private') return;
  const user = await upsertUser(env, msg.from);
  const t = (msg.text || '').trim();

  if (t.startsWith('/start')) {
    const payload = t.split(/\s+/)[1] || '';
    const admins = await env.DB.prepare('SELECT COUNT(*) AS c FROM users WHERE is_admin = 1').first();
    if (!admins || !admins.c) {
      await env.DB.prepare('UPDATE users SET is_admin = 1 WHERE tg_id = ?').bind(user.tg_id).run();
      user.is_admin = 1;
    }
    if (payload.startsWith('t_')) return acceptTeacherInvite(env, user, payload.slice(2));
    if (payload.startsWith('s_')) return acceptStudentInvite(env, user, payload.slice(2));
    return sendWelcome(env, user);
  }

  switch (t) {
    case '/help':
      return sendHelp(env, user);
    case 'Расписание':
      if (user.is_teacher) return showTeacherSchedule(env, user);
      break;
    case 'Добавить урок':
      if (user.is_teacher) return startAddLesson(env, user);
      break;
    case 'Ученики':
      if (user.is_teacher) return showStudents(env, user);
      break;
    case 'Пригласить ученика':
      if (user.is_teacher) return studentInviteLink(env, user);
      break;
    case 'Мои уроки':
      return showStudentLessons(env, user);
    case 'Календарь':
      return sendCalendarLink(env, user, origin);
    case 'Пригласить учителя':
      if (user.is_admin) return createTeacherInvite(env, user);
      break;
  }
  return send(env, user.tg_id, 'Я понимаю кнопки меню внизу. Если меню не видно, отправьте /start.', await menuFor(env, user));
}

async function sendWelcome(env, user) {
  const student = await isStudentAnywhere(env, user.tg_id);
  const lines = [`Привет, ${esc(user.name)}! Это SlotMate — расписание уроков без путаницы.`];
  if (user.is_teacher) lines.push('Вы учитель: здесь ваше расписание, ученики и переносы.');
  if (student) lines.push('Вы ученик: здесь ваши уроки. Если учитель предложит перенос, я пришлю кнопки «Подтвердить» и «Не могу».');
  if (user.is_admin) lines.push('Вы владелец бота. Чтобы подключить учителя, нажмите «Пригласить учителя» и отправьте ему ссылку.');
  if (!user.is_teacher && !student && !user.is_admin) lines.push('Чтобы записаться, попросите у учителя ссылку-приглашение и откройте её.');
  return send(env, user.tg_id, lines.join('\n\n'), await menuFor(env, user));
}

async function sendHelp(env, user) {
  const lines = [
    '<b>Как это работает</b>',
    'Время урока меняется только после подтверждения обеих сторон. Пока ответа нет, урок остаётся на старом времени.',
    '',
    '<b>Учитель:</b> «Добавить урок» — назначить урок (разово или каждую неделю). «Расписание» — нажмите на урок, чтобы перенести или отменить.',
    '<b>Ученик:</b> «Мои уроки» — ваши ближайшие уроки, там же можно предложить перенос.',
    '<b>Календарь:</b> личная ссылка, которую можно один раз добавить в календарь телефона.',
    '',
    'За сутки до урока я пришлю напоминание.',
  ];
  return send(env, user.tg_id, lines.join('\n'), await menuFor(env, user));
}

// ---------- приглашения ----------

async function createTeacherInvite(env, user) {
  const code = randomCode(12);
  await env.DB.prepare('INSERT INTO invites (code, kind, created_by) VALUES (?, ?, ?)').bind(code, 'teacher', user.tg_id).run();
  const link = `https://t.me/${await getBotUsername(env)}?start=t_${code}`;
  return send(env, user.tg_id,
    `Ссылка для учителя (сработает один раз):\n${link}\n\nОтправьте её учителю. Для проверки можете открыть её сами — тогда станете учителем и сможете всё попробовать.`);
}

async function acceptTeacherInvite(env, user, code) {
  const inv = await env.DB.prepare("SELECT * FROM invites WHERE code = ? AND kind = 'teacher'").bind(code).first();
  if (!inv) return send(env, user.tg_id, 'Ссылка не найдена. Попросите новую.', await menuFor(env, user));
  if (inv.used_by && inv.used_by !== user.tg_id) {
    return send(env, user.tg_id, 'Эта ссылка уже использована. Попросите новую.', await menuFor(env, user));
  }
  const inviteCode = user.invite_code || randomCode(10);
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET is_teacher = 1, invite_code = ? WHERE tg_id = ?').bind(inviteCode, user.tg_id),
    env.DB.prepare('UPDATE invites SET used_by = ? WHERE code = ?').bind(user.tg_id, code),
  ]);
  user.is_teacher = 1;
  user.invite_code = inviteCode;
  await send(env, user.tg_id,
    'Готово, вы учитель! Дальше:\n1. Нажмите «Пригласить ученика» и отправьте ссылку ученикам.\n2. Когда ученик откроет ссылку, нажмите «Добавить урок».\n3. Чтобы перенести урок, откройте «Расписание» и нажмите на урок.',
    await menuFor(env, user));
  if (inv.created_by && inv.created_by !== user.tg_id) {
    await send(env, inv.created_by, `Учитель подключился: ${esc(user.name)}.`);
  }
}

async function studentInviteLink(env, user) {
  let code = user.invite_code;
  if (!code) {
    code = randomCode(10);
    await env.DB.prepare('UPDATE users SET invite_code = ? WHERE tg_id = ?').bind(code, user.tg_id).run();
  }
  const link = `https://t.me/${await getBotUsername(env)}?start=s_${code}`;
  return send(env, user.tg_id,
    `Ссылка для учеников (одна для всех):\n${link}\n\nОтправьте её ученикам в Телеграме. Когда ученик откроет её, я пришлю вам уведомление.`);
}

async function acceptStudentInvite(env, user, code) {
  const teacher = await env.DB.prepare('SELECT * FROM users WHERE invite_code = ? AND is_teacher = 1').bind(code).first();
  if (!teacher) return send(env, user.tg_id, 'Ссылка не найдена. Попросите у учителя новую.', await menuFor(env, user));
  const res = await env.DB.prepare(
    'INSERT INTO students (tg_id, teacher_id, name) VALUES (?, ?, ?) ON CONFLICT(tg_id, teacher_id) DO NOTHING'
  ).bind(user.tg_id, teacher.tg_id, user.name).run();
  const isNew = !!(res && res.meta && res.meta.changes > 0);
  await send(env, user.tg_id,
    isNew
      ? `Готово! Ваш учитель — ${esc(teacher.name)}. Когда появится урок, я пришлю его сюда.`
      : `Вы уже записаны. Ваш учитель — ${esc(teacher.name)}.`,
    await menuFor(env, user));
  if (isNew) {
    await send(env, teacher.tg_id, `Новый ученик: <b>${esc(user.name)}</b>. Чтобы назначить урок, нажмите «Добавить урок».`);
  }
}

// ---------- списки ----------

async function showTeacherSchedule(env, user) {
  const now = nowLocal();
  const to = `${addDays(now.slice(0, 10), 14)} 23:59`;
  const { results } = await env.DB.prepare(
    `SELECT l.*, u.name AS student_name FROM lessons l
     JOIN students s ON s.id = l.student_id JOIN users u ON u.tg_id = s.tg_id
     WHERE l.teacher_id = ? AND l.status != 'cancelled' AND l.starts_at >= ? AND l.starts_at <= ?
     ORDER BY l.starts_at LIMIT 40`
  ).bind(user.tg_id, now, to).all();
  if (!results.length) return send(env, user.tg_id, 'На ближайшие две недели уроков нет. Нажмите «Добавить урок».');
  const lines = ['<b>Расписание на 2 недели</b>'];
  let day = '';
  for (const l of results) {
    const d = l.starts_at.slice(0, 10);
    if (d !== day) {
      day = d;
      lines.push('', `<b>${fmtDate(d)}</b>`);
    }
    const pending = l.status === 'pending' && l.proposed_start ? ` · перенос на ${fmtShort(l.proposed_start)} ждёт ответа` : '';
    lines.push(`${l.starts_at.slice(11, 16)} — ${esc(l.student_name)}${pending}`);
  }
  lines.push('', 'Чтобы перенести или отменить урок, нажмите на него ниже.');
  const kb = results.map((l) => [{ text: `${fmtShort(l.starts_at)} · ${l.student_name}`, callback_data: `lx:${l.id}` }]);
  return send(env, user.tg_id, lines.join('\n'), { inline_keyboard: kb });
}

async function showStudentLessons(env, user) {
  const { results } = await env.DB.prepare(
    `SELECT l.*, t.name AS teacher_name FROM lessons l
     JOIN students s ON s.id = l.student_id JOIN users t ON t.tg_id = l.teacher_id
     WHERE s.tg_id = ? AND l.status != 'cancelled' AND l.starts_at >= ?
     ORDER BY l.starts_at LIMIT 10`
  ).bind(user.tg_id, nowLocal()).all();
  if (!results.length) return send(env, user.tg_id, 'Ближайших уроков пока нет. Когда учитель назначит урок, я сообщу.', await menuFor(env, user));
  const lines = ['<b>Ваши ближайшие уроки</b>', ''];
  for (const l of results) {
    let note = '';
    if (l.status === 'pending' && l.proposed_start) {
      note = l.proposed_by === 't'
        ? `\n   учитель предлагает перенос на ${fmtShort(l.proposed_start)} — ответьте на его сообщение`
        : `\n   вы предложили ${fmtShort(l.proposed_start)}, ждём ответа учителя`;
    }
    lines.push(`• <b>${fmt(l.starts_at)}</b> — ${esc(l.teacher_name)}${note}`);
  }
  lines.push('', 'Чтобы предложить перенос или отменить урок, нажмите на него ниже.');
  const kb = results.map((l) => [{ text: fmtShort(l.starts_at), callback_data: `lx:${l.id}` }]);
  return send(env, user.tg_id, lines.join('\n'), { inline_keyboard: kb });
}

async function showStudents(env, user) {
  const { results } = await env.DB.prepare(
    `SELECT s.id, u.name,
       (SELECT COUNT(*) FROM lessons l WHERE l.student_id = s.id AND l.status != 'cancelled' AND l.starts_at >= ?) AS upcoming
     FROM students s JOIN users u ON u.tg_id = s.tg_id
     WHERE s.teacher_id = ? ORDER BY u.name`
  ).bind(nowLocal(), user.tg_id).all();
  if (!results.length) return send(env, user.tg_id, 'Пока нет учеников. Нажмите «Пригласить ученика».');
  const lines = [`<b>Ученики (${results.length})</b>`, ''];
  for (const s of results) lines.push(`• ${esc(s.name)} — впереди уроков: ${s.upcoming}`);
  return send(env, user.tg_id, lines.join('\n'));
}

async function startAddLesson(env, user) {
  const { results } = await env.DB.prepare(
    'SELECT s.id, u.name FROM students s JOIN users u ON u.tg_id = s.tg_id WHERE s.teacher_id = ? ORDER BY u.name'
  ).bind(user.tg_id).all();
  if (!results.length) return send(env, user.tg_id, 'Пока нет учеников. Нажмите «Пригласить ученика» и отправьте ссылку.');
  const rows = results.map((s) => [{ text: s.name, callback_data: `al:s:${s.id}` }]);
  rows.push([{ text: 'Отмена', callback_data: 'x' }]);
  return send(env, user.tg_id, 'Кому добавить урок?', { inline_keyboard: rows });
}

// ---------- кнопки ----------

async function handleCallback(cq, env) {
  const user = await upsertUser(env, cq.from);
  let note = '';
  try {
    if (cq.message) note = (await routeCallback(env, cq, user, (cq.data || '').split(':'))) || '';
  } finally {
    const payload = { callback_query_id: cq.id };
    if (note) payload.text = note;
    await tg(env, 'answerCallbackQuery', payload);
  }
}

async function routeCallback(env, cq, user, p) {
  switch (p[0]) {
    case 'x':
      await edit(env, cq, 'Хорошо, ничего не меняю.');
      return '';
    case 'al':
      return addLessonStep(env, cq, user, p);
    case 'rs':
      return rescheduleStep(env, cq, user, p);
    case 'ok':
      return answerProposal(env, cq, user, Number(p[1]), p[2], true);
    case 'no':
      return answerProposal(env, cq, user, Number(p[1]), p[2], false);
    case 'lx':
      return lessonActions(env, user, Number(p[1]));
    case 'cx':
      return cancelAsk(env, cq, user, Number(p[1]));
    case 'cx2':
      return cancelDo(env, cq, user, Number(p[1]));
    default:
      return 'Эта кнопка устарела';
  }
}

async function addLessonStep(env, cq, user, p) {
  if (!user.is_teacher) return 'Только для учителя';
  const step = p[1];
  const sid = Number(p[2]);
  const student = await env.DB.prepare(
    'SELECT s.id, s.tg_id, u.name FROM students s JOIN users u ON u.tg_id = s.tg_id WHERE s.id = ? AND s.teacher_id = ?'
  ).bind(sid, user.tg_id).first();
  if (!student) return 'Ученик не найден';
  const who = `<b>${esc(student.name)}</b>`;

  if (step === 's') {
    await edit(env, cq, `Урок для ${who}. Выберите дату:`, dateKeyboard(`al:d:${sid}`));
    return '';
  }
  const ymd8 = p[3];
  if (!/^\d{8}$/.test(ymd8 || '')) return 'Ошибка даты';
  if (step === 'd') {
    await edit(env, cq, `Урок для ${who}, ${fmtDate(ymdFrom8(ymd8))}. Выберите час:`, hourKeyboard(`al:h:${sid}:${ymd8}`));
    return '';
  }
  if (step === 'h') {
    await edit(env, cq, `Урок для ${who}, ${fmtDate(ymdFrom8(ymd8))}. Уточните время:`, minuteKeyboard(`al:m:${sid}:${ymd8}`, p[4]));
    return '';
  }
  if (!isValidSlot(ymd8, p[4])) return 'Ошибка времени';
  const ts = compactToTs(ymd8, p[4]);
  if (step === 'm') {
    await edit(env, cq, `Урок для ${who}: <b>${fmt(ts)}</b>. Как часто?`, {
      inline_keyboard: [
        [{ text: 'Один раз', callback_data: `al:r:${sid}:${ymd8}:${p[4]}:1` }],
        [{ text: `Каждую неделю (${WEEKS_AHEAD} недель)`, callback_data: `al:r:${sid}:${ymd8}:${p[4]}:${WEEKS_AHEAD}` }],
        [{ text: 'Отмена', callback_data: 'x' }],
      ],
    });
    return '';
  }
  if (step === 'r') {
    if (ts <= nowLocal()) {
      await edit(env, cq, 'Это время уже прошло. Начните заново: «Добавить урок».');
      return '';
    }
    const count = Math.min(Math.max(Number(p[5]) || 1, 1), 52);
    const stmts = [];
    for (let i = 0; i < count; i++) {
      const at = `${addDays(ts.slice(0, 10), i * 7)} ${ts.slice(11, 16)}`;
      stmts.push(env.DB.prepare('INSERT INTO lessons (teacher_id, student_id, starts_at) VALUES (?, ?, ?)').bind(user.tg_id, sid, at));
    }
    await env.DB.batch(stmts);
    const summary = count === 1
      ? `<b>${fmt(ts)}</b>`
      : `каждую неделю по ${WD_PLURAL[weekday(ts.slice(0, 10))]} в <b>${ts.slice(11, 16)}</b>, начиная с ${fmtDate(ts.slice(0, 10))} (${count} уроков)`;
    await edit(env, cq, `Добавлено для ${who}: ${summary}.`);
    await send(env, student.tg_id, `Учитель ${esc(user.name)}: ${count === 1 ? 'назначен урок' : 'назначены уроки'} — ${summary}.`);
    return 'Добавлено';
  }
  return '';
}

async function lessonActions(env, user, lid) {
  const l = await loadLesson(env, lid);
  if (!l) return 'Урок не найден';
  const r = roles(l, user.tg_id);
  if (!r.t && !r.s) return 'Это не ваш урок';
  let msg = `Урок ${lessonTitle(l, r)} — <b>${fmt(l.starts_at)}</b>`;
  if (l.status === 'cancelled') {
    await send(env, user.tg_id, `${msg}\nЭтот урок отменён.`);
    return '';
  }
  if (l.status === 'pending' && l.proposed_start) msg += `\nПеренос на ${fmt(l.proposed_start)} ждёт ответа.`;
  await send(env, user.tg_id, msg, {
    inline_keyboard: [
      [{ text: 'Перенести', callback_data: `rs:l:${lid}` }, { text: 'Отменить урок', callback_data: `cx:${lid}` }],
      [{ text: 'Закрыть', callback_data: 'x' }],
    ],
  });
  return '';
}

async function rescheduleStep(env, cq, user, p) {
  const step = p[1];
  const lid = Number(p[2]);
  const l = await loadLesson(env, lid);
  if (!l) return 'Урок не найден';
  const r = roles(l, user.tg_id);
  if (!r.t && !r.s) return 'Это не ваш урок';
  if (l.status === 'cancelled') {
    await edit(env, cq, 'Этот урок отменён.');
    return '';
  }
  if (l.starts_at < nowLocal()) {
    await edit(env, cq, 'Этот урок уже прошёл.');
    return '';
  }
  const head = `Перенос урока ${lessonTitle(l, r)}. Сейчас: <b>${fmt(l.starts_at)}</b>.`;

  if (step === 'l') {
    await edit(env, cq, `${head}\nВыберите новую дату:`, dateKeyboard(`rs:d:${lid}`));
    return '';
  }
  const ymd8 = p[3];
  if (!/^\d{8}$/.test(ymd8 || '')) return 'Ошибка даты';
  if (step === 'd') {
    await edit(env, cq, `${head}\n${fmtDate(ymdFrom8(ymd8))}. Выберите час:`, hourKeyboard(`rs:h:${lid}:${ymd8}`));
    return '';
  }
  if (step === 'h') {
    await edit(env, cq, `${head}\n${fmtDate(ymdFrom8(ymd8))}. Уточните время:`, minuteKeyboard(`rs:m:${lid}:${ymd8}`, p[4]));
    return '';
  }
  if (step === 'm') {
    if (!isValidSlot(ymd8, p[4])) return 'Ошибка времени';
    const ts = compactToTs(ymd8, p[4]);
    if (ts <= nowLocal()) {
      await edit(env, cq, `${head}\nЭто время уже прошло. Выберите другую дату:`, dateKeyboard(`rs:d:${lid}`));
      return '';
    }
    if (ts === l.starts_at) {
      await edit(env, cq, `${head}\nЭто то же самое время. Выберите другую дату:`, dateKeyboard(`rs:d:${lid}`));
      return '';
    }
    const by = r.t && r.s ? (l.proposed_by === 't' ? 's' : 't') : r.t ? 't' : 's';
    await env.DB.prepare("UPDATE lessons SET status = 'pending', proposed_start = ?, proposed_by = ? WHERE id = ?").bind(ts, by, lid).run();
    await edit(env, cq,
      `Предложение отправлено.\nБыло: ${fmt(l.starts_at)}\nСтанет: <b>${fmt(ts)}</b>\n\nПока нет ответа, урок остаётся на старом времени.`);
    await sendProposal(env, { ...l, proposed_start: ts, proposed_by: by });
    return 'Отправлено';
  }
  return '';
}

async function sendProposal(env, l) {
  const toTeacher = l.proposed_by === 's';
  const chat = toTeacher ? l.teacher_id : l.student_tg;
  const fromName = toTeacher ? `Ученик ${esc(l.student_name)}` : `Учитель ${esc(l.teacher_name)}`;
  const code = tsToCompact(l.proposed_start);
  return send(env, chat,
    `${fromName} предлагает перенести урок.\nБыло: <s>${fmt(l.starts_at)}</s>\nСтанет: <b>${fmt(l.proposed_start)}</b>`,
    { inline_keyboard: [[
      { text: 'Подтвердить', callback_data: `ok:${l.id}:${code}` },
      { text: 'Не могу', callback_data: `no:${l.id}:${code}` },
    ]] });
}

async function answerProposal(env, cq, user, lid, code, accept) {
  const l = await loadLesson(env, lid);
  if (!l) return 'Урок не найден';
  const r = roles(l, user.tg_id);
  if (l.status !== 'pending' || !l.proposed_start || tsToCompact(l.proposed_start) !== code) {
    await edit(env, cq, 'Это предложение уже неактуально.');
    return '';
  }
  const allowed = (l.proposed_by === 't' && r.s) || (l.proposed_by === 's' && r.t);
  if (!allowed) return 'Ответить должна другая сторона';
  const proposerChat = l.proposed_by === 't' ? l.teacher_id : l.student_tg;
  const responder = l.proposed_by === 't' ? `Ученик ${esc(l.student_name)}` : `Учитель ${esc(l.teacher_name)}`;

  if (accept) {
    await env.DB.prepare(
      "UPDATE lessons SET starts_at = proposed_start, status = 'scheduled', proposed_start = NULL, proposed_by = NULL, reminded = 0 WHERE id = ?"
    ).bind(lid).run();
    await edit(env, cq, `Готово! Урок перенесён на <b>${fmt(l.proposed_start)}</b>.\nЕсли вы подписаны на календарь, он обновится сам.`);
    await send(env, proposerChat, `${responder} подтверждает перенос. Урок: <b>${fmt(l.proposed_start)}</b>.`);
    return 'Подтверждено';
  }

  await env.DB.prepare("UPDATE lessons SET status = 'scheduled', proposed_start = NULL, proposed_by = NULL WHERE id = ?").bind(lid).run();
  await edit(env, cq,
    `Понял, ${fmt(l.proposed_start)} не подходит. Урок пока остаётся: <b>${fmt(l.starts_at)}</b>.\n\nХотите предложить своё время? Выберите дату:`,
    dateKeyboard(`rs:d:${lid}`, 'Оставить как было'));
  await send(env, proposerChat,
    `${responder}: время ${fmt(l.proposed_start)} не подходит. Урок пока остаётся: <b>${fmt(l.starts_at)}</b>. Если будет встречное предложение, я пришлю его.`);
  return 'Ответ отправлен';
}

async function cancelAsk(env, cq, user, lid) {
  const l = await loadLesson(env, lid);
  if (!l) return 'Урок не найден';
  const r = roles(l, user.tg_id);
  if (!r.t && !r.s) return 'Это не ваш урок';
  if (l.status === 'cancelled') {
    await edit(env, cq, 'Этот урок уже отменён.');
    return '';
  }
  await edit(env, cq, `Отменить урок ${lessonTitle(l, r)} — <b>${fmt(l.starts_at)}</b>?`, {
    inline_keyboard: [[{ text: 'Да, отменить', callback_data: `cx2:${lid}` }, { text: 'Нет', callback_data: 'x' }]],
  });
  return '';
}

async function cancelDo(env, cq, user, lid) {
  const l = await loadLesson(env, lid);
  if (!l) return 'Урок не найден';
  const r = roles(l, user.tg_id);
  if (!r.t && !r.s) return 'Это не ваш урок';
  if (l.status === 'cancelled') {
    await edit(env, cq, 'Этот урок уже отменён.');
    return '';
  }
  await env.DB.prepare("UPDATE lessons SET status = 'cancelled', proposed_start = NULL, proposed_by = NULL WHERE id = ?").bind(lid).run();
  await edit(env, cq, `Урок <b>${fmt(l.starts_at)}</b> отменён.`);
  const other = r.t ? l.student_tg : l.teacher_id;
  if (other !== user.tg_id) {
    await send(env, other, `Урок <b>${fmt(l.starts_at)}</b> отменён.\nКто отменил: ${esc(user.name)}.`);
  }
  return 'Отменено';
}

// ---------- календарь ----------

async function sendCalendarLink(env, user, origin) {
  let key = user.cal_key;
  if (!key) {
    key = randomCode(24);
    await env.DB.prepare('UPDATE users SET cal_key = ? WHERE tg_id = ?').bind(key, user.tg_id).run();
  }
  const link = `${origin}/cal/${key}.ics`;
  return send(env, user.tg_id, [
    'Ваш личный календарь уроков. Подпишитесь на него один раз — дальше уроки и переносы будут появляться в нём сами.',
    `<code>${link}</code>`,
    '<b>iPhone:</b> Настройки → Приложения → Календарь → Учётные записи → Добавить → Другое → Подписной календарь → вставьте ссылку.',
    '<b>Google Календарь:</b> на компьютере откройте calendar.google.com → «Другие календари» → «+» → «Добавить по URL» → вставьте ссылку. Google обновляет такие календари с задержкой до суток.',
    'Ссылку никому не пересылайте: по ней видно ваше расписание.',
  ].join('\n\n'));
}

async function calendarFeed(url, env) {
  const m = url.pathname.match(/^\/cal\/([A-Za-z0-9]+)\.ics$/);
  if (!m) return text('not found', 404);
  const user = await env.DB.prepare('SELECT * FROM users WHERE cal_key = ?').bind(m[1]).first();
  if (!user) return text('not found', 404);
  const since = `${addDays(nowLocal().slice(0, 10), -60)} 00:00`;
  const { results } = await env.DB.prepare(
    `SELECT l.*, s.tg_id AS student_tg, su.name AS student_name, tu.name AS teacher_name
     FROM lessons l
     JOIN students s ON s.id = l.student_id
     JOIN users su ON su.tg_id = s.tg_id
     JOIN users tu ON tu.tg_id = l.teacher_id
     WHERE (l.teacher_id = ? OR s.tg_id = ?) AND l.status != 'cancelled' AND l.starts_at >= ?
     ORDER BY l.starts_at LIMIT 500`
  ).bind(user.tg_id, user.tg_id, since).all();

  const stamp = icsUtc(Date.now());
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SlotMate//RU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:Уроки (SlotMate)', 'X-PUBLISHED-TTL:PT1H', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
  ];
  for (const l of results) {
    const start = localToUtcMs(l.starts_at);
    const end = start + l.duration_min * 60000;
    const asTeacher = l.teacher_id === user.tg_id;
    const summary = `Урок · ${asTeacher ? l.student_name : l.teacher_name}`;
    const desc = l.status === 'pending' && l.proposed_start
      ? `Предложен перенос на ${fmt(l.proposed_start)}, ждём ответа.`
      : 'Из бота SlotMate.';
    lines.push(
      'BEGIN:VEVENT',
      `UID:lesson-${l.id}-${asTeacher ? 't' : 's'}@slotmate`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsUtc(start)}`,
      `DTEND:${icsUtc(end)}`,
      `SUMMARY:${icsText(summary)}`,
      `DESCRIPTION:${icsText(desc)}`,
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return new Response(lines.map(foldLine).join('\r\n') + '\r\n', {
    headers: { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'no-cache' },
  });
}

function icsUtc(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function icsText(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

function foldLine(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = '';
  let curBytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    const limit = out.length ? 74 : 75;
    if (curBytes + b > limit) {
      out.push(cur);
      cur = '';
      curBytes = 0;
    }
    cur += ch;
    curBytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

// ---------- напоминания (запускаются раз в час по расписанию) ----------

async function sendReminders(env) {
  const now = nowLocal();
  const until = nowLocal(24 * 3600 * 1000);
  const { results } = await env.DB.prepare(
    `SELECT l.*, s.tg_id AS student_tg, tu.name AS teacher_name FROM lessons l
     JOIN students s ON s.id = l.student_id JOIN users tu ON tu.tg_id = l.teacher_id
     WHERE l.reminded = 0 AND l.status != 'cancelled' AND l.starts_at > ? AND l.starts_at <= ?`
  ).bind(now, until).all();
  for (const l of results) {
    await send(env, l.student_tg, `Напоминание: урок <b>${fmt(l.starts_at)}</b> (учитель: ${esc(l.teacher_name)}).`, {
      inline_keyboard: [[{ text: 'Предложить перенос', callback_data: `rs:l:${l.id}` }]],
    });
    await env.DB.prepare('UPDATE lessons SET reminded = 1 WHERE id = ?').bind(l.id).run();
  }
}
