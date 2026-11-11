import { api, msg, cb, show, day, db, scheduled, sent, expect, done } from './harness.mjs';

const OWN = { id: 111, first_name: 'Артём' }, PAV = { id: 333, first_name: 'Павел' }, OLA = { id: 222, first_name: 'Ола' }, MAR = { id: 444, first_name: 'Марек' };

await msg(OWN, '/start');
let r = await api(OWN, 'teacher_invite');
await msg(PAV, '/start ' + r.j.link.split('start=')[1]);
r = await api(PAV, 'invite'); const sc = r.j.link.split('start=s_')[1];
await msg(OWN, '/start s_' + sc); await msg(OLA, '/start s_' + sc); await msg(MAR, '/start s_' + sc);
r = await api(PAV, 'me');
const sid = Object.fromEntries(r.j.students.map((s) => [s.name, s.id]));
expect(r.j.students.length === 3, 'three students joined');

// регулярные уроки
const D3 = day(3), D4 = day(4);
r = await api(PAV, 'lesson/add', { student_id: sid['Артём'], starts_at: `${D3} 15:00`, weeks: 8 });
expect(r.j.ok, 'weekly series added');
r = await api(PAV, 'lesson/add', { student_id: sid['Марек'], starts_at: `${D3} 17:00`, weeks: 1 });
r = await api(PAV, 'lesson/add', { student_id: sid['Ола'], starts_at: `${D3} 15:30`, weeks: 1 });
expect(!!r.j.conflict, 'add lesson overlapping Артём → conflict: ' + r.j.conflict);
r = await api(PAV, 'lesson/add', { student_id: sid['Ола'], starts_at: `${day(-1)} 15:30`, weeks: 1 });
expect(r.status === 400, 'past add rejected');
r = await api(PAV, 'lesson/add', { student_id: sid['Ола'], starts_at: `${D4} 12:00`, weeks: 1 });
expect(r.j.ok, 'Ола lesson added');

const L = (name, date) => db.prepare(`SELECT l.* FROM lessons l JOIN students s ON s.id=l.student_id JOIN users u ON u.tg_id=s.tg_id WHERE u.name=? AND substr(starts_at,1,10)=?`).get(name, date);
const art = L('Артём', D3), mar = L('Марек', D3), ola = L('Ола', D4);

// концерт и перенос всех
r = await api(PAV, 'busy/add', { date: D3, all_day: false, from: '14:00', to: '22:00', note: 'Концерт' });
expect(r.j.affected.length === 2, 'concert affects 2 lessons: ' + r.j.affected.map((a) => a.student_name).join(','));
r = await api(PAV, 'me');
expect(r.j.lessons.find((l) => l.id === art.id).clash === 'Концерт 14:00–22:00', 'clash flag on lesson');
r = await api(OWN, 'me');
expect(r.j.lessons.find((l) => l.id === art.id).clash, 'student sees clash too');
r = await api(PAV, 'lesson/propose_many', { items: [{ id: art.id, starts_at: `${D4} 12:00` }, { id: mar.id, starts_at: `${D4} 18:00` }] });
expect(!r.j.results[0].ok && /Ола/.test(r.j.results[0].problem), 'propose onto Ола slot blocked: ' + r.j.results[0].problem);
expect(r.j.results[1].ok, 'Марек moved ok');
r = await api(PAV, 'lesson/propose', { id: art.id, starts_at: `${D4} 18:30`, scope: 'one' });
expect(/предложено другому/.test(r.j.conflict || ''), 'overlap with pending proposal detected: ' + r.j.conflict);
r = await api(PAV, 'lesson/propose', { id: art.id, starts_at: `${D3} 20:00`, scope: 'one' });
expect(/Концерт/.test(r.j.conflict || ''), 'concert conflict detected');
r = await api(OWN, 'lesson/propose', { id: art.id, starts_at: `${D3} 20:00`, scope: 'one' });
expect(/Учитель в это время занят/.test(r.j.conflict || ''), 'student sees neutral wording: ' + r.j.conflict);

// предложение, замена старого, отзыв
r = await api(PAV, 'lesson/propose', { id: art.id, starts_at: `${D4} 10:00`, scope: 'one' });
show('teacher proposes to Артём', r.sent);
const firstMsg = db.prepare('SELECT proposal_msg FROM lessons WHERE id=?').get(art.id).proposal_msg;
r = await api(PAV, 'lesson/propose', { id: art.id, starts_at: `${D4} 10:00`, scope: 'one' });
expect(r.status === 400, 'same proposal twice rejected');
r = await api(PAV, 'lesson/propose', { id: art.id, starts_at: `${D4} 09:00`, scope: 'series' });
show('teacher re-proposes (series)', r.sent);
expect(r.sent.some((c) => c.method === 'editMessageText' && c.body.message_id === firstMsg && /заменено/.test(c.body.text)), 'old proposal message closed');
let c = await cb(OWN, `ok:${art.id}:${D4} 10:00`, firstMsg);
show('student taps OLD button', c);
expect(c.some((x) => /неактуально/.test(x.body.text || '')), 'old button is stale');
r = await api(PAV, 'lesson/withdraw', { id: art.id });
expect(r.j.ok, 'teacher withdrew');
r = await api(OWN, 'lesson/withdraw', { id: art.id });
expect(r.status === 400, 'nothing to withdraw now');

