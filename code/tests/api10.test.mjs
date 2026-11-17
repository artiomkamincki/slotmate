// v14: Google Календарь — подключение, уроки в календаре «SlotMate», занятость учителя из Google.
import { api, msg, cb, call, db, scheduled, sent, expect, done, day, google } from './harness.mjs';

const OWN = { id: 111, first_name: 'Артём' }, PAV = { id: 333, first_name: 'Павел' }, OLA = { id: 222, first_name: 'Ола' }, MAR = { id: 444, first_name: 'Марек' };
const local = (iso) => new Date(iso).toLocaleString('sv-SE', { timeZone: 'Europe/Warsaw' }).slice(0, 16);
const acc = (id) => db.prepare('SELECT * FROM google_accounts WHERE tg_id=?').get(id);
const evs = (id) => db.prepare('SELECT * FROM gcal_events WHERE tg_id=? ORDER BY lesson_id').all(id);
const gev = (eid) => google.events.get(eid);
const texts = (list) => list.map((x) => x.body?.text || '').join(' | ');
async function connect(user, email) {
  google.email = email;
  const r = await api(user, 'google/start');
  const st = new URL(r.j.url).searchParams.get('state');
  sent.length = 0;
  const res = await call(`/google/callback?code=c${user.id}&state=${encodeURIComponent(st)}`);
  return { url: r.j.url, html: await res.text(), sent: [...sent] };
}

await msg(OWN, '/start');
let r = await api(OWN, 'teacher_invite');
await msg(PAV, '/start ' + r.j.link.split('start=')[1]);
r = await api(PAV, 'invite'); const sc = r.j.link.split('start=')[1];
for (const u of [OLA, MAR]) await msg(u, '/start ' + sc);
r = await api(PAV, 'me'); const sid = Object.fromEntries(r.j.students.map((s) => [s.name, s.id]));
expect(r.j.google && r.j.google.connected === false, 'me: Google section available, not connected');
await api(PAV, 'lesson/add', { student_id: sid['Ола'], starts_at: `${day(3)} 18:30`, weeks: 4 });
await api(PAV, 'lesson/add', { student_id: sid['Марек'], starts_at: `${day(4)} 17:00`, weeks: 1 });

// --- ссылка на вход: учителю — с занятостью, ученику — без ---
r = await api(PAV, 'google/start');
const sc1 = new URL(r.j.url).searchParams.get('scope');
expect(/accounts\.google\.com/.test(r.j.url) && /calendar\.app\.created/.test(sc1) && /calendar\.freebusy/.test(sc1), 'teacher consent asks for own calendar + free/busy');
r = await api(OLA, 'google/start');
expect(!/calendar\.freebusy/.test(new URL(r.j.url).searchParams.get('scope')), 'student consent does not ask for free/busy');
let res = await call('/google/callback?code=x&state=333.1.bad');
expect(/Ссылка устарела/.test(await res.text()) && !acc(333), 'forged state is refused');

// --- учитель подключился: календарь «SlotMate», все его уроки там ---
let c = await connect(PAV, 'teacher@gmail.com');
const a = acc(333);
expect(/Готово/.test(c.html) && a?.status === 'ok' && a.email === 'teacher@gmail.com' && a.busy_on === 1, 'teacher connected, busy on');
expect(!String(a.refresh_enc).includes('rt-'), 'refresh token stored encrypted');
expect(google.calendars.has(a.calendar_id) && google.calendars.get(a.calendar_id).summary === 'SlotMate', 'calendar «SlotMate» created');
expect(evs(333).length === 5 && evs(333).every((e) => gev(e.event_id)?.cal === a.calendar_id), `5 lessons written to Google (${evs(333).length})`);
const first = gev(evs(333)[0].event_id);
expect(first.summary === 'Урок: Ола' && first.start.dateTime === `${day(3)}T18:30:00` && first.end.dateTime === `${day(3)}T19:30:00` && first.start.timeZone === 'Europe/Warsaw', 'event: title, time, zone');
expect(c.sent.some((x) => x.body.chat_id === 333 && /Google Календарь подключён/.test(x.body.text || '')), 'bot confirms connection');

// --- ученица подключилась: только её уроки ---
c = await connect(OLA, 'ola@gmail.com');
expect(evs(222).length === 4 && gev(evs(222)[0].event_id).summary === 'Урок · Павел' && acc(222).busy_on === 0, 'student sees only her 4 lessons, titled with teacher');

// --- новый урок → сразу в Google у учителя ---
await api(PAV, 'lesson/add', { student_id: sid['Марек'], starts_at: `${day(5)} 12:00`, weeks: 1 });
expect(evs(333).length === 6, 'new lesson appears in teacher calendar at once');

