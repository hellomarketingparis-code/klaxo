/**
 * Générateur hebdomadaire de KLAXO.
 *
 *   npm run weekly                       → lit les flux RSS, choisit un sujet, écrit les fichiers de la semaine
 *   npm run weekly -- --fixture dossier  → lit des fichiers .xml locaux au lieu du réseau (tests, hors ligne)
 *   npm run weekly -- --manual "titre|source|https://lien|2026-10-08|ai"   → sujet choisi à la main
 *   npm run weekly -- --date 2026-10-11  → simule une autre date ;  --dry → n'écrit rien
 *
 * Aucune clé n'est nécessaire. Si ANTHROPIC_API_KEY est définie, les textes du modèle sont réécrits par une IA
 * autour du fait d'actualité ; la structure de la mission, elle, vient toujours des modèles validés.
 * En cas d'échec à n'importe quelle étape, la dernière mission valide est conservée : le jeu n'est jamais cassé.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RNG, hashStr } from '../../src/engine/rng';
import { generateCity } from '../../src/map/generator';
import { validateMission } from '../../src/missions/validate';
import { validateChanges } from '../../src/weekly/WorldModifiers';
import type { MissionDef, ArchiveIndex } from '../../src/missions/schema';
import { BLOCKLIST, KEYWORDS, buildWeekly, reserveMission } from './templates';
import type { Category, NewsRef, WeeklyOutput } from './templates';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const DATA = path.join(ROOT, 'public', 'data');
const args = process.argv.slice(2);
const arg = (name: string): string | undefined => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : undefined; };
const flag = (name: string) => args.includes('--' + name);

export interface FeedItem { title: string; link: string; date: Date; source: string; }
const log: string[] = [];
const say = (m: string) => { log.push(m); console.log(m); };

// ---------- Dates ----------
export function isoWeek(d: Date): { id: string; start: Date; end: Date } {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  const monday = new Date(t); monday.setUTCDate(t.getUTCDate() - day + 1);
  const thursday = new Date(monday); thursday.setUTCDate(monday.getUTCDate() + 3);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  const end = new Date(monday); end.setUTCDate(monday.getUTCDate() + 8); // une journée de marge après le dimanche
  return { id: `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`, start: monday, end };
}

// ---------- Lecture des flux ----------
const decode = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/\s+/g, ' ').trim();
/** Analyse minimale RSS 2.0 / Atom : titre, lien, date. */
export function parseFeed(xml: string, source: string): FeedItem[] {
  const out: FeedItem[] = [];
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/g) ?? [];
  for (const b of blocks) {
    const title = decode(b.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] ?? '');
    const link = decode(b.match(/<link[^>]*>([\s\S]*?)<\/link>/)?.[1] ?? '') || (b.match(/<link[^>]*href="([^"]+)"/)?.[1] ?? '');
    const dateStr = decode(b.match(/<(pubDate|published|updated|dc:date)[^>]*>([\s\S]*?)<\/\1>/)?.[2] ?? '');
    const date = new Date(dateStr);
    if (!title || !/^https:\/\//.test(link) || isNaN(date.getTime())) continue;
    out.push({ title, link, date, source });
  }
  return out;
}
async function loadItems(now: Date): Promise<FeedItem[]> {
  const fixture = arg('fixture');
  const items: FeedItem[] = [];
  if (fixture) {
    for (const f of fs.readdirSync(fixture).filter((n) => n.endsWith('.xml')).sort()) items.push(...parseFeed(fs.readFileSync(path.join(fixture, f), 'utf8'), f.replace(/[-_]?\d*\.xml$/, '').replace(/[-_]/g, ' ')));
    say(`Flux locaux : ${items.length} titres lus dans ${fixture}`);
  } else {
    const cfg = JSON.parse(fs.readFileSync(path.join(here, 'feeds.json'), 'utf8'));
    await Promise.all(cfg.feeds.map(async (f: { source: string; url: string }) => {
      try {
        const res = await fetch(f.url, { headers: { 'User-Agent': 'klaxo-weekly/1.0 (jeu satirique ; lecture de titres RSS)' }, signal: AbortSignal.timeout(12000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const got = parseFeed(await res.text(), f.source);
        items.push(...got);
        say(`Flux OK   ${f.url} (${got.length} titres)`);
      } catch (e) { say(`Flux KO   ${f.url} : ${(e as Error).message}`); }
    }));
  }
  const min = now.getTime() - 8 * 86400000;
  return items.filter((it) => it.date.getTime() >= min && it.date.getTime() <= now.getTime() + 86400000);
}

// ---------- Choix du sujet ----------
const STOP = new Set('le la les un une des de du d l et en à au aux pour par sur dans avec sans que qui est son sa ses ce cette ces plus the a an of to in on for and with is are as at by from its it that this new after over says say will has have be'.split(' '));
const tokens = (t: string) => new Set(t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w)));
export function classify(title: string): Category | null {
  const t = ` ${title.toLowerCase()} `;
  if (BLOCKLIST.some((w) => t.includes(w))) return null;
  let best: Category | null = null, score = 0;
  for (const [cat, words] of Object.entries(KEYWORDS)) {
    const n = words.filter((w) => t.includes(w)).length;
    if (n > score) { score = n; best = cat as Category; }
  }
  return best;
}
export function pickTopic(items: FeedItem[], recent: string[], seed: number): { item: FeedItem; category: Category; corroborated: number } | null {
  const rng = new RNG(seed);
  let cands = items.map((it) => ({ it, cat: classify(it.title), tok: tokens(it.title) })).filter((c) => c.cat !== null) as { it: FeedItem; cat: Category; tok: Set<string> }[];
  if (!cands.length) return null;
  // Jamais deux semaines de suite la même catégorie (donc la même mission), sauf si l'actualité n'offre rien d'autre.
  const fresh = cands.filter((c) => c.cat !== recent[0]);
  if (fresh.length) cands = fresh;
  let best: { item: FeedItem; category: Category; corroborated: number; score: number } | null = null;
  for (const c of cands) {
    // Recoupement : d'autres sources parlent-elles du même fait cette semaine ?
    const sources = new Set<string>();
    for (const o of cands) {
      if (o === c || o.it.source === c.it.source) continue;
      let shared = 0; for (const w of c.tok) if (o.tok.has(w)) shared++;
      if (shared >= 3 || (shared >= 2 && shared / Math.min(c.tok.size, o.tok.size) >= 0.5)) sources.add(o.it.source);
    }
    const variety = recent.includes(c.cat) ? -2.5 : 0;
    const score = sources.size * 3 + variety + rng.next() * 0.9;
    if (!best || score > best.score) best = { item: c.it, category: c.cat, corroborated: sources.size, score };
  }
  return best;
}

// ---------- Réécriture facultative par une IA ----------
async function llmRewrite(out: WeeklyOutput, news: NewsRef): Promise<MissionDef | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || flag('no-llm')) return null;
  const m = out.mission;
  const texts = { title: m.title, summary: m.summary, intro: m.intro.map((l) => l.text), objectives: m.steps.map((s) => s.objective), punchline: m.punchline, outro: (m.outro ?? []).map((l) => l.text) };
  const prompt = `Tu écris pour KLAXO, un jeu satirique tout public situé dans une ville fictive.\nFait d'actualité réel de la semaine (à ne pas déformer, à ne pas présenter comme une citation) : « ${news.headline} » (${news.source}, ${news.date}).\n\nVoici les textes d'une mission dont la structure est fixe. Réécris-les pour qu'ils fassent écho à ce fait, avec humour.\nRègles : français ; personnages et organisations fictifs uniquement, aucun nom réel ; aucune accusation ; aucune moquerie de victimes ; ton malicieux, jamais méchant ; même nombre d'éléments dans chaque liste ; titre ≤ 40 caractères ; résumé ≤ 180 ; répliques ≤ 180 ; objectifs ≤ 90 et toujours à l'impératif, en gardant leur sens pratique ; chute : titre ≤ 40, texte ≤ 230.\nRéponds uniquement par un objet JSON de même forme.\n\n${JSON.stringify(texts, null, 2)}`;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: AbortSignal.timeout(60000),
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: process.env.KLAXO_LLM_MODEL ?? 'claude-haiku-5-5', max_tokens: 2000, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body: any = await res.json();
    const raw = String(body?.content?.[0]?.text ?? '');
    const t = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    if (!Array.isArray(t.intro) || t.intro.length !== m.intro.length || !Array.isArray(t.objectives) || t.objectives.length !== m.steps.length) throw new Error('forme inattendue');
    const copy: MissionDef = JSON.parse(JSON.stringify(m));
    copy.title = String(t.title); copy.summary = String(t.summary);
    copy.intro.forEach((l, i) => (l.text = String(t.intro[i])));
    copy.steps.forEach((s, i) => (s.objective = String(t.objectives[i])));
    if (copy.punchline && t.punchline) copy.punchline = { title: String(t.punchline.title), text: String(t.punchline.text) };
    if (copy.outro && Array.isArray(t.outro) && t.outro.length === copy.outro.length) copy.outro.forEach((l, i) => (l.text = String(t.outro[i])));
    return copy;
  } catch (e) { say(`Réécriture IA ignorée : ${(e as Error).message}`); return null; }
}

