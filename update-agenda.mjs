// Usage : node update-agenda.mjs [fichier-de-sortie]
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CALENDAR_ID = 'dd330d9d4daea22bcf5bb9a479f3e66c468db75f51bb2dce9d34fdb62dd9d144@group.calendar.google.com';
const ICS_URL = `https://calendar.google.com/calendar/ical/${encodeURIComponent(CALENDAR_ID)}/public/basic.ics`;
const WINDOW_DAYS = 120;
const MIN_FEED_EVENTS = 20;
const TZ = 'Europe/Paris';
const OUTPUT = resolve(process.argv[2] ?? join(HERE, 'dist', 'nantes-tous-terrains.html'));

const SPORTS = [
  { id: 'futsal',     chip: 'Futsal',   icon: '🥅', words: /futsal/i,           emoji: /🥾/u },
  { id: 'football',   chip: 'Football', icon: '⚽', words: /foot/i,             emoji: /⚽/u },
  { id: 'handball',   chip: 'Hand',     icon: '🤾', words: /hand/i,             emoji: /🤾/u },
  { id: 'basketball', chip: 'Basket',   icon: '🏀', words: /basket/i,           emoji: /🏀/u },
  { id: 'volleyball', chip: 'Volley',   icon: '🏐', words: /volley/i,           emoji: /🏐/u },
  { id: 'rugby',      chip: 'Rugby',    icon: '🏉', words: /rugby/i,            emoji: /🏉/u },
  { id: 'hockey',     chip: 'Hockey',   icon: '🏒', words: /hockey|corsaires/i, emoji: /🏒/u },
];
const CHIP_ORDER = ['football', 'basketball', 'handball', 'volleyball', 'rugby', 'hockey', 'futsal'];
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MONTHS_SHORT = ['JANV', 'FÉVR', 'MARS', 'AVR', 'MAI', 'JUIN', 'JUIL', 'AOÛT', 'SEPT', 'OCT', 'NOV', 'DÉC'];

const parisFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
const weekdayFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, weekday: 'short' });
const stampFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, dateStyle: 'long', timeStyle: 'short' });

