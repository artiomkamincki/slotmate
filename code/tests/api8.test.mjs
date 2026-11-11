// v10: оплата за любое число уроков — в сообщении бота варианты 1 / 4 / 8 / «Другое…», сумма по цене урока.
import { api, msg, cb, db, scheduled, sent, expect, done } from './harness.mjs';

const OWN = { id: 111, first_name: 'Артём' }, PAV = { id: 333, first_name: 'Павел' }, OLA = { id: 222, first_name: 'Ола' }, MAR = { id: 444, first_name: 'Марек' };
const nowPlus = (h) => new Date(Date.now() + h * 3600e3).toLocaleString('sv-SE', { timeZone: 'Europe/Warsaw' }).slice(0, 16);
const lastId = (sid) => db.prepare('SELECT id FROM lessons WHERE student_id=? ORDER BY id DESC').get(sid).id;
const pays = (sid) => db.prepare('SELECT * FROM payments WHERE student_id=? ORDER BY id').all(sid);

await msg(OWN, '/start');
let r = await api(OWN, 'teacher_invite');
await msg(PAV, '/start ' + r.j.link.split('start=')[1]);
r = await api(PAV, 'invite'); const sc = r.j.link.split('start=')[1];
for (const u of [OLA, MAR]) await msg(u, '/start ' + sc);
r = await api(PAV, 'me'); const sid = Object.fromEntries(r.j.students.map((s) => [s.name, s.id]));
await api(PAV, 'settings', { pack_size: 4, pack_price: 600, default_duration: 60, late_hours: 0 });

// Урок сегодня, оплат нет → бот предлагает варианты.
await api(PAV, 'lesson/add', { student_id: sid['Ола'], starts_at: nowPlus(2), weeks: 1 });
const l1 = lastId(sid['Ола']);
sent.length = 0; await scheduled();
const ask = sent.find((x) => x.body.chat_id === 333 && /Получили оплату\?/.test(x.body.text || ''));
const btns = (ask?.body.reply_markup.inline_keyboard || []).flat();
const label = btns.map((b) => b.text).join(' | ');
expect(btns.some((b) => b.callback_data === `pd:${l1}:1` && b.text === '1 урок · 150 zł'), '«1 урок · 150 zł»: ' + label);
expect(btns.some((b) => b.callback_data === `pd:${l1}:4` && b.text === '4 урока · 600 zł'), '«4 урока · 600 zł»');
expect(btns.some((b) => b.callback_data === `pd:${l1}:8` && b.text === '8 уроков · 1200 zł'), '«8 уроков · 1200 zł»');
const other = btns.find((b) => b.text === 'Другое…');
expect(!!other && /\/app\?s=\d+&pay=1$/.test(other.web_app?.url || ''), '«Другое…» opens the payment sheet in the app: ' + (other?.web_app?.url || ''));
expect(btns.some((b) => b.callback_data === `pl:${l1}`), '«Пока не оплатил» is there');

// Нажал «1 урок» — записан 1 урок за 150 zł, ученик получил подтверждение.
let c = await cb(PAV, `pd:${l1}:1`);
expect(pays(sid['Ола']).length === 1 && pays(sid['Ола'])[0].lessons === 1 && pays(sid['Ола'])[0].amount === 150, '1 lesson · 150 zł recorded');
expect(c.some((x) => x.body.chat_id === 222 && /отметил оплату: 1 урок \(150 zł\)/.test(x.body.text || '')), 'student told: 1 lesson (150 zł)');
await cb(PAV, `pd:${l1}:8`);
expect(pays(sid['Ола']).length === 1, 'another button on the same message does not add a second payment');

// Кнопка из старого сообщения (без числа) — как раньше, абонемент.
await api(PAV, 'lesson/add', { student_id: sid['Марек'], starts_at: nowPlus(0.5), weeks: 1 });
await cb(PAV, `pd:${lastId(sid['Марек'])}`);
expect(pays(sid['Марек'])[0]?.lessons === 4 && pays(sid['Марек'])[0]?.amount === 600, 'old button without a number → 4 lessons · 600 zł');

// Из приложения — любое число уроков и сумма (3 урока, учитель поправил сумму).
r = await api(PAV, 'pay/add', { student_id: sid['Ола'], lessons: 3, amount: 480 });
expect(r.j.ok && pays(sid['Ола']).at(-1).lessons === 3 && pays(sid['Ола']).at(-1).amount === 480, 'app: 3 lessons · 480 zł');
r = await api(PAV, 'pay/add', { student_id: sid['Ола'], lessons: 0 });
expect(!!r.j.error, 'app: 0 lessons refused');

done();
