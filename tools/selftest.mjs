#!/usr/bin/env node
/**
 * Selftest fuer Scanner und Auswertung.
 *
 *   npm run selftest
 *
 * Prueft zuerst gegen erfundene Logdateien in einem temporaeren Verzeichnis,
 * inklusive der Faelle, die in der Praxis wehtun: kaputte JSON-Zeile,
 * angeschnittene letzte Zeile, Datei wird kleiner, leeres Verzeichnis, zu
 * wenige Fenster fuer eine Kalibrierung. Danach laeuft einmal ueber die echten
 * Logs, nur lesend, mit Plausibilitaetsgrenzen.
 */

import { mkdtemp, mkdir, writeFile, appendFile, rm, truncate } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Scanner, DEFAULT_ROOT, parseLine } from '../lib/scan.mjs';
import { parseReport, deriveBudget, buildSync, fitBudget, mergePoints } from '../lib/report.mjs';
import { parseResetText, limitKind, dedupeLimits, summarizeLimits } from '../lib/limits.mjs';
import { parseStatus } from '../lib/git.mjs';
import {
    byKind, cacheReuse, byDay, heatmap, topSessions, estimateCost, priceFor,
} from '../lib/insights.mjs';
import {
    aggregate, buildWindows, computePace, percentile, median,
    describeModel, describeProject, characterState, severity, WINDOW_MS, COUNT_VERSION,
    rollForward, floorTen, WEEK_MS,
} from '../lib/aggregate.mjs';
import { normalizeConfig, Config } from '../lib/config.mjs';

let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
    if (ok) {
        passed++;
        console.log('  ok    ' + name);
        return;
    }
    failed++;
    console.log('  FEHLT ' + name + (detail ? '  (' + detail + ')' : ''));
}

function near(a, b, tolerance = 1e-6) {
    return Math.abs(a - b) <= tolerance;
}

/** Baut eine Assistant-Logzeile wie Claude Code sie schreibt. */
function line(ts, model, usage, extra = {}) {
    const { message: messageExtra, ...rest } = extra;
    return JSON.stringify({
        type: 'assistant',
        timestamp: new Date(ts).toISOString(),
        message: { model, usage, ...messageExtra },
        ...rest,
    });
}

/**
 * Eine Antwort so, wie Claude Code sie wirklich schreibt: eine Zeile je
 * Inhaltsblock, alle mit derselben id und denselben Cache-Zahlen, die
 * endgueltigen Antworttokens erst in der abgeschlossenen Zeile.
 */
function blocks(ts, model, id, { input, output, cc, cr }) {
    return [
        line(ts, model, USAGE(input, 2, cc, cr), { message: { id } }),
        line(ts + 400, model, USAGE(input, 2, cc, cr), { message: { id } }),
        line(ts + 900, model, USAGE(input, output, cc, cr),
            { message: { id, stop_reason: 'end_turn' } }),
    ];
}

const USAGE = (input, output, cc, cr, thinking = 0) => ({
    input_tokens: input,
    output_tokens: output,
    cache_creation_input_tokens: cc,
    cache_read_input_tokens: cr,
    output_tokens_details: { thinking_tokens: thinking },
});

const HOUR = 60 * 60 * 1000;

/* ------------------------------------------------------------------ *
 * Reine Rechnungen
 * ------------------------------------------------------------------ */

function testMath() {
    console.log('\nRechnen');

    check('percentile bei einem Wert', percentile([42], 0.9) === 42);
    check('percentile interpoliert', near(percentile([0, 10], 0.5), 5));
    check('percentile p90 von 1..10', near(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9), 9.1));
    check('percentile bei leer', percentile([], 0.9) === 0);
    check('median', near(median([3, 1, 2]), 2));

    const msgs = [
        { ts: 0, effort: 10, cacheRead: 0 },
        { ts: HOUR, effort: 20, cacheRead: 0 },
        // Genau an der Fenstergrenze: muss ein neues Fenster eroeffnen.
        { ts: 5 * HOUR, effort: 5, cacheRead: 0 },
        { ts: 12 * HOUR, effort: 7, cacheRead: 0 },
    ];
    const windows = buildWindows(msgs);
    check('drei Fenster erkannt', windows.length === 3, 'waren ' + windows.length);
    check('erstes Fenster summiert', windows[0].effort === 30);
    check('Fenstergrenze bei genau 5h schneidet', windows[1].start === 5 * HOUR);
    check('Pause eroeffnet Fenster', windows[2].start === 12 * HOUR);
    check('leere Eingabe gibt keine Fenster', buildWindows([]).length === 0);

    const pace = computePace(50, 0, WINDOW_MS / 2);
    check('Soll-Marke bei halber Zeit ist 50', near(pace.expected, 50));
    check('im Plan heisst delta 0', near(pace.delta, 0));
    check('reicht bis Reset', pace.willLast === true);

    const hot = computePace(80, 0, WINDOW_MS / 2);
    check('zu schnell wird erkannt', hot.willLast === false);
    check('Restzeit wird geschaetzt', hot.etaMs !== null && hot.etaMs > 0);

    check('Warnstufe ok', severity(40, computePace(40, 0, WINDOW_MS / 2)) === 'ok');
    check('Warnstufe warn ab 75', severity(80, null) === 'warn');
    check('Warnstufe crit ab 92', severity(95, null) === 'crit');
    check('ohne Prozente keine Warnstufe', severity(null, null) === 'none');

    check('Figur schlaeft nach 20 min',
        characterState({ percent: 10, sinceLastMs: 30 * 60 * 1000, rate: 0, medianRate: 5 }) === 'sleeping');
    check('Figur wartet',
        characterState({ percent: 10, sinceLastMs: 5 * 60 * 1000, rate: 0, medianRate: 5 }) === 'idle');
    check('Figur arbeitet',
        characterState({ percent: 10, sinceLastMs: 10 * 1000, rate: 5, medianRate: 5 }) === 'working');
    check('Figur sprintet bei doppeltem Tempo',
        characterState({ percent: 10, sinceLastMs: 10 * 1000, rate: 20, medianRate: 5 }) === 'sprinting');
    check('Anstrengung schlaegt Sprint',
        characterState({ percent: 80, sinceLastMs: 10 * 1000, rate: 20, medianRate: 5 }) === 'strained');
    check('platt schlaegt alles',
        characterState({ percent: 95, sinceLastMs: 10 * 1000, rate: 20, medianRate: 5 }) === 'spent');
    check('ohne Prozente kein platt',
        characterState({ percent: null, sinceLastMs: 10 * 1000, rate: 1, medianRate: 5 }) === 'working');

    // Ohne Betrieb keine Anstrengung: die Haltung zeigt, was laeuft, nicht wie
    // voll das Fenster ist.
    check('volles Fenster ohne Betrieb wartet',
        characterState({ percent: 86, sinceLastMs: 5 * 60 * 1000, rate: 0, medianRate: 5 }) === 'idle');
    check('volles Fenster ohne Betrieb schlaeft nach einer Weile',
        characterState({ percent: 86, sinceLastMs: 40 * 60 * 1000, rate: 0, medianRate: 5 }) === 'sleeping');
    check('am Anschlag liegt Clawd auch ohne Betrieb platt',
        characterState({ percent: 95, sinceLastMs: 40 * 60 * 1000, rate: 0, medianRate: 5 }) === 'spent');
    check('mit Subagenten dirigiert Clawd',
        characterState({ percent: 30, sinceLastMs: 10 * 1000, rate: 5, medianRate: 5, subagentShare: 0.8 }) === 'conducting');
    check('wenig Subagenten bleibt Arbeiten',
        characterState({ percent: 30, sinceLastMs: 10 * 1000, rate: 5, medianRate: 5, subagentShare: 0.2 }) === 'working');
    check('Anstrengung schlaegt den Dirigenten',
        characterState({ percent: 80, sinceLastMs: 10 * 1000, rate: 5, medianRate: 5, subagentShare: 0.9 }) === 'strained');
    check('ohne Betrieb kein Dirigent',
        characterState({ percent: 30, sinceLastMs: 30 * 60 * 1000, rate: 0, medianRate: 5, subagentShare: 0.9 }) === 'sleeping');

    check('angestrengt nur waehrend etwas laeuft',
        characterState({ percent: 86, sinceLastMs: 10 * 1000, rate: 5, medianRate: 5 }) === 'strained');

    check('Modell Opus 5', describeModel('claude-opus-5').label === 'Opus 5');
    check('Modell Opus 5.5 wird nicht zu Opus 5',
        describeModel('claude-opus-5-5').label === 'Opus 5.5');
    check('Opus 5 und Opus 5.5 haben verschiedene Farben',
        describeModel('claude-opus-5').color !== describeModel('claude-opus-5-5').color);
    check('Modell Fable', describeModel('claude-fable-5-1').label === 'Fable 5.1');
    check('Modell synthetic', describeModel('<synthetic>').label === 'intern');
    check('unbekanntes Modell bekommt Farbe',
        /^#[0-9a-f]{6}$/.test(describeModel('claude-neu-9').color));
    check('unbekanntes Modell stabil benannt',
        describeModel('claude-neu-9').label === describeModel('claude-neu-9').label);

    check('Projektname aus cwd',
        describeProject('X--irgendwas', 'C:/Users/p/Documents/GitHub/beispiel-app') === 'beispiel-app');
    check('Worktree erkannt',
        describeProject('X', 'C:/GitHub/Claude TV/.claude/worktrees/abc') === 'Claude TV (Worktree)');
    check('Projektname ohne cwd faellt zurueck',
        describeProject('C--Users-phili-Documents-GitHub-Spam-Cleaner', null) === 'Spam Cleaner');
}

