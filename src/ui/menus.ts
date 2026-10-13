import { GAME_VERSION } from '../engine/config';
import { drawCarIcon, drawPortrait, drawTopDown } from '../assets/textures';
import { ACC_NAMES, BOTTOMS, DEFAULT_LOOK, HAIRS, HAIR_NAMES, SKINS, TOPS } from '../npc/looks';
import type { Look } from '../npc/looks';
import { ACHIEVEMENTS } from '../economy/Economy';
import { SHOP_TYPES, VEHICLES } from '../vehicles/specs';
import { DISTRICT_NAMES } from '../map/tiles';
import type { MissionDef } from '../missions/schema';
import type { App } from '../app';
import type { Hud } from './hud';

/** Hébergement sur claude.ai : les téléchargements passent par la fonction « downloads » de l'hébergeur. Ailleurs : null. */
function hostDownloads(): { use: (name: string) => Promise<any> } | null {
  const c = (window as any).claude;
  return c && typeof c.use === 'function' ? c : null;
}
import { h, clear, css, fmtDate, fmtDuration } from './dom';

type Tab = 'map' | 'missions' | 'stats' | 'options' | 'save' | 'help';

/** Menus et fenêtres : accueil, création de personnage, pause, boutiques, kiosque. */
export class Menus {
  private overlay: HTMLElement;
  private closeCb: (() => void) | null = null;
  kind: string | null = null;
  /** Appelé à chaque ouverture ou fermeture (l'interface met le monde en pause). */
  onChange: () => void = () => {};

  constructor(private app: App, private hud: Hud, overlay: HTMLElement) { this.overlay = overlay; }

  get open(): boolean { return this.kind !== null; }
  private mount(kind: string, node: HTMLElement, onClose?: () => void): void {
    clear(this.overlay);
    this.overlay.className = 'open' + (kind === 'menu' ? ' menu' : '');
    this.overlay.append(node);
    this.kind = kind; this.closeCb = onClose ?? null;
    this.app.input.flush();
    const f = node.querySelector<HTMLElement>('[data-autofocus]');
    if (f) setTimeout(() => f.focus({ preventScroll: true }), 0);
    this.onChange();
  }
  close(): void {
    if (!this.kind) return;
    const cb = this.closeCb;
    clear(this.overlay); this.overlay.className = ''; this.kind = null; this.closeCb = null;
    this.app.input.flush();
    this.onChange();
    cb?.();
  }
  private click(): void { this.app.audio.unlock(); this.app.audio.play('ui'); }
  private window(title: string, body: HTMLElement, opts: { narrow?: boolean; tabs?: HTMLElement; onClose?: () => void; closable?: boolean } = {}): HTMLElement {
    const head = h('header', null, h('h2', { text: title }), opts.closable === false ? null : h('button', { class: 'x', 'aria-label': 'Fermer', text: '✕', onclick: () => { this.click(); (opts.onClose ?? (() => this.close()))(); } }));
    const panel = h('div', { class: 'panel' + (opts.narrow ? ' narrow' : ''), role: 'dialog', 'aria-label': title }, head);
    if (opts.tabs) { panel.style.gridTemplateRows = 'auto auto 1fr'; panel.append(opts.tabs); }
    panel.append(body);
    return h('div', { class: 'win' }, panel);
  }

  /** Demande de confirmation intégrée à la page. */
  confirm(title: string, text: string, yes: string, onYes: () => void, back: () => void): void {
    const body = h('div', { class: 'body' }, h('p', { text, style: { margin: '0' } }),
      h('div', { class: 'row' }, h('button', { class: 'btn danger', text: yes, onclick: () => { this.click(); onYes(); } }), h('button', { class: 'btn', text: 'Annuler', 'data-autofocus': '1', onclick: () => { this.click(); back(); } })));
    this.mount('confirm', this.window(title, body, { narrow: true, onClose: back }));
  }

