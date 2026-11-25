// Checks the trait library (js/data.js + js/data-more.js): run with `node scripts/validate-data.cjs`.
const path = require('path');
global.window = {};
require(path.join(__dirname, '../js/data.js'));
require(path.join(__dirname, '../js/data-more.js'));
require(path.join(__dirname, '../js/ideas.js'));
const D = window.HABIT_DATA;
const errs = [];
const names = {};

const all = D.domains.flatMap((d) => d.traits.map((t) => [d.id, t])).concat(D.general.map((t) => ['general', t]));
for (const [dom, t] of all) {
  names[t.name] = (names[t.name] || []).concat(dom);
  const words = t.name.trim().split(/\s+/);
  if (words.length > 2) errs.push(`${dom}: trait name has more than 2 words: ${t.name}`);
  words.forEach((w) => { if ([...w].length > 8) errs.push(`${dom}: word longer than 8 letters (won't fit the map): ${w}`); });
  if (t.habits.length !== 5) errs.push(`${dom}/${t.name}: ${t.habits.length} habits (expected 5)`);
  if (!t.how || !t.stretch || !t.starter || !t.starter.cue || !t.starter.text) errs.push(`${dom}/${t.name}: missing field`);
  else if (/^אחרי/.test(t.starter.cue)) errs.push(`${dom}/${t.name}: cue must not start with "אחרי"`);
  if (new Set(t.habits).size !== t.habits.length) errs.push(`${dom}/${t.name}: duplicate habit`);
}
Object.entries(names).filter(([, d]) => d.length > 1).forEach(([n, d]) => errs.push(`duplicate trait name "${n}" in ${d.join(', ')}`));

const ids = D.domains.map((d) => d.id);
if (new Set(ids).size !== ids.length) errs.push('duplicate domain id');
D.domains.forEach((d) => {
  if (d.traits.length < 2) errs.push(`${d.id}: fewer than 2 traits`);
  if (!d.identity.startsWith('ש')) errs.push(`${d.id}: identity must start with "ש"`);
  d.keywords.forEach((k) => { if (!k.includes(' ') && [...k].length < 2) errs.push(`${d.id}: keyword too short: ${k}`); });
});

// every idea must lead to at least one domain, using the site's own matcher from js/app.js
const src = require('fs').readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
const matcherSrc = src.slice(src.indexOf('  function clean('), src.indexOf('  function joinHe('));
const matchDomains = new Function('D', matcherSrc + '; return matchDomains;')(D);
const ideas = window.HABIT_IDEAS || [];
ideas.forEach((i) => {
  if (!i.label || !i.goal) errs.push('idea missing label or goal');
  else if (!matchDomains(i.goal).length) errs.push(`idea matches no domain: "${i.label}" -> ${i.goal}`);
});

console.log(`domains ${D.domains.length} | traits ${all.length} | ideas ${ideas.length}`);
if (errs.length) { console.error(errs.join('\n')); process.exit(1); }
console.log('all checks passed');
