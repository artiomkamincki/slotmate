// Скриншоты экранов приложения → code/tests/screens/. Запуск: npm run screens
import http from 'node:http';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

let chromium;
try { ({ chromium } = await import('playwright')); } catch (e) {
  if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e;
  console.log('пропущен: нет playwright (в папке code выполни: npm install && npx playwright install chromium)');
  process.exit(0);
}
const { api, msg, call, initData, day, db, expect, done } = await import('./harness.mjs');
const SCREENS = fileURLToPath(new URL('./screens/', import.meta.url));
fs.mkdirSync(SCREENS, { recursive: true });

const OWN = { id: 111, first_name: 'Артём' }, PAV = { id: 333, first_name: 'Павел' }, OLA = { id: 222, first_name: 'Ола' }, MAR = { id: 444, first_name: 'Марек' }, KAS = { id: 555, first_name: 'Кася' };
await msg(OWN, '/start');
let r = await api(OWN, 'teacher_invite'); await msg(PAV, '/start ' + r.j.link.split('start=')[1]);
r = await api(PAV, 'invite'); const sc = r.j.link.split('start=')[1];
for (const u of [OWN, OLA, MAR, KAS]) await msg(u, '/start ' + sc);
r = await api(PAV, 'me'); const sid = Object.fromEntries(r.j.students.map((s) => [s.name, s.id]));
// понедельник следующей недели
const t = day(0); const wdn = new Date(t + 'T12:00:00Z').getUTCDay(); const mon = day(wdn === 0 ? 1 : 8 - wdn);
const d = (i) => new Date(Date.parse(mon + 'T12:00:00Z') + i * 864e5).toISOString().slice(0, 10);
await api(PAV, 'lesson/add', { student_id: sid['Марек'], starts_at: `${d(0)} 17:00`, weeks: 8 });
await api(PAV, 'lesson/add', { student_id: sid['Ола'], starts_at: `${d(2)} 18:30`, weeks: 8 });
await api(PAV, 'lesson/add', { student_id: sid['Кася'], starts_at: `${d(5)} 11:00`, weeks: 8 });
await api(PAV, 'lesson/add', { student_id: sid['Артём'], starts_at: `${d(5)} 15:00`, weeks: 8 });
await api(PAV, 'settings', { pack_size: 4, pack_price: 600 });
await api(PAV, 'pay/add', { student_id: sid['Артём'], lessons: 4, amount: 600 });
await api(PAV, 'pay/add', { student_id: sid['Кася'], lessons: 8, amount: 1200 });
// Ола: прошедшие уроки без оплаты
db.prepare('INSERT INTO lessons (teacher_id, student_id, starts_at) VALUES (?, ?, ?)').run(333, sid['Ола'], `${day(-3)} 18:30`);
db.prepare('INSERT INTO lessons (teacher_id, student_id, starts_at) VALUES (?, ?, ?)').run(333, sid['Ола'], `${day(-10)} 18:30`);
// Ола предлагает перенос (учитель должен ответить)
const olaL = db.prepare('SELECT id FROM lessons WHERE student_id=? AND starts_at=?').get(sid['Ола'], `${d(2)} 18:30`).id;
await api(OLA, 'lesson/propose', { id: olaL, starts_at: `${d(3)} 18:00`, scope: 'one' });
// Кася тоже просит перенос — третий вопрос, в блоке видно «Ещё 1»
const kasL = db.prepare('SELECT id FROM lessons WHERE student_id=? AND starts_at=?').get(sid['Кася'], `${d(5)} 11:00`).id;
await api(KAS, 'lesson/propose', { id: kasL, starts_at: `${d(5)} 12:30`, scope: 'one' });
// прошедший урок Марека, на который он ответил «не смогу» — учитель должен решить
db.prepare("INSERT INTO lessons (teacher_id, student_id, starts_at, reminder_answer) VALUES (?, ?, ?, 'no')").run(333, sid['Марек'], `${day(-1)} 17:00`);
// ещё 8 учеников для экрана оплат
const extra = ['Томек','Зося','Кшиштоф','Ева','Агата','Бартек','Магда','Юлия'];
for (let i = 0; i < extra.length; i++) await msg({ id: 900 + i, first_name: extra[i] }, '/start ' + sc);
r = await api(PAV, 'me'); const all = r.j.students;
for (let i = 0; i < extra.length; i++) { const s = all.find((x) => x.name === extra[i]); if (i % 3) await api(PAV, 'pay/add', { student_id: s.id, lessons: 4, amount: 600 });
  for (let j = 0; j <= i % 4; j++) db.prepare('INSERT INTO lessons (teacher_id, student_id, starts_at) VALUES (?, ?, ?)').run(333, s.id, `${day(-3 - j * 7)} ${9 + i}:00`); }
