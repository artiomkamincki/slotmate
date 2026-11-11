import { msg, call, initData, db, sent, scheduled, expect, done } from './harness.mjs';
const OWN = { id: 111, first_name: 'Артём' }, X = { id: 999, first_name: 'Чужой' };
const dapi = async (user, path, body) => { sent.length = 0; const r = await call('/api/' + path, { method: 'POST', headers: { 'x-init-data': initData(user), 'x-demo': '1' }, body: JSON.stringify(body || {}) }); return { status: r.status, j: await r.json(), sent: [...sent] }; };
await msg(OWN, '/start'); await msg(X, '/start');
let r = await dapi(X, 'me');
expect(r.status === 403, 'non-owner cannot open demo');
r = await dapi(OWN, 'me');
expect(r.j.is_teacher && r.j.students.length === 6, 'demo teacher with 6 students');
// Сколько оплат в свежем демо — берём из самих данных (у ученика с нулевым балансом оплаты нет), а не числом в тесте.
const demoPays = () => db.prepare('SELECT COUNT(*) n FROM payments WHERE teacher_id=-1000').get().n;
const freshPays = demoPays();
expect(r.j.to_check.length === 1, 'demo inbox: 1 past lesson to decide');
expect(r.j.lessons.some((l) => l.status === 'pending' && l.proposed_by === 's'), 'demo: student proposal waiting');
expect(r.j.busy.length === 1, 'demo: concert');
const due = r.j.students.filter((s) => s.left <= 0 && (s.paid || s.used)).map((s) => s.name + ':' + s.left);
console.log('  balances:', r.j.students.map((s) => s.name + ' ' + s.left).join(', '));
expect(due.length >= 2, 'demo: some students owe');
// teacher proposes, then answers as student
const l = r.j.lessons.find((x) => x.student_name === 'Зося' && !x.past && x.status === 'scheduled');
const ts = l.starts_at.slice(0, 10) + ' 14:00';
r = await dapi(OWN, 'lesson/propose', { id: l.id, starts_at: ts });
expect(r.j.ok && !r.sent.some((x) => x.method === 'sendMessage'), 'proposal made, nothing actually sent to Telegram: ' + JSON.stringify(r.j));
r = await dapi(OWN, 'demo/as_student', { id: l.id, accept: true });
expect(r.j.ok && db.prepare('SELECT starts_at FROM lessons WHERE id=?').get(l.id).starts_at === ts, 'answered as student → moved');
r = await dapi(OWN, 'pay/add', { student_id: r.j.ok && (await dapi(OWN, 'me')).j.students[0].id, lessons: 4, amount: 600 });
expect(r.j.ok, 'demo payment ok');
r = await dapi(OWN, 'invite');
expect(r.status === 400, 'demo invite link blocked');
// real view not affected
const real = await call('/api/me', { method: 'POST', headers: { 'x-init-data': initData(OWN) }, body: '{}' }).then((x) => x.json());
expect(!real.is_teacher && real.is_admin && !real.is_student, 'real owner view unchanged');
sent.length = 0; await scheduled();
expect(!sent.some((x) => x.body && x.body.chat_id <= -1000), 'hourly job sends nothing to demo people');
r = await dapi(OWN, 'demo/reset');
r = await dapi(OWN, 'me');
expect(r.j.students.length === 6 && demoPays() === freshPays, `reset restores demo (payments ${demoPays()} = ${freshPays})`);
done();
