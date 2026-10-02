/**
 * Liest den Verbrauchsbericht von Claude Code.
 *
 * Die echten Limits stehen in keiner lokalen Datei, Claude Code holt sie live
 * von der API. Sichtbar werden sie nur an einer Stelle: im Kontextfenster
 * unter "Detaillierte Aufschluesselung anzeigen". Dieser Text laesst sich
 * kopieren, und genau er wird hier zerlegt.
 *
 * Erwartet wird so etwas:
 *
 *   Claude Code usage report (2026-09-09T14:08:19.102Z)
 *
 *   Plan limits:
 *   - session-0: 56% (resets 2026-09-09T17:00:00.294676+00:00)
 *   - weekly_all-1: 61% (resets 2026-09-09T16:59:59.294695+00:00)
 *   - weekly_scoped-2: 0% (resets 2026-09-09T17:00:00+00:00)
 *
 *   Local activity: 2085 requests (24h) | 7847 (7d)
 *
 * Absichtlich nachsichtig: unbekannte Zeilen werden uebergangen, fehlende
 * Abschnitte machen den Rest nicht ungueltig. Kaputt ist der Bericht nur,
 * wenn sich kein einziges Limit lesen laesst.
 */

/** Zeitangaben mit mehr als drei Nachkommastellen kuerzen, sonst mag sie nicht jede Laufzeit. */
function parseTime(raw) {
    const text = String(raw || '').trim();
    if (text === '') {
        return null;
    }
    const ms = Date.parse(text.replace(/(\.\d{3})\d+/, '$1'));
    return Number.isFinite(ms) ? ms : null;
}

/**
 * @typedef {{percent: number, resetAt: number|null}} Limit
 * @typedef {{
 *   at: number,
 *   session: Limit|null,
 *   weekAll: Limit|null,
 *   weekScoped: Limit|null,
 *   requests24h: number|null,
 *   requests7d: number|null,
 *   costUsd: number|null
 * }} Report
 */

/**
 * @param {string} text der kopierte Bericht
 * @returns {Report|null} null, wenn kein einziges Limit lesbar war
 */
export function parseReport(text) {
    const raw = String(text || '');
    if (raw.trim() === '') {
        return null;
    }

    const header = /usage report\s*\(([^)]+)\)/i.exec(raw);
    const at = parseTime(header && header[1]);

    /** @type {Record<string, Limit>} */
    const limits = {};
    // Die Ziffer hinter dem Namen ist eine laufende Nummer und egal.
    const line = /^[-*\s]*([a-z_]+)(?:-\d+)?\s*:\s*(\d{1,3}(?:[.,]\d+)?)\s*%\s*(?:\(\s*resets?\s+([^)]+)\))?/gim;
    let match;
    while ((match = line.exec(raw)) !== null) {
        const key = match[1].toLowerCase();
        const percent = Number(String(match[2]).replace(',', '.'));
        if (!Number.isFinite(percent)) {
            continue;
        }
        limits[key] = {
            percent: Math.min(100, Math.max(0, percent)),
            resetAt: parseTime(match[3]),
        };
    }

    const activity = /local activity:\s*([\d.]+)\s*requests?\s*\(24h\)\s*\|\s*([\d.]+)\s*\(7d\)/i.exec(raw);
    const cost = /cost:\s*\$\s*([\d.]+)/i.exec(raw);

    const report = {
        at: at ?? Date.now(),
        session: limits.session ?? null,
        weekAll: limits.weekly_all ?? null,
        weekScoped: limits.weekly_scoped ?? null,
        requests24h: activity ? Number(activity[1].replace(/\./g, '')) : null,
        requests7d: activity ? Number(activity[2].replace(/\./g, '')) : null,
        costUsd: cost ? Number(cost[1]) : null,
    };

    if (!report.session && !report.weekAll && !report.weekScoped) {
        return null;
    }
    return report;
}

/**
 * Was der Bericht ueber die Zeitstempel hinaus wert ist: aus Prozentwert und
 * gemessenem Aufwand ergibt sich, wie viel 100 Prozent sind.
 *
 * Unter fuenf Prozent wird nicht gerechnet. Bei 1 Prozent haengt das Ergebnis
 * an einer einzigen Nachkommastelle, die der Bericht gar nicht hergibt, und
 * ein Rundungsfehler wuerde das Budget um Faktoren verschieben.
 *
 * @param {Limit|null} limit
 * @param {number} effort gemessener Aufwand im selben Zeitraum
 * @returns {number|null}
 */
export function deriveBudget(limit, effort) {
    if (!limit || !Number.isFinite(effort) || effort <= 0) {
        return null;
    }
    if (!Number.isFinite(limit.percent) || limit.percent < 5) {
        return null;
    }
    return Math.max(1, Math.round(effort / (limit.percent / 100)));
}