// ученик предлагает, учитель отвечает в приложении — серия
r = await api(OWN, 'lesson/propose', { id: art.id, starts_at: `${D4} 09:00`, scope: 'series' });
show('student proposes series', r.sent);
r = await api(PAV, 'me');
const al = r.j.lessons.find((l) => l.id === art.id);
expect(al.status === 'pending' && al.proposed_by === 's' && al.later === 7, 'teacher sees pending from student, later=' + al.later);
r = await api(PAV, 'lesson/answer', { id: art.id, accept: true, code: `${D4} 09:00` });
show('teacher accepts in app', r.sent);
const series = db.prepare('SELECT starts_at FROM lessons WHERE series_id=(SELECT series_id FROM lessons WHERE id=?) ORDER BY starts_at').all(art.id).map((x) => x.starts_at);
expect(series.every((s, i) => s === `${new Date(Date.parse(D4) + i * 7 * 864e5).toISOString().slice(0, 10)} 09:00`), 'whole series moved: ' + series.slice(0, 3).join(', '));

// отмена серии
r = await api(OWN, 'lesson/cancel', { id: L('Артём', day(4 + 14)).id, scope: 'series' });
expect(r.j.count === 6, 'cancelled 6 from the 3rd lesson on: ' + r.j.count);
show('series cancel notice', r.sent);

// оплаты
r = await api(PAV, 'settings', { pack_size: 4, pack_price: 600 });
r = await api(PAV, 'pay/add', { student_id: sid['Ола'], lessons: 4, amount: 600 });
show('payment', r.sent);
const pid = r.j.id;
r = await api(PAV, 'me');
expect(r.j.month.got === 600, 'month got 600');
expect(r.j.students.find((s) => s.name === 'Ола').left === 4, 'Ола left 4');
r = await api(PAV, 'pay/remind', { student_id: sid['Ола'] });
expect(r.j.sent === 0, 'no reminder for paid student');
r = await api(PAV, 'pay/undo', { id: pid });
r = await api(PAV, 'me');
expect(r.j.month.got === 0 && r.j.students.find((s) => s.name === 'Ола').left === 0, 'undo works');
// прошедший урок списывается
db.prepare("UPDATE lessons SET starts_at = ? WHERE id = ?").run(`${day(-2)} 12:00`, ola.id);
r = await api(PAV, 'me');
expect(r.j.students.find((s) => s.name === 'Ола').left === -1, 'past lesson counted → debt -1');
r = await api(PAV, 'pay/remind', { student_ids: [sid['Ола'], sid['Марек']] });
show('remind due', r.sent);
expect(r.j.sent === 2, 'reminders to due students (Ола debt, Марек 0)');
r = await api(OLA, 'me');
expect(r.j.my_subs[0].left === -1 && r.j.my_subs[0].pack_price === 600, 'student sees own balance');

// напоминания по расписанию
db.prepare("UPDATE lessons SET starts_at = ?, reminded = 0 WHERE id = ?").run(new Date(Date.now() + 5 * 3600e3).toLocaleString('sv-SE', { timeZone: 'Europe/Warsaw' }).slice(0, 16), mar.id);
db.prepare("UPDATE lessons SET status='pending', proposed_start=?, proposed_by='t', proposed_at=?, pinged=0 WHERE id=?").run(`${day(6)} 10:00`, `${day(-2)} 10:00`, ola.id);
db.prepare("UPDATE lessons SET starts_at=? WHERE id=?").run(`${day(5)} 10:00`, ola.id);
sent.length = 0; await scheduled(); show('hourly run', [...sent]);
const rem = sent.find((x) => /Напоминание: урок/.test(x.body.text || ''));
expect(rem && rem.body.reply_markup.inline_keyboard[0].length === 2, 'student reminder with Буду/Не смогу');
expect(sent.some((x) => /Ждём вашего ответа уже сутки/.test(x.body.text || '')), 'stale proposal re-pinged');
sent.length = 0; await scheduled();
expect(!sent.some((x) => /Напоминание: урок|уже сутки/.test(x.body.text || '')), 'no duplicates on second run');
c = await cb(MAR, `cn:${mar.id}`);
show('Марек: не смогу', c);
expect(c.some((x) => x.body.chat_id === 333 && /не сможет/.test(x.body.text)), 'teacher notified about не смогу');
r = await api(PAV, 'me');
expect(r.j.lessons.find((l) => l.id === mar.id).reminder_answer === 'no', 'teacher sees «не придёт»');

// удаление ученика
r = await api(PAV, 'student/remove', { id: sid['Марек'] });
r = await api(PAV, 'me');
expect(r.j.students.length === 2, 'student removed');
r = await api(MAR, 'lesson/add', { student_id: 1, starts_at: `${D4} 10:00` });
expect(r.status === 400 || r.status === 403, 'student cannot add lessons');

done();
