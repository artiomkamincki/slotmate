// v7: ученик без оплат с назначенным уроком — в «Ждём оплату»; напоминание без «уроки закончились».
import { api, msg, sent, expect, done, day } from './harness.mjs';

const OWN = { id: 111, first_name: 'Артём' }, PAV = { id: 333, first_name: 'Павел' }, OLA = { id: 222, first_name: 'Ола' }, MAR = { id: 444, first_name: 'Марек' };
await msg(OWN, '/start');
let r = await api(OWN, 'teacher_invite');
await msg(PAV, '/start ' + r.j.link.split('start=')[1]);
r = await api(PAV, 'invite'); const sc = r.j.link.split('start=')[1];
for (const u of [OLA, MAR]) await msg(u, '/start ' + sc);
r = await api(PAV, 'me'); const sid = Object.fromEntries(r.j.students.map((s) => [s.name, s.id]));

// Учитель не ведёт оплаты (нет цены и оплат) — никого не ждём, даже с уроком.
await api(PAV, 'lesson/add', { student_id: sid['Ола'], starts_at: `${day(2)} 15:00`, weeks: 1 });
r = await api(PAV, 'me');
expect(r.j.students.every((s) => !s.due) && r.j.month.due_count === 0, 'no payments in app → nobody is «due»');

// Указал цену абонемента: Ола (урок назначен, оплат нет) — ждём оплату; Марек (без уроков) — нет.
await api(PAV, 'settings', { pack_size: 4, pack_price: 600 });
r = await api(PAV, 'me');
const ola = r.j.students.find((s) => s.name === 'Ола'), mar = r.j.students.find((s) => s.name === 'Марек');
expect(ola.due && !mar.due && r.j.month.due_count === 1, `never-paid student with a lesson is due (Ола ${ola.due}, Марек ${mar.due})`);
expect(r.j.lessons.find((l) => l.student_id === sid['Ола']).pay_due, 'her lesson shows «ждём оплату» too');

// Напоминание: «оплаты ещё не было», а не «оплаченные уроки закончились».
r = await api(PAV, 'pay/remind', { student_ids: [sid['Ола']] });
const m = r.sent.find((x) => x.body.chat_id === 222);
expect(r.j.sent === 1 && /ещё не было/.test(m?.body.text || ''), 'reminder text for never-paid: ' + (m?.body.text || ''));

// После оплаты — больше не ждём.
await api(PAV, 'pay/add', { student_id: sid['Ола'], lessons: 4, amount: 600 });
r = await api(PAV, 'me');
expect(!r.j.students.find((s) => s.name === 'Ола').due && r.j.month.due_count === 0, 'paid → not due');

done();