function parisParts(ms) {
  const o = {};
  for (const p of parisFmt.formatToParts(new Date(ms))) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour, mi: +o.minute, s: +o.second };
}
function offsetMin(ms) {
  const p = parisParts(ms);
  return Math.round((Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - ms) / 60000);
}
function parisToInstant(y, m, d, h, mi) {
  const t0 = Date.UTC(y, m - 1, d, h, mi);
  const t1 = t0 - offsetMin(t0) * 60000;
  return t0 - offsetMin(t1) * 60000;
}
function offsetStr(min) {
  const a = Math.abs(min);
  return `${min < 0 ? '-' : '+'}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}
const pad = (n) => String(n).padStart(2, '0');

function parseDate(value) {
  let m = value.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return { allDay: true, instant: parisToInstant(+m[1], +m[2], +m[3], 0, 0) };
  m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  const instant = z ? Date.UTC(+y, +mo - 1, +d, +h, +mi, +s) : parisToInstant(+y, +mo, +d, +h, +mi);
  return { allDay: false, instant };
}

function parseEvents(ics) {
  const events = [];
  let cur = null;
  for (const line of ics.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const name = line.slice(0, i).split(';')[0];
    const value = line.slice(i + 1).replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1');
    if (name === 'SUMMARY') cur.summary = value;
    else if (name === 'LOCATION') cur.location = value;
    else if (name === 'STATUS') cur.status = value;
    else if (name === 'DTSTART') cur.start = parseDate(value);
    else if (name === 'DTEND') cur.end = parseDate(value);
  }
  return events;
}

function sportOf(summary) {
  return SPORTS.find((s) => s.words.test(summary)) ?? SPORTS.find((s) => s.emoji.test(summary)) ?? null;
}

function describe(summary) {
  let s = summary.replace(/^[^\p{L}\p{N}]+/u, '').trim();
  const colon = s.indexOf(':');
  if (colon > 0 && colon < 40 && SPORTS.some((x) => x.words.test(s.slice(0, colon)))) s = s.slice(colon + 1).trim();
  const parts = s.split(/\s+-\s+/);
  let title, extra;
  if (/\s+vs\.?\s+/i.test(parts[0])) { title = parts[0]; extra = parts.slice(1).join(' - '); }
  else if (parts.length > 1) { title = `${parts[1]} en ${parts[0]}`; extra = parts.slice(2).join(' - '); }
  else { title = parts[0]; extra = ''; }
  extra = extra
    .replace(/\s*\((?:FFHG|Championnat Fédéral|MP\d+)\)/gi, '')
    .replace(/\s*\(à confirmer selon tirage\)/i, ' (à confirmer)')
    .trim();
  return { title: title.replace(/\s+/g, ' ').trim(), extra };
}

function venueOf(location = '') {
  const first = location.split(',')[0].trim();
  if (/Salle sportive Métropolitaine/i.test(first)) return 'Salle Métropolitaine, Rezé';
  if (/Complexe Sportif Mangin-Beaulieu/i.test(first)) return 'Complexe sportif Mangin-Beaulieu';
  return first;
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function toFixture(ev) {
  const sport = sportOf(ev.summary);
  const p = parisParts(ev.start.instant);
  const { title, extra } = describe(ev.summary);
  const sub = [extra, venueOf(ev.location)].filter(Boolean).join(' · ');
  let time = 'Toute la journée';
  if (!ev.start.allDay) {
    time = `${pad(p.h)}h${pad(p.mi)}`;
    if (ev.end && !ev.end.allDay) {
      const e = parisParts(ev.end.instant);
      time += `–${pad(e.h)}h${pad(e.mi)}`;
    }
  }
  return {
    sport, p, instant: ev.start.instant, title, sub, time,
    iso: `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}${offsetStr(offsetMin(ev.start.instant))}`,
    dow: weekdayFmt.format(new Date(ev.start.instant)).replace('.', '').toUpperCase(),
  };
}

function fixtureHtml(f) {
  return `      <div class="fixture" data-sport="${f.sport.id}" data-iso="${f.iso}">
        <div class="f-date"><span class="dow">${f.dow}</span><span class="dom">${pad(f.p.d)}</span><span class="mon">${MONTHS_SHORT[f.p.m - 1]}</span></div>
        <div class="f-main"><div class="title"><span class="sport-icon">${f.sport.icon}</span>${esc(f.title)}</div><div class="sub">${esc(f.sub)}</div></div>
        <div class="f-time">${f.time}</div>
      </div>`;
}

function boardHtml(fixtures) {
  if (!fixtures.length) {
    return '    <p style="color:var(--anthracite);opacity:.7">Aucun match programmé pour le moment. Abonnez-vous : les prochains arriveront dans votre agenda.</p>';
  }
  const groups = new Map();
  for (const f of fixtures) {
    const key = `${f.p.y}-${pad(f.p.m)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }
  return [...groups.values()].map((list) => {
    const { y, m } = list[0].p;
    const n = list.length;
    return `    <div class="month-head"><h2>${MONTHS[m - 1][0].toUpperCase()}${MONTHS[m - 1].slice(1)} ${y}</h2><span class="rule"></span><span class="count">${n} rencontre${n > 1 ? 's' : ''}</span></div>
    <div class="board-card">
${list.map(fixtureHtml).join('\n')}
    </div>`;
  }).join('\n\n');
}

function chipsHtml(fixtures) {
  const chip = (id, label, n) => `      <button class="chip" data-sport="${id}" aria-pressed="true">${label}<span class="n">${n}</span></button>`;
  const rows = [chip('all', 'Tous', fixtures.length)];
  for (const id of CHIP_ORDER) {
    const n = fixtures.filter((f) => f.sport.id === id).length;
    if (n) {
      const s = SPORTS.find((x) => x.id === id);
      rows.push(chip(id, `${s.icon} ${s.chip}`, n));
    }
  }
  return rows.join('\n');
}

