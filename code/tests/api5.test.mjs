import { api, msg, cb, day, db, scheduled, sent, expect, done } from './harness.mjs';

const OWN = { id: 111, first_name: 'Артём' }, PAV = { id: 333, first_name: 'Павел' }, OLA = { id: 222, first_name: 'Ола' }, MAR = { id: 444, first_name: 'Марек' };
const nowPlus = (h) => new Date(Date.now() + h * 3600e3).toLocaleString('sv-SE', { timeZone: 'Europe/Warsaw' }).slice(0, 16);
const st = (id) => db.prepare('SELECT * FROM lessons WHERE id=?').get(id);
const texts = (list) => list.map((x) => x.body.text || '').join(' | ');

await msg(OWN, '/start');
let r = await api(OWN, 'teacher_invite'); await msg(PAV, '/start ' + r.j.link.split('start=')[1]);
r = await api(PAV, 'invite'); const sc = r.j.link.split('start=')[1];
for (const u of [OLA, MAR]) await msg(u, '/start ' + sc);
r = await api(PAV, 'me'); const sid = Object.fromEntries(r.j.students.map((s) => [s.name, s.id]));

// --- серия: перенос всей серии проверяет каждую дату ---
const D = day(3);
await api(PAV, 'lesson/add', { student_id: sid['Ола'], starts_at: `${D} 15:00`, weeks: 6 });
await api(PAV, 'lesson/add', { student_id: sid['Марек'], starts_at: `${day(3 + 21 + 1)} 15:00`, weeks: 1 }); // занимает новую дату 4-й недели
const first = db.prepare("SELECT id FROM lessons WHERE student_id=? ORDER BY starts_at").get(sid['Ола']).id;
sent.length = 0;
r = await api(OLA, 'lesson/propose', { id: first, starts_at: `${day(4)} 15:00`, scope: 'series' });
expect(!!r.j.conflict && /всей серии/.test(r.j.conflict), 'series move refused, lists clashing date: ' + (r.j.conflict || '').split('\n')[1]);
expect(st(first).status === 'scheduled' && !sent.some((x) => x.method === 'sendMessage'), 'nothing sent when refused');
r = await api(OLA, 'lesson/propose', { id: first, starts_at: `${day(4)} 15:00`, scope: 'one' });
expect(r.j.ok, 'single lesson can still move');
await api(OLA, 'lesson/withdraw', { id: first });

// перенос серии на свободное время, потом дата занимается — при подтверждении она остаётся
r = await api(OLA, 'lesson/propose', { id: first, starts_at: `${D} 17:00`, scope: 'series' });
expect(r.j.ok, 'series move to free time proposed');
const prop = sent.filter((x) => x.method === 'sendMessage').pop();
expect(/Не подходит/.test(JSON.stringify(prop.body.reply_markup)), 'button now says «Не подходит»');
db.prepare('INSERT INTO lessons (teacher_id, student_id, starts_at) VALUES (?, ?, ?)').run(333, sid['Марек'], `${day(3 + 14)} 17:00`);
sent.length = 0;
r = await api(PAV, 'lesson/answer', { id: first, accept: true, code: `${D} 17:00` });
expect(r.j.ok, 'teacher accepts series move');
const moved = db.prepare("SELECT starts_at FROM lessons WHERE student_id=? AND status='scheduled' ORDER BY starts_at").all(sid['Ола']).map((x) => x.starts_at.slice(11));
expect(moved.filter((t) => t === '17:00').length === 5 && moved.filter((t) => t === '15:00').length === 1, 'clashing week stays at 15:00, others moved: ' + moved.join(','));
expect(/Остались на старом времени/.test(texts(sent)), 'both told which lesson stayed');

// --- «не смогу» и урок прошёл: не списывается, пока учитель не решит ---
await api(PAV, 'settings', { pack_size: 4, pack_price: 600, default_duration: 60, late_hours: 0 });
await api(PAV, 'pay/add', { student_id: sid['Марек'], lessons: 4, amount: 600 });
r = await api(PAV, 'me');
expect(r.j.payments[0].kind === 'pay' && r.j.payments[0].student_id === sid['Марек'], 'payments list has kind and student');
await api(PAV, 'lesson/add', { student_id: sid['Марек'], starts_at: nowPlus(5), weeks: 1 });
const m1 = db.prepare("SELECT id FROM lessons WHERE student_id=? ORDER BY id DESC").get(sid['Марек']).id;
sent.length = 0; await scheduled();
let c = await cb(MAR, `cn:${m1}`);
expect(/сам решит/.test(texts(c)), 'student told teacher will decide');
db.prepare('UPDATE lessons SET starts_at=? WHERE id=?').run(nowPlus(-1), m1);
r = await api(PAV, 'me');
expect(r.j.students.find((s) => s.id === sid['Марек']).used === 0, 'past «не смогу» lesson NOT charged yet');
expect(r.j.to_check.some((x) => x.id === m1 && x.why === 'no'), 'teacher inbox: «Урок состоялся?» (no)');
sent.length = 0; await scheduled();
const ask = sent.find((x) => /Урок состоялся\?/.test(x.body.text || ''));
expect(!!ask && ask.body.chat_id === 333, 'hourly asks teacher «Урок состоялся?»');
expect(st(m1).check_needed === 1, 'lesson flagged check_needed');
sent.length = 0; await scheduled();
expect(!sent.some((x) => /Урок состоялся/.test(x.body.text || '')), 'asked only once');
c = await cb(OLA, `nh:${m1}`);
expect(st(m1).status === 'scheduled', 'student cannot answer for teacher');
c = await cb(PAV, `nh:${m1}`);
expect(st(m1).status === 'cancelled' && c.some((x) => x.body.chat_id === 444 && /не списан/.test(x.body.text || '')), 'Нет → cancelled, student told not charged');

