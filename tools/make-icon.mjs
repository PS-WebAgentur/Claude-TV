#!/usr/bin/env node
/**
 * Erzeugt build/icon.png, das App-Symbol.
 *
 * Zeichnet die Figur direkt in ein PNG, ohne Fremdabhaengigkeit: die Formen
 * sind Abstandsfunktionen im gleichen Koordinatensystem wie das SVG im
 * Renderer, geglaettet durch dreifache Ueberabtastung. Das PNG wird von Hand
 * gepackt, zlib bringt Node schon mit.
 *
 *   npm run icon
 */

import { deflateSync } from 'node:zlib';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'build', 'icon.png');

const SIZE = 512;      // Kantenlaenge in Pixeln
const SS = 3;          // Ueberabtastung je Achse
const VIEW = 220;      // Koordinatensystem wie im SVG

const BODY = [0xd9, 0x77, 0x57];
const GLOSS = [0xe8, 0x9c, 0x82];
const EYE = [0x33, 0x23, 0x1c];

/* ---------- Geometrie ---------- */

function insideEllipse(x, y, cx, cy, rx, ry) {
    const dx = (x - cx) / rx;
    const dy = (y - cy) / ry;
    return dx * dx + dy * dy <= 1;
}

/** Abstand eines Punkts zu einem Liniensegment. */
function distToSegment(x, y, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSq = dx * dx + dy * dy;
    let t = lengthSq === 0 ? 0 : ((x - x1) * dx + (y - y1) * dy) / lengthSq;
    t = Math.max(0, Math.min(1, t));
    const px = x1 + t * dx;
    const py = y1 + t * dy;
    return Math.hypot(x - px, y - py);
}

const TUFT = [
    [110, 14, 110, 30],
    [93, 19, 100, 33],
    [127, 19, 120, 33],
    [80, 29, 89, 39],
    [140, 29, 131, 39],
];

/**
 * Farbe an einer Stelle im Koordinatensystem, oder null fuer durchsichtig.
 * Reihenfolge von hinten nach vorn.
 */
function sample(x, y) {
    // Bueschel
    for (const [x1, y1, x2, y2] of TUFT) {
        if (distToSegment(x, y, x1, y1, x2, y2) <= 2.6) {
            return BODY;
        }
    }

    // Koerper. Die Aermchen aus dem Renderer fehlen hier bewusst: bei 32
    // Pixeln in der Taskleiste werden daraus nur Beulen.
    if (!insideEllipse(x, y, 110, 105, 80, 72)) {
        return null;
    }

    // Augen
    if (insideEllipse(x, y, 88, 104, 8.5, 11) || insideEllipse(x, y, 132, 104, 8.5, 11)) {
        return EYE;
    }

    // Mund: Bogenstueck eines Kreises, nur im unteren Bereich
    const mouth = Math.hypot(x - 110, y - 112);
    if (y > 124 && Math.abs(x - 110) < 17 && mouth > 17.4 && mouth < 20.8) {
        return EYE;
    }

    // Glanz
    if (insideEllipse(x, y, 84, 70, 21, 13)) {
        return GLOSS;
    }

    return BODY;
}

/* ---------- Bild aufbauen ---------- */

const pixels = Buffer.alloc(SIZE * SIZE * 4);
const scale = VIEW / SIZE;

for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
        let r = 0;
        let g = 0;
        let b = 0;
        let hits = 0;
        for (let sy = 0; sy < SS; sy++) {
            for (let sx = 0; sx < SS; sx++) {
                const x = (px + (sx + 0.5) / SS) * scale;
                // Acht Einheiten nach oben verschoben abgetastet, damit die
                // Figur mittig im Rahmen sitzt und nicht oben klebt.
                const y = (py + (sy + 0.5) / SS) * scale - 8;
                const color = sample(x, y);
                if (color) {
                    r += color[0];
                    g += color[1];
                    b += color[2];
                    hits++;
                }
            }
        }
        const total = SS * SS;
        const offset = (py * SIZE + px) * 4;
        if (hits === 0) {
            continue; // durchsichtig
        }
        pixels[offset] = Math.round(r / hits);
        pixels[offset + 1] = Math.round(g / hits);
        pixels[offset + 2] = Math.round(b / hits);
        pixels[offset + 3] = Math.round((hits / total) * 255);
    }
}

/* ---------- PNG packen ---------- */

const CRC_TABLE = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c;
    }
    return table;
})();

function crc32(buffer) {
    let crc = -1;
    for (let i = 0; i < buffer.length; i++) {
        crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([length, body, crc]);
}

// Jede Zeile bekommt ein Filter-Byte 0 voran, so verlangt es das Format.
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
    raw[y * (SIZE * 4 + 1)] = 0;
    pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;    // Bittiefe
ihdr[9] = 6;    // Farbtyp RGBA
ihdr[10] = 0;   // Kompression
ihdr[11] = 0;   // Filter
ihdr[12] = 0;   // kein Interlace

const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
]);

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, png);
console.log('geschrieben: build/icon.png (' + SIZE + 'x' + SIZE + ', '
    + (png.length / 1024).toFixed(1) + ' kB)');
