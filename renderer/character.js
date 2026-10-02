/* ============================================================
   Clawd, Sprite-Engine.

   Die Form folgt dem Original: ein flacher Block in einem Ton, zwei
   quadratische schwarze Augen, links und rechts ein kurzer Stummel, unten
   drei Beine. Kein Mund, keine Umrisslinie, keine Schattenkante. Die erste
   Fassung hier hatte eine Drei-Ton-Schattierung und eine Brille, beides gibt
   es am Original nicht, und aus der Ferne wurde daraus Matsch.

   Charakter kommt deshalb nicht aus dem Koerper, sondern aus Haltung, Augen
   und Aufsaetzen: Sonnenbrille beim Warten, Becher in der Pause, Laptop bei
   der Arbeit, Schweiss im Sprint, Zzz im Schlaf.

   Animiert wird mit echten Bildern, nicht mit CSS-Kurven. Ein Bild besteht
   aus Koerper plus Ueberlagerungen und einem Versatz in ganzen Pixeln.

   Jeder Zustand hat mehrere Abläufe mit Gewicht: einen Hauptreigen, der fast
   immer laeuft, und seltene Einlagen. Deshalb wiederholt sich die Figur nicht
   im Sekundentakt, sondern erst nach Minuten.

   Raster 28 mal 22. Der Koerper sitzt auf x5..22, die Augen auf x8..10 und
   x17..19, damit beide gleich weit von der Mitte stehen.

   Zeichen der Pixelkarten:
     .  leer      B  Koerper     D  dunkel (Augen)     H  hell (Schweiss)
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
     * Koerper: schlichter Block, x5..22, ab Zeile 4
     * ------------------------------------------------------------------ */

    var BODY_ROW = '.....BBBBBBBBBBBBBBBBBB.....';
    var BODY = [];
    for (var i = 0; i < 12; i++) {
        BODY.push(BODY_ROW);
    }

    /* Augen: 28 breit, 4 hoch, ab Zeile 6. Quadrate, kein Mund. */
    var FACES = {
        open: [
            '............................',
            '........DDD......DDD........',
            '........DDD......DDD........',
            '........DDD......DDD........',
        ],
        blink: [
            '............................',
            '............................',
            '........DDD......DDD........',
            '............................',
        ],
        wide: [
            '........DDDD....DDDD........',
            '........DDDD....DDDD........',
            '........DDDD....DDDD........',
            '........DDDD....DDDD........',
        ],
        squint: [
            '............................',
            '............................',
            '.......DDDDD....DDDDD.......',
            '............................',
        ],
        // Zusammengekniffen und leicht nach innen versetzt.
        worried: [
            '............................',
            '.........DD........DD.......',
            '.........DDD......DDD.......',
            '.........DD........DD.......',
        ],
        happy: [
            '............................',
            '.........D..........D.......',
            '........D.D........D.D......',
            '............................',
        ],
        tired: [
            '............................',
            '............................',
            '.......DDDDD....DDDDD.......',
            '........DDD......DDD........',
        ],
        lookLeft: [
            '............................',
            '.......DDD......DDD.........',
            '.......DDD......DDD.........',
            '.......DDD......DDD.........',
        ],
        lookRight: [
            '............................',
            '.........DDD......DDD.......',
            '.........DDD......DDD.......',
            '.........DDD......DDD.......',
        ],
        // Ein Auge zu: das kurze Zwinkern zwischendurch.
        wink: [
            '............................',
            '........DDD.................',
            '........DDD......DDD........',
            '........DDD.................',
        ],
        // Kreuze statt Augen, wenn gar nichts mehr geht.
        dizzy: [
            '............................',
            '........D.D......D.D........',
            '.........D........D.........',
            '........D.D......D.D........',
        ],
        // Zusammengezogen und ein Stueck nach unten: konzentriert.
        focused: [
            '............................',
            '............................',
            '........DDDD....DDDD........',
            '........DDDD....DDDD........',
        ],
    };

    /* Stummel links und rechts: 28 breit, 5 hoch, ab Zeile 6. */
    var ARMS = {
        down: [
            '............................',
            '............................',
            '..BBB..................BBB..',
            '..BBB..................BBB..',
            '..BBB..................BBB..',
        ],
        out: [
            '............................',
            '..BBB..................BBB..',
            '..BBB..................BBB..',
            '..BBB..................BBB..',
            '............................',
        ],
        up: [
            '..BBB..................BBB..',
            '..BBB..................BBB..',
            '..BBB..................BBB..',
            '............................',
            '............................',
        ],
        tucked: [
            '............................',
            '............................',
            '...BB....................BB.',
            '...BB....................BB.',
            '............................',
        ],
        cheer: [
            '..BBB..................BBB..',
            '..BBB..................BBB..',
            '..BBB..................BBB..',
            '.......................BBB..',
            '............................',
        ],
        // Ein Stummel oben, einer unten: das liest sich als Winken.
        wave: [
            '..BBB.......................',
            '..BBB.......................',
            '..BBB..................BBB..',
            '.......................BBB..',
            '.......................BBB..',
        ],
    };

    /* Beine: 28 breit, 4 hoch, ab Zeile 16. Vier Stueck wie am Original. */
    var LEGS = {
        stand: [
            '.....BBB..BBB..BBB..BBB.....',
            '.....BBB..BBB..BBB..BBB.....',
            '.....BBB..BBB..BBB..BBB.....',
            '.....BBB..BBB..BBB..BBB.....',
        ],
        // Beim Gehen tragen die Beine unterschiedlich weit.
        stepA: [
            '.....BBB..BBB..BBB..BBB.....',
            '.....BBB..BBB..BBB..BBB.....',
            '.....BBB..BBB.......BBB.....',
            '.....BBB............BBB.....',
        ],
        stepB: [
            '.....BBB..BBB..BBB..BBB.....',
            '.....BBB..BBB..BBB..BBB.....',
            '..........BBB..BBB..........',
            '..........BBB...............',
        ],
        run: [
            '.....BBB..BBB..BBB..BBB.....',
            '....BBB...BBB...BBB..BBB....',
            '...BBB..............BBB.....',
            '............................',
        ],
        splay: [
            '.....BBB..BBB..BBB..BBB.....',
            '...BBB....BBB..BBB....BBB...',
            '..BBB.....BBB..BBB.....BBB..',
            '..BB...................BB...',
        ],
        // Liegend: nur ein Rest unter dem Koerper.
        tuckedLegs: [
            '.....BBB..BBB..BBB..BBB.....',
            '.....BBB..BBB..BBB..BBB.....',
            '............................',
            '............................',
        ],
    };

    /* ------------------------------------------------------------------ *
     * Aufsaetze. Jeder bringt seine eigene Ecke mit.
     * ------------------------------------------------------------------ */

    var PROPS = {
        sunglasses: {
            x: 7, y: 6,
            map: [
                'DDDDDDDDDDDDDD',
                'DDDDD....DDDDD',
                'DDDDD....DDDDD',
                'DDDDD....DDDDD',
            ],
        },
        // Becher neben dem rechten Bein, mit Henkel.
        mug: {
            x: 23, y: 15, fixed: true,
            map: [
                'TTTT.',
                'TTTTk',
                'TTTTk',
                'TTTT.',
                'kkkk.',
            ],
        },
        sweat: {
            x: 0, y: 4,
            map: [
                '..H.....................H...',
                '.HHH...................HHH..',
                '..H.....................H...',
            ],
        },
        sweatDrip: {
            x: 0, y: 6,
            map: [
                '..H........................H',
                '.HHH......................HH',
                '..H.........................',
            ],
        },
        /*
           Zwei kleine Clawds links und rechts, fuer die Arbeit mit
           Subagenten. Vier mal vier Pixel reichen fuer Silhouette und ein
           Auge je Seite, mehr wird bei dieser Groesse ohnehin Matsch.
        */
        helpers: {
            x: 0, y: 14, fixed: true,
            map: [
                'BBBB....................BBBB',
                'DBBD....................DBBD',
                'BBBB....................BBBB',
                'B..B....................B..B',
            ],
        },
        helpersUp: {
            x: 0, y: 13, fixed: true,
            map: [
                'BBBB....................BBBB',
                'DBBD....................DBBD',
                'BBBB....................BBBB',
                'B..B....................B..B',
            ],
        },
        /*
           Alles Neue sitzt ueber oder neben dem Koerper, nie darauf.

           Der Laptop sass einmal mitten auf dem Bauch und las sich prompt als
           offenes Maul. Die Silhouette bleibt deshalb frei: Aufsaetze gehen
           nach oben (Zeile 0 bis 3) oder an die Seiten (Spalte 0 bis 4 und 23
           bis 27). Einzige Ausnahme ist die Sonnenbrille, die gehoert aufs
           Gesicht.
        */
        headphones: {
            x: 0, y: 3,
            map: [
                '......DDDDDDDDDDDDDDDD......',
                '...DD..................DD...',
                '...DD..................DD...',
                '...DD..................DD...',
                '...DD..................DD...',
            ],
        },
        heart: {
            x: 23, y: 0, fixed: true,
            map: [
                'rr.rr',
                'rrrrr',
                '.rrr.',
                '..r..',
            ],
        },
        bulb: {
            x: 12, y: 0, fixed: true,
            map: [
                '.ww.',
                'wwww',
                'wwww',
                '.DD.',
            ],
        },
        hat: {
            x: 10, y: 0,
            map: [
                '...w...',
                '..www..',
                '.wwwww.',
                'wwwwwww',
            ],
        },
        question: {
            x: 23, y: 0, fixed: true,
            map: [
                '.DD.',
                'D..D',
                '...D',
                '..D.',
                '..D.',
            ],
        },
        steam: {
            x: 23, y: 12, fixed: true,
            map: [
                '.H..',
                '..H.',
                '.H..',
            ],
        },
        zzz: {
            x: 21, y: 0, fixed: true,
            map: [
                '..DDD',
                '...D.',
                '..DDD',
                '.....',
                'DD...',
                '.D...',
                'DD...',
            ],
        },
        zzzBig: {
            x: 20, y: 0, fixed: true,
            map: [
                '...DDDD',
                '.....D.',
                '....D..',
                '...DDDD',
                'DDD....',
                '..D....',
                'DDD....',
            ],
        },
    };

    /* ------------------------------------------------------------------ *
     * Der Rechner: unveraendert, leicht perspektivisch
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
        // Noten, wenn Clawd mit Kopfhoerern arbeitet.
        music: [
            'nnllnnnnnn',
            'nnlnlnnnnn',
            'nnlnnlnnnn',
            'nllnnllnnn',
            'nllnnllnnn',
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
     * Zustaende
     *
     * Jeder hat mehrere Ablaeufe mit Gewicht. Nach jedem Durchlauf wird neu
     * gewuerfelt, der Hauptablauf hat das hoechste Gewicht. Eine Einlage
     * kommt dadurch etwa alle zehn Durchlaeufe, also nicht vorhersehbar,
     * aber auch nicht staendig.
     *
     * dy und dx verschieben Clawd um ganze Pixel, hold ist die Anzeigedauer.
     * ------------------------------------------------------------------ */

    var STATES = {
        sleeping: {
            runs: [
                {
                    weight: 10,
                    frames: [
                        { face: 'tired', arms: 'tucked', legs: 'tuckedLegs', prop: 'zzz', dy: 2, screen: 'off', hold: 1600 },
                        { face: 'tired', arms: 'tucked', legs: 'tuckedLegs', prop: 'zzz', dy: 3, screen: 'off', hold: 1600 },
                    ],
                },
                {
                    // Tief durchatmen, das Zzz wird groesser.
                    weight: 3,
                    frames: [
                        { face: 'tired', arms: 'tucked', legs: 'tuckedLegs', prop: 'zzzBig', dy: 1, screen: 'off', hold: 900 },
                        { face: 'tired', arms: 'tucked', legs: 'tuckedLegs', prop: 'zzzBig', dy: 3, screen: 'off', hold: 1400 },
                        { face: 'squint', arms: 'tucked', legs: 'tuckedLegs', prop: null, dy: 3, screen: 'standby', hold: 500 },
                        { face: 'tired', arms: 'tucked', legs: 'tuckedLegs', prop: 'zzz', dy: 2, screen: 'off', hold: 1200 },
                    ],
                },
            ],
        },

        idle: {
            runs: [
                {
                    weight: 12,
                    frames: [
                        { face: 'open', arms: 'down', legs: 'stand', dy: 0, screen: 'standby', hold: 2400 },
                        { face: 'blink', arms: 'down', legs: 'stand', dy: 0, screen: 'standby', hold: 120 },
                        { face: 'open', arms: 'down', legs: 'stand', dy: 0, screen: 'standby', hold: 1900 },
                    ],
                },
                {
                    // Umsehen.
                    weight: 4,
                    frames: [
                        { face: 'lookLeft', arms: 'down', legs: 'stand', dy: 0, screen: 'standby', hold: 900 },
                        { face: 'open', arms: 'down', legs: 'stand', dy: 0, screen: 'standby', hold: 400 },
                        { face: 'lookRight', arms: 'down', legs: 'stand', dy: 0, screen: 'standby', hold: 900 },
                        { face: 'blink', arms: 'down', legs: 'stand', dy: 0, screen: 'standby', hold: 120 },
                    ],
                },
                {
                    // Warten mit Sonnenbrille, das dauert.
                    weight: 3,
                    frames: [
                        { face: 'open', arms: 'down', legs: 'stand', prop: 'sunglasses', dy: 0, screen: 'standby', hold: 2000 },
                        { face: 'open', arms: 'out', legs: 'stand', prop: 'sunglasses', dy: -1, screen: 'standby', hold: 700 },
                        { face: 'open', arms: 'down', legs: 'stand', prop: 'sunglasses', dy: 0, screen: 'standby', hold: 2600 },
                        { face: 'open', arms: 'down', legs: 'stepA', prop: 'sunglasses', dy: 0, screen: 'standby', hold: 900 },
                    ],
                },
                {
                    // Pause mit Becher.
                    weight: 3,
                    frames: [
                        { face: 'open', arms: 'out', legs: 'stand', prop: 'mug', dy: 0, screen: 'standby', hold: 1200 },
                        { face: 'open', arms: 'out', legs: 'stand', prop: 'steam', dy: 0, screen: 'standby', hold: 600 },
                        { face: 'squint', arms: 'out', legs: 'stand', prop: 'mug', dy: -1, screen: 'standby', hold: 700 },
                        { face: 'happy', arms: 'down', legs: 'stand', prop: 'steam', dy: 0, screen: 'standby', hold: 1400 },
                    ],
                },
                {
                    // Strecken.
                    weight: 2,
                    frames: [
                        { face: 'squint', arms: 'up', legs: 'stand', dy: -2, screen: 'standby', hold: 500 },
                        { face: 'wide', arms: 'up', legs: 'stand', dy: -3, screen: 'standby', hold: 400 },
                        { face: 'open', arms: 'out', legs: 'stand', dy: -1, screen: 'standby', hold: 350 },
                        { face: 'open', arms: 'down', legs: 'stand', dy: 0, screen: 'standby', hold: 900 },
                    ],
                },
                {
                    // Ratlos: ein Fragezeichen steigt auf.
                    weight: 2,
                    frames: [
                        { face: 'lookLeft', arms: 'down', legs: 'stand', prop: 'question', dy: 0, screen: 'standby', hold: 900 },
                        { face: 'squint', arms: 'down', legs: 'stand', prop: 'question', dy: 0, screen: 'standby', hold: 700 },
                        { face: 'open', arms: 'out', legs: 'stand', dy: -1, screen: 'standby', hold: 600 },
                    ],
                },
                {
                    // Ein paar Schritte nach links und wieder zurueck.
                    weight: 2,
                    frames: [
                        { face: 'open', arms: 'out', legs: 'stepA', dx: -1, dy: 0, screen: 'standby', hold: 320 },
                        { face: 'open', arms: 'out', legs: 'stepB', dx: -2, dy: -1, screen: 'standby', hold: 320 },
                        { face: 'lookLeft', arms: 'down', legs: 'stand', dx: -2, dy: 0, screen: 'standby', hold: 700 },
                        { face: 'open', arms: 'out', legs: 'stepB', dx: -1, dy: -1, screen: 'standby', hold: 320 },
                        { face: 'open', arms: 'out', legs: 'stepA', dx: 0, dy: 0, screen: 'standby', hold: 320 },
                    ],
                },
                {
                    // Zwinkern.
                    weight: 2,
                    frames: [
                        { face: 'open', arms: 'down', legs: 'stand', dy: 0, screen: 'standby', hold: 1200 },
                        { face: 'wink', arms: 'down', legs: 'stand', dy: 0, screen: 'standby', hold: 320 },
                        { face: 'happy', arms: 'down', legs: 'stand', dy: -1, screen: 'standby', hold: 500 },
                    ],
                },
                {
                    // Winken.
                    weight: 1,
                    frames: [
                        { face: 'happy', arms: 'wave', legs: 'stand', dy: 0, screen: 'standby', hold: 320 },
                        { face: 'happy', arms: 'out', legs: 'stand', dy: -1, screen: 'standby', hold: 320 },
                        { face: 'happy', arms: 'wave', legs: 'stand', dy: 0, screen: 'standby', hold: 320 },
                        { face: 'open', arms: 'down', legs: 'stand', dy: 0, screen: 'standby', hold: 800 },
                    ],
                },
            ],
        },

        working: {
            runs: [
                {
                    weight: 12,
                    frames: [
                        { face: 'open', arms: 'out', legs: 'stepA', dy: 0, screen: 'codeA', hold: 240 },
                        { face: 'open', arms: 'up', legs: 'stepB', dy: -1, screen: 'codeB', hold: 240 },
                        { face: 'open', arms: 'out', legs: 'stepA', dy: 0, screen: 'codeC', hold: 240 },
                        { face: 'blink', arms: 'up', legs: 'stepB', dy: -1, screen: 'codeA', hold: 200 },
                    ],
                },
                {
                    // Mit Kopfhoerern, ruhiger, der Bildschirm macht Musik.
                    weight: 6,
                    frames: [
                        { face: 'focused', arms: 'out', legs: 'stand', prop: 'headphones', dy: 0, screen: 'music', hold: 420 },
                        { face: 'focused', arms: 'up', legs: 'stand', prop: 'headphones', dy: -1, screen: 'music', hold: 420 },
                        { face: 'open', arms: 'out', legs: 'stepA', prop: 'headphones', dy: 0, screen: 'codeA', hold: 420 },
                        { face: 'focused', arms: 'up', legs: 'stepB', prop: 'headphones', dy: -1, screen: 'music', hold: 460 },
                    ],
                },
                {
                    // Geistesblitz.
                    weight: 3,
                    frames: [
                        { face: 'squint', arms: 'down', legs: 'stand', dy: 0, screen: 'codeC', hold: 600 },
                        { face: 'wide', arms: 'up', legs: 'stand', prop: 'bulb', dy: -2, screen: 'codeA', hold: 500 },
                        { face: 'happy', arms: 'out', legs: 'stand', prop: 'bulb', dy: -1, screen: 'codeB', hold: 400 },
                        { face: 'open', arms: 'out', legs: 'stepA', dy: 0, screen: 'codeA', hold: 300 },
                    ],
                },
                {
                    // Kurz nachdenken, zum Bildschirm schauen.
                    weight: 3,
                    frames: [
                        { face: 'lookRight', arms: 'down', legs: 'stand', dy: 0, screen: 'codeC', hold: 700 },
                        { face: 'squint', arms: 'down', legs: 'stand', dy: 0, screen: 'codeC', hold: 600 },
                        { face: 'wide', arms: 'up', legs: 'stand', dy: -2, screen: 'codeA', hold: 320 },
                    ],
                },
            ],
        },

        /*
           Mit Subagenten: Clawd dirigiert, zwei kleine Figuren arbeiten mit.
           Der Zustand kommt aus den Daten, nicht aus der Laune: er gilt,
           solange der Verbrauch der letzten Minuten ueberwiegend aus
           Subagenten stammt.
        */
        conducting: {
            runs: [
                {
                    weight: 10,
                    frames: [
                        { face: 'open', arms: 'up', legs: 'stand', prop: 'helpers', dy: -1, screen: 'busyA', hold: 260 },
                        { face: 'open', arms: 'out', legs: 'stand', prop: 'helpersUp', dy: 0, screen: 'busyB', hold: 260 },
                        { face: 'open', arms: 'cheer', legs: 'stand', prop: 'helpers', dy: -1, screen: 'busyA', hold: 260 },
                        { face: 'blink', arms: 'out', legs: 'stand', prop: 'helpersUp', dy: 0, screen: 'busyB', hold: 220 },
                    ],
                },
                {
                    // Die Kleinen huepfen im Takt mit.
                    weight: 5,
                    frames: [
                        { face: 'focused', arms: 'up', legs: 'stand', prop: 'helpersUp', dy: -1, screen: 'busyA', hold: 180 },
                        { face: 'focused', arms: 'out', legs: 'stand', prop: 'helpers', dy: 0, screen: 'busyB', hold: 180 },
                        { face: 'open', arms: 'up', legs: 'stand', prop: 'helpersUp', dy: -2, screen: 'busyA', hold: 180 },
                        { face: 'focused', arms: 'out', legs: 'stand', prop: 'helpers', dy: 0, screen: 'busyB', hold: 180 },
                    ],
                },
                {
                    // Kurz zusehen, wie die anderen arbeiten.
                    weight: 3,
                    frames: [
                        { face: 'lookLeft', arms: 'down', legs: 'stand', prop: 'helpers', dy: 0, screen: 'codeA', hold: 700 },
                        { face: 'lookRight', arms: 'down', legs: 'stand', prop: 'helpersUp', dy: 0, screen: 'codeB', hold: 700 },
                        { face: 'happy', arms: 'up', legs: 'stand', prop: 'helpers', dy: -2, screen: 'busyA', hold: 400 },
                    ],
                },
            ],
        },

        sprinting: {
            runs: [
                {
                    weight: 12,
                    frames: [
                        { face: 'wide', arms: 'up', legs: 'run', dy: -2, screen: 'busyA', hold: 95 },
                        { face: 'wide', arms: 'out', legs: 'stepA', dy: 0, screen: 'busyB', hold: 95 },
                        { face: 'wide', arms: 'up', legs: 'run', dy: -3, screen: 'busyA', hold: 95 },
                        { face: 'open', arms: 'out', legs: 'stepB', dy: 0, screen: 'busyB', hold: 95 },
                    ],
                },
                {
                    // Ins Schwitzen kommen.
                    weight: 4,
                    frames: [
                        { face: 'wide', arms: 'up', legs: 'run', prop: 'sweat', dx: -1, dy: -2, screen: 'busyA', hold: 110 },
                        { face: 'wide', arms: 'out', legs: 'run', prop: 'sweatDrip', dx: 1, dy: -1, screen: 'busyB', hold: 110 },
                        { face: 'squint', arms: 'up', legs: 'run', prop: 'sweat', dx: 0, dy: -3, screen: 'busyA', hold: 110 },
                    ],
                },
            ],
        },

        strained: {
            runs: [
                {
                    weight: 12,
                    frames: [
                        { face: 'worried', arms: 'out', legs: 'stand', prop: 'sweat', dx: -1, dy: 0, screen: 'warn', hold: 260 },
                        { face: 'worried', arms: 'out', legs: 'stand', prop: 'sweat', dx: 1, dy: 0, screen: 'warn', hold: 260 },
                        { face: 'wide', arms: 'up', legs: 'stand', prop: 'sweatDrip', dx: 0, dy: -1, screen: 'off', hold: 200 },
                        { face: 'worried', arms: 'out', legs: 'stand', prop: 'sweat', dx: 1, dy: 0, screen: 'warn', hold: 260 },
                    ],
                },
                {
                    // Kurz sammeln.
                    weight: 3,
                    frames: [
                        { face: 'squint', arms: 'tucked', legs: 'stand', dy: 1, screen: 'warn', hold: 800 },
                        { face: 'tired', arms: 'tucked', legs: 'stand', dy: 2, screen: 'warn', hold: 900 },
                        { face: 'worried', arms: 'out', legs: 'stand', prop: 'sweat', dy: 0, screen: 'warn', hold: 500 },
                    ],
                },
            ],
        },

        spent: {
            runs: [
                {
                    weight: 12,
                    frames: [
                        { face: 'tired', arms: 'tucked', legs: 'splay', dy: 4, screen: 'alarm', hold: 800 },
                        { face: 'tired', arms: 'tucked', legs: 'splay', dy: 4, screen: 'off', hold: 600 },
                        { face: 'squint', arms: 'tucked', legs: 'splay', dy: 5, screen: 'alarm', hold: 800 },
                    ],
                },
                {
                    // Sterne sehen.
                    weight: 4,
                    frames: [
                        { face: 'dizzy', arms: 'tucked', legs: 'splay', dx: -1, dy: 4, screen: 'alarm', hold: 420 },
                        { face: 'dizzy', arms: 'tucked', legs: 'splay', dx: 1, dy: 5, screen: 'off', hold: 420 },
                        { face: 'dizzy', arms: 'tucked', legs: 'splay', dx: 0, dy: 4, screen: 'alarm', hold: 420 },
                        { face: 'tired', arms: 'tucked', legs: 'splay', dx: 0, dy: 5, screen: 'off', hold: 900 },
                    ],
                },
                {
                    // Ein Auge riskieren.
                    weight: 3,
                    frames: [
                        { face: 'squint', arms: 'tucked', legs: 'splay', dy: 5, screen: 'off', hold: 1100 },
                        { face: 'worried', arms: 'tucked', legs: 'splay', dy: 4, screen: 'alarm', hold: 700 },
                        { face: 'tired', arms: 'tucked', legs: 'splay', dy: 5, screen: 'off', hold: 1300 },
                    ],
                },
            ],
        },

        fresh: {
            runs: [
                {
                    // Huepfen mit Partyhut.
                    weight: 3,
                    frames: [
                        { face: 'happy', arms: 'cheer', legs: 'run', prop: 'hat', dy: -2, screen: 'done', hold: 170 },
                        { face: 'happy', arms: 'up', legs: 'stand', prop: 'hat', dy: 0, screen: 'done', hold: 170 },
                        { face: 'happy', arms: 'cheer', legs: 'run', prop: 'hat', dy: -1, screen: 'done', hold: 170 },
                        { face: 'wide', arms: 'out', legs: 'stand', prop: 'hat', dy: 0, screen: 'done', hold: 210 },
                    ],
                },
                {
                    // Ein Herz, wie auf dem Aufkleber.
                    weight: 2,
                    frames: [
                        { face: 'happy', arms: 'up', legs: 'stand', prop: 'heart', dy: -2, screen: 'done', hold: 260 },
                        { face: 'wink', arms: 'cheer', legs: 'run', prop: 'heart', dy: -4, screen: 'done', hold: 260 },
                        { face: 'happy', arms: 'out', legs: 'stand', prop: 'heart', dy: 0, screen: 'done', hold: 300 },
                    ],
                },
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

    function buildClawd(frame) {
        var grid = blank(CW, CH);
        var dy = frame.dy || 0;
        var dx = frame.dx || 0;

        overlay(grid, ARMS[frame.arms] || ARMS.down, dx, dy + 6);
        overlay(grid, BODY, dx, dy + 4);
        overlay(grid, LEGS[frame.legs] || LEGS.stand, dx, dy + 16);
        overlay(grid, FACES[frame.face] || FACES.open, dx, dy + 6);

        /*
           Zwei Sorten Aufsaetze.

           Getragene wandern mit der Figur: Sonnenbrille, Kopfhoerer, Hut,
           Schweiss. Schwebende bleiben stehen, wo sie sind: Herz, Gluehbirne,
           Fragezeichen, Zzz, Dampf, der Becher am Boden und die kleinen
           Helfer. Ohne diese Trennung rutscht beim Huepfen alles mit nach
           oben aus dem Bild; ueber dem Kopf sind nur vier Zeilen Platz, und
           Hut wie Herz waren prompt abgeschnitten. Getragenes wird zusaetzlich
           am oberen Rand festgehalten, damit es nicht verschwindet.
        */
        var prop = frame.prop && PROPS[frame.prop];
        if (prop) {
            var px = prop.fixed ? prop.x : prop.x + dx;
            var py = prop.fixed ? prop.y : Math.max(0, prop.y + dy);
            overlay(grid, prop.map, px, py);
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

    /** Waehlt einen Ablauf nach Gewicht. */
    function pickRun(runs) {
        var total = 0;
        for (var i = 0; i < runs.length; i++) {
            total += runs[i].weight || 1;
        }
        var pick = Math.random() * total;
        for (var j = 0; j < runs.length; j++) {
            pick -= runs[j].weight || 1;
            if (pick <= 0) {
                return runs[j];
            }
        }
        return runs[0];
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
        var run = pickRun(STATES.idle.runs);
        var frameIndex = 0;
        var timer = null;
        var celebrateTimer = null;
        var lastScreen = null;
        var reduced = window.matchMedia
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        function drawFrame() {
            if (frameIndex >= run.frames.length) {
                // Ablauf zu Ende, der naechste wird gewuerfelt.
                run = pickRun((STATES[state] || STATES.idle).runs);
                frameIndex = 0;
            }
            var frame = run.frames[frameIndex];

            figure.innerHTML = svg(buildClawd(frame), CW, CH, 'px-clawd');
            var screen = frame.screen || 'off';
            if (screen !== lastScreen) {
                pc.innerHTML = svg(buildPc(screen), PW, PH, 'px-pc');
                lastScreen = screen;
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
            run = pickRun(STATES[next].runs);
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

    /*
       Die Pixelkarten liegen offen, damit App- und Tray-Symbol aus derselben
       Quelle entstehen wie die Anzeige. Vorher zeichnete der Icon-Erzeuger
       eine eigene, runde Figur, und die beiden liefen auseinander.
    */
    window.ClaudeCreature = {
        create: create,
        STATES: STATE_NAMES,
        sprite: {
            width: CW,
            height: CH,
            build: buildClawd,
            faces: Object.keys(FACES),
            props: Object.keys(PROPS),
        },
    };
}());
