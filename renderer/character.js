/* ============================================================
   Clawd, Sprite-Engine.

   Kein schwarzer Umriss. Die Raeumlichkeit kommt aus drei Toenen: heller
   Rand oben links, Koerperton in der Mitte, dunkler Rand unten rechts. Genau
   so macht es das Original, und genau das hat meiner ersten Fassung gefehlt,
   die aus der Ferne nur noch schwarze Querbaender zeigte.

   Animiert wird mit echten Bildern, nicht mit CSS-Kurven. Ein Bild besteht
   aus Koerper plus Ueberlagerungen fuer Gesicht, Arme und Beine, dazu ein
   Versatz in ganzen Pixeln. Daraus ergeben sich viele Bewegungen aus wenig
   Daten: Atmen, Wippen, Schritte, Wackeln, Huepfen.

   28 mal 22 Pixel, weil eine Brille bei 20 Pixeln Breite nicht neben das
   Auge passt: Fassung und Pupille landen dann auf demselben Pixel und alles
   wird ein schwarzer Klotz.

   Zeichen der Pixelkarten:
     .  leer      H  Glanz        B  Koerper     S  Schatten
     D  dunkel (Augen, Brille)
     t  Tuerkis hell   T  Tuerkis   k  Tuerkis dunkel
     n  Bildschirm aus  l  Bildschirm an  w  Warnung  r  Alarm
   ============================================================ */

