/**
 * Render public/og-image.svg → public/og-image.png at 1200x630.
 *
 * Run via: pnpm og-image
 *
 * Sharp's text rendering depends on the OS having Libre Baskerville and
 * Noto Naskh Arabic available; the SVG falls back to Times/Georgia and
 * Geeza Pro via the font-family stack if not. The fallbacks look fine at
 * og-image scale.
 */
import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const svgPath = resolve(here, '..', 'public', 'og-image.svg');
const pngPath = resolve(here, '..', 'public', 'og-image.png');

const svg = await readFile(svgPath);
const png = await sharp(svg, { density: 144 })
  .resize(1200, 630, { fit: 'cover' })
  .png({ compressionLevel: 9 })
  .toBuffer();
await writeFile(pngPath, png);

const kb = (png.length / 1024).toFixed(1);
console.log(`Wrote public/og-image.png (${kb} KB)`);
