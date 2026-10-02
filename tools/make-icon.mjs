#!/usr/bin/env node
/**
 * Erzeugt die Symbole: build/icon.png fuer die App und die Bilder fuer das
 * Tray.
 *
 * Gezeichnet wird aus denselben Pixelkarten, die auch im Fenster laufen. Die
 * frueherer Fassung malte eine eigene, runde Figur mit Abstandsfunktionen
 * nach; sobald sich der Sprite aenderte, zeigte das Symbol etwas anderes als
 * das Programm. Deshalb wird character.js hier geladen und nach seinen Karten
 * gefragt, statt sie ein zweites Mal zu beschreiben.
 *
 *   npm run icon
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { encodePng, paint, trim } from '../lib/png.mjs';
import { TRAY_FRAMES, TRAY_PALETTE } from '../lib/tray-sprite.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const SIZE = 512;

/** Farben wie im hellen Farbschema der Anzeige. */
const PALETTE = {
    B: [0xd9, 0x77, 0x57],
    D: [0x24, 0x1c, 0x17],
    H: [0xf0, 0xb6, 0x99],
    S: [0xa8, 0x50, 0x3a],
};

/**
 * Laedt die Sprite-Engine aus dem Renderer. Sie ist fuer den Browser
 * geschrieben und braucht nur ein window-Objekt, sonst nichts.
 */
async function loadSprite() {
    const source = await readFile(join(ROOT, 'renderer', 'character.js'), 'utf8');
    const sandbox = { window: {} };
    runInNewContext(source, sandbox);
    return sandbox.window.ClaudeCreature.sprite;
}

const sprite = await loadSprite();

/* ---------- App-Symbol ---------- */

// Ruhige Haltung, offene Augen: so soll die Figur im Startmenue stehen.
const grid = trim(sprite.build({ face: 'open', arms: 'out', legs: 'stand' }));
const scale = Math.floor((SIZE * 0.82) / Math.max(...grid.map((r) => r.length)));
const icon = paint(grid, PALETTE, { size: SIZE, scale });

await mkdir(join(ROOT, 'build'), { recursive: true });
const png = encodePng(icon.width, icon.height, icon.pixels);
await writeFile(join(ROOT, 'build', 'icon.png'), png);
console.log('geschrieben: build/icon.png (' + SIZE + 'x' + SIZE + ', '
    + (png.length / 1024).toFixed(1) + ' kB)');

/* ---------- Tray-Bilder als Vorschau ---------- */

// Das Programm erzeugt die Tray-Bilder zur Laufzeit selbst, damit sie zur
// Warnstufe passen. Hier entsteht nur eine Kontrolldatei zum Ansehen.
const strip = [];
for (const [name, map] of Object.entries(TRAY_FRAMES)) {
    strip.push(name);
}
const preview = paint(TRAY_FRAMES.open, TRAY_PALETTE(PALETTE.B), { size: 128 });
await writeFile(join(ROOT, 'build', 'tray-preview.png'),
    encodePng(preview.width, preview.height, preview.pixels));
console.log('geschrieben: build/tray-preview.png (' + strip.length + ' Bilder vorhanden: '
    + strip.join(', ') + ')');
