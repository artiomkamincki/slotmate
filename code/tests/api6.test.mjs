// v6: закрытые дыры, уроки «без срока», оплата в одно нажатие, «Я оплатил» у ученика.
import { api, msg, cb, call, env, day, db, scheduled, sent, expect, done } from './harness.mjs';

const OWN = { id: 111, first_name: 'Артём' }, PAV = { id: 333, first_name: 'Павел' }, OLA = { id: 222, first_name: 'Ола' }, MAR = { id: 444, first_name: 'Марек' }, EVE = { id: 555, first_name: 'Ева' };
const nowPlus = (h) => new Date(Date.now() + h * 3600e3).toLocaleString('sv-SE', { timeZone: 'Europe/Warsaw' }).slice(0, 16);
const st = (id) => db.prepare('SELECT * FROM lessons WHERE id=?').get(id);
const texts = (list) => list.map((x) => x.body.text || '').join(' | ');
const lastId = (sid) => db.prepare('SELECT id FROM lessons WHERE student_id=? ORDER BY id DESC').get(sid).id;

await msg(OWN, '/start');
let r = await api(OWN, 'teacher_invite');
const tcode = r.j.link.split('start=')[1];
await msg(PAV, '/start ' + tcode);
r = await api(PAV, 'invite'); const sc = r.j.link.split('start=')[1];
for (const u of [OLA, MAR, EVE]) await msg(u, '/start ' + sc);
r = await api(PAV, 'me'); const sid = Object.fromEntries(r.j.students.map((s) => [s.name, s.id]));

// --- /setup закрыт после первого раза ---
let res = await call('/setup');
expect(res.status === 403, '/setup refused once the bot is connected');
env.SETUP_KEY = 'k1';
res = await call('/setup?key=wrong');
expect(res.status === 403, '/setup refused with wrong key');
res = await call('/setup?key=k1');
expect(res.status === 200, '/setup works with SETUP_KEY');
delete env.SETUP_KEY;

// --- ссылка учителя одноразовая ---
let c = await msg(EVE, '/start ' + tcode);
expect(/уже использована/.test(texts(c)) && !db.prepare('SELECT is_teacher FROM users WHERE tg_id=?').get(555).is_teacher, 'used teacher link does not make a second teacher');

// --- ученик не может отменить начавшийся урок ---
await api(PAV, 'lesson/add', { student_id: sid['Ола'], starts_at: nowPlus(2), weeks: 1 });
const past = lastId(sid['Ола']);
db.prepare('UPDATE lessons SET starts_at=? WHERE id=?').run(nowPlus(-2), past);
r = await api(OLA, 'lesson/cancel', { id: past, scope: 'one' });
expect(r.status === 400 && /только учитель/.test(r.j.error) && st(past).status === 'scheduled', 'student cannot cancel a lesson that already started');
c = await cb(OLA, `cn:${past}`);
expect(st(past).reminder_answer == null && /уже начался/.test(texts(c)), '«Не смогу» after start is refused');
r = await api(PAV, 'lesson/cancel', { id: past, scope: 'one' });
expect(r.j.ok, 'teacher can still cancel it');

// --- подтверждение устаревшего предложения ничего не меняет ---
await api(PAV, 'lesson/add', { student_id: sid['Ола'], starts_at: `${day(5)} 15:00`, weeks: 1 });
const m1 = lastId(sid['Ола']);
await api(OLA, 'lesson/propose', { id: m1, starts_at: `${day(5)} 16:00` });
await api(OLA, 'lesson/propose', { id: m1, starts_at: `${day(5)} 18:00` });
r = await api(PAV, 'lesson/answer', { id: m1, accept: true, code: `${day(5)} 16:00` });
expect(!!r.j.error && st(m1).starts_at === `${day(5)} 15:00` && st(m1).proposed_start === `${day(5)} 18:00`, 'answer to replaced proposal does not move the lesson');
r = await api(PAV, 'lesson/answer', { id: m1, accept: true, code: `${day(5)} 18:00` });
expect(r.j.ok && st(m1).starts_at === `${day(5)} 18:00`, 'answer to current proposal moves it');

