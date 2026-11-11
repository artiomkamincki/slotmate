// v12 (4-й дизайн-отзыв): честная сумма долга, «Отменить» оплату прямо в чате, тихая отмена у ученика,
// совпадения при добавлении серии — одной строкой.
import { api, msg, cb, db, scheduled, sent, expect, done, day } from './harness.mjs';

const OWN = { id: 111, first_name: 'Артём' }, PAV = { id: 333, first_name: 'Павел' }, OLA = { id: 222, first_name: 'Ола' }, MAR = { id: 444, first_name: 'Марек' }, EVA = { id: 555, first_name: 'Ева' };
const nowPlus = (h) => new Date(Date.now() + h * 3600e3).toLocaleString('sv-SE', { timeZone: 'Europe/Warsaw' }).slice(0, 16);
const lastId = (sid) => db.prepare('SELECT id FROM lessons WHERE student_id=? ORDER BY id DESC').get(sid).id;
const pays = (sid) => db.prepare('SELECT * FROM payments WHERE student_id=? ORDER BY id').all(sid);
const past = (sid, daysAgo) => db.prepare('INSERT INTO lessons (teacher_id, student_id, starts_at) VALUES (?, ?, ?)').run(333, sid, `${day(-daysAgo)} 10:00`);

await msg(OWN, '/start');
let r = await api(OWN, 'teacher_invite');
await msg(PAV, '/start ' + r.j.link.split('start=')[1]);
r = await api(PAV, 'invite'); const sc = r.j.link.split('start=')[1];
for (const u of [OLA, MAR, EVA]) await msg(u, '/start ' + sc);
r = await api(PAV, 'me'); const sid = Object.fromEntries(r.j.students.map((s) => [s.name, s.id]));
await api(PAV, 'settings', { pack_size: 4, pack_price: 600, default_duration: 60, late_hours: 0 });

// --- честная сумма долга: Ола должна 2 урока, Ева 1, Марек оплат не имеет, но и уроков не было ---
past(sid['Ола'], 3); past(sid['Ола'], 10); past(sid['Ева'], 4);
await api(PAV, 'lesson/add', { student_id: sid['Марек'], starts_at: `${day(3)} 17:00`, weeks: 1 });
r = await api(PAV, 'me');
const m = r.j.month;
expect(m.debt_count === 2 && m.debt_lessons === 3 && m.debt_sum === 450, `debt = 3 lessons · 450 zł from 2 students (${m.debt_count}/${m.debt_lessons}/${m.debt_sum})`);
expect(m.due_count === 3, 'still 3 students «ждём оплату» (Марек — оплат нет, урок назначен)');

// --- оплата из чата → «Отменить» → оплата удалена, подтверждение у ученика убрано, вопрос вернулся ---
await api(PAV, 'lesson/add', { student_id: sid['Ола'], starts_at: nowPlus(2), weeks: 1 });
const l1 = lastId(sid['Ола']);
sent.length = 0; await scheduled();
let c = await cb(PAV, `pd:${l1}:4`);
const p1 = pays(sid['Ола']).at(-1);
const edited = c.find((x) => x.method === 'editMessageText' && x.body.chat_id === 333);
const undoBtn = (edited?.body.reply_markup.inline_keyboard || []).flat().find((b) => b.text === 'Отменить');
expect(!!p1 && p1.lessons === 4 && !!p1.msg_id, 'payment recorded, student message id stored');
expect(undoBtn?.callback_data === `pu:${p1.id}:${l1}`, 'chat message after payment has «Отменить»');
c = await cb(PAV, undoBtn.callback_data);
expect(!pays(sid['Ола']).some((x) => x.id === p1.id), '«Отменить» in chat deletes the payment');
expect(c.some((x) => x.method === 'deleteMessage' && x.body.chat_id === 222 && x.body.message_id === p1.msg_id), 'student confirmation removed quietly');
expect(!c.some((x) => x.method === 'sendMessage' && x.body.chat_id === 222), 'no «это была ошибка» message for a fresh undo');
const back = c.find((x) => x.method === 'editMessageText' && x.body.chat_id === 333);
expect(/Оплата отменена/.test(back?.body.text || '') && /pd:/.test(JSON.stringify(back?.body.reply_markup)), 'question with lesson buttons is back');
c = await cb(PAV, `pd:${l1}:1`);
expect(pays(sid['Ола']).at(-1)?.lessons === 1, 'after undo the teacher can choose again (1 lesson)');
c = await cb(OLA, `pu:${pays(sid['Ола']).at(-1).id}:${l1}`);
expect(pays(sid['Ола']).at(-1)?.lessons === 1, 'student cannot undo teacher payment');

// --- больше 10 минут — из чата не отменить, в приложении — с сообщением «ошибка» ---
const p2 = pays(sid['Ола']).at(-1);
db.prepare("UPDATE payments SET created_at = datetime('now', '-20 minutes') WHERE id = ?").run(p2.id);
c = await cb(PAV, `pu:${p2.id}:${l1}`);
expect(pays(sid['Ола']).some((x) => x.id === p2.id), 'after 10 minutes chat undo does nothing');
expect(c.some((x) => x.method === 'answerCallbackQuery' && /Все оплаты/.test(x.body.text || '')), 'teacher told to use «Все оплаты»');
r = await api(PAV, 'pay/undo', { id: p2.id });
expect(r.j.ok && r.sent.some((x) => x.body.chat_id === 222 && /это была ошибка/.test(x.body.text || '')) && !r.sent.some((x) => x.method === 'deleteMessage'), 'old payment undone in app → student told it was a mistake');

// --- быстрая отмена в приложении — тоже тихо ---
r = await api(PAV, 'pay/add', { student_id: sid['Ева'], lessons: 4, amount: 600 });
const p3 = pays(sid['Ева']).at(-1);
r = await api(PAV, 'pay/undo', { id: r.j.id });
expect(r.sent.some((x) => x.method === 'deleteMessage' && x.body.message_id === p3.msg_id) && !r.sent.some((x) => /это была ошибка/.test(x.body.text || '')), 'fresh undo in app removes the confirmation quietly');

// --- совпадения при добавлении серии — одной строкой ---
await api(PAV, 'lesson/add', { student_id: sid['Ева'], starts_at: `${day(5)} 18:00`, weeks: 8 });
r = await api(PAV, 'lesson/add', { student_id: sid['Марек'], starts_at: `${day(5)} 18:00`, weeks: 8 });
expect(/уже урок: Ева, 18:00 — совпадает 8 из 8 недель, начиная с /.test(r.j.conflict || '') && r.j.conflict.split('\n').length === 1, 'conflict grouped: ' + r.j.conflict);

done();
