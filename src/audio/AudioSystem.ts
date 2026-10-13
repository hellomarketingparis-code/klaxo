import type { World } from '../world/World';
import { D } from '../map/tiles';

/**
 * Tout le son est synthétisé en direct (Web Audio) : aucun fichier à télécharger.
 * Effets, moteur, sirène, ambiance urbaine et musique générative par quartier.
 */
type Note = [freq: number, at: number, dur: number, vol?: number];

const CHORDS: Record<number, number[][]> = {
  // Degrés en demi-tons depuis la tonique (basse, puis accord).
  [D.DOWNTOWN]: [[0, 3, 7, 10], [-4, 0, 3, 7], [-7, -4, 0, 3], [-2, 2, 5, 8]],
  [D.BUSINESS]: [[0, 4, 7, 11], [-3, 0, 4, 7], [-5, -1, 2, 5], [-7, -3, 0, 4]],
  [D.OLDTOWN]: [[0, 3, 7, 10], [5, 8, 12, 15], [-2, 2, 5, 9], [3, 7, 10, 14]],
  [D.INDUSTRIAL]: [[0, 3, 7, 10], [0, 3, 6, 10], [-2, 1, 5, 8], [-4, 0, 3, 6]],
  [D.HILLS]: [[0, 4, 7, 9], [5, 9, 12, 14], [-3, 0, 4, 7], [2, 5, 9, 12]],
};
const ROOT: Record<number, number> = { [D.DOWNTOWN]: 110, [D.BUSINESS]: 98, [D.OLDTOWN]: 103.83, [D.INDUSTRIAL]: 82.41, [D.HILLS]: 116.54 };

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private noise!: AudioBuffer;
  private engine: { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private siren: { osc: OscillatorNode; gain: GainNode } | null = null;
  private hum: { gain: GainNode } | null = null;
  private nextBar = 0;
  private bar = 0;
  private stepT = 0;
  private lastSfx = new Map<string, number>();
  sound = true;
  music = true;
  volume = 0.7;
  unlocked = false;

  constructor(private w: World) {
    w.bus.on('sfx', (e) => this.play(e.name, e.x, e.y, e.vol));
  }

  /** À appeler sur un geste de l'utilisateur : les navigateurs bloquent le son avant. */
  unlock(): void {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    const AC = (window.AudioContext ?? (window as any).webkitAudioContext) as typeof AudioContext | undefined;
    if (!AC) return;
    try {
      const ctx = new AC();
      this.ctx = ctx;
      this.master = ctx.createGain(); this.master.connect(ctx.destination);
      const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 5; comp.connect(this.master);
      this.sfxBus = ctx.createGain(); this.sfxBus.connect(comp);
      this.musicBus = ctx.createGain(); this.musicBus.gain.value = 0.5; this.musicBus.connect(comp);
      const len = ctx.sampleRate;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.unlocked = true;
      this.applySettings();
      this.startLoops();
    } catch { this.ctx = null; }
  }
  applySettings(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.sound || this.music ? this.volume : 0, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.sound ? 1 : 0, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.music ? 0.5 : 0, t, 0.2);
  }
  suspend(on: boolean): void { if (!this.ctx) return; if (on) void this.ctx.suspend(); else void this.ctx.resume(); }

  // ---------- Briques de synthèse ----------
  private tone(freq: number, at: number, dur: number, type: OscillatorType, vol: number, dest: AudioNode, slideTo?: number, pan = 0): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, at);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), at + dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g);
    if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(dest); } else g.connect(dest);
    o.start(at); o.stop(at + dur + 0.03);
  }
  private burst(at: number, dur: number, vol: number, freq: number, q: number, dest: AudioNode, type: BiquadFilterType = 'lowpass'): void {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource(); s.buffer = this.noise; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.0002, vol), at); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    s.connect(f); f.connect(g); g.connect(dest);
    s.start(at, Math.random() * 0.5); s.stop(at + dur + 0.03);
  }
  private seq(notes: Note[], type: OscillatorType, vol: number): void {
    const t = this.ctx!.currentTime;
    for (const [f, at, dur, v] of notes) this.tone(f, t + at, dur, type, vol * (v ?? 1), this.sfxBus);
  }

  play(name: string, x?: number, y?: number, vol = 1): void {
    if (!this.ctx || !this.sound || this.ctx.state !== 'running') return;
    const ctx = this.ctx, t = ctx.currentTime;
    // Atténuation et panoramique selon la position dans la rue.
    let pan = 0;
    if (x !== undefined && y !== undefined) {
      const dx = x - this.w.focusX, dy = y - this.w.focusY;
      const d = Math.hypot(dx, dy);
      if (d > 420) return;
      vol *= Math.max(0, 1 - d / 420) ** 1.4;
      pan = Math.max(-0.8, Math.min(0.8, dx / 260));
    }
    // Anti-saturation : un même son ne se répète pas plus de ~12 fois par seconde.
    const last = this.lastSfx.get(name) ?? 0;
    if (t - last < 0.08) return;
    this.lastSfx.set(name, t);
    const out = this.sfxBus;
    switch (name) {
      case 'horn': this.tone(392, t, 0.26, 'square', 0.11 * vol, out, undefined, pan); this.tone(494, t, 0.26, 'square', 0.09 * vol, out, undefined, pan); break;
      case 'horn_low': this.tone(196, t, 0.34, 'sawtooth', 0.14 * vol, out, undefined, pan); this.tone(247, t, 0.34, 'sawtooth', 0.11 * vol, out, undefined, pan); break;
      case 'crash': this.burst(t, 0.28, 0.5 * vol, 900, 0.6, out); this.tone(120, t, 0.2, 'sine', 0.4 * vol, out, 45, pan); break;
      case 'thud': this.tone(150, t, 0.16, 'sine', 0.4 * vol, out, 55, pan); this.burst(t, 0.07, 0.2 * vol, 500, 0.5, out); break;
      case 'door': this.burst(t, 0.05, 0.25 * vol, 1400, 1, out, 'bandpass'); this.tone(90, t + 0.02, 0.08, 'sine', 0.25 * vol, out, 60); break;
      case 'coin': this.seq([[988, 0, 0.08], [1319, 0.07, 0.22]], 'square', 0.07); break;
      case 'pickup': this.seq([[660, 0, 0.06], [880, 0.05, 0.06], [1175, 0.1, 0.14]], 'triangle', 0.16); break;
      case 'step': this.seq([[784, 0, 0.08], [1047, 0.08, 0.16]], 'triangle', 0.14); break;
      case 'checkpoint': this.seq([[1319, 0, 0.07], [1760, 0.06, 0.2]], 'sine', 0.2); break;
      case 'start': this.seq([[440, 0, 0.1], [554, 0.1, 0.1], [659, 0.2, 0.1], [880, 0.3, 0.3]], 'square', 0.07); break;
      case 'success': this.seq([[523, 0, 0.12], [659, 0.12, 0.12], [784, 0.24, 0.12], [1047, 0.36, 0.2], [988, 0.56, 0.1], [1047, 0.66, 0.5]], 'square', 0.08); this.seq([[262, 0, 0.5], [330, 0.36, 0.8]], 'triangle', 0.14); break;
      case 'fail': this.seq([[440, 0, 0.2], [392, 0.2, 0.2], [349, 0.4, 0.2], [262, 0.6, 0.6]], 'sawtooth', 0.07); break;
      case 'levelup': this.seq([[523, 0, 0.09], [659, 0.08, 0.09], [784, 0.16, 0.09], [1047, 0.24, 0.09], [1319, 0.32, 0.4]], 'triangle', 0.16); break;
      case 'secret': this.seq([[1047, 0, 0.1], [1319, 0.08, 0.1], [1568, 0.16, 0.1], [2093, 0.24, 0.4]], 'sine', 0.16); break;
      case 'deny': this.seq([[150, 0, 0.12], [120, 0.12, 0.2]], 'sawtooth', 0.1); break;
      case 'wanted': this.tone(700, t, 0.18, 'square', 0.08, out, 1100); this.tone(1100, t + 0.18, 0.2, 'square', 0.08, out, 700); break;
      case 'alarm': for (let i = 0; i < 4; i++) this.tone(980, t + i * 0.16, 0.1, 'square', 0.1, out); break;
      case 'tick': this.burst(t, 0.02, 0.4, 3000, 2, out, 'bandpass'); this.burst(t + 0.25, 0.02, 0.3, 2200, 2, out, 'bandpass'); break;
      case 'cuckoo': this.seq([[784, 0, 0.16], [622, 0.2, 0.3], [784, 0.7, 0.16], [622, 0.9, 0.3]], 'sine', 0.3); break;
      case 'phone': this.seq([[1245, 0, 0.06], [1568, 0.07, 0.06], [1245, 0.14, 0.06], [1568, 0.21, 0.06]], 'sine', 0.1); break;
      case 'whistle': this.tone(1500, t, 0.14, 'sine', 0.12 * vol, out, 2300); break;
      case 'repair': for (let i = 0; i < 5; i++) this.burst(t + i * 0.07, 0.03, 0.25, 2600, 3, out, 'bandpass'); this.seq([[660, 0.4, 0.1], [880, 0.5, 0.2]], 'triangle', 0.14); break;
      case 'neon': this.tone(120, t, 0.5, 'sawtooth', 0.05, out); this.tone(1800, t, 0.4, 'square', 0.015, out); break;
      case 'robot': this.seq([[880, 0, 0.05], [440, 0.06, 0.05], [1320, 0.12, 0.08]], 'square', 0.06); break;
      case 'ui': this.tone(880, t, 0.04, 'triangle', 0.1, out); break;
      case 'foot': this.burst(t, 0.03, 0.05 * vol, 700, 1, out, 'bandpass'); break;
      default: break;
    }
  }

  // ---------- Boucles continues ----------
  private startLoops(): void {
    const ctx = this.ctx!;
    const mk = (type: OscillatorType) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = 50; o.start(); return o; };
    const eg = ctx.createGain(); eg.gain.value = 0;
    const ef = ctx.createBiquadFilter(); ef.type = 'lowpass'; ef.frequency.value = 400; ef.Q.value = 2;
    const o1 = mk('sawtooth'), o2 = mk('square');
    const g2 = ctx.createGain(); g2.gain.value = 0.4;
    o1.connect(ef); o2.connect(g2); g2.connect(ef); ef.connect(eg); eg.connect(this.sfxBus);
    this.engine = { osc: o1, osc2: o2, gain: eg, filter: ef };
    const so = mk('square'); const sg = ctx.createGain(); sg.gain.value = 0;
    const sf = ctx.createBiquadFilter(); sf.type = 'lowpass'; sf.frequency.value = 1800;
    so.connect(sf); sf.connect(sg); sg.connect(this.sfxBus);
    this.siren = { osc: so, gain: sg };
    const hs = ctx.createBufferSource(); hs.buffer = this.noise; hs.loop = true;
    const hf = ctx.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 220;
    const hg = ctx.createGain(); hg.gain.value = 0.05;
    hs.connect(hf); hf.connect(hg); hg.connect(this.sfxBus); hs.start();
    this.hum = { gain: hg };
    this.nextBar = ctx.currentTime + 0.3;
  }

  /** Une mesure de musique générative : basse, arpège, nappe, batterie légère. */
  private scheduleBar(at: number): void {
    const w = this.w;
    const d = w.map.districtAtPx(w.focusX, w.focusY);
    const prog = CHORDS[d], root = ROOT[d];
    const chord = prog[this.bar % prog.length];
    const beat = 60 / (w.wanted.level >= 2 ? 118 : 96);
    const f = (semi: number, oct = 0) => root * Math.pow(2, semi / 12 + oct);
    const m = this.musicBus;
    const tense = w.wanted.level >= 2;
    // Nappe.
    for (const s of chord.slice(1)) { this.tone(f(s, 1), at, beat * 4, 'sawtooth', 0.016, m); this.tone(f(s, 1) * 1.006, at, beat * 4, 'sawtooth', 0.012, m); }
    // Basse en croches.
    for (let i = 0; i < 8; i++) this.tone(f(chord[0], i % 4 === 3 ? 1 : 0), at + i * beat * 0.5, beat * 0.42, 'triangle', i % 2 ? 0.1 : 0.15, m);
    // Arpège : motif différent une mesure sur deux.
    const pat = this.bar % 2 ? [1, 2, 3, 2, 1, 3, 2, 1] : [1, 3, 2, 3, 1, 2, 3, 2];
    if (this.bar % 8 >= 2 || tense) for (let i = 0; i < 8; i++) this.tone(f(chord[pat[i]], 2), at + i * beat * 0.5 + beat * 0.25, beat * 0.3, 'square', 0.02, m);
    // Batterie.
    for (let b = 0; b < 4; b++) {
      this.tone(110, at + b * beat, 0.14, 'sine', tense || b % 2 === 0 ? 0.28 : 0.0002, m, 42);
      if (b % 2 === 1) this.burst(at + b * beat, 0.11, 0.1, 1800, 0.8, m, 'bandpass');
      this.burst(at + b * beat + beat * 0.5, 0.03, 0.035, 7000, 1, m, 'highpass');
      if (tense) this.burst(at + b * beat + beat * 0.25, 0.02, 0.025, 8000, 1, m, 'highpass');
    }
    this.bar++;
    this.nextBar = at + beat * 4;
  }

  update(dt: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const w = this.w, t = ctx.currentTime, p = w.player;
    if (this.music && this.nextBar - t < 0.25) this.scheduleBar(Math.max(t + 0.05, this.nextBar));
    if (this.nextBar < t - 1) this.nextBar = t + 0.1;
    // Moteur du véhicule conduit.
    if (this.engine) {
      const v = p.driving ? p.vehicle! : null;
      const on = !!v && !v.dead && !w.attract && !w.paused && !w.busy;
      const sp = v ? Math.abs(v.forwardSpeed) : 0;
      const base = v ? (v.type === 'truck' ? 34 : v.type === 'van' ? 42 : v.type === 'sport' ? 62 : 50) : 50;
      this.engine.osc.frequency.setTargetAtTime(base + sp * 0.75, t, 0.06);
      this.engine.osc2.frequency.setTargetAtTime((base + sp * 0.75) * 0.5, t, 0.06);
      this.engine.filter.frequency.setTargetAtTime(320 + sp * 5 + (v && v.throttle > 0 ? 300 : 0), t, 0.08);
      this.engine.gain.gain.setTargetAtTime(on && this.sound ? 0.05 + Math.min(0.07, sp / 2600) + (v!.throttle > 0 ? 0.03 : 0) : 0, t, 0.08);
    }
    // Sirène : la voiture de police la plus proche.
    if (this.siren) {
      let best = Infinity;
      if (!w.paused && !w.busy) for (const v of w.vehicles) if (v.siren) { const d = Math.hypot(v.x - w.focusX, v.y - w.focusY); if (d < best) best = d; }
      const g = best < 500 && this.sound ? 0.085 * Math.max(0, 1 - best / 500) : 0;
      this.siren.gain.gain.setTargetAtTime(g, t, 0.1);
      this.siren.osc.frequency.setTargetAtTime(Math.floor(t * 2.6) % 2 ? 660 : 520, t, 0.02);
    }
    if (this.hum) this.hum.gain.gain.setTargetAtTime(w.paused ? 0.01 : 0.05, t, 0.3);
    // Bruits de pas.
    if (!w.attract && p.onFoot && p.moving && !w.paused && !w.busy) {
      this.stepT -= dt;
      if (this.stepT <= 0) { this.stepT = p.running ? 0.2 : 0.32; this.play('foot'); }
    }
  }
}