/* ------------------------------------------------------------------ *
 * Scanner gegen erfundene Dateien
 * ------------------------------------------------------------------ */

async function testScanner() {
    console.log('\nScanner');
    const root = await mkdtemp(join(tmpdir(), 'claude-tv-test-'));

    // Leeres Verzeichnis
    const empty = new Scanner({ root });
    const none = await empty.refresh();
    check('leeres Verzeichnis liefert nichts', none.length === 0 && empty.messages.length === 0);
    const emptySnapshot = aggregate({ messages: [], now: Date.now() });
    check('Auswertung ohne Daten stuerzt nicht ab',
        emptySnapshot.totals.effort === 0 && emptySnapshot.window.active === false);
    check('ohne Daten schlaeft die Figur', emptySnapshot.character.state === 'sleeping');
    check('ohne Daten keine Prozente', emptySnapshot.window.percent === null);
    check('ohne Daten Kalibrierung unzureichend',
        emptySnapshot.calibration.basis === 'insufficient');

    const project = join(root, 'C--Users-test-Projekt-Eins');
    await mkdir(join(project, 'sitzung', 'subagents'), { recursive: true });

    const base = Date.now() - 3 * HOUR;
    const main = join(project, 'sitzung.jsonl');
    await writeFile(main, [
        JSON.stringify({ type: 'user', cwd: 'C:/Users/test/Projekt Eins', message: {} }),
        line(base, 'claude-opus-5', USAGE(10, 20, 30, 1000, 5)),
        'das ist kein JSON',
        JSON.stringify({ type: 'assistant', message: { model: 'x' } }),
        line(base + 60000, 'claude-opus-5', USAGE(1, 2, 3, 4)),
    ].join('\n') + '\n', 'utf8');

    const sub = join(project, 'sitzung', 'subagents', 'agent-1.jsonl');
    await writeFile(sub, line(base + 120000, 'claude-fable-5-1', USAGE(5, 5, 5, 50)) + '\n', 'utf8');

    const scanner = new Scanner({ root });
    const first = await scanner.refresh();
    check('drei gute Nachrichten gelesen', first.length === 3, 'waren ' + first.length);
    check('kaputte Zeile uebersprungen', scanner.messages.length === 3);
    check('Aufwand ohne Cache-Lesen',
        scanner.messages[0].effort === 60, 'war ' + scanner.messages[0].effort);
    check('Cache-Lesen getrennt gefuehrt', scanner.messages[0].cacheRead === 1000);
    check('Thinking uebernommen', scanner.messages[0].thinking === 5);
    check('Subagent mitgezaehlt',
        scanner.messages.some((m) => m.kind === 'subagent'));
    check('cwd aus dem Log gemerkt',
        scanner.cwdBySession.get('sitzung') === 'C:/Users/test/Projekt Eins');
    check('nach Zeit sortiert',
        scanner.messages.every((m, i, a) => i === 0 || a[i - 1].ts <= m.ts));

    // Zweiter Durchgang ohne Aenderung darf nichts doppelt liefern
    const again = await scanner.refresh();
    check('unveraenderte Dateien liefern nichts', again.length === 0);
    check('keine Doppelzaehlung', scanner.messages.length === 3);

    // Angeschnittene letzte Zeile: erst ohne Zeilenumbruch anhaengen
    const half = line(base + 180000, 'claude-opus-5', USAGE(7, 7, 7, 7));
    await appendFile(main, half.slice(0, 40), 'utf8');
    const partial = await scanner.refresh();
    check('angeschnittene Zeile wird noch nicht gezaehlt', partial.length === 0);
    await appendFile(main, half.slice(40) + '\n', 'utf8');
    const completed = await scanner.refresh();
    check('vervollstaendigte Zeile wird gezaehlt', completed.length === 1, 'waren ' + completed.length);
    check('Puffer hat die Zeile nicht zerstoert',
        completed.length === 1 && completed[0].effort === 21);

    // Datei wird kleiner: kompletter Neueinlesevorgang
    await truncate(main, 0);
    await writeFile(main, line(base + 240000, 'claude-opus-5', USAGE(2, 2, 2, 2)) + '\n', 'utf8');
    await scanner.refresh();
    const fromMain = scanner.messages.filter((m) => m.session === 'sitzung' && m.kind === 'main');
    check('gekuerzte Datei wird neu eingelesen',
        fromMain.length === 1 && fromMain[0].effort === 6,
        'waren ' + fromMain.length + ' Nachrichten');

    // Neue Datei im Nachgang
    await writeFile(join(project, 'zweite.jsonl'),
        line(base + 300000, 'claude-sonnet-5', USAGE(1, 1, 1, 1)) + '\n', 'utf8');
    const discovered = await scanner.refresh();
    check('neu angelegte Datei wird gefunden', discovered.length === 1);

    // Eine Antwort in drei Bloecken darf einmal zaehlen, nicht dreimal.
    const dupRoot = await mkdtemp(join(tmpdir(), 'claude-tv-dup-'));
    await mkdir(join(dupRoot, 'P'), { recursive: true });
    await writeFile(join(dupRoot, 'P', 'sitzung.jsonl'),
        blocks(base, 'claude-opus-5', 'msg_1', { input: 10, output: 900, cc: 5000, cr: 100 })
            .concat(blocks(base + 60000, 'claude-opus-5', 'msg_2',
                { input: 10, output: 50, cc: 200, cr: 100 }))
            .join('\n') + '\n', 'utf8');
    const dupScanner = new Scanner({ root: dupRoot });
    const dupFirst = await dupScanner.refresh();
    check('drei Bloecke ergeben eine Nachricht', dupScanner.messages.length === 2,
        'waren ' + dupScanner.messages.length);
    check('nur neue Antworten gelten als frisch', dupFirst.length === 2,
        'waren ' + dupFirst.length);
    check('Verbrauch aus der abgeschlossenen Zeile',
        dupScanner.messages[0].effort === 10 + 900 + 5000,
        'war ' + dupScanner.messages[0].effort);
    check('Cache-Lesen nicht vervielfacht', dupScanner.messages[0].cacheRead === 100);
    const dupAgain = await dupScanner.refresh();
    check('zweiter Durchgang zaehlt nichts nach',
        dupAgain.length === 0 && dupScanner.messages.length === 2);

    // Nachgereichte Zwischenzeile darf die vollstaendige nicht verdraengen.
    await appendFile(join(dupRoot, 'P', 'sitzung.jsonl'),
        line(base + 100, 'claude-opus-5', USAGE(10, 2, 5000, 100), { message: { id: 'msg_1' } })
        + '\n', 'utf8');
    await dupScanner.refresh();
    check('Zwischenzeile ueberschreibt die vollstaendige nicht',
        dupScanner.messages.find((m) => m.id === 'msg_1').effort === 10 + 900 + 5000);
    await rm(dupRoot, { recursive: true, force: true });

    // Ueberlappende Durchgaenge. Beim ersten Scan eines grossen Bestands
    // dauert ein Durchgang laenger als der Abstand des Polls, dann ruft der
    // Hauptprozess erneut an, waehrend der erste noch laeuft.
    const parallel = new Scanner({ root });
    const runs = await Promise.all([
        parallel.refresh(), parallel.refresh(), parallel.refresh(),
    ]);
    check('gleichzeitige Durchgaenge werden zusammengefasst',
        runs[0] === runs[1] && runs[1] === runs[2]);
    check('gleichzeitige Durchgaenge zaehlen nicht doppelt',
        parallel.messages.length === 3, 'waren ' + parallel.messages.length);
    check('nach dem Durchgang ist die Sperre wieder offen',
        parallel.pending === null && (await parallel.refresh()).length === 0);

    check('parseLine ignoriert Zeile ohne usage',
        parseLine(JSON.stringify({ type: 'assistant', message: {} }), {}) === null);
    check('parseLine ignoriert leere Zeile', parseLine('', {}) === null);
    check('parseLine ignoriert kaputten Zeitstempel', parseLine(JSON.stringify({
        type: 'assistant',
        timestamp: 'kaputt',
        message: { model: 'm', usage: USAGE(1, 1, 1, 1) },
    }), {}) === null);
    check('parseLine ignoriert fehlenden Zeitstempel', parseLine(JSON.stringify({
        type: 'assistant',
        message: { model: 'm', usage: USAGE(1, 1, 1, 1) },
    }), {}) === null);
    check('parseLine haelt Text als Tokenzahl aus', (() => {
        const parsed = parseLine(JSON.stringify({
            type: 'assistant',
            timestamp: new Date().toISOString(),
            message: { model: 'm', usage: { input_tokens: 'viel', output_tokens: 5 } },
        }), { project: 'p', session: 's', kind: 'main' });
        return parsed !== null && parsed.effort === 5;
    })());

    await rm(root, { recursive: true, force: true });
    return root;
}