/**
 * Rechnet aus mehreren Abgleichen ein Budget.
 *
 * Ein einzelner Punkt reicht nicht. Der Bericht nennt volle Prozent, bei 56
 * Prozent steckt darin schon ein Prozent Unsicherheit, und dazu kommt
 * Verbrauch, den die Logs nicht sehen. Am 09.09.2026 ergaben drei Punkte
 * desselben Fensters einzeln 6,78 M, 7,40 M und 6,98 M; gemeinsam
 * ausgeglichen 7,05 M, und damit lag die Anzeige an allen drei Stellen
 * hoechstens drei Punkte daneben statt fuenf.
 *
 * Kleinste Quadrate ueber `effort = budget * anteil`, gewichtet mit dem
 * Alter: `budget = Summe(w * effort * anteil) / Summe(w * anteil^2)`.
 *
 * Das Alter geht ein, weil die Grenze selbst wandert. Am eigenen Bestand
 * ergaben die Punkte der Reihe nach 7,40 M, 9,93 M und 10,88 M, ueber drei
 * Wochen stetig steigend; ein Monat alter Messwert beschreibt dann nicht mehr
 * dieselbe Lage. Nach einer Woche zaehlt ein Punkt noch halb, nach drei
 * Wochen noch ein Achtel.
 *
 * @param {{percent: number, effort: number, at?: number}[]} points
 * @param {{now?: number, halfLifeMs?: number}} [options]
 * @returns {number|null}
 */
export function fitBudget(points, options = {}) {
    const now = options.now ?? Date.now();
    const halfLife = options.halfLifeMs ?? 7 * 24 * 60 * 60 * 1000;
    let zaehler = 0;
    let nenner = 0;
    for (const point of points || []) {
        // Unter fuenf Prozent traegt ein Punkt mehr Rundungsfehler als Aussage.
        if (!(point.percent >= 5) || !(point.effort > 0)) {
            continue;
        }
        const alter = Number.isFinite(point.at) ? Math.max(0, now - point.at) : 0;
        const gewicht = halfLife > 0 ? Math.pow(0.5, alter / halfLife) : 1;
        const anteil = point.percent / 100;
        zaehler += gewicht * point.effort * anteil;
        nenner += gewicht * anteil * anteil;
    }
    return nenner > 0 ? Math.max(1, Math.round(zaehler / nenner)) : null;
}

/**
 * Nimmt einen neuen Punkt in die Sammlung auf.
 *
 * Punkte aus einer anderen Zaehlweise fliegen raus, doppelte Zeitpunkte
 * ersetzen sich, und aelter als vier Wochen wird nichts mitgeschleppt: das
 * Limit selbst kann sich aendern.
 */
export function mergePoints(alt, neu, { countVersion, now = Date.now(), maxAgeMs = 28 * 864e5, max = 12 }) {
    const behalten = (alt || []).filter((p) => p
        && p.countVersion === countVersion
        && now - p.at < maxAgeMs
        && p.at !== neu.at);
    return [...behalten, neu]
        .sort((a, b) => a.at - b.at)
        .slice(-max);
}

/**
 * Macht aus einem Bericht den Abgleich, den die Auswertung braucht.
 *
 * Der Zeitraum kommt aus dem Bericht selbst, also aus der Resetzeit minus
 * Fensterlaenge, nicht aus unserer eigenen Fenstererkennung. Sonst wuerde
 * genau der Fehler mit eingerechnet, den der Abgleich beheben soll.
 *
 * @param {Report} report
 * @param {(from: number, to: number) => number} effortBetween gemessener Aufwand
 * @param {{windowMs: number, weekMs: number, countVersion: number}} spans
 */
export function buildSync(report, effortBetween, spans) {
    const sync = {
        at: report.at,
        countVersion: spans.countVersion,
        windowResetAt: report.session?.resetAt ?? null,
        windowPercent: report.session?.percent ?? null,
        windowBudget: null,
        weekResetAt: report.weekAll?.resetAt ?? null,
        weekPercent: report.weekAll?.percent ?? null,
        weekBudget: null,
        scopedResetAt: report.weekScoped?.resetAt ?? null,
        scopedPercent: report.weekScoped?.percent ?? null,
    };

    // Was in diesem Fenster und dieser Woche bis zum Bericht gemessen wurde.
    const point = {
        at: report.at,
        countVersion: spans.countVersion,
        windowPercent: sync.windowPercent,
        windowEffort: Number.isFinite(sync.windowResetAt)
            ? effortBetween(sync.windowResetAt - spans.windowMs, report.at) : 0,
        weekPercent: sync.weekPercent,
        weekEffort: Number.isFinite(sync.weekResetAt)
            ? effortBetween(sync.weekResetAt - spans.weekMs, report.at) : 0,
    };

    sync.points = mergePoints(spans.points, point, {
        countVersion: spans.countVersion,
        now: report.at,
    });

    const gewichtung = { now: report.at };
    sync.windowBudget = fitBudget(sync.points.map((p) => ({
        percent: p.windowPercent, effort: p.windowEffort, at: p.at,
    })), gewichtung);
    sync.weekBudget = fitBudget(sync.points.map((p) => ({
        percent: p.weekPercent, effort: p.weekEffort, at: p.at,
    })), gewichtung);
    return sync;
}