// Томек: долг, следующий урок — во вторник (на нём учитель видит «Внести оплату»)
await api(PAV, 'lesson/add', { student_id: all.find((x) => x.name === 'Томек').id, starts_at: `${d(1)} 12:00`, auto: true });
// Ева: урок сегодня и долг — «Внести оплату» на главном экране подставит её сама
db.prepare('INSERT INTO lessons (teacher_id, student_id, starts_at) VALUES (?, ?, ?)').run(333, all.find((x) => x.name === 'Ева').id, `${day(0)} 19:00`);



const server = http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const r = await call(req.url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
  res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
}).listen(8789);
await new Promise((ok, bad) => { server.once('listening', ok); server.once('error', bad); });
const b = await chromium.launch();
const errs = [];
async function page(user, scheme = 'light') {
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  p.on('pageerror', (e) => errs.push(e.message));
  await p.route('https://telegram.org/**', (rt) => rt.fulfill({ contentType: 'text/javascript', body: `window.Telegram={WebApp:{initData:${JSON.stringify(initData(user))},colorScheme:'${scheme}',ready(){},expand(){}}}` }));
  await p.goto('http://localhost:8789/app');
  await p.waitForSelector('h1');
  return p;
}
const shot = async (p, name) => { await p.waitForTimeout(300); await p.screenshot({ path: `${SCREENS}${name}.png` }); };
const bg = (p) => p.click('#sheetbg', { position: { x: 5, y: 5 } });

