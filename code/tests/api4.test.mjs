import { api, msg, cb, show, day, db, scheduled, sent, expect, done } from './harness.mjs';

const OWN = { id: 111, first_name: 'Артём' }, PAV = { id: 333, first_name: 'Павел' }, OLA = { id: 222, first_name: 'Ола' }, MAR = { id: 444, first_name: 'Марек' };
const nowPlus = (h) => new Date(Date.now() + h * 3600e3).toLocaleString('sv-SE', { timeZone: 'Europe/Warsaw' }).slice(0, 16);

await msg(OWN, '/start');
let r = await api(OWN, 'teacher_invite'); await msg(PAV, '/start ' + r.j.link.split('start=')[1]);
r = await api(PAV, 'invite'); const sc = r.j.link.split('start=')[1];
let c = await msg(OLA, '/start ' + sc);
const newBtn = c.find((x) => x.body.chat_id === 333).body.reply_markup.inline_keyboard[0][0];
expect(/\?s=\d+&add=1$/.test(newBtn.web_app.url), 'new-student button opens «Новый урок» for that student: ' + newBtn.web_app.url);
await msg(MAR, '/start ' + sc); await msg(OWN, '/start ' + sc);
r = await api(PAV, 'me'); const sid = Object.fromEntries(r.j.students.map((s) => [s.name, s.id]));
expect(r.j.settings.default_duration === 60 && r.j.settings.late_hours === 0, 'default settings');

// длительность и серия до даты
const D3 = day(3);
r = await api(PAV, 'lesson/add', { student_id: sid['Ола'], starts_at: `${D3} 15:00`, weeks: 12, duration: 90 });
expect(r.j.ok, '12-week series, 90 min');
r = await api(PAV, 'lesson/add', { student_id: sid['Марек'], starts_at: `${D3} 16:00`, weeks: 1, duration: 45 });
expect(!!r.j.conflict, '16:00 clashes with 90-min lesson 15:00–16:30: ' + r.j.conflict);
r = await api(PAV, 'lesson/add', { student_id: sid['Марек'], starts_at: `${D3} 16:30`, weeks: 1, duration: 45 });
expect(r.j.ok, '16:30 fits right after');
r = await api(PAV, 'me');
const ola1 = r.j.lessons.find((l) => l.student_name === 'Ола');
expect(ola1.later === 11 && ola1.series_end && ola1.duration === 90, `series info: later=${ola1.later}, end=${ola1.series_end}`);

// свободные окна
r = await api(PAV, 'slots', { lesson_id: ola1.id });
expect(r.j.slots.length === 6 && !r.j.slots.includes(`${D3} 16:30`) && !r.j.slots.includes(`${D3} 15:00`), 'slots exclude taken: ' + r.j.slots.join(', '));
expect(r.j.slots.join() === r.j.slots.slice().sort().join() && r.j.slots.includes(r.j.best), 'slots go in date order, best is one of them');
r = await api(OLA, 'slots', { lesson_id: ola1.id });
expect(r.j.slots.length > 0, 'student gets slots too');
r = await api(MAR, 'slots', { lesson_id: ola1.id });
expect(r.status === 400, 'other student cannot see slots of foreign lesson');

// перепроверка при подтверждении
const mar = db.prepare("SELECT id FROM lessons WHERE student_id=?").get(sid['Марек']).id;
r = await api(PAV, 'lesson/propose', { id: ola1.id, starts_at: `${day(4)} 10:00` });
r = await api(PAV, 'lesson/propose', { id: mar, starts_at: `${day(4)} 10:00` });
expect(!!r.j.conflict, 'v5: cannot propose a slot already offered to someone else');
r = await api(PAV, 'lesson/propose', { id: mar, starts_at: `${day(4)} 12:00` });
r = await api(OLA, 'lesson/answer', { id: ola1.id, accept: true, code: `${day(4)} 10:00` });
expect(r.j.ok, 'Ола accepts first');
db.prepare('INSERT INTO lessons (teacher_id, student_id, starts_at) VALUES (?, ?, ?)').run(333, sid['Ола'], `${day(4)} 12:00`);
c = await cb(MAR, `ok:${mar}:${day(4)} 12:00`);
show('Марек accepts the now-taken slot', c);
expect(c.some((x) => /уже занято/.test(x.body.text || '')), 'second accept refused: slot taken');
expect(db.prepare('SELECT status, starts_at FROM lessons WHERE id=?').get(mar).starts_at === `${D3} 16:30`, 'Марек stays on old time');

