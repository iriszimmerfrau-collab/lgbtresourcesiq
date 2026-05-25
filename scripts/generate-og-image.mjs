/**
 * Render all public/og-*.svg files → matching public/og-*.png at 1200x630.
 *
 * Run via: pnpm og-image
 *
 * Sharp's text rendering depends on the OS having Libre Baskerville and
 * Noto Naskh Arabic available; the SVGs fall back to Times / Georgia /
 * Geeza Pro via the font-family stack if not. The fallbacks look fine
 * at og-image scale.
 *
 * Outputs:
 *   og-image.png         — homepage / default
 *   og-hrt.png           — HRT guides
 *   og-alert-critical.png — high/critical-severity security alerts
 *   og-alert-info.png    — medium/low/info severity alerts + news
 *   og-story.png         — community stories
 *   og-guide.png         — identity/general/safety guides + fallback
 */
import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, '..', 'public');

const sources = [
  'og-image',
  'og-hrt',
  'og-alert-critical',
  'og-alert-info',
  'og-story',
  'og-guide',
];

for (const name of sources) {
  const svgPath = resolve(publicDir, `${name}.svg`);
  const pngPath = resolve(publicDir, `${name}.png`);
  const svg = await readFile(svgPath);
  const png = await sharp(svg, { density: 144 })
    .resize(1200, 630, { fit: 'cover' })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(pngPath, png);
  const kb = (png.length / 1024).toFixed(1);
  console.log(`Wrote public/${name}.png (${kb} KB)`);
}