function ledeText(fixtures) {
  const sports = 'Foot, hand, basket, volley, rugby, hockey sur glace, futsal.';
  if (!fixtures.length) return `${sports} Aucun match à domicile programmé pour l'instant.`;
  const a = fixtures[0].p, b = fixtures[fixtures.length - 1].p;
  const n = fixtures.length;
  let period;
  if (a.y === b.y && a.m === b.m) period = `en ${MONTHS[a.m - 1]} ${a.y}`;
  else if (a.y === b.y) period = `entre ${MONTHS[a.m - 1]} et ${MONTHS[b.m - 1]} ${a.y}`;
  else period = `entre ${MONTHS[a.m - 1]} ${a.y} et ${MONTHS[b.m - 1]} ${b.y}`;
  return `${sports} ${n} match${n > 1 ? 's' : ''} à domicile des clubs nantais, ${period}.${n > 1 ? " Dans l'ordre où ils tombent." : ''}`;
}

// Le modèle est un fragment (title, polices, style, contenu) : on le range dans un vrai document HTML.
function standalone(html) {
  const cut = html.indexOf('</style>') + '</style>'.length;
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
${html.slice(0, cut)}
<style>body{margin:0}[hidden]{display:none!important}</style>
</head>
<body>
${html.slice(cut)}
</body>
</html>
`;
}

async function download() {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(ICS_URL, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text.startsWith('BEGIN:VCALENDAR')) throw new Error('réponse inattendue (pas un agenda)');
      return text;
    } catch (e) {
      lastError = e;
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 3000));
    }
  }
  throw new Error(`téléchargement de l'agenda impossible : ${lastError.message}`);
}

async function main() {
  const events = parseEvents(await download());
  if (events.length < MIN_FEED_EVENTS) throw new Error(`agenda suspect : ${events.length} événements seulement`);

  const now = Date.now();
  const t = parisParts(now);
  const todayStart = parisToInstant(t.y, t.m, t.d, 0, 0);
  const windowEnd = todayStart + WINDOW_DAYS * 86400000;

  const upcoming = events.filter((e) => e.start && e.status !== 'CANCELLED' && e.summary && e.start.instant >= todayStart);
  const skipped = [];
  const seen = new Set();
  const fixtures = [];
  for (const ev of upcoming) {
    if (ev.start.instant >= windowEnd) continue;
    if (!sportOf(ev.summary)) { skipped.push(ev.summary); continue; }
    const key = `${ev.summary}|${ev.start.instant}`;
    if (seen.has(key)) continue;
    seen.add(key);
    fixtures.push(toFixture(ev));
  }
  fixtures.sort((a, b) => a.instant - b.instant || a.title.localeCompare(b.title, 'fr'));

  const lastYear = upcoming.length ? parisParts(Math.max(...upcoming.map((e) => e.start.instant))).y : t.y;
  const values = {
    LEDE: esc(ledeText(fixtures)),
    CHIPS: chipsHtml(fixtures),
    BOARD: boardHtml(fixtures),
    UPDATED: stampFmt.format(new Date(now)),
    LAST_YEAR: String(lastYear),
  };
  let html = await readFile(join(HERE, 'template.html'), 'utf8');
  for (const [k, v] of Object.entries(values)) html = html.split(`{{${k}}}`).join(v);
  if (html.includes('{{')) throw new Error('marqueur non remplacé dans le modèle');

  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(`${OUTPUT}.tmp`, standalone(html), 'utf8');
  await rename(`${OUTPUT}.tmp`, OUTPUT);

  console.log(`OK : ${fixtures.length} matchs (${WINDOW_DAYS} jours), écrit dans ${OUTPUT}`);
  for (const s of skipped) console.warn(`Ignoré (sport non reconnu) : ${s}`);
}

main().catch((e) => {
  console.error(`ÉCHEC, la page précédente est conservée : ${e.message}`);
  process.exit(1);
});