  // ---------- Accueil ----------
  showMain(): void {
    const app = this.app;
    const logo = h('canvas', { id: 'logo', role: 'img', 'aria-label': 'KLAXO' });
    // Lettrage du logo : cinq lettres dessinées à la main sur une grille 5×7.
    const glyphs: Record<string, string[]> = {
      K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
      L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
      A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
      X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
      O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
    };
    const S = 8;
    logo.width = 5 * 6 * S - S + 8; logo.height = 7 * S + 8;
    const lc = logo.getContext('2d')!;
    const word = (ox: number, oy: number, color: string) => {
      lc.fillStyle = color;
      [...'KLAXO'].forEach((ch, i) => glyphs[ch].forEach((row, r) => [...row].forEach((b, c) => { if (b === '1') lc.fillRect(ox + (i * 6 + c) * S, oy + r * S, S, S); })));
    };
    word(6, 6, '#4a1230'); word(2, 2, '#ff2e88');
    lc.fillStyle = '#ffc2dd';
    [...'KLAXO'].forEach((ch, i) => glyphs[ch].forEach((row, r) => [...row].forEach((b, c) => { if (b === '1' && (r === 0 || glyphs[ch][r - 1][c] === '0')) lc.fillRect(2 + (i * 6 + c) * S, 2 + r * S, S, 2); })));
    const buttons = h('div', { class: 'menu-buttons' });
    if (app.saveInfo) {
      buttons.append(h('button', { class: 'btn primary', text: 'Continuer', 'data-autofocus': '1', onclick: () => { this.click(); app.continueGame(); } }));
      buttons.append(h('button', { class: 'btn', text: 'Nouvelle partie', onclick: () => { this.click(); this.confirm('Nouvelle partie', 'Une partie est déjà sauvegardée sur cet appareil. La nouvelle partie la remplacera.', 'Remplacer', () => this.showCreator(), () => this.showMain()); } }));
    } else buttons.append(h('button', { class: 'btn primary', text: 'Jouer', 'data-autofocus': '1', onclick: () => { this.click(); this.showCreator(); } }));
    buttons.append(h('button', { class: 'btn', text: 'Options', onclick: () => { this.click(); this.showPause('options', () => this.showMain()); } }));
    buttons.append(h('button', { class: 'btn', text: 'Commandes', onclick: () => { this.click(); this.showPause('help', () => this.showMain()); } }));
    const side = h('div', { class: 'menu-side' });
    const wk = app.weekly.mission;
    if (wk) {
      side.append(h('div', { class: 'weekly-card' },
        h('span', { class: 'tag news', text: 'Mission de la semaine' }),
        h('h3', { text: wk.title }),
        h('p', { text: wk.summary }),
        wk.news ? h('p', null, 'Inspirée d’un fait réel : ', h('a', { href: wk.news.url, target: '_blank', rel: 'noopener noreferrer', text: wk.news.headline }), ` (${wk.news.source}, ${fmtDate(wk.news.date)})`) : null,
        h('p', { class: 'muted', text: 'Rends-toi au kiosque de Jo, à Downtown, pour la jouer.' })));
    }
    const s = app.saveInfo;
    const foot = h('div', { class: 'menu-foot', text: `v${GAME_VERSION} · jeu solo · ${app.save.persistent ? 'sauvegarde locale' : 'sauvegarde indisponible sur ce navigateur'}${app.weekly.online ? '' : ' · hors ligne'}` });
    const main = h('div', { class: 'menu-main' }, logo,
      h('p', { class: 'tagline', text: 'La ville qui klaxonne l’actualité' }),
      s ? h('p', { class: 'muted', style: { margin: '0' }, text: `${s.player.name || 'Sans nom'} · niveau ${s.level} · ${s.money.toLocaleString('fr-FR')} ¤ · ${fmtDuration(s.playTime ?? 0)} de jeu` }) : h('p', { class: 'muted', style: { margin: '0', maxWidth: '34ch' }, text: 'Conduis, explore, rends service. Chaque semaine, une nouvelle mission inspirée de l’actualité.' }),
      buttons, foot);
    this.mount('menu', h('div', { class: 'menu' }, main, side));
  }

  // ---------- Personnage ----------
  private lookEditor(look: Look, onChange: () => void): HTMLElement {
    const sw = (label: string, values: number[], get: () => number, set: (v: number) => void) => {
      const box = h('div', { class: 'swatches' });
      const render = () => { clear(box); for (const v of values) box.append(h('button', { style: { background: css(v) }, 'aria-pressed': String(get() === v), 'aria-label': `${label} ${css(v)}`, onclick: () => { set(v); render(); onChange(); } })); };
      render();
      return h('div', { class: 'field' }, h('span', { class: 'label', text: label }), box);
    };
    const chips = (label: string, names: string[], get: () => number, set: (v: number) => void) => {
      const box = h('div', { class: 'chips' });
      const render = () => { clear(box); names.forEach((n, i) => box.append(h('button', { text: n, 'aria-pressed': String(get() === i), onclick: () => { set(i); render(); onChange(); } }))); };
      render();
      return h('div', { class: 'field' }, h('span', { class: 'label', text: label }), box);
    };
    return h('div', { class: 'list' },
      sw('Teint', SKINS, () => look.skin, (v) => (look.skin = v)),
      chips('Coiffure', HAIR_NAMES, () => look.hairStyle, (v) => (look.hairStyle = v)),
      sw('Cheveux', HAIRS, () => look.hair, (v) => (look.hair = v)),
      sw('Haut', TOPS, () => look.top, (v) => (look.top = v)),
      sw('Bas', BOTTOMS, () => look.bottom, (v) => (look.bottom = v)),
      chips('Accessoire', ACC_NAMES, () => look.acc, (v) => (look.acc = v)),
      sw('Couleur de l’accessoire', TOPS.slice(0, 8), () => look.accColor, (v) => (look.accColor = v)));
  }
  /** Aperçu : portrait de face + silhouette animée telle qu'elle apparaît dans la rue. */
  private preview(look: Look): { el: HTMLElement; draw: () => void; stop: () => void } {
    const face = h('canvas', { role: 'img', 'aria-label': 'Portrait du personnage' });
    const walk = h('canvas', { class: 'walk', role: 'img', 'aria-label': 'Le personnage vu du dessus, comme en jeu' });
    let f = 0;
    const draw = () => { drawPortrait(face, look, 7); drawTopDown(walk, look, 4, f); };
    const id = window.setInterval(() => { f = (f % 4) + 1; drawTopDown(walk, look, 4, f); }, 170);
    draw();
    return { el: h('div', { class: 'looks' }, face, h('div', { class: 'walkbox' }, walk, h('span', { class: 'label', text: 'En jeu' }))), draw, stop: () => window.clearInterval(id) };
  }

