import type { MissionDef, Step } from '../../src/missions/schema';
import type { WorldChange } from '../../src/weekly/WorldModifiers';
import { RNG } from '../../src/engine/rng';
import type { CityMap } from '../../src/map/CityMap';

/**
 * Modèles de missions d'actualité. Chaque catégorie d'actualité correspond à un scénario satirique
 * construit uniquement avec les mécaniques du moteur. Personnages et organisations sont fictifs.
 * C'est le mode de secours déterministe : il fonctionne sans aucune API d'IA.
 */
export interface NewsRef { headline: string; source: string; url: string; date: string; category: string; }
export interface WeeklyOutput { mission: MissionDef; changes: WorldChange[]; }
export type Category = 'ai' | 'outage' | 'prices' | 'transport' | 'energy' | 'app' | 'space' | 'culture' | 'business' | 'generic';

/** Mots-clés (français et anglais) qui rattachent un titre à une catégorie. */
export const KEYWORDS: Record<Exclude<Category, 'generic'>, string[]> = {
  ai: ['intelligence artificielle', ' ia ', 'robot', 'chatbot', 'artificial intelligence', ' ai ', 'humanoid', 'automation', 'automatisation', 'algorithme', 'openai', 'anthropic', 'deepseek', 'gemini'],
  outage: ['panne', 'outage', 'bug', 'hors service', 'interruption', 'glitch', 'down for', 'crash informatique', 'mise à jour défectueuse', 'faulty update'],
  prices: ['inflation', 'prix', 'hausse des tarifs', 'coût de la vie', 'cost of living', 'prices', 'price rise', 'pouvoir d’achat', "pouvoir d'achat", 'loyers', 'tariff'],
  transport: ['grève', 'strike', 'sncf', 'train', 'embouteillage', 'traffic jam', 'métro', 'airline', 'aéroport', 'airport', 'retards', 'delays', 'transports'],
  energy: ['énergie', 'energy', 'électricité', 'electricity', 'blackout', 'coupure de courant', 'power cut', 'nucléaire', 'nuclear', 'réseau électrique', 'power grid', 'data center', 'centre de données'],
  app: ['application', 'appli', ' app ', 'réseau social', 'social network', 'smartphone', 'iphone', 'android', 'abonnement', 'subscription', 'streaming', 'tiktok', 'instagram', 'mise à jour', 'update'],
  space: ['espace', 'space', 'fusée', 'rocket', 'lune', 'moon', 'mars', 'satellite', 'astéroïde', 'asteroid', 'télescope', 'telescope', 'nasa', 'esa', 'spacex', 'découverte scientifique'],
  culture: ['festival', 'cinéma', 'film', 'concert', 'exposition', 'musée', 'museum', 'prix nobel', 'nobel prize', 'coupe du monde', 'world cup', 'jeux olympiques', 'olympic', 'tournoi', 'championnat', 'record'],
  business: ['milliard', 'billion', 'bourse', 'stock market', 'rachat', 'acquisition', 'levée de fonds', 'funding round', 'ipo', 'introduction en bourse', 'start-up', 'startup', 'licorne', 'unicorn', 'banque centrale', 'central bank'],
};
/** Sujets que le jeu ne transforme jamais en divertissement. */
export const BLOCKLIST = ['mort', 'morts', 'tué', 'tués', 'décès', 'deuil', 'attentat', 'guerre', 'bombard', 'massacre', 'fusillade', 'séisme', 'tremblement de terre', 'ouragan', 'inondation', 'incendie', 'victime', 'viol', 'suicide', 'meurtre', 'otage', 'famine', 'épidémie', 'crash d’avion', 'naufrage',
  'dead', 'death', 'dies', 'died', 'killed', 'kill', 'war ', 'attack', 'bombing', 'shooting', 'earthquake', 'hurricane', 'flood', 'wildfire', 'victim', 'rape', 'murder', 'hostage', 'famine', 'outbreak', 'plane crash', 'shipwreck', 'genocide', 'terror', 'abuse', 'homicide'];

const MONDAY = (week: Date) => week.toISOString();