/* ------------------------------------------------------------------ *
 * Kalibrierung
 * ------------------------------------------------------------------ */

function testCalibration() {
    console.log('\nKalibrierung');
    const now = Date.now();

    // Zwei abgeschlossene Fenster: noch keine Prozente.
    const few = [
        { ts: now - 40 * HOUR, effort: 100, cacheRead: 0, thinking: 0, model: 'm', project: 'p', session: 's', kind: 'main' },
        { ts: now - 20 * HOUR, effort: 200, cacheRead: 0, thinking: 0, model: 'm', project: 'p', session: 's', kind: 'main' },
    ];
    const shy = aggregate({ messages: few, now });
    check('zwei Fenster reichen nicht', shy.calibration.basis === 'insufficient');
    check('ohne Kalibrierung keine Prozente', shy.window.percent === null);
    check('abgeschlossene Fenster gezaehlt', shy.calibration.completedWindows === 2,
        'waren ' + shy.calibration.completedWindows);

    // Vier abgeschlossene Fenster plus ein laufendes.
    const many = [];
    for (let i = 5; i >= 2; i--) {
        many.push({
            ts: now - i * 6 * HOUR, effort: 1000 * i, cacheRead: 0, thinking: 0,
            model: 'claude-opus-5', project: 'p', session: 's', kind: 'main',
        });
    }
    many.push({
        ts: now - 30 * 60 * 1000, effort: 2500, cacheRead: 500, thinking: 0,
        model: 'claude-opus-5', project: 'p', session: 's', kind: 'main',
    });
    const rich = aggregate({ messages: many, now });
    check('vier Fenster kalibrieren', rich.calibration.basis === 'p90');
    check('Budget aus p90 gesetzt', rich.calibration.windowBudget > 0);
    check('laufendes Fenster erkannt', rich.window.active === true);
    check('Prozente vorhanden', rich.window.percent !== null && rich.window.percent > 0);
    check('Reset liegt in der Zukunft', rich.window.resetAt > now);
    check('Soll-Marke berechnet', rich.window.pace !== null);
    check('Serie hat 30 Eimer', rich.window.series.length === 30);
    // Zwei Kennungen derselben Familie gehoeren in eine Zeile.
    const zweiKennungen = aggregate({
        messages: [
            { ts: now - 2 * HOUR, model: 'claude-haiku-4-5', effort: 100, cacheRead: 0, input: 0, output: 0, cacheCreate: 0, thinking: 0, project: 'p', session: 's', kind: 'main' },
            { ts: now - HOUR, model: 'claude-haiku-4-5-20251001', effort: 300, cacheRead: 0, input: 0, output: 0, cacheCreate: 0, thinking: 0, project: 'p', session: 's', kind: 'main' },
        ],
        now,
    });
    check('gleiche Beschriftung steht einmal in der Liste',
        zweiKennungen.models.length === 1 && zweiKennungen.models[0].effort === 400,
        'waren ' + zweiKennungen.models.length + ' Zeilen');
    check('zusammengefasste Zeile merkt sich beide Kennungen',
        zweiKennungen.models[0].ids.length === 2);

    check('Modelle aufgelistet', rich.models.length === 1 && rich.models[0].label === 'Opus 5');
    check('Modellanteil summiert auf 1',
        near(rich.models.reduce((s, m) => s + m.share, 0), 1, 1e-9));
    check('Tagesverlauf hat 24 Eimer', rich.today.buckets.length === 24);

    // Budget aus der Konfiguration schlaegt die Kalibrierung.
    const forced = aggregate({ messages: many, now, config: { budgets: { windowEffort: 5000 } } });
    check('Budget aus Konfiguration gewinnt', forced.calibration.basis === 'config');
    check('Prozente folgen dem Budget',
        near(forced.window.percent, (forced.window.effort / 5000) * 100, 1e-9));

    // Prozente sind bei 100 gedeckelt.
    const over = aggregate({ messages: many, now, config: { budgets: { windowEffort: 1 } } });
    check('Prozente bei 100 gedeckelt', over.window.percent === 100);
    check('gedeckelt heisst crit', over.window.severity === 'crit');

    // Festgehaltene Kalibrierung: einen Tag stabil, danach neu.
    check('neu gerechnete Kalibrierung wird gemeldet',
        rich.calibration.fresh !== null && rich.calibration.fresh.windowEffort > 0);

    const pinnedValue = 999000;
    const withPin = aggregate({
        messages: many,
        now,
        pinned: { windowEffort: pinnedValue, computedAt: now - 2 * HOUR, basisWindows: 4, countVersion: 2 },
    });
    check('frischer Anschlag wird genutzt', withPin.calibration.windowBudget === pinnedValue);
    check('genutzter Anschlag gilt als p90', withPin.calibration.basis === 'p90');
    check('genutzter Anschlag wird nicht neu gerechnet', withPin.calibration.fresh === null);

    const stalePin = aggregate({
        messages: many,
        now,
        pinned: { windowEffort: pinnedValue, computedAt: now - 30 * HOUR, basisWindows: 4, countVersion: 2 },
    });
    check('alter Anschlag wird verworfen', stalePin.calibration.windowBudget !== pinnedValue);
    check('alter Anschlag loest Neuberechnung aus', stalePin.calibration.fresh !== null);

    // Ein Anschlag, der aus einem halben Scan stammt, kennt zu wenige Fenster.
    // Er darf die Skala nicht einen Tag lang verbiegen.
    const halfScanPin = aggregate({
        messages: many,
        now,
        pinned: { windowEffort: pinnedValue, computedAt: now - HOUR, basisWindows: 1, countVersion: 2 },
    });
    check('Anschlag aus halbem Scan wird verworfen',
        halfScanPin.calibration.windowBudget !== pinnedValue);
    check('halber Scan loest Neuberechnung aus', halfScanPin.calibration.fresh !== null);
    check('Neuberechnung merkt sich die Zahl der Fenster',
        halfScanPin.calibration.fresh.basisWindows === halfScanPin.calibration.completedWindows);

    const pinOldCounting = aggregate({
        messages: many,
        now,
        pinned: {
            windowEffort: pinnedValue, computedAt: now - HOUR,
            basisWindows: 4, countVersion: 1,
        },
    });
    check('Anschlag aus alter Zaehlweise wird verworfen',
        pinOldCounting.calibration.windowBudget !== pinnedValue
        && pinOldCounting.calibration.fresh !== null);
    check('Neuberechnung vermerkt die Zaehlweise',
        pinOldCounting.calibration.fresh.countVersion === COUNT_VERSION);

    const pinWithoutOrigin = aggregate({
        messages: many,
        now,
        pinned: { windowEffort: pinnedValue, computedAt: now - HOUR },
    });
    check('Anschlag ohne vermerkte Herkunft wird neu gerechnet',
        pinWithoutOrigin.calibration.windowBudget !== pinnedValue
        && pinWithoutOrigin.calibration.fresh !== null);

    const matchingPin = aggregate({
        messages: many,
        now,
        pinned: { windowEffort: pinnedValue, computedAt: now - HOUR, basisWindows: 4, countVersion: 2 },
    });
    check('Anschlag mit passendem Bestand bleibt',
        matchingPin.calibration.windowBudget === pinnedValue);

    const userWins = aggregate({
        messages: many,
        now,
        config: { budgets: { windowEffort: 500000 } },
        pinned: { windowEffort: pinnedValue, computedAt: now, basisWindows: 4, countVersion: 2 },
    });
    check('eigenes Budget schlaegt den Anschlag',
        userWins.calibration.windowBudget === 500000 && userWins.calibration.basis === 'config');

    // Warnschwelle mit Toleranz: knapp ueber Plan faerbt noch nicht.
    const slightlyOver = computePace(42, now - 2 * HOUR, now);
    check('knapp ueber Plan bleibt ruhig', severity(42, slightlyOver) === 'ok',
        'projiziert ' + (42 / (slightlyOver.expected / 100)).toFixed(0));
    const clearlyOver = computePace(60, now - 2 * HOUR, now);
    check('deutlich ueber Plan warnt', severity(60, clearlyOver) === 'warn');
}