(function () {
    'use strict';

    var CW = 28;
    var CH = 22;
    var PW = 16;
    var PH = 15;

    var CLASSES = {
        H: 'px-light',
        B: 'px-body',
        S: 'px-shade',
        D: 'px-dark',
        t: 'px-teal-light',
        T: 'px-teal',
        k: 'px-teal-dark',
        n: 'px-screen',
        l: 'px-screen-on',
        w: 'px-warn',
        r: 'px-alarm',
    };

    /* ------------------------------------------------------------------ *
     * Koerper: gedrungen, breiter als hoch, ohne Gesicht und Gliedmassen
     * ------------------------------------------------------------------ */

    var BODY = [
        '..........HHHHHHHH..........',
        '........HHBBBBBBBBSS........',
        '......HHBBBBBBBBBBBBSS......',
        '.....HBBBBBBBBBBBBBBBBS.....',
        '....HBBBBBBBBBBBBBBBBBBS....',
        '....HBBBBBBBBBBBBBBBBBBS....',
        '....HBBBBBBBBBBBBBBBBBBS....',
        '....HBBBBBBBBBBBBBBBBBBS....',
        '....HBBBBBBBBBBBBBBBBBBS....',
        '....HBBBBBBBBBBBBBBBBBBS....',
        '....HBBBBBBBBBBBBBBBBBBS....',
        '.....HBBBBBBBBBBBBBBBBS.....',
        '.....SBBBBBBBBBBBBBBBBS.....',
        '......SSBBBBBBBBBBBBSS......',
        '........SSSSSSSSSSSS........',
    ];

    /* Gesicht: 20 breit, 6 hoch, ab Spalte 4, Zeile 5. */
    var FACES = {
        open: [
            '....................',
            '....................',
            '...DD.........DD....',
            '...DD.........DD....',
            '....................',
            '....................',
        ],
        blink: [
            '....................',
            '....................',
            '....................',
            '..DDDD.......DDDD...',
            '....................',
            '....................',
        ],
        // Bewusst nur zwei Zeilen hoch: mit vier Zeilen fuellt das Auge das
        // Brillenglas komplett aus und das Gesicht wird ein schwarzes Band.
        wide: [
            '....................',
            '....................',
            '..DDD........DDD....',
            '..DDD........DDD....',
            '....................',
            '....................',
        ],
        squint: [
            '....................',
            '....................',
            '..DDDD.......DDDD...',
            '....................',
            '....................',
            '....................',
        ],
        worried: [
            '..DD............DD..',
            '...D.............D..',
            '...DD.........DD....',
            '...DD.........DD....',
            '....D.........D.....',
            '....................',
        ],
        tired: [
            '....................',
            '....................',
            '....................',
            '..DDDD.......DDDD...',
            '...DD.........DD....',
            '....................',
        ],
        happy: [
            '....................',
            '....................',
            '...D...........D....',
            '..D.D.........D.D...',
            '....................',
            '....................',
        ],
        lookLeft: [
            '....................',
            '....................',
            '..DD..........DD....',
            '..DD..........DD....',
            '....................',
            '....................',
        ],
        lookRight: [
            '....................',
            '....................',
            '....DD.........DD...',
            '....DD.........DD...',
            '....................',
            '....................',
        ],
    };

    /*
       Brille, gleiche Flaeche wie das Gesicht.

       Nur obere und untere Fassung plus Bruecke, keine Seitenstege. Mit
       Stegen laufen die Glaeser bei dieser Groesse voll und das Gesicht wird
       zu zwei schwarzen Kloetzen. So bleibt das Auge sichtbar und es liest
       sich trotzdem als Brille.
    */
    var GLASSES = [
        '.DDDDDD.....DDDDDD..',
        '.D...............D..',
        '.D....DDDDDDD....D..',
        '.D...............D..',
        '.D...............D..',
        '.DDDDDD.....DDDDDD..',
    ];

    /* Arme: 28 breit, 5 hoch, ab Zeile 7. */
    var ARMS = {
        out: [
            '............................',
            'HBBB....................BBBS',
            'HBBB....................BBBS',
            '.SSS....................SSS.',
            '............................',
        ],
        up: [
            'HBBB....................BBBS',
            'HBBB....................BBBS',
            '.SSS....................SSS.',
            '............................',
            '............................',
        ],
        down: [
            '............................',
            '............................',
            'HBBB....................BBBS',
            'HBBB....................BBBS',
            '.SSS....................SSS.',
        ],
        tucked: [
            '............................',
            '............................',
            '..HBB..................BBS..',
            '..HBB..................BBS..',
            '...SS..................SS...',
        ],
        cheer: [
            'HBB.......................BS',
            'HBBB....................BBBS',
            '.SSS....................SSS.',
            '............................',
            '............................',
        ],
        wave: [
            'HBBB........................',
            'HBBB....................BBBS',
            '.SSS....................BBBS',
            '........................SSS.',
            '............................',
        ],
    };

    /* Beine: 28 breit, 6 hoch, ab Zeile 15. */
    var LEGS = {
        stand: [
            '........BBBB....BBBB........',
            '........BBBB....BBBB........',
            '........SSSS....SSSS........',
            '............................',
            '............................',
            '............................',
        ],
        stepA: [
            '.......BBBB.....BBBB........',
            '.......BBBB.....BBBB........',
            '.......SSSS.....BBBB........',
            '................SSSS........',
            '............................',
            '............................',
        ],
        stepB: [
            '........BBBB....BBBB........',
            '........BBBB.....BBBB.......',
            '........BBBB.....SSSS.......',
            '........SSSS................',
            '............................',
            '............................',
        ],
        run: [
            '.......BBB.......BBB........',
            '......BBB.........BBB.......',
            '.....BBB...........BBB......',
            '.....SSS...........SSS......',
            '............................',
            '............................',
        ],
        tuckedLegs: [
            '.........SSSSSSSSSS.........',
            '............................',
            '............................',
            '............................',
            '............................',
            '............................',
        ],
        splay: [
            '......BBB..........BBB......',
            '....BBB..............BBB....',
            '...BBB................BBB...',
            '...SSS................SSS...',
            '............................',
            '............................',
        ],
    };

    /* ------------------------------------------------------------------ *
     * Der Rechner: dieselbe Drei-Ton-Logik, leicht perspektivisch
     * ------------------------------------------------------------------ */

    var PC = [
        '...tttttttttt...',
        '..tttTTTTTTttk..',
        '.ttTTTTTTTTTTkk.',
        'ttT..........Tkk',
        'tTT..........TTk',
        'tTT..........TTk',
        'tTT..........TTk',
        'tTT..........TTk',
        'tTTTTTTTTTTTTTTk',
        '.tTTTTTTTTTTTTk.',
        '..kkTTTTTTTTkk..',
        '.....TTTTTT.....',
        '...TTTTTTTTTT...',
        '..TTTTTTTTTTTT..',
        '..kkkkkkkkkkkk..',
    ];

    /* Bildschirm: 10 breit, 5 hoch, ab Spalte 3, Zeile 3. */
    var SCREENS = {
        off: [
            'nnnnnnnnnn',
            'nnnnnnnnnn',
            'nnnnnnnnnn',
            'nnnnnnnnnn',
            'nnnnnnnnnn',
        ],
        standby: [
            'nnnnnnnnnn',
            'nnnnnnnnnn',
            'nlnnnnnnnn',
            'nnnnnnnnnn',
            'nnnnnnnnnn',
        ],
        codeA: [
            'nllllnnnnn',
            'nllnnnnnnn',
            'nlllllnnnn',
            'nllnnnnnnn',
            'nllllllnnn',
        ],
        codeB: [
            'nllnnnnnnn',
            'nlllllnnnn',
            'nllnnnnnnn',
            'nlllllllnn',
            'nllnnnnnnn',
        ],
        codeC: [
            'nlllllnnnn',
            'nllnnnnnnn',
            'nllllllnnn',
            'nllnnnnnnn',
            'nlllnnnnnn',
        ],
        busyA: [
            'nlllllllln',
            'nllnnlllln',
            'nlllllllln',
            'nllllnnnnn',
            'nlllllllnn',
        ],
        busyB: [
            'nllllnnnnn',
            'nlllllllln',
            'nllnnlllnn',
            'nlllllllln',
            'nlllnnnnnn',
        ],
        warn: [
            'nnnnnnnnnn',
            'nnnwwwwnnn',
            'nnwwwwwwnn',
            'nnnwwwwnnn',
            'nnnnnnnnnn',
        ],
        alarm: [
            'nnnnnnnnnn',
            'nrrrrrrrrn',
            'nrrrrrrrrn',
            'nrrrrrrrrn',
            'nnnnnnnnnn',
        ],
        done: [
            'nnnnnnnnnn',
            'nnnnnnnlnn',
            'nnnnnnlnnn',
            'nnlnnlnnnn',
            'nnnllnnnnn',
        ],
    };

    /* ------------------------------------------------------------------ *
     * Zustaende: je ein Bilderreigen
     *
     * dy und dx verschieben Clawd um ganze Pixel, so entstehen Wippen und
     * Wackeln ohne Skalierung. hold ist die Anzeigedauer in Millisekunden.
     * ------------------------------------------------------------------ */

    var STATES = {
        sleeping: {
            glasses: false,
            frames: [
                { face: 'tired', arms: 'tucked', legs: 'tuckedLegs', dy: 1, screen: 'off', hold: 1500 },
                { face: 'tired', arms: 'tucked', legs: 'tuckedLegs', dy: 0, screen: 'off', hold: 1500 },
            ],
        },
        idle: {
            glasses: false,
            frames: [
                { face: 'open', arms: 'down', legs: 'stand', dy: 0, screen: 'standby', hold: 2400 },
                { face: 'blink', arms: 'down', legs: 'stand', dy: 0, screen: 'standby', hold: 130 },
                { face: 'open', arms: 'down', legs: 'stand', dy: 0, screen: 'standby', hold: 1700 },
                { face: 'lookLeft', arms: 'down', legs: 'stand', dy: 0, screen: 'standby', hold: 800 },
                { face: 'lookRight', arms: 'down', legs: 'stand', dy: 0, screen: 'standby', hold: 800 },
                { face: 'open', arms: 'wave', legs: 'stand', dy: 0, screen: 'standby', hold: 400 },
                { face: 'open', arms: 'down', legs: 'stand', dy: 0, screen: 'standby', hold: 2200 },
            ],
        },
        working: {
            glasses: true,
            frames: [
                { face: 'open', arms: 'out', legs: 'stepA', dy: 0, screen: 'codeA', hold: 230 },
                { face: 'open', arms: 'up', legs: 'stepB', dy: -1, screen: 'codeB', hold: 230 },
                { face: 'lookRight', arms: 'out', legs: 'stepA', dy: 0, screen: 'codeC', hold: 230 },
                { face: 'open', arms: 'up', legs: 'stepB', dy: -1, screen: 'codeA', hold: 230 },
            ],
        },
        sprinting: {
            glasses: true,
            frames: [
                { face: 'wide', arms: 'up', legs: 'run', dy: -2, screen: 'busyA', hold: 95 },
                { face: 'wide', arms: 'out', legs: 'stepA', dy: 0, screen: 'busyB', hold: 95 },
                { face: 'wide', arms: 'up', legs: 'run', dy: -3, screen: 'busyA', hold: 95 },
                { face: 'open', arms: 'out', legs: 'stepB', dy: 0, screen: 'busyB', hold: 95 },
            ],
        },
        strained: {
            glasses: true,
            frames: [
                { face: 'worried', arms: 'out', legs: 'stand', dx: -1, dy: 0, screen: 'warn', hold: 240 },
                { face: 'worried', arms: 'out', legs: 'stand', dx: 1, dy: 0, screen: 'warn', hold: 240 },
                { face: 'wide', arms: 'out', legs: 'stand', dx: 0, dy: -1, screen: 'off', hold: 180 },
                { face: 'worried', arms: 'out', legs: 'stand', dx: 1, dy: 0, screen: 'warn', hold: 240 },
            ],
        },
        // Am Anschlag nimmt Clawd die Brille ab. Mit Fassung plus
        // Schlitzaugen wuerde daraus wieder ein schwarzes Band.
        spent: {
            glasses: false,
            frames: [
                { face: 'tired', arms: 'tucked', legs: 'splay', dy: 3, screen: 'alarm', hold: 750 },
                { face: 'tired', arms: 'tucked', legs: 'splay', dy: 3, screen: 'off', hold: 550 },
                { face: 'squint', arms: 'tucked', legs: 'splay', dy: 4, screen: 'alarm', hold: 750 },
            ],
        },
        fresh: {
            glasses: false,
            frames: [
                { face: 'happy', arms: 'cheer', legs: 'run', dy: -4, screen: 'done', hold: 170 },
                { face: 'happy', arms: 'up', legs: 'stand', dy: 0, screen: 'done', hold: 170 },
                { face: 'happy', arms: 'cheer', legs: 'run', dy: -3, screen: 'done', hold: 170 },
                { face: 'happy', arms: 'out', legs: 'stand', dy: 0, screen: 'done', hold: 210 },
            ],
        },
    };

    var STATE_NAMES = Object.keys(STATES);
    var CELEBRATE_MS = 3600;

    /* ------------------------------------------------------------------ *
     * Karten zusammensetzen und zeichnen
     * ------------------------------------------------------------------ */

    function blank(width, height) {
        var rows = [];
        for (var y = 0; y < height; y++) {
            rows.push(new Array(width + 1).join('.'));
        }
        return rows;
    }

    /** Legt eine Ueberlagerung auf. Punkte lassen die Grundkarte stehen. */
    function overlay(grid, patch, atX, atY) {
        for (var y = 0; y < patch.length; y++) {
            var row = grid[atY + y];
            if (row === undefined) {
                continue;
            }
            var chars = row.split('');
            for (var x = 0; x < patch[y].length; x++) {
                var pixel = patch[y][x];
                if (pixel !== '.' && chars[atX + x] !== undefined) {
                    chars[atX + x] = pixel;
                }
            }
            grid[atY + y] = chars.join('');
        }
        return grid;
    }

    function buildClawd(frame, withGlasses) {
        var grid = blank(CW, CH);
        var dy = (frame.dy || 0) + 5;
        var dx = frame.dx || 0;

        overlay(grid, BODY, dx, dy);
        overlay(grid, ARMS[frame.arms] || ARMS.down, dx, dy + 7);
        overlay(grid, LEGS[frame.legs] || LEGS.stand, dx, dy + 15);
        overlay(grid, FACES[frame.face] || FACES.open, dx + 4, dy + 5);
        if (withGlasses) {
            overlay(grid, GLASSES, dx + 4, dy + 5);
        }
        return grid;
    }

    function buildPc(screen) {
        var grid = PC.slice();
        overlay(grid, SCREENS[screen] || SCREENS.off, 3, 3);
        return grid;
    }

    /**
     * Karte zu SVG. Gleiche Farben in einer Zeile werden zu einem Rechteck
     * zusammengefasst, sonst waeren es bei mehreren Bildern pro Sekunde ein
     * paar hundert Knoten zu viel.
     */
    function toRects(grid) {
        var out = [];
        for (var y = 0; y < grid.length; y++) {
            var row = grid[y];
            var x = 0;
            while (x < row.length) {
                var cls = CLASSES[row[x]];
                if (!cls) {
                    x++;
                    continue;
                }
                var run = 1;
                while (x + run < row.length && row[x + run] === row[x]) {
                    run++;
                }
                out.push('<rect class="' + cls + '" x="' + x + '" y="' + y
                    + '" width="' + run + '" height="1"/>');
                x += run;
            }
        }
        return out.join('');
    }

    function svg(grid, width, height, extraClass) {
        return '<svg class="px-svg ' + extraClass + '" viewBox="0 0 ' + width + ' ' + height + '"'
            + ' shape-rendering="crispEdges" aria-hidden="true">' + toRects(grid) + '</svg>';
    }

    /* ------------------------------------------------------------------ *
     * Oeffentliche Schnittstelle
     * ------------------------------------------------------------------ */

    function create(container) {
        container.innerHTML = '<div class="clawd" data-state="idle">'
            + '<div class="clawd-row">'
            + '<div class="clawd-figure"></div>'
            + '<div class="clawd-pc"></div>'
            + '</div>'
            + '<div class="clawd-fx"></div>'
            + '</div>';

        var root = container.querySelector('.clawd');
        var figure = container.querySelector('.clawd-figure');
        var pc = container.querySelector('.clawd-pc');
        var fx = container.querySelector('.clawd-fx');

        var state = 'idle';
        var baseState = 'idle';
        var frameIndex = 0;
        var timer = null;
        var celebrateTimer = null;
        var lastScreen = null;
        var reduced = window.matchMedia
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        function drawFrame() {
            var recipe = STATES[state] || STATES.idle;
            var frames = recipe.frames;
            var frame = frames[frameIndex % frames.length];

            figure.innerHTML = svg(buildClawd(frame, recipe.glasses), CW, CH, 'px-clawd');
            if (frame.screen !== lastScreen) {
                pc.innerHTML = svg(buildPc(frame.screen), PW, PH, 'px-pc');
                lastScreen = frame.screen;
            }

            clearTimeout(timer);
            if (reduced) {
                return; // Ein Bild reicht, keine Dauerbewegung.
            }
            timer = setTimeout(function () {
                frameIndex++;
                drawFrame();
            }, frame.hold || 250);
        }

        function apply(next) {
            if (STATE_NAMES.indexOf(next) === -1 || next === state) {
                return;
            }
            state = next;
            frameIndex = 0;
            lastScreen = null;
            root.dataset.state = next;
            drawFrame();
        }

        drawFrame();

        return {
            setState: function (next) {
                baseState = next;
                if (!celebrateTimer) {
                    apply(next);
                }
            },

            setSeverity: function (level) {
                root.dataset.severity = ['ok', 'warn', 'crit'].indexOf(level) === -1
                    ? 'none'
                    : level;
            },

            /**
             * Pixel, die zur Figur fliegen. Vier Sorten, damit es lebt:
             * Wuerfel, Codestreifen, Funken und ein Plus aus zwei Balken.
             */
            spark: function (color, count) {
                if (reduced) {
                    return;
                }
                var total = Math.max(1, Math.min(16, count || 5));
                var kinds = ['cube', 'bar', 'spark', 'cube', 'cube', 'plus'];
                for (var i = 0; i < total; i++) {
                    var bit = document.createElement('i');
                    bit.className = 'fx fx--' + kinds[Math.floor(Math.random() * kinds.length)];
                    bit.style.setProperty('--lane', String(Math.floor(Math.random() * 9) - 4));
                    bit.style.setProperty('--delay', (i * 60 + Math.random() * 40).toFixed(0) + 'ms');
                    bit.style.setProperty('--spin',
                        ((Math.random() < 0.5 ? -1 : 1) * (90 + Math.random() * 270)).toFixed(0) + 'deg');
                    bit.style.setProperty('--speed', (620 + Math.random() * 420).toFixed(0) + 'ms');
                    if (/^#[0-9a-f]{6}$/i.test(String(color || ''))) {
                        bit.style.background = color;
                    }
                    bit.addEventListener('animationend', function () { this.remove(); });
                    fx.appendChild(bit);
                }
            },

            celebrate: function () {
                if (celebrateTimer || reduced) {
                    return;
                }
                apply('fresh');
                root.classList.add('is-celebrating');
                for (var i = 0; i < 22; i++) {
                    var piece = document.createElement('i');
                    piece.className = 'fx fx--confetti';
                    piece.style.setProperty('--dx', (Math.random() * 220 - 110).toFixed(0) + 'px');
                    piece.style.setProperty('--dy', (-50 - Math.random() * 120).toFixed(0) + 'px');
                    piece.style.setProperty('--delay', (Math.random() * 320).toFixed(0) + 'ms');
                    piece.style.setProperty('--spin', (Math.random() * 900 - 450).toFixed(0) + 'deg');
                    piece.addEventListener('animationend', function () { this.remove(); });
                    fx.appendChild(piece);
                }
                celebrateTimer = setTimeout(function () {
                    celebrateTimer = null;
                    root.classList.remove('is-celebrating');
                    apply(baseState);
                }, CELEBRATE_MS);
            },

            state: function () { return state; },
        };
    }

    window.ClaudeCreature = { create: create, STATES: STATE_NAMES };
}());
