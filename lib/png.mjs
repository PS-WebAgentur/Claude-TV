/**
 * Winziger PNG-Packer.
 *
 * Reicht genau fuer das, was hier gebraucht wird: RGBA ohne Interlace, ohne
 * Filter, mit zlib aus Node. Keine Fremdabhaengigkeit fuer ein paar Icons.
 */

import { deflateSync } from 'node:zlib';

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

/**
 * @param {number} width
 * @param {number} height
 * @param {Buffer} pixels RGBA, vier Bytes je Punkt
 * @returns {Buffer} fertige PNG-Datei
 */
export function encodePng(width, height, pixels) {
    // Jede Zeile bekommt ein Filter-Byte 0 voran, so verlangt es das Format.
    const stride = width * 4;
    const raw = Buffer.alloc(height * (stride + 1));
    for (let y = 0; y < height; y++) {
        raw[y * (stride + 1)] = 0;
        pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
    }

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;    // Bittiefe
    ihdr[9] = 6;    // Farbtyp RGBA
    ihdr[10] = 0;   // Kompression
    ihdr[11] = 0;   // Filter
    ihdr[12] = 0;   // kein Interlace

    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

/**
 * Malt eine Pixelkarte in ganzzahliger Vergroesserung auf eine Flaeche.
 *
 * Ganzzahlig, weil alles andere die Kanten weichzeichnet und aus einem
 * Pixelbild Matsch macht.
 *
 * @param {string[]} grid Zeilen aus Zeichen
 * @param {Record<string, number[]>} palette Zeichen zu [r, g, b] oder [r, g, b, a]
 * @param {{size: number, scale?: number, offsetX?: number, offsetY?: number}} options
 * @returns {{width: number, height: number, pixels: Buffer}}
 */
export function paint(grid, palette, options) {
    const size = options.size;
    const gridWidth = Math.max(...grid.map((row) => row.length));
    const gridHeight = grid.length;
    const scale = options.scale ?? Math.max(1, Math.floor(size / Math.max(gridWidth, gridHeight)));
    const drawnWidth = gridWidth * scale;
    const drawnHeight = gridHeight * scale;
    const offsetX = options.offsetX ?? Math.round((size - drawnWidth) / 2);
    const offsetY = options.offsetY ?? Math.round((size - drawnHeight) / 2);

    const pixels = Buffer.alloc(size * size * 4);
    for (let gy = 0; gy < gridHeight; gy++) {
        for (let gx = 0; gx < grid[gy].length; gx++) {
            const color = palette[grid[gy][gx]];
            if (!color) {
                continue;
            }
            for (let y = 0; y < scale; y++) {
                const py = offsetY + gy * scale + y;
                if (py < 0 || py >= size) {
                    continue;
                }
                for (let x = 0; x < scale; x++) {
                    const px = offsetX + gx * scale + x;
                    if (px < 0 || px >= size) {
                        continue;
                    }
                    const at = (py * size + px) * 4;
                    pixels[at] = color[0];
                    pixels[at + 1] = color[1];
                    pixels[at + 2] = color[2];
                    pixels[at + 3] = color[3] ?? 255;
                }
            }
        }
    }
    return { width: size, height: size, pixels };
}

/** Schneidet leere Raender einer Pixelkarte weg. */
export function trim(grid) {
    let top = 0;
    let bottom = grid.length - 1;
    const leer = (row) => !/[^.]/.test(row);
    while (top < grid.length && leer(grid[top])) {
        top++;
    }
    while (bottom > top && leer(grid[bottom])) {
        bottom--;
    }
    const rows = grid.slice(top, bottom + 1);
    let left = Infinity;
    let right = -1;
    for (const row of rows) {
        const first = row.search(/[^.]/);
        if (first === -1) {
            continue;
        }
        left = Math.min(left, first);
        right = Math.max(right, row.replace(/\.+$/, '').length - 1);
    }
    if (right < 0) {
        return rows;
    }
    return rows.map((row) => row.slice(left, right + 1).padEnd(right - left + 1, '.'));
}