// «не смогу» → кнопки учителю → отменить без списания
db.prepare("UPDATE lessons SET starts_at=?, reminded=0 WHERE id=?").run(nowPlus(5), mar);
sent.length = 0; await scheduled();
c = await cb(MAR, `cn:${mar}`);
show('Марек: не смогу', c);
const tmsg = c.find((x) => x.body.chat_id === 333);
expect(tmsg && tmsg.body.reply_markup.inline_keyboard[0][0].callback_data === `nc:${mar}`, 'teacher gets «Отменить без списания»');
expect(/l=\d+/.test(tmsg.body.reply_markup.inline_keyboard[1][0].web_app.url), 'teacher «Предложить» opens lesson');
r = await api(MAR, 'me');
expect(r.j.lessons.find((l) => l.id === mar).reminder_answer === 'no', 'student sees own «не смогу»');
c = await cb(OLA, `nc:${mar}`);
expect(c.some((x) => x.body.text === 'Только для учителя'), 'student cannot press teacher button');
c = await cb(PAV, `nc:${mar}`);
show('teacher: cancel without charge', c);
expect(db.prepare('SELECT status FROM lessons WHERE id=?').get(mar).status === 'cancelled', 'cancelled, not charged');

// поздняя отмена
await api(PAV, 'settings', { pack_size: 4, pack_price: 600, default_duration: 60, late_hours: 12 });
r = await api(PAV, 'lesson/add', { student_id: sid['Артём'], starts_at: nowPlus(5), weeks: 1 });
const art = db.prepare("SELECT id FROM lessons WHERE student_id=? ORDER BY id DESC").get(sid['Артём']).id;
r = await api(OWN, 'me');
expect(r.j.lessons.find((l) => l.id === art).late_charge === true, 'student warned: late charge');
r = await api(OWN, 'lesson/cancel', { id: art });
expect(r.j.late === true && db.prepare('SELECT status FROM lessons WHERE id=?').get(art).status === 'late', 'late cancel → status late');
db.prepare("UPDATE lessons SET starts_at=? WHERE id=?").run(`${day(-1)} 10:00`, art);
r = await api(PAV, 'me');
expect(r.j.students.find((s) => s.name === 'Артём').used === 1, 'late cancel is charged (used=1)');
expect(r.j.lessons.some((l) => l.id === art && l.status === 'late'), 'v5: late-cancelled lesson visible to teacher as late');
await api(PAV, 'settings', { pack_size: 4, pack_price: 600, default_duration: 60, late_hours: 0 });

// урок не состоялся
r = await api(PAV, 'lesson/add', { student_id: sid['Артём'], starts_at: nowPlus(30), weeks: 1 });
const art2 = db.prepare("SELECT id FROM lessons WHERE student_id=? ORDER BY id DESC").get(sid['Артём']).id;
r = await api(PAV, 'lesson/void', { id: art2 });
expect(r.status === 400, 'cannot void a future lesson');
db.prepare("UPDATE lessons SET starts_at=? WHERE id=?").run(`${day(-2)} 10:00`, art2);
r = await api(PAV, 'lesson/void', { id: art2 });
expect(r.j.ok && db.prepare('SELECT status FROM lessons WHERE id=?').get(art2).status === 'cancelled', 'past lesson voided');

// начальный остаток — без сообщения
r = await api(PAV, 'pay/add', { student_id: sid['Ола'], lessons: 3, kind: 'initial' });
expect(r.j.ok && !r.sent.some((x) => x.method === 'sendMessage'), 'initial balance: no message to student');
r = await api(PAV, 'pay/add', { student_id: sid['Артём'], lessons: 4, amount: 600 });
expect(r.sent.some((x) => /Осталось: 3 урока/.test(x.body.text || '')), 'pay message shows left after debt: ' + r.sent.map((x) => x.body.text).join('|'));

// просроченное предложение и конец серии
const ola2 = db.prepare("SELECT id, starts_at FROM lessons WHERE student_id=? AND status='scheduled' ORDER BY starts_at LIMIT 1 OFFSET 1").get(sid['Ола']);
db.prepare("UPDATE lessons SET status='pending', proposed_start=?, proposed_by='t', proposed_at=?, proposal_chat=222, proposal_msg=77 WHERE id=?").run(nowPlus(-1), nowPlus(-2), ola2.id);
const seriesId = db.prepare('SELECT series_id FROM lessons WHERE id=?').get(ola1.id).series_id;
db.prepare("UPDATE lessons SET status='cancelled' WHERE series_id=? AND starts_at > ?").run(seriesId, `${day(10)} 23:59`);
sent.length = 0; await scheduled(); show('hourly', [...sent]);
expect(db.prepare('SELECT status FROM lessons WHERE id=?').get(ola2.id).status === 'scheduled', 'expired proposal closed');
expect(sent.some((x) => x.body.message_id === 77 && /прошло без ответа/.test(x.body.text)), 'expired proposal message edited');
const ext = sent.find((x) => /Заканчиваются регулярные уроки/.test(x.body.text || ''));
expect(!!ext, 'series end warning sent');
sent.length = 0; await scheduled();
expect(!sent.some((x) => /Заканчиваются/.test(x.body.text || '')), 'warning sent only once');
c = await cb(PAV, ext.body.reply_markup.inline_keyboard[0][0].callback_data);
show('teacher extends', c);
expect(db.prepare("SELECT COUNT(*) n FROM lessons WHERE series_id=? AND status IN ('scheduled','pending')").get(seriesId).n >= 13, 'series extended by 12');

done();