export function buildWeekly(category: Category, news: NewsRef, weekId: string, start: Date, end: Date, rng: RNG, map: CityMap): WeeklyOutput {
  // Trajets : on ordonne les lieux au plus proche et on calcule un chronomètre réaliste (distance / 50 px·s⁻¹ + marge).
  const at = (poi: string) => map.poiPx(poi);
  const route = (pois: string[], from = 'kiosk'): string[] => {
    const left = [...pois], out: string[] = [];
    let cur = at(from);
    while (left.length) {
      left.sort((a, b) => (Math.abs(at(a).x - cur.x) + Math.abs(at(a).y - cur.y)) - (Math.abs(at(b).x - cur.x) + Math.abs(at(b).y - cur.y)));
      const n = left.shift()!; out.push(n); cur = at(n);
    }
    return out;
  };
  const limit = (pois: string[], min: number, from = 'kiosk'): number => {
    let need = 0, cur = at(from);
    for (const p of pois) { const q = at(p); need += Math.abs(q.x - cur.x) + Math.abs(q.y - cur.y); cur = q; }
    return Math.min(880, Math.max(min, Math.ceil(need / 50 / 10) * 10 + 40));
  };
  const id = `weekly-${weekId.toLowerCase()}-${category}`;
  const s = MONDAY(start), e = MONDAY(end);
  const base = (title: string, summary: string, giverName: string, intro: string[], steps: Step[], punch: { title: string; text: string }, outro: string, extra: Partial<MissionDef> = {}): MissionDef => ({
    schema: 1, id, kind: 'weekly', title, summary,
    giver: { name: giverName, profile: 'shopkeeper', at: { poi: 'kiosk', dx: 2 } },
    // Une réplique précédée de « > » est dite par le joueur ; les autres par le donneur de mission.
    intro: intro.map((text) => (text.startsWith('> ') ? { who: 'player', text: text.slice(2) } : { who: 'giver', text })),
    steps, punchline: punch, outro: [{ who: 'giver', text: outro }],
    reward: { money: 900, xp: 180 }, news, publishedAt: s, expiresAt: e, ...extra,
  });
  const ch = (suffix: string, c: Omit<WorldChange, 'id' | 'start' | 'end'>): WorldChange => ({ id: `${weekId.toLowerCase()}-${suffix}`, start: s, end: e, ...c });
  const JO = 'Jo la Dépêche';

  switch (category) {
    case 'ai': {
      const spots = route(rng.shuffle(['mairie', 'gare', 'banque', 'clothes', 'm2_giver', 'tour', 'parc', 'police']).slice(0, 5));
      return {
        mission: base('Ralentissez, Robotix !', 'L’usine Robotix a lâché ses robots stagiaires en ville. Ils sont polis, zélés, et beaucoup trop rapides.', JO,
          ['Tu as vu l’actu sur l’intelligence artificielle cette semaine ? Pile au même moment, Robotix lâche ses robots stagiaires en ville.', '> Ils font quoi, ces robots ?', 'Tout. Trop vite. L’un d’eux a rangé mon kiosque par ordre alphabétique. J’ai mis trois heures à retrouver « Aujourd’hui ».', 'Débranche-les et rapporte les fusibles à l’usine. Gentiment : ils sont en période d’essai.'],
          [
            { type: 'collect', objective: 'Débranche les robots stagiaires trop zélés', targets: spots.map((poi) => ({ poi, dy: 1 })), item: { id: 'fusible', name: 'Fusible de robot' }, radius: 2, timeLimit: limit(spots, 200), checkpoint: true,
              onStart: [{ do: 'world', set: 'robots', value: 0.5, seconds: 600 }, { do: 'sfx', name: 'robot' }],
              events: [{ at: 20, do: [{ do: 'say', who: 'Robot stagiaire', text: 'Bonjour. J’ai optimisé votre trajet. Il passe par ici. Désolé.' }] }, { at: 90, do: [{ do: 'say', who: JO, text: 'Dépêche-toi : il y en a un qui vient de finir mes mots croisés. Au stylo.' }] }] },
            { type: 'deliver', objective: 'Rapporte les fusibles à l’usine Robotix', target: { poi: 'usine' }, radius: 5, item: { id: 'fusible', name: 'Les fusibles' } },
            { type: 'talk', objective: 'Parle à l’ingénieure de Robotix', npc: { name: 'Ingénieure Vitesse', profile: 'worker', at: { poi: 'usine', dx: 2 } },
              lines: [{ who: 'npc', text: 'Nos robots vont trop vite ? Impossible. Nous avons fait un sondage.' }, { who: 'player', text: 'Et alors ?' }, { who: 'npc', text: 'Regardez vous-même les résultats.' }] },
          ],
          { title: 'Sondage interne', text: 'Chez Robotix, 64 % des personnes interrogées trouvent que tout va trop vite. Les 36 % restants étaient des robots. Ils ont répondu avant la fin de la question.' },
          'Ils vont sortir un mode « Lent ». En option payante, évidemment.'),
        changes: [
          ch('robots', { type: 'robots', label: 'Des robots stagiaires de Robotix arpentent les trottoirs.', share: 0.2 }),
          ch('chatter', { type: 'chatter', label: 'Les habitants trouvent que tout va trop vite.', lines: ['Tout va trop vite.', 'Mon grille-pain a fait une mise à jour.', 'Un robot m’a tenu la porte. Avant que j’arrive.', 'Je veux bien le progrès, mais au pas.', 'Il m’a dit « bonne journée » en 0,2 seconde.'] }),
          ch('billboard', { type: 'billboard', label: 'Les panneaux de la ville appellent au calme.', text: 'RALENTISSEZ' }),
        ],
      };
    }
    case 'outage': {
      const spots = route(rng.shuffle(['banque', 'gare', 'police', 'hotel', 'tour', 'clothes']).slice(0, 4));
      return {
        mission: base('Écran bleu sur Klaxo', 'Grande panne informatique : plus rien ne marche, sauf le papier. La mairie réclame ses formulaires.', JO,
          ['Panne générale ! Les feux clignotent, les caisses boudent, et la mairie a ressorti les tampons.', '> Je peux aider ?', 'Il leur faut le formulaire B-12, en quatre exemplaires, à récupérer aux quatre coins de la ville. C’est ça ou attendre le technicien. Il arrive entre 8 h et jeudi.'],
          [
            { type: 'collect', objective: 'Récupère les formulaires B-12', targets: spots.map((poi) => ({ poi, dy: 1 })), item: { id: 'formulaire', name: 'Formulaire B-12' }, radius: 2, timeLimit: limit(spots, 180), checkpoint: true,
              onStart: [{ do: 'world', set: 'lights_blink', value: 1, seconds: 600 }],
              events: [{ at: 30, do: [{ do: 'say', who: JO, text: 'Attention aux carrefours : les feux clignotent et tout le monde a la priorité. Surtout les autres.' }] }] },
            { type: 'deliver', objective: 'Dépose les formulaires à la mairie', target: { poi: 'mairie' }, radius: 5, item: { id: 'formulaire', name: 'Les formulaires' } },
            { type: 'talk', objective: 'Fais tamponner les formulaires', npc: { name: 'Monsieur Tampon', profile: 'employee', at: { poi: 'mairie', dx: 2 } },
              lines: [{ who: 'npc', text: 'Quatre exemplaires. Parfait. Je les saisis dans l’ordinateur.' }, { who: 'player', text: 'L’ordinateur est en panne.' }, { who: 'npc', text: 'Ah. Alors il me faudra le formulaire B-13.' }] },
          ],
          { title: 'Retour à la normale', text: 'La panne a été résolue en éteignant puis en rallumant la ville. Le formulaire B-13 sert à demander le formulaire B-12.' },
          'Tout remarche. Enfin, comme avant, quoi.'),
        changes: [
          ch('feux', { type: 'lights_mode', label: 'Panne informatique : les feux de circulation clignotent.', mode: 'blink' }),
          ch('chatter', { type: 'chatter', label: 'La panne est sur toutes les lèvres.', lines: ['Vous avez essayé d’éteindre et de rallumer ?', 'Ma carte ne passe plus. Mon charme non plus.', 'Je paie en liquide, comme en 1998.', 'Le réseau est tombé. Il va bien ?', 'J’ai dû parler à quelqu’un. En vrai.'] }),
        ],
      };
    }
    case 'prices':
      return {
        mission: base('La baguette en or', 'Les prix s’envolent. Le marché confie sa dernière baguette abordable à un coffre de la banque.', JO,
          ['Tu as vu les prix ? Au marché, il reste UNE baguette à l’ancien tarif. Ils veulent la mettre au coffre.', '> Une baguette. Dans un coffre.', 'À la Banque Pognon. C’est fragile, c’est précieux, et ça refroidit. Fonce, mais ne la casse pas.'],
          [
            { type: 'pickup', objective: 'Prends la baguette au marché', target: { poi: 'marche' }, item: { id: 'baguette', name: 'Baguette à l’ancien prix' } },
            { type: 'get_vehicle', objective: 'Trouve un véhicule', checkpoint: true },
            { type: 'deliver', objective: 'Mets la baguette à l’abri à la Banque Pognon', target: { poi: 'banque' }, radius: 5, timeLimit: limit(['banque'], 90, 'marche'), fragile: { max: 4 }, item: { id: 'baguette', name: 'La baguette' },
              events: [{ at: 25, do: [{ do: 'say', who: JO, text: 'Elle a encore pris dix centimes pendant que tu roulais.' }] }, { at: 60, do: [{ do: 'toast', text: 'La baguette refroidit. Sa valeur aussi.' }] }] },
          ],
          { title: 'Valeur refuge', text: 'La baguette repose désormais en salle des coffres, entre deux lingots. Le banquier assure qu’elle a déjà pris 4 %. Elle a surtout pris un coup de vieux.' },
          'Demain, on essaie avec un croissant. Il paraît que c’est plus spéculatif.', { reward: { money: 950, xp: 180 } }),
        changes: [
          ch('prix', { type: 'prices', label: 'Hausse des prix : garages et boutiques augmentent leurs tarifs.', factor: 1.2 }),
          ch('chatter', { type: 'chatter', label: 'Tout le monde parle des prix.', lines: ['Tu as vu le prix du café ?', 'Je regarde les vitrines, c’est gratuit.', 'À ce prix-là, je la veux dédicacée, la baguette.', 'J’ai payé un sandwich en trois fois.', 'Même les soldes ont augmenté.'] }),
        ],
      };
    case 'transport':
      return {
        mission: base('Tout le monde en taxi', 'Les transports sont à l’arrêt. La ville entière cherche un chauffeur. Tu as une voiture, donc une vocation.', JO,
          ['Plus un bus, plus un tram. La moitié de la ville est coincée sur le trottoir.', '> Et l’autre moitié ?', 'Elle klaxonne. Prends une voiture et dépose trois naufragés. Ils paient en gratitude. Moi, en vrai argent.'],
          [
            { type: 'get_vehicle', objective: 'Trouve un véhicule', checkpoint: true },
            { type: 'passengers', objective: 'Dépose les trois voyageurs bloqués', timeLimit: limit(['gare', 'hotel', 'parc', 'tour', 'mairie', 'gare'], 240),
              onStart: [{ do: 'world', set: 'traffic', value: 1.5, seconds: 600 }],
              fares: [
                { name: 'Madame Correspondance', from: { poi: 'gare' }, to: { poi: 'hotel' }, profile: 'tourist', line: 'Mon train a deux jours de retard. J’ai fini mon livre. Deux fois.' },
                { name: 'Monsieur Pointeuse', from: { poi: 'parc' }, to: { poi: 'tour' }, profile: 'employee', line: 'Vite ! Ma réunion a commencé. Elle porte sur les retards.' },
                { name: 'Le contrôleur', from: { poi: 'mairie' }, to: { poi: 'gare' }, profile: 'employee', line: 'Vous avez votre titre de transport ? Pardon. Déformation professionnelle.' },
              ] },
          ],
          { title: 'Service minimum', text: 'Le trafic reprendra « progressivement ». Le dictionnaire de la ville précise : progressivement, adverbe, synonyme de « un jour ».' },
          'Tu as transporté plus de monde que la ligne 3 ce mois-ci. Bravo.'),
        changes: [
          ch('trafic', { type: 'traffic', label: 'Transports perturbés : la circulation est plus dense.', factor: 1.4 }),
          ch('pietons', { type: 'pedestrians', label: 'Les trottoirs débordent de voyageurs à pied.', factor: 1.4 }),
          ch('chatter', { type: 'chatter', label: 'Les habitants attendent un bus qui ne vient pas.', lines: ['Le bus est un concept.', 'J’attends depuis mardi.', 'À pied, au moins, j’arrive.', 'Quelqu’un va vers le centre ?', 'J’ai une carte d’abonnement et des regrets.'] }),
        ],
      };
    case 'energy': {
      const pts = route(['x_ouest', 'x_centre', 'x_est', 'x_indus']);
      return {
        mission: base('Extinction des feux', 'La ville économise l’électricité. Quelqu’un doit faire le tour des transformateurs avant que tout s’éteigne.', JO,
          ['Tu as remarqué ? La moitié de la ville est dans le noir. Sobriété, qu’ils disent.', '> Et l’autre moitié ?', 'Elle héberge un centre de données. Fais le tour des quatre transformateurs en voiture et remets le courant. Avant que mes néons ne lâchent.'],
          [
            { type: 'get_vehicle', objective: 'Trouve un véhicule', checkpoint: true },
            { type: 'checkpoints', objective: 'Réenclenche les transformateurs', mode: 'vehicle', radius: 4, timeLimit: limit(pts, 120), targets: pts.map((poi) => ({ poi })),
              events: [{ at: 40, do: [{ do: 'say', who: JO, text: 'Mon enseigne clignote. Soit c’est le courant, soit c’est du morse.' }] }] },
            { type: 'goto', objective: 'Reviens au kiosque', target: { poi: 'kiosk' }, radius: 4 },
          ],
          { title: 'Sobriété heureuse', text: 'Le courant est revenu partout. Il a été aussitôt affecté à un panneau lumineux géant rappelant d’économiser l’électricité.' },
          'On y voit clair. Surtout sur la facture.', { reward: { money: 850, xp: 170 } }),
        changes: [
          ch('noir-old', { type: 'lighting', label: 'Économies d’énergie : Old Town est plongé dans la pénombre.', district: 'oldtown', factor: 0.4 }),
          ch('noir-hills', { type: 'lighting', label: 'Éclairage réduit sur les collines.', district: 'hills', factor: 0.5 }),
          ch('chatter', { type: 'chatter', label: 'Les habitants cherchent l’interrupteur.', lines: ['On n’y voit rien.', 'J’ai salué un lampadaire.', 'Qui a éteint ?', 'C’est romantique, dans le noir. Ou dangereux.', 'Ma bougie est à 3 %.'] }),
        ],
      };
    }
    case 'app': {
      const pts = rng.shuffle(['x_nord', 'x_est', 'x_sud', 'x_ouest', 'x_indus']).slice(0, 3);
      return {
        mission: base('L’appli a toujours raison', 'L’application Wazou a reçu une mise à jour. Elle donne désormais des itinéraires très sûrs d’eux et très faux.', JO,
          ['La nouvelle version de Wazou est sortie. Elle m’a fait livrer mes journaux en passant par la plage.', '> Elle est cassée ?', 'Elle est « augmentée ». Suis ses indications jusqu’au bout, qu’on voie où elle veut en venir.'],
          [
            { type: 'get_vehicle', objective: 'Trouve un véhicule', checkpoint: true },
            { type: 'checkpoints', objective: 'Suis les indications de Wazou', mode: 'vehicle', radius: 4, timeLimit: limit([...pts, 'wazou'], 150), targets: [...pts.map((poi) => ({ poi })), { poi: 'wazou' }],
              events: [
                { at: 5, do: [{ do: 'say', who: 'Wazou', text: 'Dans 200 mètres, tournez à gauche. Non. L’autre gauche.' }] },
                { at: 45, do: [{ do: 'say', who: 'Wazou', text: 'Vous êtes arrivé. Je plaisante. Faites demi-tour dès que possible.' }] },
                { at: 90, do: [{ do: 'say', who: 'Wazou', text: 'Itinéraire recalculé. Il est plus long, mais il passe devant nos partenaires.' }] },
              ] },
          ],
          { title: 'Vous êtes arrivé', text: 'L’itinéraire menait au siège de Wazou, service des réclamations. Il est fermé. L’appli propose de s’y rendre.' },
          'Je garde mon plan papier. Il ne me juge pas, lui.', { reward: { money: 850, xp: 170 } }),
        changes: [
          ch('chatter', { type: 'chatter', label: 'Une mise à jour d’appli sème la confusion.', lines: ['Mon appli me dit de tourner à gauche.', 'Il y a un mur, à gauche.', 'J’ai accepté les conditions sans lire. Comme tout le monde.', 'Elle veut mon avis toutes les deux minutes.', 'Version 12.4 : « corrections mineures ». J’ai perdu ma rue.'] }),
          ch('billboard', { type: 'billboard', label: 'Wazou s’affiche sur les toits.', text: 'WAZOU 2.0' }),
        ],
      };
    }
    case 'space': {
      const spots = route(rng.shuffle(['plage', 'parc', 'quai_nord', 'belvedere', 'jetee', 'marche']).slice(0, 4));
      return {
        mission: base('Tombé du ciel', 'Des débris venus de l’espace auraient atterri à Klaxo. Le musée les veut. Les curieux aussi.', JO,
          ['Paraît qu’un bout de satellite est tombé sur la ville cette nuit. En quatre morceaux.', '> C’est dangereux ?', 'C’est surtout exposable. Le Musée du Klaxon paie pour chaque morceau. Ramasse-les avant les collectionneurs.'],
          [
            { type: 'collect', objective: 'Ramasse les débris tombés du ciel', targets: spots.map((poi) => ({ poi })), item: { id: 'debris', name: 'Débris spatial' }, radius: 2, timeLimit: limit(spots, 240), checkpoint: true },
            { type: 'deliver', objective: 'Apporte les débris au musée', target: { poi: 'musee' }, radius: 5, item: { id: 'debris', name: 'Les débris' } },
          ],
          { title: 'Expertise', text: 'Après analyse, le musée confirme l’origine des débris : une antenne de télévision, modèle 1987. Elle est quand même exposée, avec un cartel très sérieux.' },
          'L’espace, c’est loin. Les toits, c’est plus près.', { reward: { money: 900, xp: 190 } }),
        changes: [ch('chatter', { type: 'chatter', label: 'La ville lève les yeux au ciel.', lines: ['Tu l’as vu tomber, toi ?', 'Je regarde en l’air depuis ce matin.', 'Si ça se trouve, c’est une étoile.', 'J’ai fait un vœu. On verra.', 'C’est passé au-dessus de chez moi. Enfin, je crois.'] })],
      };
    }
    case 'culture':
      return {
        mission: base('La coupe est pleine', 'La ville fête un grand événement. Il manque juste le trophée, resté à la gare.', JO,
          ['Toute la ville est décorée et la cérémonie commence. Devine ce qu’ils ont oublié à la gare.', '> Le trophée.', 'Le trophée. Il est fragile, la foule est dense, et le maire a déjà commencé son discours. Tu as le temps : il parle longtemps.'],
          [
            { type: 'pickup', objective: 'Récupère le trophée à la gare', target: { poi: 'gare' }, item: { id: 'trophee', name: 'Trophée de la ville' } },
            { type: 'deliver', objective: 'Apporte le trophée à la mairie sans le cabosser', target: { poi: 'mairie' }, radius: 5, timeLimit: limit(['mairie'], 90, 'gare'), fragile: { max: 4 }, item: { id: 'trophee', name: 'Le trophée' }, checkpoint: true,
              onStart: [{ do: 'world', set: 'pedestrians', value: 1.6, seconds: 600 }],
              events: [{ at: 30, do: [{ do: 'say', who: JO, text: 'Le maire en est à « mes chers concitoyens ». Il te reste du temps.' }] }] },
          ],
          { title: 'Cérémonie', text: 'Le trophée est arrivé à temps. Le maire l’a brandi, remercié « celles et ceux sans qui », puis l’a fait tomber. Applaudissements nourris.' },
          'Belle fête. On remet ça à la prochaine occasion. Ou sans occasion.'),
        changes: [
          ch('decor-dt', { type: 'decor', label: 'Downtown est pavoisé pour la fête.', district: 'downtown', kind: 'garlands' }),
          ch('decor-old', { type: 'decor', label: 'Des fanions flottent sur Old Town.', district: 'oldtown', kind: 'banners' }),
          ch('pietons', { type: 'pedestrians', label: 'Il y a foule dans les rues.', factor: 1.3 }),
        ],
      };
    case 'business': {
      const spots = route(rng.shuffle(['tour', 'wazou', 'hotel', 'banque', 'dealer']).slice(0, 4));
      return {
        mission: base('Levée de fonds', 'Une jeune pousse de Klaxo lève des fonds. Littéralement : il faut aller chercher les mallettes.', JO,
          ['Tu connais « Truc », la start-up ? Elle vaut un milliard. Personne ne sait ce qu’elle fait.', '> Et moi là-dedans ?', 'Les investisseurs ont laissé leurs mallettes dans le quartier d’affaires. Ramasse-les et porte-les à la banque avant la clôture.'],
          [
            { type: 'collect', objective: 'Ramasse les mallettes des investisseurs', targets: spots.map((poi) => ({ poi, dy: 1 })), item: { id: 'mallette', name: 'Mallette d’investisseur' }, radius: 2, timeLimit: limit(spots, 180), checkpoint: true },
            { type: 'deliver', objective: 'Dépose les mallettes à la Banque Pognon', target: { poi: 'banque' }, radius: 5, item: { id: 'mallette', name: 'Les mallettes' } },
          ],
          { title: 'Valorisation', text: 'Les mallettes contenaient des diapositives. Quarante pages, dont trente-huit de courbes qui montent. « Truc » vaut désormais deux milliards.' },
          'Si un jour ils fabriquent quelque chose, préviens-moi.'),
        changes: [
          ch('billboard', { type: 'billboard', label: 'Les panneaux vantent la nouvelle pépite locale.', text: 'INVESTISSEZ' }),
          ch('chatter', { type: 'chatter', label: 'Le quartier d’affaires ne parle que de ça.', lines: ['On pivote.', 'C’est disruptif. Je ne sais pas ce que ça veut dire.', 'J’ai une idée d’appli pour avoir des idées.', 'On brûle du cash, mais avec passion.', 'Tu connais quelqu’un qui investit ?'] }),
        ],
      };
    }
    default:
      return { mission: reserveMission(id, news, s, e), changes: [] };
  }
}

