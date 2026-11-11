// Склеивает «мозг» (worker.src.js) и экран (app.html) в один файл slotmate-app.js.
// Запуск из любой папки: node app/build.mjs  (или npm run build)
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (name) => new URL(name, import.meta.url);

export function build() {
  const html = fs.readFileSync(here('app.html'), 'utf8');
  const src = fs.readFileSync(here('worker.src.js'), 'utf8');
  // Функция вместо строки: иначе $& и $' внутри html были бы спецсимволами замены.
  return src.replace('__APP_HTML__', () => JSON.stringify(html));
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const out = here('slotmate-app.js');
  fs.writeFileSync(out, build());
  console.log('built', fs.statSync(out).size);
}