const T = await page(PAV);
await shot(T, '01-teacher-week');
expect(/Ещё 1 ›/.test(await T.textContent('.inbox')), 'inbox shows 2 questions and «Ещё 1»');
await T.click('.inbox >> text=Ещё 1'); await shot(T, '01b-inbox-all'); await T.reload(); await T.waitForSelector('h1');
await T.click('.fab >> text=Внести оплату'); await shot(T, '10-pay-start');
expect(/Ева/.test(await T.textContent('#sheet')) && /Записать · 4 урока · 600 zł/.test(await T.textContent('#paySave')), 'main button: today\'s student with debt is preselected');
await T.click('#sheet >> text=Другой'); await shot(T, '10b-pay-who');
expect(/От кого\?/.test(await T.textContent('#sheet')), 'main button: «Другой» shows who to choose');
await bg(T);
await T.click('[aria-label="Следующая неделя"]'); await T.waitForTimeout(300);
await shot(T, '02-next-week');
await T.click('.day .card:has-text("Ола") >> nth=0'); await T.waitForTimeout(600); await shot(T, '03-answer-sheet');
await T.click('text=Предложить другое время'); await T.waitForTimeout(300); await shot(T, '03b-answer-sheet-open');
await T.click('#sheet >> text=Другое время…'); await T.locator('#sendBtn').scrollIntoViewIfNeeded(); await shot(T, '03c-other-time');
expect(/Выберите новую дату или время/.test(await T.textContent('#sendHint')), 'grey «Предложить перенос» explains why');
await bg(T);
await T.click('.fab >> text=Я занят');
await T.fill('#bd', d(5)); await T.click('.opts[data-name="allday"] [data-v="0"]');
await shot(T, '04-busy-sheet');
await T.click('#sheet >> text=Отметить'); await T.waitForTimeout(900);
await shot(T, '05-move-all');
await T.click('.mvrow >> text=Другое время…'); await T.fill('#mv0d', d(2)); await T.fill('#mv0t', '18:30');
await T.click('#sheet >> button:text-is("Отправить")'); await T.waitForTimeout(500);
await shot(T, '06-move-all-result');
await T.click('#sheet >> text=Выбрать другое время'); await T.waitForTimeout(700); await shot(T, '07-retry');
await bg(T);
// Ученики и оплаты — одна вкладка
await T.click('role=tab[name=/Ученики/]'); await shot(T, '08-students');
await T.screenshot({ path: `${SCREENS}08b-students-full.png`, fullPage: true });
await T.fill('#sq', 'ма'); await T.waitForTimeout(200); await shot(T, '08c-students-search');
await T.fill('#sq', ''); await T.waitForTimeout(200);
await T.click('.card:has-text("Ола") >> nth=0'); await shot(T, '09-student-card');
await bg(T);
// Марек ждёт оплату: в карточке «Внести оплату» — одно нажатие
await T.click('.card:has-text("Марек") >> nth=0'); await shot(T, '12-student-card-due');
await T.click('#sheet >> text=Внести оплату'); await shot(T, '13-pay-sheet');
expect(/Записать · 4 урока · 600 zł/.test(await T.textContent('#paySave')), 'pay sheet: pack preselected');
await T.click('.opts[data-name="pn"] [data-v="1"]');
expect(/Записать · 1 урок · 150 zł/.test(await T.textContent('#paySave')), 'pay sheet: 1 lesson → 150 zł');
await T.click('.opts[data-name="pn"] [data-v="x"]'); await T.fill('#pn', '6'); await shot(T, '13b-pay-sheet-other');
expect(/Записать · 6 уроков · 900 zł/.test(await T.textContent('#paySave')), 'pay sheet: 6 lessons → 900 zł');
await T.fill('#pa', '850');
expect(/6 уроков · 850 zł/.test(await T.textContent('#paySave')), 'pay sheet: amount can be changed');
await T.click('#pkind'); await shot(T, '13c-pay-sheet-initial');
expect(/Записать остаток · 6 уроков/.test(await T.textContent('#paySave')), 'pay sheet: initial balance mode');
await T.click('#pkind'); await T.click('.opts[data-name="pn"] [data-v="8"]');
await T.click('#paySave'); await T.waitForTimeout(500); await shot(T, '13d-pay-toast');
await T.click('role=tab[name=/Расписание/]'); await T.click('.fab >> text=+ Урок');
await T.selectOption('#als', String(sid['Кася'])); await T.fill('#ald', d(0)); await T.fill('#alt', '17:30');
await T.click('#sheet >> text=Добавить'); await T.waitForTimeout(400); await shot(T, '14-add-conflict');
await bg(T); await T.click('[aria-label="Настройки"]'); await shot(T, '15-settings'); await bg(T);
const D = await page(PAV, 'dark'); await shot(D, '16-dark-week');
await D.click('role=tab[name=/Ученики/]'); await shot(D, '16b-dark-students');
const S = await page(OWN);
await shot(S, '17-student-home');
await S.click('.card >> nth=0'); await S.waitForTimeout(500); await shot(S, '18-student-lesson');
await S.click('#sheet >> text=Отменить урок'); await shot(S, '19-cancel-series');
await bg(S);
await S.click('[aria-label="Как это работает"]'); await shot(S, '17b-student-help'); await bg(S);
// Ола в долгу: сверху «Оплаченные уроки закончились · долг» + «Оплатить» (пока муляж)
const SM = await page(OLA); await shot(SM, '17c-student-pay-due');
await SM.click('.paydue >> text=Оплатить'); await shot(SM, '20-student-pay-soon');
const T2 = await page(PAV);
// v6: урок, где ждём оплату, — кнопка «Внести оплату» в одно нажатие
await T2.click('[aria-label="Следующая неделя"]'); await T2.waitForTimeout(300);
await T2.click('.day .card:has-text("Томек") >> nth=0'); await T2.waitForTimeout(500); await shot(T2, '23-teacher-pay-lesson');
await bg(T2); await T2.click('.fab >> text=+ Урок'); await shot(T2, '24-add-lesson-weekly');
// «Не смогу прийти» → нажал свободное время → предложение ушло, можно отозвать
await S.click('.big >> text=Не смогу прийти'); await S.waitForSelector('#rsSlots button'); await shot(S, '18b-student-cant-come');
await S.click('#rsSlots button >> nth=0'); await S.waitForTimeout(600); await shot(S, '18c-student-proposed');
console.log('errors:', errs);
expect(errs.length === 0, 'no JS errors on pages');
await b.close(); server.close();
console.log('скриншоты:', SCREENS);
done();
