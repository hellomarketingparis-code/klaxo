/**
 * Partage : lien du jeu, invitation dans un groupe, carte de victoire en image.
 * Sur téléphone, on ouvre le menu de partage du système (WhatsApp, Instagram, SMS…).
 * Ailleurs, on copie le lien ou on télécharge l'image.
 */
import { drawPortrait } from '../assets/textures';
import type { Look } from '../npc/looks';

/** Adresse publique du jeu (fixée à la compilation ; sinon l'adresse de la page). */
export const SITE_URL: string = (import.meta.env.VITE_SITE_URL as string | undefined) || (typeof location !== 'undefined' ? location.origin + location.pathname : '');
export const SITE_LABEL = SITE_URL.replace(/^https?:\/\//, '').replace(/\/$/, '');

export function inviteUrl(code: string): string {
  const u = new URL(SITE_URL);
  u.searchParams.set('groupe', code);
  return u.toString();
}

export type ShareResult = 'shared' | 'copied' | 'downloaded' | 'cancelled' | 'failed';

/** Partage un lien : menu du système si possible, sinon copie dans le presse-papiers. */
export async function shareLink(text: string, url: string): Promise<ShareResult> {
  const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
  if (typeof nav.share === 'function' && matchMedia('(pointer: coarse)').matches) {
    try { await nav.share({ title: 'KLAXO', text, url }); return 'shared'; } catch (e) { if ((e as Error).name === 'AbortError') return 'cancelled'; }
  }
  try { await navigator.clipboard.writeText(`${text} ${url}`); return 'copied'; } catch { return 'failed'; }
}

/** Partage une image : menu du système (fichier joint), sinon téléchargement, sinon copie du lien. */
export async function shareImage(blob: Blob, filename: string, text: string, url: string, canDownload: boolean): Promise<ShareResult> {
  const file = new File([blob], filename, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (typeof nav.canShare === 'function' && nav.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], text: `${text} ${url}` }); return 'shared'; } catch (e) { if ((e as Error).name === 'AbortError') return 'cancelled'; }
  }
  if (canDownload) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return 'downloaded';
  }
  return shareLink(text, url);
}

// ---------- Logo ----------
const GLYPHS: Record<string, string[]> = {
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
};
/** Dessine le logo KLAXO (lettrage pixel 5×7) ; renvoie sa largeur. */
export function drawLogo(ctx: CanvasRenderingContext2D, ox: number, oy: number, S: number): number {
  const word = (dx: number, dy: number, color: string) => {
    ctx.fillStyle = color;
    [...'KLAXO'].forEach((ch, i) => GLYPHS[ch].forEach((row, r) => [...row].forEach((b, c) => { if (b === '1') ctx.fillRect(ox + dx + (i * 6 + c) * S, oy + dy + r * S, S, S); })));
  };
  word(S / 2 + 2, S / 2 + 2, '#4a1230'); word(0, 0, '#ff2e88');
  ctx.fillStyle = '#ffc2dd';
  [...'KLAXO'].forEach((ch, i) => GLYPHS[ch].forEach((row, r) => [...row].forEach((b, c) => { if (b === '1' && (r === 0 || GLYPHS[ch][r - 1][c] === '0')) ctx.fillRect(ox + (i * 6 + c) * S, oy + r * S, S, Math.max(2, S / 4)); })));
  return 5 * 6 * S - S;
}

// ---------- Carte de victoire ----------
const DISPLAY = 'ui-monospace, "SF Mono", "Cascadia Mono", "Roboto Mono", Menlo, Consolas, "Liberation Mono", monospace';
const BODY = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(/\s+/), lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; if (lines.length === maxLines) break; } else cur = t;
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) lines[maxLines - 1] = lines[maxLines - 1].replace(/[\s,.;:!?]*\S*$/, '') + '…';
  return lines;
}

export interface VictoryInfo { title: string; text: string; kind: string; look: Look; name: string; level: number; money: number; missions: number; tag?: string; }