/* ------------------------------------------------------------------ *
 * Konfiguration
 * ------------------------------------------------------------------ */

async function testConfig() {
    console.log('\nKonfiguration');
    check('Vorgabe ist nach System', normalizeConfig(null).theme === 'system');
    check('unbekanntes Theme wird System', normalizeConfig({ theme: 'lila' }).theme === 'system');
    check('dunkel bleibt dunkel', normalizeConfig({ theme: 'dark' }).theme === 'dark');
    check('hell bleibt hell', normalizeConfig({ theme: 'light' }).theme === 'light');
    check('system bleibt system', normalizeConfig({ theme: 'system' }).theme === 'system');
    check('Fensterbreite begrenzt', normalizeConfig({ window: { width: 5 } }).window.width === 480);
    check('Text als Budget wird null',
        normalizeConfig({ budgets: { windowEffort: 'viel' } }).budgets.windowEffort === null);
    check('negatives Budget wird null',
        normalizeConfig({ budgets: { windowEffort: -5 } }).budgets.windowEffort === null);
    check('gutes Budget bleibt',
        normalizeConfig({ budgets: { windowEffort: 1234.6 } }).budgets.windowEffort === 1235);

    const dir = await mkdtemp(join(tmpdir(), 'claude-tv-cfg-'));
    const config = new Config(join(dir, 'claude-tv.config.json'));
    await config.load();
    check('fehlende Datei ergibt Vorgaben', config.data.view === 'overview');
    await config.save({ theme: 'dark', view: 'detail' });
    const reread = new Config(join(dir, 'claude-tv.config.json'));
    await reread.load();
    check('gespeichert und wieder gelesen',
        reread.data.theme === 'dark' && reread.data.view === 'detail');
    await writeFile(join(dir, 'claude-tv.config.json'), '{kaputt', 'utf8');
    const broken = new Config(join(dir, 'claude-tv.config.json'));
    await broken.load();
    check('kaputte Datei ergibt Vorgaben', broken.data.theme === 'system');
    await rm(dir, { recursive: true, force: true });
}

/* ------------------------------------------------------------------ *
 * Echte Logs, nur lesend
 * ------------------------------------------------------------------ */

