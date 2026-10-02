/**
 * Clawd fuers Tray.
 *
 * Eigene Karten, nicht der Sprite aus dem Fenster: der ist 28 Pixel breit,
 * und bei 16 Pixeln Kantenlaenge bliebe von Beinen und Stummeln nichts uebrig
 * als ein Fleck. Hier steht dieselbe Figur in 16 mal 16, auf das Noetigste
 * gekuerzt, aber mit derselben Silhouette: Block, zwei quadratische Augen,
 * Seitenstummel, vier Beine.
 *
 * Zeichen wie im Renderer: B Koerper, D dunkel, H hell.
 */

/** Ein Bild je Gesichtsausdruck, 16 mal 16. */
export const TRAY_FRAMES = {
    open: [
        '................',
        '................',
        '..BBBBBBBBBBBB..',
        '..BBBBBBBBBBBB..',
        '..BBBBBBBBBBBB..',
        '.BBBDDBBBBDDBBB.',
        '.BBBDDBBBBDDBBB.',
        '.BBBBBBBBBBBBBB.',
        '..BBBBBBBBBBBB..',
        '..BBBBBBBBBBBB..',
        '..BB.BB.BB.BB...',
        '..BB.BB.BB.BB...',
        '................',
        '................',
        '................',
        '................',
    ],
    blink: [
        '................',
        '................',
        '..BBBBBBBBBBBB..',
        '..BBBBBBBBBBBB..',
        '..BBBBBBBBBBBB..',
        '.BBBBBBBBBBBBBB.',
        '.BBBDDBBBBDDBBB.',
        '.BBBBBBBBBBBBBB.',
        '..BBBBBBBBBBBB..',
        '..BBBBBBBBBBBB..',
        '..BB.BB.BB.BB...',
        '..BB.BB.BB.BB...',
        '................',
        '................',
        '................',
        '................',
    ],
    wide: [
        '................',
        '................',
        '..BBBBBBBBBBBB..',
        '..BBBDDBBDDBBB..',
        '..BBBDDBBDDBBB..',
        '.BBBBDDBBDDBBBB.',
        '.BBBBDDBBDDBBBB.',
        '.BBBBBBBBBBBBBB.',
        '..BBBBBBBBBBBB..',
        '..BBBBBBBBBBBB..',
        '..BB.BB.BB.BB...',
        '..BB.BB.BB.BB...',
        '................',
        '................',
        '................',
        '................',
    ],
    tired: [
        '................',
        '................',
        '................',
        '..BBBBBBBBBBBB..',
        '..BBBBBBBBBBBB..',
        '.BBBBBBBBBBBBBB.',
        '.BBBDDBBBBDDBBB.',
        '.BBBBBBBBBBBBBB.',
        '..BBBBBBBBBBBB..',
        '..BBBBBBBBBBBB..',
        '..BBBBBBBBBBBB..',
        '..BB.BB.BB.BB...',
        '................',
        '................',
        '................',
        '................',
    ],
    // Warten: Sonnenbrille.
    shades: [
        '................',
        '................',
        '..BBBBBBBBBBBB..',
        '..BBBBBBBBBBBB..',
        '..DDDDDDDDDDDD..',
        '.BDDDBBBBBBDDDB.',
        '.BDDDBBBBBBDDDB.',
        '.BBBBBBBBBBBBBB.',
        '..BBBBBBBBBBBB..',
        '..BBBBBBBBBBBB..',
        '..BB.BB.BB.BB...',
        '..BB.BB.BB.BB...',
        '................',
        '................',
        '................',
        '................',
    ],
    // Am Anschlag: flach, Augen zu.
    flat: [
        '................',
        '................',
        '................',
        '................',
        '................',
        '..BBBBBBBBBBBB..',
        '.BBBBBBBBBBBBBB.',
        '.BBBDDBBBBDDBBB.',
        '.BBBBBBBBBBBBBB.',
        '..BBBBBBBBBBBB..',
        '..BBBBBBBBBBBB..',
        '..B.B.B.B.B.B...',
        '................',
        '................',
        '................',
        '................',
    ],
};

/**
 * Ablauf je Zustand: Bildname und Standzeit. Absichtlich sparsam, ein Tray,
 * das dauernd zappelt, faellt unangenehm auf. Nur wenn wirklich etwas
 * passiert, bewegt sich etwas.
 */
export const TRAY_ANIMATIONS = {
    sleeping: [{ frame: 'tired', hold: 4000 }, { frame: 'flat', hold: 2500 }],
    idle: [
        { frame: 'open', hold: 5200 },
        { frame: 'blink', hold: 180 },
        { frame: 'open', hold: 6400 },
        { frame: 'shades', hold: 2600 },
    ],
    working: [
        { frame: 'open', hold: 700 },
        { frame: 'wide', hold: 700 },
        { frame: 'open', hold: 900 },
        { frame: 'blink', hold: 160 },
    ],
    sprinting: [
        { frame: 'wide', hold: 260 },
        { frame: 'open', hold: 260 },
    ],
    strained: [
        { frame: 'wide', hold: 600 },
        { frame: 'tired', hold: 600 },
    ],
    spent: [
        { frame: 'flat', hold: 1800 },
        { frame: 'tired', hold: 900 },
    ],
    fresh: [
        { frame: 'wide', hold: 220 },
        { frame: 'open', hold: 220 },
    ],
};

/**
 * Farbtafel fuer die Tray-Bilder.
 * @param {number[]} body Koerperfarbe als [r, g, b]
 */
export function TRAY_PALETTE(body) {
    return {
        B: body,
        D: [0x1a, 0x14, 0x10],
        H: [0xf5, 0xd3, 0xc2],
    };
}