// --- перенос серии ровно на неделю ---
await api(PAV, 'lesson/add', { student_id: sid['Марек'], starts_at: `${day(2)} 12:00`, weeks: 4 });
const s1 = db.prepare('SELECT id FROM lessons WHERE student_id=? AND starts_at=?').get(sid['Марек'], `${day(2)} 12:00`).id;
r = await api(MAR, 'lesson/propose', { id: s1, starts_at: `${day(9)} 12:00`, scope: 'series' });
expect(r.j.ok, 'series move by one week proposed');
r = await api(PAV, 'lesson/answer', { id: s1, accept: true, code: `${day(9)} 12:00` });
expect(r.j.ok && st(s1).starts_at === `${day(9)} 12:00`, 'series move by one week confirmed (no false «занято»)');

// --- уроки без срока ---
r = await api(PAV, 'lesson/add', { student_id: sid['Ева'], starts_at: `${day(1)} 10:00`, auto: true });
const evLessons = () => db.prepare("SELECT starts_at FROM lessons WHERE student_id=? AND status='scheduled' ORDER BY starts_at").all(sid['Ева']);
const serId = db.prepare('SELECT series_id FROM lessons WHERE student_id=?').get(sid['Ева']).series_id;
expect(r.j.ok && evLessons().length === 12 && !!db.prepare('SELECT 1 FROM series_auto WHERE series_id=?').get(serId), 'endless series: 12 weeks + marked auto');
expect(/без срока/.test(texts(r.sent)), 'student told «без срока»');
r = await api(PAV, 'me');
expect(r.j.lessons.some((l) => l.series_id === serId && l.series_auto), 'app sees series_auto');
// оставить только 3 урока впереди — ежечасная задача продлит сама, без вопросов
db.prepare("UPDATE lessons SET status='cancelled' WHERE series_id=? AND starts_at > ?").run(serId, `${day(16)} 00:00`);
sent.length = 0; await scheduled();
expect(evLessons().length === 15, 'hourly job extends endless series by 12: ' + evLessons().length);
expect(!sent.some((x) => /Заканчиваются регулярные|продлены/.test(x.body.text || '')), 'no question to teacher, no «продлены» message');
sent.length = 0; await scheduled();
expect(evLessons().length === 15, 'not extended twice');
// «этот и все следующие» — повтор остановлен
const evFirst = db.prepare("SELECT id FROM lessons WHERE series_id=? AND status='scheduled' ORDER BY starts_at").get(serId).id;
await api(PAV, 'lesson/cancel', { id: evFirst, scope: 'series' });
expect(!db.prepare('SELECT 1 FROM series_auto WHERE series_id=?').get(serId), 'cancelling the series stops auto-extension');

// обычная серия: вопрос «Продлевать автоматически», двойное нажатие не удваивает
const marSer = db.prepare('SELECT series_id FROM lessons WHERE id=?').get(s1).series_id;
db.prepare("UPDATE lessons SET status='cancelled' WHERE series_id=? AND starts_at > ?").run(marSer, `${day(12)} 00:00`); // серия кончается через 9 дней
sent.length = 0; await scheduled();
const ask = sent.find((x) => /Заканчиваются регулярные/.test(x.body.text || ''));
expect(!!ask && /Продлевать автоматически/.test(JSON.stringify(ask.body.reply_markup)), 'ending series: teacher asked «Продлевать автоматически»');
await cb(PAV, `ex:${marSer}`);
const n1 = db.prepare("SELECT COUNT(*) n FROM lessons WHERE series_id=? AND status='scheduled'").get(marSer).n;
await cb(PAV, `ex:${marSer}`);
const n2 = db.prepare("SELECT COUNT(*) n FROM lessons WHERE series_id=? AND status='scheduled'").get(marSer).n;
expect(n1 === 13 && n2 === 13 && !!db.prepare('SELECT 1 FROM series_auto WHERE series_id=?').get(marSer), `extended once and marked auto (${n1}/${n2})`);