/** Image 1080×1350 (format portrait des réseaux sociaux) : la ville en fond, la mission, la chute, le joueur, l'adresse du jeu. */
export async function makeVictoryCard(info: VictoryInfo, scene: CanvasImageSource | null): Promise<Blob | null> {
  const W = 1080, H = 1350;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#0b0a16'; ctx.fillRect(0, 0, W, H);
  // La ville, telle qu'elle était à l'écran.
  const topH = 700;
  if (scene) {
    const sw = (scene as HTMLImageElement).naturalWidth || (scene as HTMLCanvasElement).width, sh = (scene as HTMLImageElement).naturalHeight || (scene as HTMLCanvasElement).height;
    if (sw && sh) {
      // Cadrage resserré sur le centre de l'écran (là où se trouve le joueur).
      const k = Math.max(W / sw, topH / sh) * 1.45;
      const dw = sw * k, dh = sh * k;
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, topH); ctx.clip();
      ctx.drawImage(scene, (W - dw) / 2, (topH - dh) / 2 + 40, dw, dh);
      ctx.restore();
    }
  }
  const fade = ctx.createLinearGradient(0, topH - 260, 0, topH + 10);
  fade.addColorStop(0, 'rgba(11,10,22,0)'); fade.addColorStop(1, 'rgba(11,10,22,1)');
  ctx.fillStyle = fade; ctx.fillRect(0, topH - 260, W, 270);
  const shade = ctx.createLinearGradient(0, 0, 0, 260);
  shade.addColorStop(0, 'rgba(11,10,22,0.92)'); shade.addColorStop(0.7, 'rgba(11,10,22,0.6)'); shade.addColorStop(1, 'rgba(11,10,22,0)');
  ctx.fillStyle = shade; ctx.fillRect(0, 0, W, 260);
  drawLogo(ctx, 64, 60, 14);
  ctx.font = `700 26px ${DISPLAY}`; ctx.fillStyle = '#22e0ff'; ctx.textBaseline = 'alphabetic';
  ctx.fillText('LA VILLE QUI KLAXONNE L’ACTUALITÉ', 66, 190);

  let y = topH - 40;
  // Étiquette.
  const tag = info.tag ?? 'MISSION RÉUSSIE';
  ctx.font = `700 30px ${DISPLAY}`;
  const tw = ctx.measureText(tag).width;
  ctx.fillStyle = '#9dff4a'; ctx.fillRect(64, y - 34, tw + 36, 50);
  ctx.fillStyle = '#0b0a16'; ctx.fillText(tag, 82, y);
  y += 90;
  ctx.font = `800 66px ${BODY}`; ctx.fillStyle = '#f2f0ff';
  for (const l of wrap(ctx, info.title, W - 128, 2)) { ctx.fillText(l, 64, y); y += 76; }
  y += 6;
  ctx.font = `400 36px ${BODY}`; ctx.fillStyle = '#c9c4ea';
  for (const l of wrap(ctx, info.text, W - 128, 4)) { ctx.fillText(l, 64, y); y += 50; }
  // Le joueur.
  const by = H - 340;
  const pc = document.createElement('canvas');
  drawPortrait(pc, info.look, 8);
  ctx.fillStyle = '#14122a'; ctx.fillRect(64, by, 176, 176);
  ctx.drawImage(pc, 64 + (176 - pc.width) / 2, by + (176 - pc.height) / 2);
  ctx.strokeStyle = '#ff2e88'; ctx.lineWidth = 4; ctx.strokeRect(64, by, 176, 176);
  ctx.font = `700 40px ${BODY}`; ctx.fillStyle = '#f2f0ff';
  ctx.fillText(info.name || 'Un pilote de Klaxo', 272, by + 62);
  ctx.font = `600 32px ${DISPLAY}`; ctx.fillStyle = '#ffb627';
  ctx.fillText(`NIV ${info.level} · ${info.money.toLocaleString('fr-FR')} ¤ · ${info.missions} mission${info.missions > 1 ? 's' : ''}`, 272, by + 118);
  // Pied : l'adresse, toujours entière.
  ctx.fillStyle = '#ff2e88'; ctx.fillRect(0, H - 132, W, 132);
  ctx.font = `800 34px ${DISPLAY}`; ctx.fillStyle = '#0b0a16';
  ctx.fillText('JOUE GRATUITEMENT, SEUL OU ENTRE AMIS', 64, H - 76);
  let fs = 32;
  do { ctx.font = `700 ${fs}px ${DISPLAY}`; fs -= 2; } while (fs > 16 && ctx.measureText(SITE_LABEL).width > W - 128);
  ctx.fillText(SITE_LABEL, 64, H - 30);
  return new Promise((res) => c.toBlob((b) => res(b), 'image/png'));
}
