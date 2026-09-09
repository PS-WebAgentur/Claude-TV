#!/usr/bin/env node
/**
 * Kopiert die Schriften aus node_modules nach vendor/, damit die fertige App
 * sie mitbringt und offline laeuft. Keine Anfragen an fremde Server, weder im
 * Betrieb noch beim Start.
 *
 *   npm run fonts
 */

import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, 'vendor', 'fonts');

const FONTS = [
    {
        // Die grossen Zahlen. Dieselbe Serif-Stimme, die Anthropic neben das
        // Pixel-Maskottchen setzt.
        from: 'node_modules/@fontsource-variable/fraunces/files/fraunces-latin-full-normal.woff2',
        file: 'fraunces.woff2',
        family: 'Fraunces',
        weights: '100 900',
    },
    {
        from: 'node_modules/@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2',
        file: 'instrument-sans.woff2',
        family: 'Instrument Sans',
        weights: '400 700',
    },
];

await mkdir(OUT, { recursive: true });

const blocks = [];
for (const font of FONTS) {
    await copyFile(join(ROOT, font.from), join(OUT, font.file));
    blocks.push(`@font-face {
    font-family: "${font.family}";
    font-style: normal;
    font-weight: ${font.weights};
    font-display: block;
    src: url("fonts/${font.file}") format("woff2-variations");
}`);
    console.log('kopiert: ' + font.file);
}

await writeFile(
    join(ROOT, 'vendor', 'fonts.css'),
    '/* Erzeugt von tools/vendor-fonts.mjs. Nicht von Hand aendern. */\n\n'
    + blocks.join('\n\n') + '\n',
    'utf8',
);
console.log('geschrieben: vendor/fonts.css');
