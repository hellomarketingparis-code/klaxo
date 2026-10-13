// Valide tous les fichiers de données publiés (missions, monde). Utilisé en local et par l'intégration continue.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateCity } from '../src/map/generator';
import { validateMission } from '../src/missions/validate';
import { validateChanges } from '../src/weekly/WorldModifiers';
import { validateEvents } from '../src/weekly/RandomEvents';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');
const map = generateCity();
let errors = 0;
const read = (rel: string) => JSON.parse(fs.readFileSync(path.join(DATA, rel), 'utf8'));
const report = (file: string, errs: string[]) => { if (errs.length) { errors += errs.length; console.error(`✗ ${file}\n   ${errs.join('\n   ')}`); } else console.log(`✓ ${file}`); };
const missions = (rel: string, min: number) => {
  let data: any;
  try { data = read(rel); } catch (e) { return report(rel, [`illisible : ${(e as Error).message}`]); }
  const errs: string[] = [];
  if (data?.schema !== 1 || !Array.isArray(data.missions)) errs.push('structure attendue : { schema: 1, missions: [] }');
  else { if (data.missions.length < min) errs.push(`au moins ${min} mission(s) attendue(s)`); for (const m of data.missions) errs.push(...validateMission(m, map).errors.map((e) => `${m?.id}: ${e}`)); }
  report(rel, errs);
};
missions('missions/story.json', 3);
missions('missions/weekly.json', 0);
try {
  const idx = read('missions/archive/index.json');
  const errs: string[] = [];
  if (idx?.schema !== 1 || !Array.isArray(idx.items)) errs.push('structure invalide');
  else for (const it of idx.items) { if (!/^[a-zA-Z0-9_-]+\.json$/.test(it.file)) errs.push(`nom de fichier invalide : ${it.file}`); else missions(`missions/archive/${it.file}`, 1); }
  report('missions/archive/index.json', errs);
} catch (e) { report('missions/archive/index.json', [`illisible : ${(e as Error).message}`]); }
try { report('world/weekly-changes.json', validateChanges(read('world/weekly-changes.json')).errors); } catch (e) { report('world/weekly-changes.json', [`illisible : ${(e as Error).message}`]); }
try { report('world/events.json', validateEvents(read('world/events.json')).errors); } catch (e) { report('world/events.json', [`illisible : ${(e as Error).message}`]); }
console.log(errors ? `\n${errors} erreur(s).` : '\nToutes les données sont valides.');
process.exit(errors ? 1 : 0);