/** Gesamtgroesse der Logdateien, fuer die Durchsatzmessung. */
async function scannedMegabytes() {
    const { stat, readdir } = await import('node:fs/promises');
    const { join } = await import('node:path');
    let bytes = 0;
    async function walk(dir) {
        let entries;
        try {
            entries = await readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) {
                await walk(full);
            } else if (entry.name.endsWith('.jsonl')) {
                bytes += (await stat(full)).size;
            }
        }
    }
    await walk(DEFAULT_ROOT);
    return bytes / 1048576;
}

async function testRealLogs() {
    console.log('\nEchte Logs (nur lesend)');
    const started = Date.now();
    const scanner = new Scanner();
    await scanner.refresh();
    const took = Date.now() - started;

    if (scanner.stats().rootMissing || scanner.messages.length === 0) {
        console.log('  uebersprungen, keine Logs unter ' + DEFAULT_ROOT);
        return;
    }

    const snapshot = aggregate({
        messages: scanner.messages,
        cwdBySession: scanner.cwdBySession,
        limits: scanner.limits,
        stats: scanner.stats(),
    });

    /*
       Gemessen wird Durchsatz, nicht Dauer. Der Logbestand waechst staendig,
       bei taeglicher Nutzung um mehrere hundert Megabyte im Monat; eine feste
       Sekundenschranke schlaegt dann irgendwann an, ohne dass etwas langsamer
       geworden waere.
       Die Schwelle liegt bewusst tief. Isoliert gemessen laeuft der Scan mit
       rund 240 MB/s, waehrend eines laufenden Claude Code aber auch mal mit
       115: derselbe Datentraeger wird dann gleichzeitig beschrieben. 100 MB/s
       faengt einen echten Einbruch und schlaegt nicht bei Betrieb an.
    */
    const mb = await scannedMegabytes();
    const durchsatz = mb / (took / 1000);
    check('Durchsatz ueber 100 MB/s', durchsatz > 100,
        Math.round(durchsatz) + ' MB/s fuer ' + Math.round(mb) + ' MB in ' + took + 'ms');
    check('Nachrichten gefunden', snapshot.totals.messages > 0);
    check('Aufwand positiv', snapshot.totals.effort > 0);
    check('Aufwand kleiner als Gesamttokens',
        snapshot.totals.effort < snapshot.totals.effort + snapshot.totals.cacheRead);
    check('Prozente entweder null oder 0 bis 100',
        snapshot.window.percent === null
        || (snapshot.window.percent >= 0 && snapshot.window.percent <= 100));
    check('Modelle haben Farben',
        snapshot.models.every((m) => /^#[0-9a-f]{6}$/.test(m.color)));
    check('Projekte benannt',
        snapshot.projects.every((p) => typeof p.name === 'string' && p.name.length > 0));
    check('Figurenzustand gueltig',
        ['sleeping', 'idle', 'working', 'conducting', 'sprinting', 'strained', 'spent']
            .includes(snapshot.character.state),
        'war ' + snapshot.character.state);
    check('Fenster hat plausible Laenge',
        !snapshot.window.active
        || (snapshot.window.resetAt - snapshot.window.startedAt) === WINDOW_MS);

    const M = (n) => (n / 1e6).toFixed(1) + 'M';
    console.log('  ---');
    console.log('  Dateien ' + snapshot.source.files + ', Nachrichten ' + snapshot.totals.messages
        + ', Durchlauf ' + took + 'ms');
    console.log('  Aufwand gesamt ' + M(snapshot.totals.effort)
        + ', Cache-Lesen ' + M(snapshot.totals.cacheRead));
    console.log('  Fenster: ' + (snapshot.window.active
        ? M(snapshot.window.effort) + ' Aufwand, '
          + (snapshot.window.percent === null ? 'ohne Prozente' : snapshot.window.percent.toFixed(0) + '%')
        : 'gerade keins aktiv'));
    console.log('  Kalibrierung: ' + snapshot.calibration.basis
        + ', abgeschlossene Fenster ' + snapshot.calibration.completedWindows
        + (snapshot.calibration.windowBudget ? ', Budget ' + M(snapshot.calibration.windowBudget) : ''));
    console.log('  Woche: ' + M(snapshot.week.effort) + ' (' + snapshot.week.basis + ')');
    console.log('  Figur: ' + snapshot.character.state);
    console.log('  Modelle: ' + snapshot.models.map((m) => m.label + ' ' + M(m.effort)).join(', '));
    console.log('  Projekte: ' + snapshot.projects.slice(0, 4).map((p) => p.name).join(', '));
}


/* ------------------------------------------------------------------ *
 * Abgleich mit dem Bericht von Claude Code
 * ------------------------------------------------------------------ */

// Wortlaut wie am 09.09.2026 aus dem Kontextfenster kopiert.
const BERICHT = [
    'Claude Code usage report (2026-09-09T14:08:19.102Z)',
    'Client: Mozilla/5.0 (Windows NT 10.0; Win64; x64) Claude/1.49585.0',
    '',
    'Plan limits:',
    '- session-0: 56% (resets 2026-09-09T17:00:00.294676+00:00)',
    '- weekly_all-1: 61% (resets 2026-09-09T16:59:59.294695+00:00)',
    '- weekly_scoped-2: 0% (resets 2026-09-09T17:00:00+00:00)',
    '',
    'Session:',
    '- Opus 5: 324 in / 39.5k out / 25.2M cache read / 310.3k cache write',
    '- Cost: $12.40 | API 23m | Wall 31m',
    '',
    'Local activity: 2085 requests (24h) | 7847 (7d)',
].join('\n');

function testReport() {
    console.log('\nAbgleich');

    const report = parseReport(BERICHT);
    check('Bericht gelesen', report !== null);
    check('Zeitpunkt erkannt', report.at === Date.parse('2026-09-09T14:08:19.102Z'));
    check('Fensterlimit erkannt', report.session.percent === 56);
    check('Reset mit sechs Nachkommastellen gelesen',
        report.session.resetAt === Date.parse('2026-09-09T17:00:00.294Z'));
    check('Wochenlimit erkannt', report.weekAll.percent === 61);
    check('zweites Wochenlimit erkannt', report.weekScoped.percent === 0);
    check('Anfragen erkannt', report.requests24h === 2085 && report.requests7d === 7847);
    check('Kosten erkannt', report.costUsd === 12.4);

    check('Text ohne Limit ergibt nichts', parseReport('nur Prosa, keine Zahlen') === null);
    check('leerer Text ergibt nichts', parseReport('') === null);
    check('halber Bericht reicht',
        parseReport('- session-0: 12% (resets 2026-09-09T17:00:00Z)') !== null);

    check('Budget aus Prozent und Aufwand',
        deriveBudget(report.session, 4200000) === Math.round(4200000 / 0.56));
    check('null Prozent ergibt kein Budget', deriveBudget(report.weekScoped, 9000000) === null);
    check('winziger Prozentwert ergibt kein Budget',
        deriveBudget({ percent: 2, resetAt: 0 }, 9000000) === null);

    // Der Aufwand wird ueber den Zeitraum aus dem Bericht abgefragt, nicht
    // ueber den, den die App selbst geraten haette.
    const gefragt = [];
    const sync = buildSync(report, (from, to) => {
        gefragt.push([from, to]);
        return 4200000;
    }, { windowMs: WINDOW_MS, weekMs: WEEK_MS, countVersion: COUNT_VERSION });
    check('Fensterzeitraum ist Reset minus fuenf Stunden',
        gefragt[0][0] === report.session.resetAt - WINDOW_MS && gefragt[0][1] === report.at);
    check('Wochenzeitraum ist Reset minus sieben Tage',
        gefragt[1][0] === report.weekAll.resetAt - WEEK_MS);
    check('Abgleich traegt die Zaehlweise', sync.countVersion === COUNT_VERSION);
    check('Abgleich hat ein Fensterbudget', sync.windowBudget === Math.round(4200000 / 0.56));
    check('zweites Wochenlimit bleibt ohne Budget',
        sync.scopedPercent === 0 && sync.weekBudget !== null);
}

function testFit() {
    console.log('\nAusgleich mehrerer Abgleiche');

    // Die drei echten Messpunkte vom 09.09.2026, dasselbe Fenster.
    const echte = [
        { percent: 42, effort: 2_850_000 },
        { percent: 56, effort: 4_140_000 },
        { percent: 91, effort: 6_350_000 },
    ];
    const budget = fitBudget(echte);
    check('Ausgleich liegt zwischen den Einzelwerten',
        budget > 6_900_000 && budget < 7_200_000, 'war ' + budget);
    for (const punkt of echte) {
        const gerechnet = (punkt.effort / budget) * 100;
        check('Punkt bei ' + punkt.percent + ' % hoechstens drei Punkte daneben',
            Math.abs(gerechnet - punkt.percent) <= 3,
            'gerechnet ' + gerechnet.toFixed(1) + ' %');
    }

    // Das Alter zaehlt: ein frischer Punkt wiegt schwerer als ein alter.
    const jetztFit = Date.parse('2026-10-02T14:00:00Z');
    const gemischt = [
        { percent: 100, effort: 7_400_000, at: jetztFit - 23 * 864e5 },
        { percent: 57, effort: 6_200_000, at: jetztFit },
    ];
    const ohneAlter = fitBudget(gemischt, { halfLifeMs: 0 });
    const mitAlter = fitBudget(gemischt, { now: jetztFit });
    check('frischer Punkt zieht staerker als der alte',
        mitAlter > ohneAlter,
        'mit Alter ' + mitAlter + ', ohne ' + ohneAlter);
    check('Gewichtung bleibt zwischen den Einzelwerten',
        mitAlter > 7_400_000 && mitAlter < 10_900_000, 'war ' + mitAlter);
    check('ohne Zeitstempel zaehlt ein Punkt voll',
        fitBudget([{ percent: 50, effort: 1000 }], { now: jetztFit }) === 2000);

    check('ein einzelner Punkt ergibt genau ihn selbst',
        fitBudget([{ percent: 50, effort: 1000 }]) === 2000);
    check('winzige Prozentwerte zaehlen nicht mit',
        fitBudget([{ percent: 1, effort: 999999 }]) === null);
    check('ohne Punkte kein Budget', fitBudget([]) === null);

    // Sammlung pflegen
    const jetzt = Date.parse('2026-09-09T14:00:00Z');
    const alt = [
        { at: jetzt - 40 * 864e5, countVersion: 2, windowPercent: 50, windowEffort: 1 },
        { at: jetzt - 1 * 864e5, countVersion: 2, windowPercent: 50, windowEffort: 2 },
        { at: jetzt - 2 * 864e5, countVersion: 1, windowPercent: 50, windowEffort: 3 },
    ];
    const neu = { at: jetzt, countVersion: 2, windowPercent: 60, windowEffort: 4 };
    const zusammen = mergePoints(alt, neu, { countVersion: 2, now: jetzt });
    check('alte Punkte fliegen raus', !zusammen.some((p) => p.windowEffort === 1));
    check('andere Zaehlweise fliegt raus', !zusammen.some((p) => p.countVersion === 1));
    check('frischer Punkt bleibt', zusammen.some((p) => p.windowEffort === 2));
    check('neuer Punkt kommt dazu', zusammen[zusammen.length - 1].at === jetzt);
    check('nach Zeit sortiert',
        zusammen.every((p, i, a) => i === 0 || a[i - 1].at <= p.at));

    const doppelt = mergePoints(zusammen, { ...neu, windowEffort: 9 }, { countVersion: 2, now: jetzt });
    check('derselbe Zeitpunkt ersetzt statt zu verdoppeln',
        doppelt.filter((p) => p.at === jetzt).length === 1
        && doppelt[doppelt.length - 1].windowEffort === 9);

    // Ueber buildSync: zweiter Bericht schaerft das Budget
    const report = parseReport(BERICHT);
    const ersteRunde = buildSync(report, () => 4_140_000, {
        windowMs: WINDOW_MS, weekMs: WEEK_MS, countVersion: COUNT_VERSION,
    });
    check('erster Abgleich hat einen Punkt', ersteRunde.points.length === 1);
    const spaeter = { ...report, at: report.at + HOUR, session: { percent: 91, resetAt: report.session.resetAt } };
    const zweiteRunde = buildSync(spaeter, () => 6_350_000, {
        windowMs: WINDOW_MS, weekMs: WEEK_MS, countVersion: COUNT_VERSION,
        points: ersteRunde.points,
    });
    check('zweiter Abgleich sammelt beide Punkte', zweiteRunde.points.length === 2);
    check('Budget liegt zwischen beiden Einzelwerten',
        zweiteRunde.windowBudget > 6_900_000 && zweiteRunde.windowBudget < 7_400_000,
        'war ' + zweiteRunde.windowBudget);
}

function testAnchoredWindows() {
    console.log('\nFensterraster');

    const uhr = (h, min) => new Date(2026, 8, 9, h, min, 0, 0).getTime();
    const nachricht = (ts) => ({
        ts, effort: 100, cacheRead: 0, input: 0, output: 0, cacheCreate: 0, thinking: 0,
        model: 'claude-opus-5', project: 'p', session: 's', kind: 'main',
    });

    check('auf zehn Minuten abgerundet', floorTen(uhr(12, 52)) === uhr(12, 50));

    // Genau der gemessene Fall: erste Nachricht 12:52, echtes Fenster 14:00.
    const nachrichten = [uhr(12, 52), uhr(13, 30), uhr(14, 5), uhr(15, 29)].map(nachricht);

    const ohne = buildWindows(nachrichten);
    check('ohne Anker beginnt das Fenster bei der ersten Nachricht',
        ohne[0].start === uhr(12, 50));

    const mit = buildWindows(nachrichten, uhr(19, 0));
    check('mit Anker liegt eine Grenze um 14:00', mit.some((w) => w.start === uhr(14, 0)));
    check('Verbrauch vor der Grenze zaehlt ins vorige Fenster',
        mit.length === 2 && mit[0].start === uhr(9, 0) && mit[0].messages === 2,
        'Fenster: ' + mit.map((w) => new Date(w.start).getHours() + 'h/' + w.messages).join(' '));

    /*
       Nach einer Pause von mehr als fuenf Stunden ist das Raster hinfaellig.
       Geprueft ausserhalb des Ankerfensters: deckt der Anker die Nachricht
       ab, gilt er, und die Pause spielt keine Rolle.
    */
    const alterAnker = uhr(19, 0) - 3 * 24 * HOUR;
    const nachPause = buildWindows([
        nachricht(uhr(9, 5)),
        nachricht(uhr(16, 23)),
        nachricht(uhr(16, 40)),
    ], alterAnker);
    check('lange Pause verankert neu',
        nachPause.length === 2 && nachPause[1].start === uhr(16, 20),
        'Start war ' + new Date(nachPause[1].start).toLocaleTimeString('de-DE'));
    check('Fenster nach der Pause endet fuenf Stunden spaeter',
        nachPause[1].start + 5 * HOUR === uhr(21, 20));

    // Der belegte Anker schlaegt die Pausenregel: genau dieser Fall stand am
    // 02.10.2026 falsch, Bericht 12:30 gegen Anzeige 12:40.
    const nachNachtpause = buildWindows([
        nachricht(uhr(1, 5)),
        nachricht(uhr(12, 45)),
        nachricht(uhr(16, 38)),
    ], uhr(17, 30));
    check('Anker aus dem Bericht schlaegt die Pausenregel',
        nachNachtpause.at(-1).start === uhr(12, 30),
        'Start war ' + new Date(nachNachtpause.at(-1).start).toLocaleTimeString('de-DE'));
    check('Nachricht vor dem Ankerfenster faellt ins Raster davor',
        nachNachtpause[0].start === uhr(17, 30) - 20 * HOUR,
        'Start war ' + new Date(nachNachtpause[0].start).toLocaleString('de-DE'));

    // Ein Anker in der Vergangenheit gilt weiter, das Raster wiederholt sich.
    const spaeter = buildWindows([nachricht(uhr(20, 10))], uhr(19, 0));
    check('Raster laeuft ueber den Anker hinaus', spaeter[0].start === uhr(19, 0));

    const jetzt = uhr(20, 0);
    check('Grenze wird in die Zukunft gerollt',
        rollForward(uhr(9, 0), 5 * HOUR, jetzt) === uhr(24, 0));
    check('kuenftige Grenze bleibt stehen',
        rollForward(uhr(22, 0), 5 * HOUR, jetzt) === uhr(22, 0));
    check('ohne Grenze kommt nichts', rollForward(null, 5 * HOUR, jetzt) === null);

    // Abgleich in der Auswertung: Budget und Wochenfenster kommen daher.
    const snapshot = aggregate({
        messages: nachrichten,
        now: uhr(16, 0),
        sync: {
            at: uhr(16, 0), countVersion: COUNT_VERSION,
            windowResetAt: uhr(19, 0), windowBudget: 1000,
            weekResetAt: uhr(19, 0), weekBudget: 5000,
            scopedPercent: 0, scopedResetAt: uhr(19, 0),
        },
    });
    check('Budget aus dem Abgleich gilt',
        snapshot.calibration.basis === 'sync' && snapshot.calibration.windowBudget === 1000);
    check('laufendes Fenster beginnt um 14:00', snapshot.window.startedAt === uhr(14, 0));
    check('Reset kommt aus dem Anker', snapshot.window.resetAt === uhr(19, 0));
    check('Woche hat eine Resetzeit', snapshot.week.resetAt === uhr(19, 0));
    check('zweites Wochenlimit wird durchgereicht', snapshot.weekScoped.percent === 0);

    // Vom abgelesenen Wert weiterzaehlen statt stur zu teilen.
    const abgelesen = aggregate({
        messages: nachrichten,
        now: uhr(16, 0),
        sync: {
            at: uhr(15, 29), countVersion: COUNT_VERSION,
            windowResetAt: uhr(19, 0), windowBudget: 1000, windowPercent: 42,
        },
    });
    const seither = nachrichten.filter((m) => m.ts > uhr(15, 29))
        .reduce((a, m) => a + m.effort, 0);
    check('Anzeige beginnt beim abgelesenen Wert',
        near(abgelesen.window.percent, 42 + (seither / 1000) * 100, 1e-9),
        'war ' + abgelesen.window.percent.toFixed(2) + ' %');

    const ohneAbgleichImFenster = aggregate({
        messages: nachrichten,
        now: uhr(16, 0),
        sync: {
            at: uhr(16, 0) - 3 * 24 * HOUR, countVersion: COUNT_VERSION,
            windowResetAt: uhr(19, 0), windowBudget: 1000, windowPercent: 42,
        },
    });
    check('alter Abgleich zaehlt nicht weiter, sondern teilt',
        near(ohneAbgleichImFenster.window.percent,
            (ohneAbgleichImFenster.window.effort / 1000) * 100, 1e-9));

    const alteZaehlung = aggregate({
        messages: nachrichten,
        now: uhr(16, 0),
        sync: {
            at: uhr(16, 0), countVersion: 1,
            windowResetAt: uhr(19, 0), windowBudget: 1000,
        },
    });
    check('Budget aus alter Zaehlweise wird verworfen',
        alteZaehlung.calibration.basis !== 'sync');
    check('Anker gilt trotzdem, er haengt nicht an der Zaehlweise',
        alteZaehlung.window.startedAt === uhr(14, 0));
}

/* ------------------------------------------------------------------ *
 * Einsichten
 * ------------------------------------------------------------------ */

function testInsights() {
    console.log('\nEinsichten');

    const now = new Date(2026, 8, 9, 16, 0, 0, 0).getTime();
    const msg = (extra) => ({
        ts: now - HOUR, model: 'claude-opus-5', effort: 0, cacheRead: 0,
        input: 0, output: 0, cacheCreate: 0, thinking: 0,
        project: 'P', session: 's1', kind: 'main', ...extra,
    });

    // Art der Nachricht
    const gemischt = [
        msg({ effort: 300, kind: 'main' }),
        msg({ effort: 500, kind: 'subagent' }),
        msg({ effort: 200, kind: 'workflow' }),
    ];
    const arten = byKind(gemischt);
    check('Arten nach Groesse sortiert', arten[0].key === 'subagent');
    check('Anteile summieren auf eins',
        near(arten.reduce((a, k) => a + k.share, 0), 1, 1e-9));
    check('Subagenten tragen ihren Schluessel', arten[0].key === 'subagent');
    check('Arten tragen eine Farbe', /^#[0-9a-f]{6}$/.test(arten[0].color));
    check('leere Liste ergibt nichts', byKind([]).length === 0);

    // Cache
    const cache = cacheReuse([
        msg({ cacheRead: 900, cacheCreate: 100 }),
        msg({ cacheRead: 100, cacheCreate: 0 }),
    ]);
    check('Wiederverwendung gerechnet', near(cache.share, 1000 / 1100, 1e-9));
    check('ohne Cache kein Anteil', cacheReuse([msg({})]).share === null);

    // Tage
    const tage = byDay([
        msg({ ts: now, effort: 50 }),
        msg({ ts: now - 3 * 24 * HOUR, effort: 70 }),
    ], now);
    check('sieben Tage', tage.length === 7);
    check('heute steht rechts', tage[6].today === true && tage[6].effort === 50);
    check('aelterer Tag richtig einsortiert', tage[3].effort === 70);
    check('Tage tragen die Nummer des Wochentags',
        Number.isInteger(tage[0].weekday) && tage[0].weekday >= 0 && tage[0].weekday <= 6);

    // Heatmap
    const heat = heatmap([msg({ ts: new Date(2026, 8, 9, 14, 30).getTime(), effort: 42 })]);
    check('Heatmap trifft Wochentag und Stunde',
        heat.grid[new Date(2026, 8, 9).getDay()][14] === 42);
    check('Heatmap kennt ihr Maximum', heat.max === 42);

    // Sitzungen
    const sitzungen = topSessions([
        msg({ session: 'a', effort: 100 }),
        msg({ session: 'b', effort: 300 }),
        msg({ session: 'c', effort: 900, kind: 'subagent' }),
    ], new Map(), () => 'Projekt', 0);
    check('groesste Sitzung zuerst', sitzungen[0].id === 'b');
    check('Subagenten zaehlen nicht als Sitzung', sitzungen.length === 2);
    check('Nachrichten je Sitzung gezaehlt', sitzungen[0].messages === 1);

    // Kosten
    check('Opus kostet fuenf Dollar je Million Eingabe',
        priceFor('claude-opus-5').input === 5);
    check('Fable liest Cache guenstiger als Opus',
        priceFor('claude-fable-5-1').cacheRead < priceFor('claude-opus-5').cacheRead);
    check('unbekanntes Modell hat keinen Preis', priceFor('claude-neu-9') === null);

    const kosten = estimateCost([
        msg({ model: 'claude-opus-5', input: 1e6, output: 0, cacheCreate: 0, cacheRead: 0 }),
    ]);
    check('eine Million Eingabe kostet fuenf Dollar', near(kosten.usd, 5, 1e-9));

    const gemischteKosten = estimateCost([
        msg({ model: 'claude-sonnet-5', input: 1e6 }),
        msg({ model: 'claude-neu-9', input: 1e6, effort: 1e6 }),
    ]);
    check('Sonnet kostet zwei Dollar', near(gemischteKosten.usd, 2, 1e-9));
    check('unbekanntes Modell wird ausgewiesen', gemischteKosten.unknownEffort === 1e6);

    // Denken steckt in der Antwort und darf nicht doppelt kosten.
    const denkKosten = estimateCost([
        msg({ model: 'claude-opus-5', output: 1e6, thinking: 5e5 }),
    ]);
    check('Denken wird nicht doppelt berechnet', near(denkKosten.usd, 25, 1e-9));

    // Im Schnappschuss sind alle Einsichten vorhanden.
    const snapshot = aggregate({ messages: gemischt, now });
    const ins = snapshot.insights;
    check('Schnappschuss traegt alle Einsichten',
        Boolean(ins && ins.kinds && ins.cache && ins.history && ins.days
            && ins.heatmap && ins.sessions && ins.cost));
    check('Kosten im Schnappschuss sind Zahlen',
        Number.isFinite(ins.cost.today) && Number.isFinite(ins.cost.week));
}

function testLimitEvents() {
    console.log('\nLimit-Ereignisse');

    const tag = (h, min) => new Date(2026, 8, 25, h, min, 0, 0).getTime();
    const ts = tag(15, 43);

    check('Resetzeit mit Minuten gelesen',
        parseResetText("You've hit your session limit \u00b7 resets 3:50pm (Europe/Berlin)", ts)
        === tag(15, 50));
    check('Resetzeit zur vollen Stunde gelesen',
        parseResetText('resets 7pm', ts) === tag(19, 0));
    check('Resetzeit nach Mitternacht faellt auf den Folgetag',
        parseResetText('resets 1am', tag(20, 37))
        === new Date(2026, 8, 26, 1, 0, 0, 0).getTime());
    check('Wochenlimit mit Datum gelesen',
        parseResetText('resets Sep 16, 7pm', new Date(2026, 8, 15, 17, 39).getTime())
        === new Date(2026, 8, 16, 19, 0, 0, 0).getTime());
    check('Text ohne Resetzeit ergibt nichts',
        parseResetText("You've reached your Fable limit.", ts) === null);

    check('Fensterlimit erkannt', limitKind("You've hit your session limit") === 'window');
    check('Wochenlimit erkannt', limitKind("You've hit your weekly limit") === 'week');
    check('Modelllimit erkannt', limitKind("You've reached your Fable limit.") === 'model');

    // Claude Code wiederholt den Versuch, im eigenen Bestand bis zu 50 mal.
    const viele = [];
    for (let i = 0; i < 50; i++) {
        viele.push({ ts: ts + i * 1000, kind: 'window', resetAt: tag(15, 50) });
    }
    viele.push({ ts: tag(12, 0), kind: 'window', resetAt: tag(12, 10) });
    const sauber = dedupeLimits(viele);
    check('Wiederholungen zaehlen einmal', sauber.length === 2, 'waren ' + sauber.length);
    check('das frueheste Auftreten gewinnt',
        sauber[1].ts === ts, 'war ' + new Date(sauber[1].ts).toLocaleTimeString('de-DE'));

    const zusammen = summarizeLimits(viele, tag(18, 0));
    check('Anker ist der juengste Fensterreset', zusammen.anchor === tag(15, 50));
    check('Treffer gezaehlt', zusammen.windowHits === 2, 'waren ' + zusammen.windowHits);

    const alt = summarizeLimits([
        { ts: tag(15, 43) - 40 * 864e5, kind: 'window', resetAt: tag(15, 50) - 40 * 864e5 },
    ], tag(18, 0));
    check('alte Treffer zaehlen nicht mehr mit', alt.windowHits === 0);
    check('alter Anker bleibt trotzdem lesbar', alt.anchor !== null);
}

function testGitStatus() {
    console.log('\nGit');

    const text = [
        '# branch.oid abc123',
        '# branch.head main',
        '# branch.upstream origin/main',
        '# branch.ab +2 -1',
        '1 .M N... 100644 100644 100644 aaa bbb lib/scan.mjs',
        '1 M. N... 100644 100644 100644 ccc ddd main.mjs',
        '2 R. N... 100644 100644 100644 eee fff R100 neu.js\u0000alt.js',
        'u UU N... 100644 100644 100644 100644 ggg hhh iii streit.js',
        '? unverfolgt.txt',
        '? noch-eine.txt',
    ].join('\n');
    const status = parseStatus(text);
    check('Branch gelesen', status.branch === 'main');
    check('Vorsprung gelesen', status.ahead === 2);
    check('Rueckstand gelesen', status.behind === 1);
    check('geaenderte Dateien gezaehlt', status.changed === 4, 'waren ' + status.changed);
    check('neue Dateien getrennt gezaehlt', status.untracked === 2);

    const leer = parseStatus('# branch.head (detached)');
    check('abgehaengter Kopf hat keinen Branch', leer.branch === null);
    check('leerer Text stuerzt nicht ab', parseStatus('').changed === 0);
}

/* ------------------------------------------------------------------ */

console.log('Claude TV Selftest');
testMath();
await testScanner();
testCalibration();
testReport();
testFit();
testAnchoredWindows();
testInsights();
testLimitEvents();
testGitStatus();
await testConfig();
await testRealLogs();

console.log('\n' + passed + ' bestanden, ' + failed + ' durchgefallen');
process.exit(failed === 0 ? 0 : 1);