/** Mission de réserve intemporelle, utilisée quand aucune actualité exploitable n'est disponible. */
export function reserveMission(id: string, news: NewsRef | undefined, publishedAt: string, expiresAt: string): MissionDef {
  return {
    schema: 1, id, kind: 'weekly', title: 'Tournée des journaux', summary: 'Semaine calme : Jo a quand même des journaux à livrer, et un vélo crevé.',
    giver: { name: 'Jo la Dépêche', profile: 'shopkeeper', at: { poi: 'kiosk', dx: 2 } },
    intro: [{ who: 'giver', text: 'Semaine calme. Enfin, calme… J’ai cinq paquets de journaux à déposer et mon vélo a rendu l’âme.' }, { who: 'player', text: 'Je m’en occupe.' }, { who: 'giver', text: 'Les nouvelles n’attendent pas. Elles sont déjà vieilles.' }],
    steps: [
      { type: 'get_vehicle', objective: 'Trouve un véhicule', checkpoint: true },
      { type: 'checkpoints', objective: 'Dépose les journaux', mode: 'vehicle', radius: 4, timeLimit: 420, targets: [{ poi: 'gare' }, { poi: 'mairie' }, { poi: 'x_est' }, { poi: 'x_indus' }, { poi: 'x_sud' }] },
      { type: 'goto', objective: 'Reviens au kiosque', target: { poi: 'kiosk' }, radius: 4 },
    ],
    punchline: { title: 'Édition spéciale', text: 'À la une du journal que tu viens de livrer : « Rien de neuf à Klaxo ». En page 2 : un démenti.' },
    outro: [{ who: 'giver', text: 'Merci. La semaine prochaine, promis, il se passera quelque chose.' }],
    reward: { money: 700, xp: 150 }, ...(news ? { news } : {}), publishedAt, expiresAt,
  };
}
