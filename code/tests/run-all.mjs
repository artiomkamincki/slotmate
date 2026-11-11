// Запускает все tests/*.test.mjs (кроме ui5 — это скриншоты, см. npm run screens)
// по очереди, каждый в отдельном процессе. Код выхода 1, если хоть один упал.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('.', import.meta.url));
const SKIP = new Set(['ui5.test.mjs']);
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.mjs') && !SKIP.has(f)).sort();

const results = [];
for (const f of files) {
  console.log(`\n########## ${f}`);
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', f], { cwd: dir, stdio: 'inherit' });
  results.push({ f, ok: r.status === 0 });
}

console.log('\n########## Итог');
for (const { f, ok } of results) console.log(`${ok ? 'OK  ' : 'FAIL'}  ${f}`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\nУпало файлов: ${failed} из ${results.length}` : `\nВсе ${results.length} файлов прошли`);
process.exitCode = failed ? 1 : 0;
