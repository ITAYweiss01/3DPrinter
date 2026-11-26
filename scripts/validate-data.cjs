// Checks the trait library (js/data.js): run with `node scripts/validate-data.cjs`.
const path = require('path');
global.window = {};
require(path.join(__dirname, '../js/data.js'));
require(path.join(__dirname, '../js/ideas.js'));
const D = window.HABIT_DATA;
const errs = [];
const names = {};

const all = D.domains.flatMap((d) => d.traits.map((t) => [d.id, t])).concat(D.general.map((t) => ['general', t]));
for (const [dom, t] of all) {
  names[t.name] = (names[t.name] || []).concat(dom);
  const words = t.name.trim().split(/\s+/);
  // up to 2 words, or 3 short ones ("איש של בוקר"): the map shows the first word, then the rest
  const fits = (ws) => ws.length <= 2 || (ws.length === 3 && ws.join('').length <= 10);
  if (!fits(words)) errs.push(`${dom}: trait name too long for the map: ${t.name}`);
  words.forEach((w) => { if ([...w].length > 8) errs.push(`${dom}: word longer than 8 letters (won't fit the map): ${w}`); });
  // the feminine name (for "את") follows the same size rules: it has to fit the map too
  if (!t.name_f) errs.push(`${dom}/${t.name}: missing name_f`);
  else {
    const fw = t.name_f.trim().split(/\s+/);
    if (!fits(fw)) errs.push(`${dom}: name_f too long for the map: ${t.name_f}`);
    fw.forEach((w) => { if ([...w].length > 8) errs.push(`${dom}: name_f word longer than 8 letters: ${w}`); });
  }
  if (t.habits.length !== 5) errs.push(`${dom}/${t.name}: ${t.habits.length} habits (expected 5)`);
  if (!t.how || !t.stretch || !t.starter || !t.starter.cue || !t.starter.text || !t.starter.task) errs.push(`${dom}/${t.name}: missing field`);
  // habits are tasks: no first-person present ("אני ..."), and no trailing period
  t.habits.concat([t.stretch, t.starter.task]).forEach((h) => {
    if (/^אני /.test(h)) errs.push(`${dom}/${t.name}: habit in first person: ${h}`);
    if (/\.$/.test(h)) errs.push(`${dom}/${t.name}: habit ends with a period: ${h}`);
  });
  if (!/^אני /.test(t.starter.text)) errs.push(`${dom}/${t.name}: starter text should start with "אני": ${t.starter.text}`);
  // a habit hangs on a fixed moment of the routine or a set frequency, never on an event
  // ("when I get angry", "when something fails", "when I feel an urge")
  const EVENT_CUE = /מישהו|משהו|דחף|מרגיש|בא לי|עולה לי|רואה|שומע|פוגש|מבטיח|מתלבט|ידיעה מסעירה|תזכורת|נכנס לי תשלום|יש לי רעיון|לא מקשיב|מבקש|משתבש|לא הצליח|עומד להגיד|מגיע הרגע|שבור|ערב פנוי/;
  if (EVENT_CUE.test(t.starter.cue)) errs.push(`${dom}/${t.name}: cue is an event, not a routine moment: ${t.starter.cue}`);
  const EVENT_HABIT = /כשמתעצבנים|כשמתוסכלים|כשכועסים|כשקשה|כשטעיתי|כשצריך|כשמשהו|כשמישהו|כשרואים|כשכואב|כשאפשר|כשמרגישים|כשהשיחה|מעידה|נכנעים|לפני תגובה|לפני שעונים|באותו יום|ברגע ש|בגרסה קטנה יותר|כשמגיעה|כשנגמר/;
  t.habits.concat([t.stretch, t.starter.task]).forEach((h) => {
    if (EVENT_HABIT.test(h)) errs.push(`${dom}/${t.name}: habit depends on an event: ${h}`);
  });
  // a habit repeats at least every week: monthly or yearly is too far apart to become automatic
  const RARE = /בחודש|בשנה|חודשי|שנתי|לסוף החודש|לשלושה חודשים/;
  t.habits.concat([t.stretch, t.starter.task, t.starter.cue]).forEach((h) => {
    if (RARE.test(h)) errs.push(`${dom}/${t.name}: less often than weekly: ${h}`);
  });
  if (t.starter && /^אחרי/.test(t.starter.cue || '')) errs.push(`${dom}/${t.name}: cue must not start with "אחרי"`);
  if (new Set(t.habits).size !== t.habits.length) errs.push(`${dom}/${t.name}: duplicate habit`);
}
Object.entries(names).filter(([, d]) => d.length > 1).forEach(([n, d]) => errs.push(`duplicate trait name "${n}" in ${d.join(', ')}`));

const ids = D.domains.map((d) => d.id);
if (new Set(ids).size !== ids.length) errs.push('duplicate domain id');
D.domains.forEach((d) => {
  if (d.traits.length < 1) errs.push(`${d.id}: no traits`);
  if (!d.identity.startsWith('ש')) errs.push(`${d.id}: identity must start with "ש"`);
  if (!d.identity_f || !d.identity_f.startsWith('ש')) errs.push(`${d.id}: identity_f missing or not starting with "ש"`);
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