// --- оплата в одно нажатие ---
await api(PAV, 'settings', { pack_size: 4, pack_price: 600, default_duration: 60, late_hours: 0 });
await api(PAV, 'lesson/add', { student_id: sid['Ола'], starts_at: nowPlus(2), weeks: 1 });
const today1 = lastId(sid['Ола']);
r = await api(OLA, 'me');
const sub = r.j.my_subs[0];
expect(r.j.lessons.find((l) => l.id === today1).pay_due === true && sub.paid_until === null, 'student app: lesson waits for payment');
r = await api(PAV, 'me');
expect(r.j.lessons.find((l) => l.id === today1).pay_due === true, 'teacher app: lesson shows «Оплатил»');
sent.length = 0; await scheduled();
const payAsk = sent.find((x) => /Получили оплату\?/.test(x.body.text || ''));
expect(!!payAsk && payAsk.body.chat_id === 333 && /pd:/.test(JSON.stringify(payAsk.body.reply_markup)), 'teacher gets «Получили оплату?» with buttons');
sent.length = 0; await scheduled();
expect(!sent.some((x) => /Получили оплату\?/.test(x.body.text || '')), 'asked once');
c = await cb(PAV, `pd:${today1}`);
const pays = () => db.prepare('SELECT * FROM payments WHERE student_id=?').all(sid['Ола']);
expect(pays().length === 1 && pays()[0].lessons === 4 && pays()[0].amount === 600, 'one tap recorded 4 lessons · 600 zł');
expect(c.some((x) => x.body.chat_id === 222 && /отметил оплату/.test(x.body.text || '')), 'student got confirmation');
await cb(PAV, `pd:${today1}`);
expect(pays().length === 1, 'second tap does not double the payment');
r = await api(OLA, 'me');
expect(r.j.lessons.find((l) => l.id === today1).paid_ok === true && !!r.j.my_subs[0].paid_until, 'student sees «оплачено до»');
c = await cb(OLA, `pd:${today1}`);
expect(pays().length === 1, 'student cannot use teacher button');

// --- «Я оплатил» у ученика ---
r = await api(MAR, 'me'); const msub = r.j.my_subs[0];
r = await api(MAR, 'pay/claim', { sub_id: msub.id, lessons: 4, amount: 600 });
const claimMsg = r.sent.find((x) => x.body.chat_id === 333);
expect(r.j.ok && /пишет, что оплатил/.test(claimMsg?.body.text || '') && /ca:/.test(JSON.stringify(claimMsg.body.reply_markup)), 'teacher asked «Получил / Не получал»');
expect(db.prepare('SELECT COUNT(*) n FROM payments WHERE student_id=?').get(sid['Марек']).n === 0, 'nothing counted before teacher confirms');
r = await api(MAR, 'pay/claim', { sub_id: msub.id });
expect(r.status === 400, 'second claim while waiting is refused');
r = await api(MAR, 'me');
expect(r.j.my_subs[0].claim && r.j.my_subs[0].claim.lessons === 4, 'student sees «ждём подтверждения»');
r = await api(PAV, 'me');
const claim = r.j.claims.find((x) => x.student_id === sid['Марек']);
expect(!!claim, 'teacher inbox shows the claim');
r = await api(OLA, 'pay/claim_answer', { id: claim.id, ok: true });
expect(r.status === 400, 'only the teacher can confirm');
c = await cb(PAV, `ca:${claim.id}`);
expect(db.prepare('SELECT SUM(lessons) n FROM payments WHERE student_id=?').get(sid['Марек']).n === 4, 'confirmed → 4 lessons counted');
expect(c.some((x) => x.body.chat_id === 444 && /отметил оплату/.test(x.body.text || '')), 'student told payment is counted');
c = await cb(PAV, `ca:${claim.id}`);
expect(db.prepare('SELECT SUM(lessons) n FROM payments WHERE student_id=?').get(sid['Марек']).n === 4, 'double confirm does not double');
r = await api(MAR, 'pay/claim', { sub_id: msub.id, lessons: 4, amount: 600 });
r = await api(PAV, 'me');
const claim2 = r.j.claims[0];
r = await api(PAV, 'pay/claim_answer', { id: claim2.id, ok: false });
expect(r.j.ok && r.sent.some((x) => x.body.chat_id === 444 && /не видит/.test(x.body.text || '')), '«Не получал» → student told, nothing counted');
expect(db.prepare('SELECT SUM(lessons) n FROM payments WHERE student_id=?').get(sid['Марек']).n === 4, 'still 4 lessons');
r = await api(MAR, 'pay/claim', { sub_id: sid['Ола'] });
expect(r.status === 400, 'cannot claim for someone else');

done();