// --- перенос не подтвердили до начала урока ---
await api(PAV, 'lesson/add', { student_id: sid['Марек'], starts_at: nowPlus(30), weeks: 1 });
const m2 = db.prepare("SELECT id FROM lessons WHERE student_id=? ORDER BY id DESC").get(sid['Марек']).id;
await api(MAR, 'lesson/propose', { id: m2, starts_at: nowPlus(50) });
db.prepare('UPDATE lessons SET starts_at=? WHERE id=?').run(nowPlus(-1), m2);
r = await api(PAV, 'me');
expect(r.j.students.find((s) => s.id === sid['Марек']).used === 0, 'past pending lesson not charged');
sent.length = 0; await scheduled();
expect(sent.some((x) => x.body.chat_id === 444 && /не ответили до начала урока/.test(x.body.text || '')), 'proposer (student) told proposal lapsed');
expect(sent.some((x) => x.body.chat_id === 333 && /так и не подтвердили/.test(x.body.text || '')), 'teacher asked about it');
expect(st(m2).status === 'scheduled' && st(m2).check_needed === 1 && !st(m2).proposed_start, 'proposal closed, waiting for teacher');
r = await api(PAV, 'lesson/resolve', { id: m2, held: true });
expect(r.j.ok && st(m2).check_needed === 0, 'teacher says it happened (from app)');
r = await api(PAV, 'me');
expect(r.j.students.find((s) => s.id === sid['Марек']).used === 1 && !r.j.to_check.length, 'now charged, inbox empty');

// --- предложенное время прошло раньше урока: сообщают обоим ---
await api(PAV, 'lesson/add', { student_id: sid['Марек'], starts_at: nowPlus(60), weeks: 1 });
const m3 = db.prepare("SELECT id FROM lessons WHERE student_id=? ORDER BY id DESC").get(sid['Марек']).id;
await api(PAV, 'lesson/propose', { id: m3, starts_at: nowPlus(30) });
db.prepare('UPDATE lessons SET proposed_start=? WHERE id=?').run(nowPlus(-1), m3);
sent.length = 0; await scheduled();
expect(sent.some((x) => x.body.chat_id === 333 && /не ответили, и это время прошло/.test(x.body.text || '')), 'proposer (teacher) told time passed');

// --- учитель отменяет: ученик видит «не списывается» ---
sent.length = 0;
await api(PAV, 'lesson/cancel', { id: m3, scope: 'one' });
expect(sent.some((x) => x.body.chat_id === 444 && /не списывается/.test(x.body.text || '')), 'teacher cancel says no charge');

// --- продление серии пропускает занятые даты; «Не продлевать» ---
const sOla = db.prepare('SELECT series_id FROM lessons WHERE id=?').get(first).series_id;
const lastOla = db.prepare("SELECT MAX(starts_at) m FROM lessons WHERE series_id=? AND status IN ('scheduled','pending')").get(sOla).m;
await api(PAV, 'busy/add', { date: day(Math.round((Date.parse(lastOla.slice(0, 10)) - Date.parse(day(0))) / 864e5) + 14), all_day: true, note: 'Концерт' });
r = await api(PAV, 'series/extend', { series_id: sOla });
expect(r.j.ok && r.j.added === 11 && r.j.skipped.length === 1, `extend skipped busy week: added ${r.j.added}`);
c = await cb(PAV, `nx:${sOla}`);
expect(/не продлевается/.test(texts(c)), '«Не продлевать» answered');

// --- поздняя отмена: учитель может не списывать ---
await api(PAV, 'settings', { pack_size: 4, pack_price: 600, default_duration: 60, late_hours: 12 });
await api(PAV, 'lesson/add', { student_id: sid['Марек'], starts_at: nowPlus(5), weeks: 1 });
const m4 = db.prepare("SELECT id FROM lessons WHERE student_id=? ORDER BY id DESC").get(sid['Марек']).id;
await api(MAR, 'lesson/cancel', { id: m4 });
expect(st(m4).status === 'late', 'late cancel');
r = await api(PAV, 'lesson/void', { id: m4 });
expect(r.j.ok && st(m4).status === 'cancelled', 'teacher waives late charge on a future lesson');

done();