  showCreator(): void {
    const look: Look = { ...DEFAULT_LOOK, ...(this.app.saveInfo?.player.look ?? {}) };
    const pv = this.preview(look);
    const name = h('input', { type: 'text', id: 'player-name', maxLength: 14, placeholder: 'Facultatif', value: '', autocomplete: 'off' });
    const random = () => {
      const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
      Object.assign(look, { skin: pick(SKINS), hair: pick(HAIRS), hairStyle: Math.floor(Math.random() * 5), top: pick(TOPS), bottom: pick(BOTTOMS), acc: Math.floor(Math.random() * ACC_NAMES.length), accColor: pick(TOPS) });
      rebuild();
    };
    const editorBox = h('div');
    const rebuild = () => { clear(editorBox); editorBox.append(this.lookEditor(look, pv.draw)); pv.draw(); };
    rebuild();
    const start = () => { pv.stop(); this.click(); this.app.newGame({ ...look }, name.value.trim().slice(0, 14)); };
    const body = h('div', { class: 'body' },
      h('div', { class: 'creator' },
        h('div', { class: 'preview' }, pv.el, h('button', { class: 'btn small', text: 'Au hasard', onclick: () => { this.click(); random(); } })),
        h('div', { class: 'list' }, h('label', { class: 'field' }, h('span', { class: 'label', text: 'Pseudonyme' }), name), editorBox)),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', text: 'C’est parti', 'data-autofocus': '1', onclick: start }), h('span', { class: 'muted', text: 'Aucune inscription. Ta partie est enregistrée sur cet appareil.' })));
    this.mount('creator', this.window('Ton personnage', body, { onClose: () => { pv.stop(); this.showMain(); } }));
  }

  // ---------- Pause ----------
  showPause(tab: Tab = 'missions', back?: () => void): void {
    const app = this.app;
    const inGame = app.playing;
    const tabs: [Tab, string][] = inGame ? [['missions', 'Missions'], ['map', 'Carte'], ['stats', 'Statistiques'], ['options', 'Options'], ['save', 'Sauvegarde'], ['help', 'Commandes']] : [['options', 'Options'], ['help', 'Commandes'], ['save', 'Sauvegarde']];
    const body = h('div', { class: 'body' });
    const bar = h('div', { class: 'tabs', role: 'tablist' });
    const render = (t: Tab) => {
      clear(bar);
      for (const [id, label] of tabs) bar.append(h('button', { role: 'tab', 'aria-selected': String(id === t), text: label, onclick: () => { this.click(); render(id); } }));
      clear(body);
      if (t === 'map') this.tabMap(body);
      else if (t === 'missions') this.tabMissions(body);
      else if (t === 'stats') this.tabStats(body);
      else if (t === 'options') this.tabOptions(body);
      else if (t === 'save') this.tabSave(body, () => render('save'));
      else this.tabHelp(body);
      if (inGame) body.append(h('div', { class: 'row' },
        h('button', { class: 'btn primary', text: 'Reprendre', onclick: () => { this.click(); this.close(); } }),
        h('button', { class: 'btn', text: 'Menu principal', onclick: () => { this.click(); app.toMenu(); } })));
    };
    render(tab);
    const onClose = back ?? (() => this.close());
    this.mount('pause', this.window(inGame ? 'Pause' : 'Réglages', body, { tabs: bar, onClose }), undefined);
  }
  private tabMap(body: HTMLElement): void {
    const c = h('canvas', { id: 'bigmap', role: 'img', 'aria-label': 'Carte de Klaxo' });
    this.hud.drawBigMap(c);
    const lg = (color: string, text: string) => h('span', null, h('i', { style: { background: color } }), text);
    body.append(c, h('div', { class: 'legend' }, lg('#ffffff', 'Toi'), lg('#ff2e88', 'Mission'), lg('#22e0ff', 'Kiosque et actualité'), lg('#ffb627', 'Garage'), lg('#9dff4a', 'Concessionnaire'), lg('#8a5cff', 'Vêtements'), lg('#3b6bff', 'Commissariat'), lg('#ffd84a', 'Secret trouvé')));
  }
  private missionCard(def: MissionDef, status: HTMLElement | null, extra?: HTMLElement | null): HTMLElement {
    return h('div', { class: 'item' },
      h('div', { class: 'row' }, h('span', { class: 'tag ' + (def.kind === 'weekly' ? 'news' : 'live'), text: def.kind === 'weekly' ? 'Actualité' : def.kind === 'side' ? 'Événement' : 'Histoire' }), status),
      h('h3', { text: def.title }), h('div', { class: 'muted', text: def.summary }),
      h('div', { class: 'meta', text: `Récompense : ${def.reward.money} ¤ · ${def.reward.xp} XP` }), extra ?? null);
  }
  private tabMissions(body: HTMLElement): void {
    const w = this.app.world, ms = w.missions;
    const list = h('div', { class: 'list' });
    const r = ms.active;
    if (r) {
      list.append(this.missionCard(r.def, h('span', { class: 'tag live', text: `En cours · étape ${r.progress}` }),
        h('div', { class: 'row' }, h('span', { text: r.objective }), h('button', { class: 'btn small danger', text: 'Abandonner', onclick: () => { this.click(); ms.abort(); this.close(); } }))));
    }
    if (!r && ms.lastFailed) list.append(h('div', { class: 'item' }, h('h3', { text: `Échec : ${ms.lastFailed.def.title}` }), h('button', { class: 'btn small', text: 'Réessayer depuis le dernier point de passage', onclick: () => { this.click(); ms.retry(); this.close(); } })));
    for (const def of ms.available()) {
      if (r?.def.id === def.id) continue;
      const poi = 'poi' in def.giver.at ? w.map.pois.get((def.giver.at as any).poi) : null;
      list.append(this.missionCard(def, h('span', { class: 'tag', text: 'Disponible' }), h('div', { class: 'muted', text: `Va voir ${def.giver.name}${poi ? ` — ${poi.name}, ${DISTRICT_NAMES[poi.district]}` : ''}.` })));
    }
    const next = ms.story.find((d) => !ms.isDone(d.id) && !ms.unlocked(d));
    if (next) list.append(h('div', { class: 'item' }, h('h3', { text: '???' }), h('div', { class: 'muted', text: 'Termine la mission précédente pour débloquer la suite.' })));
    if (!list.children.length) list.append(h('p', { class: 'muted', text: 'Aucune mission pour l’instant. Balade-toi : des habitants ont parfois besoin d’un coup de main.' }));
    body.append(list);
    if (ms.history.length) {
      const hist = h('div', { class: 'list' });
      for (const e of ms.history.slice(0, 10)) hist.append(h('div', { class: 'row' }, h('span', { class: 'tag ' + (e.result === 'success' ? 'ok' : 'ko'), text: e.result === 'success' ? 'Réussie' : 'Échouée' }), h('span', { text: e.title }), h('span', { class: 'muted', text: `${fmtDate(e.at)}${e.reward ? ` · +${e.reward} ¤` : ''}` })));
      body.append(h('span', { class: 'label', text: 'Historique' }), hist);
    }
  }
  private tabStats(body: HTMLElement): void {
    const w = this.app.world, e = w.economy;
    const st = (v: string | number, label: string) => h('div', { class: 'stat' }, h('b', { text: String(v) }), h('span', { text: label }));
    body.append(h('div', { class: 'stats' },
      st(e.level, 'Niveau'), st(`${e.money.toLocaleString('fr-FR')} ¤`, 'Argent'), st(fmtDuration(w.playTime), 'Temps de jeu'),
      st(e.get('missionsDone'), 'Missions réussies'), st(`${w.secretsFound.size}/${w.map.secrets.length}`, 'Lieux secrets'),
      st(`${(e.get('distance') / 6200).toFixed(1)} km`, 'Distance au volant'), st(e.get('honks'), 'Coups de klaxon'),
      st(e.get('crashes'), 'Accrochages'), st(e.get('busted'), 'Arrestations'), st(e.get('maxWanted'), 'Étoiles maximum'), st(e.owned.length, 'Véhicules possédés'), st(e.get('eventsDone'), 'Événements de rue')));
    const ach = h('div', { class: 'ach' });
    for (const a of ACHIEVEMENTS) ach.append(h('div', { class: e.achievements.has(a.id) ? 'on' : '' }, h('b', { text: e.achievements.has(a.id) ? a.name : '???' }), a.desc));
    body.append(h('span', { class: 'label', text: `Succès (${e.achievements.size}/${ACHIEVEMENTS.length})` }), ach);
  }
  private tabOptions(body: HTMLElement): void {
    const app = this.app, s = app.settings;
    const apply = () => { app.applySettings(); void app.save.saveSettings(s); };
    const toggle = (label: string, get: () => boolean, set: (v: boolean) => void) => {
      const b = h('button', { class: 'btn small', onclick: () => { set(!get()); b.textContent = get() ? 'Activé' : 'Désactivé'; b.setAttribute('aria-pressed', String(get())); apply(); this.click(); } });
      b.textContent = get() ? 'Activé' : 'Désactivé'; b.setAttribute('aria-pressed', String(get()));
      return h('div', { class: 'field' }, h('span', { class: 'label', text: label }), b);
    };
    const select = (label: string, id: string, opts: [string, string][], get: () => string, set: (v: string) => void) => {
      const sel = h('select', { id, onchange: () => { set(sel.value); apply(); } });
      for (const [v, t] of opts) sel.append(h('option', { value: v, text: t, selected: get() === v }));
      return h('label', { class: 'field' }, h('span', { class: 'label', text: label }), sel);
    };
    const vol = h('input', { type: 'range', id: 'opt-volume', min: '0', max: '1', step: '0.05', value: String(s.volume), oninput: () => { s.volume = Number(vol.value); apply(); } });
    body.append(h('div', { class: 'grid2' },
      toggle('Effets sonores', () => s.sound, (v) => (s.sound = v)),
      toggle('Musique', () => s.music, (v) => (s.music = v)),
      h('label', { class: 'field' }, h('span', { class: 'label', text: 'Volume' }), vol),
      select('Qualité graphique', 'opt-quality', [['auto', 'Automatique'], ['low', 'Légère (téléphones modestes)'], ['medium', 'Moyenne'], ['high', 'Complète']], () => s.quality, (v) => (s.quality = v as any)),
      select('Commandes tactiles', 'opt-touch', [['auto', 'Automatique'], ['on', 'Toujours affichées'], ['off', 'Masquées']], () => s.touch, (v) => (s.touch = v as any))));
    const rej = app.world.missions.rejected;
    if (rej.length) {
      const box = h('div', { class: 'list' });
      for (const r of rej) box.append(h('div', { class: 'item' }, h('h3', { text: `Mission ignorée : ${r.id}` }), h('div', { class: 'muted', text: r.errors.slice(0, 4).join(' · ') })));
      body.append(h('span', { class: 'label', text: 'Journal de validation' }), box);
    }
  }
  private tabSave(body: HTMLElement, rerender: () => void): void {
    const app = this.app;
    const last = app.save.lastSavedAt ? new Date(app.save.lastSavedAt).toLocaleTimeString('fr-FR') : 'pas encore';
    body.append(h('div', { class: 'item' },
      h('h3', { text: app.save.persistent ? 'Sauvegarde automatique sur cet appareil' : 'Sauvegarde indisponible' }),
      h('div', { class: 'muted', text: app.save.persistent ? `Dernier enregistrement : ${last}. La partie est stockée dans ce navigateur (${app.save.store.kind === 'indexeddb' ? 'IndexedDB' : 'stockage local'}). Si tu effaces les données du site ou changes d’appareil, elle disparaît : exporte-la pour la garder.` : 'Ce navigateur bloque le stockage local : la partie sera perdue à la fermeture. Exporte-la pour la conserver.' }),
      app.save.lastError ? h('div', { class: 'tag ko', text: `Erreur : ${app.save.lastError}` }) : null));
    if (app.playing) {
      const area = h('textarea', { id: 'export-text', readOnly: true, hidden: true });
      const status = h('span', { class: 'muted' });
      const text = () => app.save.exportText(app.world.serialize());
      body.append(h('div', { class: 'field' }, h('span', { class: 'label', text: 'Exporter' }),
        h('div', { class: 'row' },
          app.canDownload || hostDownloads() ? h('button', { class: 'btn small', text: 'Télécharger le fichier', onclick: async () => {
            this.click();
            const filename = `klaxo-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;
            const host = hostDownloads();
            if (host) {
              // Page publiée sur claude.ai : le visiteur confirme l'enregistrement dans une fenêtre de l'hébergeur.
              status.textContent = 'Confirme l’enregistrement dans la fenêtre qui s’ouvre…';
              const d = await host.use('downloads').catch(() => null);
              if (!d) { status.textContent = 'Téléchargement indisponible ici : utilise « Copier » ou « Afficher le texte ».'; return; }
              try { await d.save({ filename, data: text() }); status.textContent = 'Fichier enregistré.'; }
              catch (e: any) { status.textContent = e?.code === 'declined' ? 'Enregistrement annulé.' : 'Téléchargement indisponible ici : utilise « Copier » ou « Afficher le texte ».'; }
              return;
            }
            const blob = new Blob([text()], { type: 'application/json' });
            const a = h('a', { href: URL.createObjectURL(blob), download: filename });
            document.body.append(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 2000);
            status.textContent = 'Fichier généré. S’il n’apparaît pas, utilise « Afficher le texte ».';
          } }) : null,
          h('button', { class: 'btn small', text: 'Afficher le texte', onclick: () => { this.click(); area.hidden = false; area.value = text(); area.focus(); area.select(); } }),
          h('button', { class: 'btn small', text: 'Copier', onclick: async () => {
            this.click(); area.hidden = false; area.value = text();
            try { await navigator.clipboard.writeText(area.value); status.textContent = 'Copié dans le presse-papiers.'; } catch { area.focus(); area.select(); status.textContent = 'Copie refusée : sélectionne le texte et copie-le à la main.'; }
          } }), status),
        area));
    }
    const imp = h('textarea', { id: 'import-text', placeholder: 'Colle ici le texte d’une sauvegarde exportée…' });
    const file = h('input', { type: 'file', id: 'import-file', accept: '.json,application/json', onchange: async () => { const f = file.files?.[0]; if (f) imp.value = await f.text(); } });
    const msg = h('span', { class: 'muted' });
    body.append(h('div', { class: 'field' }, h('span', { class: 'label', text: 'Importer' }), file, imp,
      h('div', { class: 'row' }, h('button', { class: 'btn small', text: 'Charger cette sauvegarde', onclick: async () => {
        this.click();
        try { const data = app.save.parseImport(imp.value); await app.importSave(data); } catch (e) { msg.textContent = (e as Error).message; msg.className = 'tag ko'; }
      } }), msg)));
    if (app.saveInfo || app.playing) body.append(h('div', { class: 'field' }, h('span', { class: 'label', text: 'Effacer' }),
      h('div', { class: 'row' }, h('button', { class: 'btn small danger', text: 'Effacer la partie de cet appareil', onclick: () => { this.click(); this.confirm('Effacer la partie', 'La progression enregistrée sur cet appareil sera supprimée définitivement.', 'Effacer', async () => { await app.resetSave(); app.toMenu(); }, () => this.showPause('save')); } }))));
    void rerender;
  }
  private tabHelp(body: HTMLElement): void {
    const k = (keys: string, text: string) => [h('kbd', { text: keys }), h('span', { text })];
    body.append(h('span', { class: 'label', text: 'Clavier' }), h('div', { class: 'keys' },
      ...k('ZQSD / WASD / flèches', 'Se déplacer · accélérer, freiner, tourner'), ...k('Maj', 'Courir · frein à main'), ...k('E', 'Interagir · monter et descendre d’un véhicule'),
      ...k('Espace', 'Klaxonner · interpeller'), ...k('M', 'Carte'), ...k('Échap', 'Pause'), ...k('R', 'Réessayer une mission échouée')),
      h('span', { class: 'label', text: 'Téléphone et tablette' }), h('div', { class: 'keys' },
        ...k('Joystick', 'Pousse dans une direction. À fond pour courir. En voiture, elle roule vers la direction choisie.'), ...k('Bouton rose', 'Interagir : monter, sortir, parler, entrer'), ...k('Frein', 'Freiner puis reculer'), ...k('Klaxon', 'Klaxonner')),
      h('span', { class: 'label', text: 'Manette' }), h('div', { class: 'keys' }, ...k('Stick gauche', 'Se déplacer · diriger'), ...k('RT / LT', 'Accélérer · freiner'), ...k('A', 'Interagir'), ...k('X', 'Klaxonner'), ...k('B', 'Courir · frein à main'), ...k('Start', 'Pause')),
      h('p', { class: 'muted', text: 'Astuce : la police te perd de vue derrière les bâtiments. Un garage peut repeindre ta voiture, si aucun agent ne regarde.' }));
  }

  // ---------- Boutiques ----------
  showShop(poiId: string): void {
    const w = this.app.world;
    const poi = w.map.poi(poiId);
    if (poi.type === 'dealer') this.shopDealer(poi.name);
    else if (poi.type === 'garage') this.shopGarage(poi.name);
    else if (poi.type === 'clothes') this.shopClothes(poi.name);
    else if (poi.type === 'kiosk') this.shopKiosk(poi.name);
  }
  private statBars(type: keyof typeof VEHICLES): HTMLElement {
    const s = VEHICLES[type];
    const bar = (v: number) => h('div', { class: 'bar' }, h('i', { style: { width: `${Math.round(Math.min(1, v) * 100)}%`, background: 'var(--cyan)' } }));
    return h('div', { class: 'mini-bars' }, 'Vitesse', bar(s.maxSpeed / 260), 'Reprise', bar(s.accel / 215), 'Solidité', bar(s.hp / 220));
  }
  private shopDealer(title: string): void {
    const w = this.app.world, e = w.economy;
    const body = h('div', { class: 'body' });
    const render = () => {
      clear(body);
      body.append(h('div', { class: 'row' }, h('span', { class: 'pill', text: `${e.money.toLocaleString('fr-FR')} ¤` }), h('span', { class: 'muted', text: w.mods.priceFactor !== 1 ? `Prix de la semaine : ×${w.mods.priceFactor.toFixed(2)}` : 'Tout véhicule acheté est livrable gratuitement dans les garages.' })));
      const list = h('div', { class: 'list' });
      for (const type of SHOP_TYPES) {
        const spec = VEHICLES[type];
        let color = spec.colors[0];
        const icon = h('canvas');
        const draw = () => drawCarIcon(icon, type, color, 3);
        draw();
        const sw = h('div', { class: 'swatches' });
        const renderSw = () => { clear(sw); for (const c of spec.colors) sw.append(h('button', { style: { background: css(c) }, 'aria-pressed': String(c === color), 'aria-label': `Couleur ${css(c)}`, onclick: () => { color = c; draw(); renderSw(); } })); };
        renderSw();
        const cost = e.price(spec.price);
        const owned = e.owned.filter((o) => o.type === type).length;
        list.append(h('div', { class: 'item car-row' }, icon,
          h('div', { class: 'list', style: { gap: '6px' } }, h('h3', { text: spec.name }), this.statBars(type), sw),
          h('div', { class: 'buy list', style: { gap: '4px', justifyItems: 'end' } },
            h('button', { class: 'btn small primary', text: `Acheter · ${cost.toLocaleString('fr-FR')} ¤`, disabled: !e.canPay(cost), onclick: () => {
              if (e.buyVehicle(type, color)) { w.deliverOwned({ type, color }); w.bus.emit('toast', { text: `${spec.name} livrée devant le magasin.`, kind: 'good' }); void this.app.saveNow('achat'); render(); }
            } }),
            owned ? h('span', { class: 'muted', text: `Possédée ×${owned}` }) : null)));
      }
      body.append(list);
    };
    render();
    this.mount('shop', this.window(title, body));
  }
  private shopGarage(title: string): void {
    const w = this.app.world, e = w.economy, v = w.player.vehicle;
    const body = h('div', { class: 'body' });
    const render = () => {
      clear(body);
      body.append(h('div', { class: 'row' }, h('span', { class: 'pill', text: `${e.money.toLocaleString('fr-FR')} ¤` })));
      if (v) {
        const cost = w.repairCost();
        const sw = h('div', { class: 'swatches' });
        for (const c of [...new Set([...v.spec.colors, 0xff2e88, 0x22e0ff, 0x9dff4a, 0x2e2e3a, 0xf5f5ff])]) sw.append(h('button', { style: { background: css(c) }, 'aria-label': `Repeindre en ${css(c)}`, onclick: () => { if (w.respray(c)) { void this.app.saveNow('garage'); render(); } } }));
        body.append(h('div', { class: 'item' }, h('h3', { text: v.spec.name }),
          h('div', { class: 'bar' }, h('i', { style: { width: `${(v.hp / v.spec.hp) * 100}%` } })),
          h('div', { class: 'row' }, h('button', { class: 'btn small primary', text: cost > 0 ? `Réparer · ${cost} ¤` : 'En parfait état', disabled: cost <= 0, onclick: () => { if (w.repair()) render(); } })),
          h('span', { class: 'label', text: `Repeindre · ${e.price(150)} ¤${w.wanted.level > 0 ? ' — efface les étoiles si la police ne regarde pas' : ''}` }), sw));
      } else body.append(h('p', { class: 'muted', text: 'Viens en voiture pour la faire réparer ou repeindre.' }));
      const mine = h('div', { class: 'list' });
      e.owned.forEach((o) => {
        const icon = h('canvas'); drawCarIcon(icon, o.type, o.color, 2);
        mine.append(h('div', { class: 'row' }, icon, h('span', { text: VEHICLES[o.type].name }), h('button', { class: 'btn small', text: 'Faire livrer ici', onclick: () => { w.deliverOwned(o); w.bus.emit('toast', { text: `${VEHICLES[o.type].name} livrée devant le garage.`, kind: 'good' }); this.close(); } })));
      });
      body.append(h('span', { class: 'label', text: 'Mes véhicules' }), e.owned.length ? mine : h('p', { class: 'muted', text: 'Tu ne possèdes aucun véhicule. Le concessionnaire Klaxocars est dans le Business District.' }));
    };
    render();
    this.mount('shop', this.window(title, body));
  }
  private shopClothes(title: string): void {
    const w = this.app.world, e = w.economy;
    const look: Look = { ...w.player.look };
    const pv = this.preview(look);
    const cost = e.price(120);
    const body = h('div', { class: 'body' },
      h('div', { class: 'creator' }, h('div', { class: 'preview' }, pv.el, h('span', { class: 'pill', text: `${e.money.toLocaleString('fr-FR')} ¤` })), this.lookEditor(look, pv.draw)),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', text: `Valider la tenue · ${cost} ¤`, onclick: () => { if (e.pay(cost, 'tenue')) { w.player.look = { ...look }; pv.stop(); void this.app.saveNow('tenue'); this.close(); } } })));
    this.mount('shop', this.window(title, body, { onClose: () => { pv.stop(); this.close(); } }));
  }
  private shopKiosk(title: string): void {
    const app = this.app, w = app.world, ms = w.missions;
    const body = h('div', { class: 'body' });
    const wk = ms.weekly;
    if (wk) {
      const done = ms.isDone(wk.id);
      body.append(h('div', { class: 'item', style: { borderTop: '3px solid var(--amber)' } },
        h('div', { class: 'row' }, h('span', { class: 'tag news', text: 'À la une cette semaine' }), done ? h('span', { class: 'tag ok', text: 'Terminée' }) : null),
        h('h3', { text: wk.title }), h('div', { class: 'muted', text: wk.summary }),
        wk.news ? h('div', null, 'Fait réel : ', h('a', { href: wk.news.url, target: '_blank', rel: 'noopener noreferrer', text: wk.news.headline }), h('span', { class: 'muted', text: ` — ${wk.news.source}, ${fmtDate(wk.news.date)}` })) : null,
        h('div', { class: 'muted', text: 'Les personnages et organisations de la mission sont fictifs.' }),
        h('div', { class: 'row' }, h('button', { class: 'btn small primary', text: done ? 'Rejouer' : 'Accepter la mission', disabled: !!ms.active, onclick: () => { this.click(); this.close(); ms.accept(wk); } }),
          h('span', { class: 'meta', text: `${wk.reward.money} ¤ · ${wk.reward.xp} XP` }))));
    } else body.append(h('p', { class: 'muted', text: 'Pas de mission d’actualité chargée. Elle arrivera à la prochaine connexion.' }));
    if (w.mods.active.length) {
      const ch = h('div', { class: 'list' });
      for (const c of w.mods.active) ch.append(h('div', { class: 'row' }, h('span', { class: 'tag live', text: 'En ville' }), h('span', { text: c.label })));
      body.append(h('span', { class: 'label', text: 'Cette semaine à Klaxo' }), ch);
    }
    const items = app.weekly.archive.items.filter((it) => it.id !== wk?.id);
    if (items.length) {
      const list = h('div', { class: 'list' });
      const msg = h('span', { class: 'muted' });
      for (const it of items.slice(0, 12)) list.append(h('div', { class: 'row' }, h('span', { class: 'tag', text: it.week }), h('span', { text: it.title }), ms.isDone(it.id) ? h('span', { class: 'tag ok', text: 'Terminée' }) : null,
        h('button', { class: 'btn small', text: 'Jouer', disabled: !!ms.active, onclick: async () => {
          this.click();
          const def = await app.fetchArchive(it.file);
          if (!def) { msg.textContent = 'Ce numéro n’est pas disponible hors ligne.'; return; }
          this.close(); ms.accept(def);
        } })));
      body.append(h('span', { class: 'label', text: 'Anciens numéros' }), list, msg);
    }
    this.mount('shop', this.window(title, body));
  }

  showStorageNotice(onOk: () => void): void {
    const body = h('div', { class: 'body' },
      h('p', { style: { margin: '0' }, text: 'Ta progression est enregistrée automatiquement dans ce navigateur. Elle ne quitte pas cet appareil.' }),
      h('p', { class: 'muted', style: { margin: '0' }, text: 'Si tu effaces les données de navigation, la partie est perdue. Tu peux l’exporter à tout moment depuis Pause → Sauvegarde.' }),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', text: 'Compris', 'data-autofocus': '1', onclick: () => { this.click(); this.close(); onOk(); } })));
    this.mount('notice', this.window('Sauvegarde locale', body, { narrow: true, onClose: () => { this.close(); onOk(); } }));
  }
}
