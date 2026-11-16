// يبني ملفات القواميس public/i18n/{en,ru,zh}.js من i18n/*.js
// تشغيل: node tools/build-i18n.js
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'i18n');
const out = path.join(__dirname, '..', 'public', 'i18n');
const LANGS = ['en', 'ru', 'zh'];
const strings = [];
const patterns = [];
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js')).sort()) {
  const m = require(path.join(dir, f));
  if (Array.isArray(m)) strings.push(...m);
  else { strings.push(...(m.strings || [])); patterns.push(...(m.patterns || [])); }
}
const norm = (s) => s.replace(/\s+/g, ' ').trim();
fs.mkdirSync(out, { recursive: true });
LANGS.forEach((lang, i) => {
  const dict = {};
  for (const row of strings) {
    if (row.length !== 4) throw new Error(`bad row: ${row[0]}`);
    dict[norm(row[0])] = row[i + 1];
  }
  // الأنماط الأطول (نصها الثابت أكتر) تتجرب الأول علشان الأدق يكسب
  const lit = (s) => s.replace(/\{\}/g, '').length;
  const pats = [...patterns].sort((a, b) => lit(b[0]) - lit(a[0])).map((r) => {
    if ((r[0].match(/\{\}/g) || []).length !== (r[i + 1].match(/\{\}/g) || []).length) throw new Error(`placeholder mismatch (${lang}): ${r[0]}`);
    return [norm(r[0]), r[i + 1]];
  });
  fs.writeFileSync(path.join(out, `${lang}.js`), `/* مولّد تلقائيًا من i18n/ — لا تعدّله يدويًا */\nwindow.I18N_DICT=${JSON.stringify(dict)};\nwindow.I18N_PATS=${JSON.stringify(pats)};\n`);
});
console.log(`i18n: ${strings.length} strings, ${patterns.length} patterns → ${LANGS.join(', ')}`);
