/**
 * Derives every brand raster the app serves from one source file.
 *
 * The source (`assets/brand/logo-source.png`) is the delivered logo: a leaf
 * with a bolt cut through it, over a white "BUZZIN" wordmark, on transparency.
 * The wordmark is dropped here — the header renders "BuzzIn" as live text, so
 * baking it into the image would both duplicate it and freeze it at one size
 * in a font the UI does not use. Alpha analysis puts the two bands at:
 *
 *     mark      x 261  y 127  151 x 203
 *     lettering x 221  y 339  208 x  39
 *
 * with rows 330-338 empty between them, so the crop below is exact rather
 * than eyeballed.
 *
 * Run it directly — there is no npm script and no new dependency:
 *
 *     node scripts/generate-brand-assets.mjs
 *
 * `sharp` is resolved out of node_modules, where Next already installs it. It
 * is a build-time tool only; nothing at runtime imports this file, and the
 * generated files are committed, so a future Next release dropping sharp
 * costs nothing until the logo actually changes.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(root, 'assets/brand/logo-source.png');

/** The mark, without the wordmark underneath it. */
const MARK = { left: 261, top: 127, width: 151, height: 203 };

/** Near-black, matching `viewport.themeColor` in app/layout.tsx. */
const TILE = { r: 4, g: 3, b: 5, alpha: 1 };

const mark = () => sharp(SOURCE).extract(MARK);

/**
 * The mark centred in a square canvas, scaled so it occupies `fill` of the
 * canvas height. It is a tall shape, so height is what controls how large it
 * reads; letting width drive it would leave the leaf looking shrunken. 0.9 is
 * as large as it goes: at 1.0 the leaf tip clips the corner of the canvas.
 *
 * `sharpen` is for the tab-icon sizes. Lanczos on a 16px canvas leaves the
 * bolt as a purple smudge inside the leaf; a light unsharp pass gives back the
 * edge between the two, which is the whole of what the mark says at that size.
 */
async function square(size, { fill, background = { r: 0, g: 0, b: 0, alpha: 0 }, sharpen = false }) {
  const height = Math.round(size * fill);
  const width = Math.round((MARK.width / MARK.height) * height);
  let resized = mark().resize(width, height, { kernel: 'lanczos3', fit: 'fill' });
  if (sharpen) resized = resized.sharpen({ sigma: 0.6, m1: 0, m2: 2.5 });
  const scaled = await resized.png().toBuffer();

  return sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: scaled, gravity: 'centre' }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * A multi-size .ico. sharp cannot write the format, but the container is
 * trivial: a 6-byte ICONDIR, one 16-byte ICONDIRENTRY per image, then the
 * payloads. The payloads are PNGs rather than BMPs — every browser in scope
 * has understood PNG-in-ICO since IE11, and it keeps the alpha channel clean.
 */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // 0 encodes 256
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2); // palette size, 0 for truecolour
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });

  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

async function emit(path, data) {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, data);
  const { width, height } = await sharp(data)
    .metadata()
    .catch(() => ({ width: '?', height: '?' }));
  console.log(`  ${path.padEnd(32)} ${String(width).padStart(4)}x${String(height).padEnd(4)} ${(data.length / 1024).toFixed(1)} KB`);
}

async function main() {
  console.log('BuzzIn brand assets\n');

  // The header mark, trimmed to the artwork so the component controls its own
  // spacing. Rendered at 24-30px; 288 tall leaves room for a 3x display and
  // for the image optimiser to pick a size rather than upscale.
  const header = await mark()
    .resize(null, 288, { kernel: 'lanczos3' })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await emit('public/brand/buzzin-mark.png', header);

  // Tab icon: transparent, so it reads on a light and a dark tab strip alike,
  // and near the edges of the canvas because it is often drawn at 16px.
  const sizes = [16, 32, 48];
  const small = await Promise.all(
    sizes.map(async (size) => ({ size, data: await square(size, { fill: 0.9, sharpen: true }) })),
  );
  await emit('app/favicon.ico', ico(small));

  // Android, PWA installs, and any browser that prefers a high-resolution PNG.
  await emit('app/icon.png', await square(512, { fill: 0.9 }));

  // iOS composites transparency onto black and applies its own corner mask, so
  // this one gets the site's own near-black tile and the padding a home-screen
  // icon expects.
  await emit('app/apple-icon.png', await square(180, { fill: 0.64, background: TILE }));

  console.log('\nDone.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
