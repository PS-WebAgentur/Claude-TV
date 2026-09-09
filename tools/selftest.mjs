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
import {
    aggregate, buildWindows, computePace, percentile, median,
    describeModel, describeProject, characterState, severity, WINDOW_MS,
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
    return JSON.stringify({
        type: 'assistant',
        timestamp: new Date(ts).toISOString(),
        message: { model, usage },
        ...extra,
    });
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

    check('Modell Opus 5', describeModel('claude-opus-5').label === 'Opus 5');
    check('Modell Fable', describeModel('claude-fable-5-1').label === 'Fable 5.1');
    check('Modell synthetic', describeModel('<synthetic>').label === 'intern');
    check('unbekanntes Modell bekommt Farbe',
        /^#[0-9a-f]{6}$/.test(describeModel('claude-neu-9').color));
    check('unbekanntes Modell stabil benannt',
        describeModel('claude-neu-9').label === describeModel('claude-neu-9').label);

    check('Projektname aus cwd',
        describeProject('X--irgendwas', 'C:/Users/p/Documents/GitHub/ayuna-app') === 'ayuna-app');
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
        pinned: { windowEffort: pinnedValue, computedAt: now - 2 * HOUR },
    });
    check('frischer Anschlag wird genutzt', withPin.calibration.windowBudget === pinnedValue);
    check('genutzter Anschlag gilt als p90', withPin.calibration.basis === 'p90');
    check('genutzter Anschlag wird nicht neu gerechnet', withPin.calibration.fresh === null);

    const stalePin = aggregate({
        messages: many,
        now,
        pinned: { windowEffort: pinnedValue, computedAt: now - 30 * HOUR },
    });
    check('alter Anschlag wird verworfen', stalePin.calibration.windowBudget !== pinnedValue);
    check('alter Anschlag loest Neuberechnung aus', stalePin.calibration.fresh !== null);

    const userWins = aggregate({
        messages: many,
        now,
        config: { budgets: { windowEffort: 500000 } },
        pinned: { windowEffort: pinnedValue, computedAt: now },
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
        stats: scanner.stats(),
    });

    check('Durchlauf unter 5 Sekunden', took < 5000, took + 'ms');
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
        ['sleeping', 'idle', 'working', 'sprinting', 'strained', 'spent']
            .includes(snapshot.character.state));
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

/* ------------------------------------------------------------------ */

console.log('Claude TV Selftest');
testMath();
await testScanner();
testCalibration();
await testConfig();
await testRealLogs();

console.log('\n' + passed + ' bestanden, ' + failed + ' durchgefallen');
process.exit(failed === 0 ? 0 : 1);