// --- перенос: пока не подтвердили — старое время и пометка; подтвердили — событие переехало (у обоих) ---
const ola1 = db.prepare('SELECT id FROM lessons WHERE student_id=? ORDER BY starts_at').get(sid['Ола']).id;
await api(OLA, 'lesson/propose', { id: ola1, starts_at: `${day(3)} 16:00`, scope: 'one' });
const tEv = () => gev(db.prepare('SELECT event_id FROM gcal_events WHERE tg_id=333 AND lesson_id=?').get(ola1).event_id);
const sEv = () => gev(db.prepare('SELECT event_id FROM gcal_events WHERE tg_id=222 AND lesson_id=?').get(ola1).event_id);
expect(tEv().start.dateTime === `${day(3)}T18:30:00` && /Предложен перенос/.test(tEv().description), 'pending: old time + note in description');
const code = db.prepare('SELECT proposed_start FROM lessons WHERE id=?').get(ola1).proposed_start;
await cb(PAV, `ok:${ola1}:${code}`);
expect(tEv().start.dateTime === `${day(3)}T16:00:00` && sEv().start.dateTime === `${day(3)}T16:00:00` && !/Предложен/.test(tEv().description), 'confirmed in bot chat → moved in both calendars');

// --- отмена урока → событие удалено ---
const mar2 = db.prepare('SELECT id FROM lessons WHERE student_id=? ORDER BY starts_at DESC').get(sid['Марек']).id;
const marEv = db.prepare('SELECT event_id FROM gcal_events WHERE tg_id=333 AND lesson_id=?').get(mar2).event_id;
await api(PAV, 'lesson/cancel', { id: mar2, scope: 'one' });
expect(!google.events.has(marEv) && evs(333).length === 5, 'cancelled lesson removed from Google');

// --- занятость из Google: концерт поверх урока Марека ---
const marL = db.prepare('SELECT starts_at FROM lessons WHERE student_id=? AND status=\'scheduled\' ORDER BY starts_at').get(sid['Марек']).starts_at;
const startUtc = new Date(Date.parse(`${marL.replace(' ', 'T')}:00Z`) - 3 * 3600e3); // примерно за пару часов до урока (с учётом пояса)
google.busy = [{ start: startUtc.toISOString(), end: new Date(startUtc.getTime() + 6 * 3600e3).toISOString() }];
db.prepare('UPDATE google_accounts SET busy_synced_at = NULL WHERE tg_id = 333').run();
sent.length = 0; await scheduled();
const busyRows = db.prepare('SELECT * FROM gcal_busy WHERE teacher_id=333').all();
expect(busyRows.length >= 1 && busyRows[0].from_t === local(google.busy[0].start).slice(11), `Google busy stored by day in local time (${JSON.stringify(busyRows[0])})`);
const warn = sent.find((x) => x.body.chat_id === 333 && /В вашем Google Календаре занято/.test(x.body.text || ''));
expect(!!warn && /Марек/.test(warn.body.text) && /w=\d{4}-\d\d-\d\d/.test(JSON.stringify(warn.body.reply_markup)), 'teacher told which lesson clashes, button opens that week');
db.prepare('UPDATE google_accounts SET busy_synced_at = NULL WHERE tg_id = 333').run();
sent.length = 0; await scheduled();
expect(!sent.some((x) => /В вашем Google Календаре занято/.test(x.body?.text || '')), 'same clash is not reported twice');
r = await api(PAV, 'me', { week: marL.slice(0, 10) });
expect(r.j.busy.some((b) => b.google && b.note === 'занято (Google)' && b.id < 0), 'schedule shows grey «занято (Google)» rows');
r = await api(MAR, 'me', { week: marL.slice(0, 10) });
expect(/занято \(Google\)/.test(r.j.lessons.find((l) => l.starts_at === marL)?.clash || ''), 'student sees that teacher is busy then');
r = await api(PAV, 'lesson/add', { student_id: sid['Ола'], starts_at: `${marL.slice(0, 10)} ${local(new Date(startUtc.getTime() + 3600e3).toISOString()).slice(11)}`, weeks: 1 });
expect(/заняты по Google Календарю/.test(r.j.conflict || ''), 'adding a lesson into Google-busy time → conflict: ' + r.j.conflict);

// --- выключил занятость → строки пропали ---
await api(PAV, 'google/busy', { on: false });
expect(db.prepare('SELECT COUNT(*) n FROM gcal_busy WHERE teacher_id=333').get().n === 0 && acc(333).busy_on === 0, 'busy off → Google busy forgotten');

// --- доступ отозван в Google → отметка и одно сообщение ---
google.revoked.add('rt-c222');
sent.length = 0;
await api(PAV, 'lesson/add', { student_id: sid['Ола'], starts_at: `${day(6)} 10:00`, weeks: 1 });
expect(acc(222).status === 'revoked' && sent.some((x) => x.body.chat_id === 222 && /доступ к нему отозван/.test(x.body.text || '')), 'revoked access noticed, student told');
r = await api(OLA, 'me');
expect(r.j.google.status === 'revoked', 'settings show «подключите снова»');

// --- отключение с удалением календаря ---
const cal = acc(333).calendar_id;
await api(PAV, 'google/disconnect', { delete_calendar: true });
expect(!acc(333) && !google.calendars.has(cal) && evs(333).length === 0, 'disconnect deletes calendar and forgets everything');

done();