// ---------- Programme principal ----------
const readJson = (p: string, fallback: any) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } };
const writeJson = (p: string, data: any) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n'); };

export async function main(): Promise<number> {
  const now = arg('date') ? new Date(arg('date')! + 'T12:00:00Z') : new Date();
  const week = isoWeek(now);
  say(`KLAXO — semaine ${week.id} (du ${week.start.toISOString().slice(0, 10)} au ${week.end.toISOString().slice(0, 10)})`);
  const map = generateCity();
  const archivePath = path.join(DATA, 'missions', 'archive', 'index.json');
  const archive: ArchiveIndex = readJson(archivePath, { schema: 1, items: [] });
  // Catégories des semaines précédentes, la plus récente d'abord (la semaine en cours est ignorée si on relance le robot).
  const recent = archive.items.filter((it) => it.week !== week.id).slice(0, 3).map((it) => it.id.split('-').pop()!);
  const seed = hashStr(week.id);

  let news: NewsRef | null = null, category: Category = 'generic';
  const manual = arg('manual');
  if (manual) {
    const [headline, source, url, date, cat] = manual.split('|');
    news = { headline, source, url, date: new Date(date).toISOString(), category: cat };
    category = cat as Category;
    say(`Sujet imposé : « ${headline} » (${source})`);
  } else {
    const items = await loadItems(now);
    say(`${items.length} titres datés des huit derniers jours.`);
    const pick = pickTopic(items, recent, seed);
    if (pick) {
      category = pick.category;
      news = { headline: pick.item.title.slice(0, 240), source: pick.item.source, url: pick.item.link, date: pick.item.date.toISOString(), category };
      say(`Sujet retenu : « ${pick.item.title} » (${pick.item.source}) — catégorie ${category}, recoupé par ${pick.corroborated} autre(s) source(s).`);
    } else say('Aucun sujet exploitable cette semaine.');
  }

  const weeklyPath = path.join(DATA, 'missions', 'weekly.json');
  const previous = readJson(weeklyPath, { schema: 1, missions: [] });
  let out: WeeklyOutput;
  if (news && category !== 'generic') {
    out = buildWeekly(category, news, week.id, week.start, week.end, new RNG(seed), map);
    const rewritten = await llmRewrite(out, news);
    if (rewritten) {
      const r = validateMission(rewritten, map);
      if (r.ok) { out.mission = rewritten; say('Textes réécrits par l’IA et validés.'); } else say(`Réécriture IA rejetée par la validation : ${r.errors.slice(0, 3).join(' ; ')}`);
    }
  } else if (previous.missions?.length && validateMission(previous.missions[0], map).ok) {
    say('On conserve la dernière mission valide.');
    writeLog(week.id, true);
    return 0;
  } else {
    say('Aucune mission précédente : utilisation de la mission de réserve.');
    out = { mission: reserveMission(`weekly-${week.id.toLowerCase()}-reserve`, undefined, week.start.toISOString(), week.end.toISOString()), changes: [] };
  }

  // Validation stricte avant toute écriture.
  const vm = validateMission(out.mission, map);
  const changesFile = { schema: 1 as const, generatedAt: now.toISOString(), changes: out.changes };
  const vc = validateChanges(changesFile);
  if (!vm.ok || !vc.ok) {
    say(`ÉCHEC de validation, rien n'est publié.\n  mission : ${vm.errors.join('\n            ')}\n  monde   : ${vc.errors.join(' ; ')}`);
    writeLog(week.id, false);
    return previous.missions?.length ? 0 : 1;
  }
  say(`Mission valide : « ${out.mission.title} » (${out.mission.steps.map((s) => s.type).join(' → ')}), ${out.changes.length} changement(s) en ville.`);
  if (flag('dry')) { say('Mode --dry : aucun fichier écrit.'); return 0; }

  const file = `${week.id}.json`;
  writeJson(weeklyPath, { schema: 1, generatedAt: now.toISOString(), missions: [out.mission] });
  writeJson(path.join(DATA, 'missions', 'archive', file), { schema: 1, generatedAt: now.toISOString(), missions: [out.mission] });
  writeJson(path.join(DATA, 'world', 'weekly-changes.json'), changesFile);
  archive.items = [{ id: out.mission.id, title: out.mission.title, week: week.id, file, headline: out.mission.news?.headline }, ...archive.items.filter((it) => it.week !== week.id)].slice(0, 52);
  writeJson(archivePath, archive);
  say(`Fichiers écrits : missions/weekly.json, missions/archive/${file}, missions/archive/index.json, world/weekly-changes.json`);
  writeLog(week.id, true);
  return 0;
}
function writeLog(weekId: string, ok: boolean): void {
  if (flag('dry')) return;
  const dir = path.join(here, 'logs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${weekId}.log`), `${new Date().toISOString()} ${ok ? 'OK' : 'ÉCHEC'}\n${log.join('\n')}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().then((code) => process.exit(code));
