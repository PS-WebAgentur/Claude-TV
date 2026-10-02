/**
 * Rechnet aus den gelesenen Nachrichten das, was die Anzeige braucht.
 *
 * Zwei Dinge sind hier bewusst so und nicht anders geloest:
 *
 * 1. Die Hauptzahl ist der Aufwand, also Input plus Output plus Cache-Aufbau.
 *    Cache-Lesevorgaenge laufen getrennt, weil sie alles andere erdruecken
 *    wuerden, ohne viel ueber die Last zu sagen.
 * 2. Die Prozentskala ist selbstkalibrierend. Wie viel erlaubt ist, steht in
 *    keinem lokalen Log. Also ist 100 Prozent das p90 der eigenen
 *    abgeschlossenen Fenster, und die Anzeige sagt das auch.
 */

import {
    byKind, cacheReuse, windowHistory, byDay, heatmap, topSessions, estimateCost, activity,
} from './insights.mjs';
import { summarizeLimits } from './limits.mjs';

export const WINDOW_MS = 5 * 60 * 60 * 1000;
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const MIN_WINDOWS_FOR_CALIBRATION = 3;

/**
 * Wie weit die Zahl der Fenster von der Kalibrierung abweichen darf, bevor
 * neu gerechnet wird: ein Zehntel des Bestands, mindestens zwei. Ein Tag
 * bringt hoechstens knapp fuenf neue Fenster, das passt bei jedem Bestand ab
 * etwa fuenfzig Fenstern bequem durch. Ein halber Scan liegt weiter daneben.
 */
/**
 * Zaehlweise, auf der eine Kalibrierung beruht. Hochzaehlen, sobald sich der
 * gemessene Aufwand aendert; gespeicherte Werte aus einer aelteren Zaehlweise
 * werden dann verworfen statt eine falsche Skala zu behaupten.
 *
 * 2: eine Antwort zaehlt einmal, nicht je Inhaltsblock.
 */
export const COUNT_VERSION = 2;

export function pinTolerance(completedCount) {
    return Math.max(2, Math.round(completedCount * 0.1));
}

const DAY_MS = 24 * 60 * 60 * 1000;

const RATE_SAMPLE_MS = 10 * 60 * 1000;
const WORKING_MS = 2 * 60 * 1000;
const IDLE_MS = 20 * 60 * 1000;
const FRESH_MS = 60 * 1000;
const WARN_PERCENT = 75;
const CRIT_PERCENT = 92;

/* ------------------------------------------------------------------ *
 * Modelle
 * ------------------------------------------------------------------ */

const MODEL_FAMILIES = [
    // Reihenfolge zaehlt: das laengere Muster zuerst, sonst beschriftet
    // /opus-5/ auch claude-opus-5-5 und die Liste zeigt zweimal "Opus 5".
    [/opus-5-5/, 'Opus 5.5', '#e0875f'],
    [/opus-5/, 'Opus 5', '#d97757'],
    [/opus-4-8/, 'Opus 4.8', '#b8674a'],
    [/opus-4-7/, 'Opus 4.7', '#a3765c'],
    [/opus/, 'Opus', '#c76a4b'],
    [/fable-5-1/, 'Fable 5.1', '#9a6b9e'],
    [/fable/, 'Fable 5', '#8c6294'],
    [/sonnet-5/, 'Sonnet 5', '#5f7d99'],
    [/sonnet/, 'Sonnet', '#6b8aa6'],
    [/haiku/, 'Haiku 4.5', '#6f9080'],
    [/synthetic/, 'intern', '#8c8578'],
];

const FALLBACK_COLORS = ['#c8a06b', '#7f9aa8', '#a58fae', '#8c8578', '#b09070'];

export function describeModel(id) {
    const key = String(id || '').toLowerCase();
    for (const [pattern, label, color] of MODEL_FAMILIES) {
        if (pattern.test(key)) {
            return { label, color };
        }
    }
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
        hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
    }
    const label = key
        .replace(/^claude-/, '')
        .replace(/-\d{8}$/, '')
        .replace(/-/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase()) || 'Unbekannt';
    return { label, color: FALLBACK_COLORS[hash % FALLBACK_COLORS.length] };
}

/* ------------------------------------------------------------------ *
 * Projekte
 * ------------------------------------------------------------------ */

/**
 * Die Verzeichnisnamen unter projects/ sind verlustbehaftet kodiert, jedes
 * Sonderzeichen wurde zu einem Bindestrich. Wenn im Log ein cwd stand, ist der
 * die verlaessliche Quelle.
 */
export function describeProject(dirName, cwd) {
    if (typeof cwd === 'string' && cwd.trim() !== '') {
        const parts = cwd.replace(/\\/g, '/').split('/').filter(Boolean);
        const claudeAt = parts.lastIndexOf('.claude');
        if (claudeAt > 0 && parts[claudeAt + 1] === 'worktrees') {
            return parts[claudeAt - 1] + ' (Worktree)';
        }
        if (parts.length > 0) {
            return parts[parts.length - 1];
        }
    }
    const cleaned = String(dirName || '')
        .replace(/^[a-zA-Z]--/, '')
        .split('-')
        .filter(Boolean);
    if (cleaned.length === 0) {
        return 'unbekannt';
    }
    return cleaned.slice(-2).join(' ');
}

/* ------------------------------------------------------------------ *
 * Hilfsrechnungen
 * ------------------------------------------------------------------ */

export function percentile(values, p) {
    if (!values.length) {
        return 0;
    }
    const sorted = [...values].sort((a, b) => a - b);
    if (sorted.length === 1) {
        return sorted[0];
    }
    const position = (sorted.length - 1) * p;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) {
        return sorted[lower];
    }
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function median(values) {
    return percentile(values, 0.5);
}

/**
 * Auf zehn Minuten abrunden.
 *
 * Dorthin legt Anthropic die Fenstergrenzen. Aus 229 Limit-Meldungen in den
 * eigenen Logs: "resets 7:10pm", "6:30pm", "3:50pm", "1:50pm". Volle Stunden
 * kommen vor, sind aber nur der Sonderfall.
 */
export function floorTen(ts) {
    const date = new Date(ts);
    date.setMinutes(Math.floor(date.getMinutes() / 10) * 10, 0, 0);
    return date.getTime();
}

/**
 * Rollt eine bekannte Grenze in die Zukunft weiter.
 *
 * Ein abgeglichener Resetzeitpunkt ist irgendwann vorbei, die Grenze
 * wiederholt sich aber im festen Abstand. Gibt die naechste Grenze ab jetzt
 * zurueck.
 */
export function rollForward(boundary, spanMs, now) {
    if (!Number.isFinite(boundary) || !(spanMs > 0)) {
        return null;
    }
    const steps = Math.ceil((now - boundary) / spanMs);
    return boundary + Math.max(0, steps) * spanMs;
}

/**
 * Teilt die Nachrichten in 5-Stunden-Fenster.
 *
 * Mit `anchor`, also einer aus dem Bericht bekannten echten Fenstergrenze,
 * liegt das Raster fest: alle Grenzen sind anchor plus ein Vielfaches von
 * fuenf Stunden. Das ist der genaue Fall, ueber den die Anzeige sonst
 * stolpert. Am 09.09.2026 gemessen: die App liess das Fenster um 12:52
 * beginnen, weil dort die erste Nachricht lag, tatsaechlich lief es von 14:00
 * bis 19:00. Der Anfang haengt eben am Kontostand, nicht am lokalen Log, und
 * Verbrauch aus dem Browser sieht die App nie.
 *
 * Ohne Anker bleibt es beim alten Verfahren: die erste Nachricht eroeffnet,
 * abgerundet auf die volle Stunde, und nach fuenf Stunden beginnt das
 * naechste. Pausen sind damit automatisch erfasst.
 */
export function buildWindows(messages, anchor = null) {
    const anchorExact = Number.isFinite(anchor) ? anchor : null;
    let grid = anchorExact;
    const windows = [];
    let current = null;
    for (const message of messages) {
        if (!current || message.ts >= current.start + WINDOW_MS) {
            /*
               Drei Faelle, in dieser Reihenfolge.

               1. Die Nachricht faellt in das Fenster, zu dem der Anker
                  gehoert. Dann steht die Grenze fest, sie kommt aus dem
                  Bericht oder aus einer Limit-Meldung. Diese Regel fehlte
                  zuerst, und dann hat Fall 2 den belegten Anker ueberstimmt:
                  der Bericht sagte 12:30, die Anzeige zeigte 12:40.
               2. Lag seit der letzten Nachricht ein ganzes Fenster Pause, ist
                  das Raster hinfaellig. Sonst schleppt ein Anker von letzter
                  Woche seinen Minutenversatz bis heute mit.
               3. Sonst laeuft das Raster weiter.
            */
            const imAnkerfenster = anchorExact !== null
                && message.ts > anchorExact - WINDOW_MS
                && message.ts <= anchorExact;
            let start;
            if (imAnkerfenster) {
                start = anchorExact - WINDOW_MS;
                grid = anchorExact;
            } else {
                const langePause = current !== null && message.ts - current.last >= WINDOW_MS;
                if (langePause || grid === null) {
                    grid = floorTen(message.ts);
                }
                start = grid + Math.floor((message.ts - grid) / WINDOW_MS) * WINDOW_MS;
            }
            current = {
                start,
                last: message.ts,
                effort: 0,
                cacheRead: 0,
                input: 0,
                output: 0,
                cacheCreate: 0,
                thinking: 0,
                messages: 0,
            };
            windows.push(current);
        }
        current.effort += message.effort;
        current.cacheRead += message.cacheRead;
        current.input += message.input;
        current.output += message.output;
        current.cacheCreate += message.cacheCreate;
        current.thinking += message.thinking;
        current.last = message.ts;
        current.messages += 1;
    }
    return windows;
}

/**
 * Soll-Marke und Hochrechnung, dieselbe Idee wie auf dem Hardware-Display:
 * wo muesste der Verbrauch stehen, wenn er dem Fenster gleichmaessig folgt?
 */
export function computePace(percent, startedAt, now) {
    const elapsed = Math.min(1, Math.max(0, (now - startedAt) / WINDOW_MS));
    const expected = elapsed * 100;
    let willLast = true;
    let etaMs = null;
    if (elapsed > 0.01 && percent > 0) {
        willLast = percent / elapsed <= 100;
        const perMs = percent / (now - startedAt);
        if (perMs > 0) {
            etaMs = (100 - percent) / perMs;
        }
    }
    return { expected, delta: percent - expected, willLast, etaMs };
}

/**
 * Warnstufe.
 *
 * Bewusst mit Toleranz: eine Hochrechnung, die nur knapp ueber 100 landet,
 * faerbt noch nichts ein. Sonst steht die Anzeige schon bei 42 Prozent auf
 * Gelb, weil das Tempo minimal ueber der Uhr liegt, und wer das ein paar Mal
 * gesehen hat, schaut nicht mehr hin. Der Hinweistext nennt die Hochrechnung
 * trotzdem.
 */
export function severity(percent, pace) {
    if (percent === null) {
        return 'none';
    }
    // Auf 100 hochgerechneter Endstand des Fensters.
    const projected = pace && pace.expected > 1 ? (percent / (pace.expected / 100)) : null;

    if (percent >= CRIT_PERCENT
        || (pace && !pace.willLast && pace.etaMs !== null && pace.etaMs < 45 * 60 * 1000)) {
        return 'crit';
    }
    if (percent >= WARN_PERCENT || (projected !== null && projected >= 110)) {
        return 'warn';
    }
    return 'ok';
}

/**
 * Zustand der Figur. Kommt aus den Daten, nicht von einem Timer.
 *
 * Zuerst zaehlt, ob gerade etwas laeuft, danach erst die Auslastung. Vorher
 * war es umgekehrt, und dann stand die Figur bei 86 Prozent auf
 * "Angestrengt", obwohl seit einer halben Stunde nichts passiert war: die
 * Haltung behauptete Betrieb, den es nicht gab. Die Auslastung steht ohnehin
 * als Zahl, als Balken und im Text daneben.
 *
 * Eine Ausnahme bleibt: am Anschlag liegt Clawd platt, auch ohne Betrieb.
 * Flach liegen ist selbst eine Ruhehaltung, und die Aussage stimmt dann.
 */
export function characterState({ percent, sinceLastMs, rate, medianRate, subagentShare = 0 }) {
    const arbeitet = sinceLastMs < WORKING_MS;
    const amAnschlag = percent !== null && percent >= CRIT_PERCENT;

    if (amAnschlag) {
        return 'spent';
    }
    if (!arbeitet) {
        return sinceLastMs < IDLE_MS ? 'idle' : 'sleeping';
    }
    if (percent !== null && percent >= WARN_PERCENT) {
        return 'strained';
    }
    // Laeuft die Arbeit ueberwiegend ueber Subagenten, dirigiert Clawd.
    if (subagentShare > 0.5) {
        return 'conducting';
    }
    if (rate > 0 && medianRate > 0 && rate > medianRate * 2) {
        return 'sprinting';
    }
    return 'working';
}

/**
 * Woraus besteht der Verbrauch?
 *
 * Aufgeschluesselt wie im Kontextfenster von Claude selbst: farbige Anteile
 * mit Klartextnamen. Cache-Lesen laeuft getrennt, weil es nicht zum Aufwand
 * zaehlt, aber trotzdem interessant ist.
 */
export function composition(source) {
    const output = Math.max(0, (source.output || 0) - (source.thinking || 0));
    /*
       Nur Schluessel, keine Woerter. Beschriftet wird im Fenster, dort kennt
       man die eingestellte Sprache.
    */
    const parts = [
        { key: 'input', value: source.input || 0, color: '#5f7d99' },
        { key: 'output', value: output, color: '#d97757' },
        { key: 'thinking', value: source.thinking || 0, color: '#9a6b9e' },
        { key: 'cacheCreate', value: source.cacheCreate || 0, color: '#c2841c' },
    ];
    const total = parts.reduce((sum, part) => sum + part.value, 0);
    return {
        total,
        parts: parts.map((part) => ({ ...part, share: total > 0 ? part.value / total : 0 })),
        cacheRead: {
            key: 'cacheRead',
            value: source.cacheRead || 0,
            color: '#8a8579',
        },
    };
}

function bucketSeries(messages, from, to, count) {
    const span = Math.max(1, to - from);
    const width = span / count;
    const buckets = new Array(count).fill(0);
    for (const message of messages) {
        if (message.ts < from || message.ts >= to) {
            continue;
        }
        const index = Math.min(count - 1, Math.floor((message.ts - from) / width));
        buckets[index] += message.effort;
    }
    return buckets;
}

/** Rollende 7-Tage-Summen an Tagesgrenzen, als Basis fuer die Wochenskala. */
function rollingWeekSums(messages, now) {
    if (messages.length === 0) {
        return [];
    }
    const first = messages[0].ts;
    const sums = [];
    const DAY = 24 * 60 * 60 * 1000;
    for (let end = first + WEEK_MS; end <= now; end += DAY) {
        let sum = 0;
        for (const message of messages) {
            if (message.ts > end - WEEK_MS && message.ts <= end) {
                sum += message.effort;
            }
        }
        if (sum > 0) {
            sums.push(sum);
        }
    }
    return sums;
}

/* ------------------------------------------------------------------ *
 * Hauptfunktion
 * ------------------------------------------------------------------ */

/**
 * @param {{
 *   messages: object[], cwdBySession?: Map<string,string>,
 *   config?: object, now?: number, stats?: object
 * }} input
 */
export function aggregate(input) {
    const messages = input.messages || [];
    const now = input.now ?? Date.now();
    const config = input.config || {};
    const cwdBySession = input.cwdBySession || new Map();
    const budgets = config.budgets || {};

    const totals = { effort: 0, cacheRead: 0, messages: messages.length, thinking: 0 };
    const modelTotals = new Map();
    const projectTotals = new Map();
    const projectCwd = new Map();
    const sessionsToday = new Set();

    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const todayFrom = dayStart.getTime();
    let todayEffort = 0;

    for (const message of messages) {
        totals.effort += message.effort;
        totals.cacheRead += message.cacheRead;
        totals.thinking += message.thinking;

        modelTotals.set(message.model, (modelTotals.get(message.model) || 0) + message.effort);
        projectTotals.set(message.project, (projectTotals.get(message.project) || 0) + message.effort);
        if (!projectCwd.has(message.project) && cwdBySession.has(message.session)) {
            projectCwd.set(message.project, cwdBySession.get(message.session));
        }
        if (message.ts >= todayFrom) {
            todayEffort += message.effort;
            if (message.kind === 'main') {
                sessionsToday.add(message.session);
            }
        }
    }

    /*
       Abgleich mit dem Bericht von Claude Code. Er liefert zwei Dinge, die
       lokal sonst fehlen: die echten Fenstergrenzen und, ueber den
       Prozentwert, wie viel 100 Prozent wirklich sind. Die Budgets gelten nur
       fuer die Zaehlweise, mit der sie gerechnet wurden; die Grenzen sind
       davon unabhaengig und bleiben immer gueltig.
    */
    const sync = input.sync && typeof input.sync === 'object' ? input.sync : {};
    const syncCountsFit = sync.countVersion === COUNT_VERSION;

    /*
       Limit-Ereignisse aus den Logs. Sie nennen eine echte Fenstergrenze und
       kosten nichts: kein Abgleich, keine Zugangsdaten. Als Anker gelten sie,
       sobald kein abgeglichener vorliegt. Fuer die Skala taugen sie nicht,
       die Begruendung steht in lib/limits.mjs.
    */
    const limits = summarizeLimits(input.limits || [], now);
    const windowAnchor = Number.isFinite(sync.windowResetAt)
        ? sync.windowResetAt
        : limits.anchor;

    const windows = buildWindows(messages, windowAnchor);
    const active = windows.length > 0 && now < windows[windows.length - 1].start + WINDOW_MS
        ? windows[windows.length - 1]
        : null;
    const completed = windows.filter((w) => now >= w.start + WINDOW_MS);

    /*
       Kalibrierung: p90 der abgeschlossenen Fenster.

       Der Wert wird festgehalten und nur einmal am Tag neu gerechnet. Sonst
       wandert die Skala unter den Fuessen, weil jedes neu abgeschlossene
       Fenster das p90 verschiebt, und dieselbe Nutzung ergaebe morgens einen
       anderen Prozentwert als abends.
    */
    const pinned = input.pinned || {};
    /*
       Der festgehaltene Wert gilt nur, wenn er zu ungefaehr demselben
       Datenbestand gehoert wie jetzt. Wurde er waehrend eines abgebrochenen
       oder halben Scans gerechnet, kannte er weniger Fenster, das p90 faellt
       zu niedrig aus, und die Anzeige haengt einen Tag lang zu hoch. Im
       normalen Betrieb kommen hoechstens knapp fuenf Fenster am Tag dazu,
       pinTolerance laesst das durch. Ein Wert ohne vermerkte Herkunft, also
       aus einer aelteren Fassung, wird einmal neu gerechnet.
    */
    const basisPasst = Number.isFinite(pinned.basisWindows)
        && pinned.countVersion === COUNT_VERSION
        && Math.abs(completed.length - pinned.basisWindows) <= pinTolerance(completed.length);
    const pinnedFresh = Number.isFinite(pinned.windowEffort) && pinned.windowEffort > 0
        && now - (pinned.computedAt || 0) < DAY_MS
        && basisPasst;

    let windowBudget = null;
    let basis = 'insufficient';
    let freshCalibration = null;

    if (Number.isFinite(budgets.windowEffort) && budgets.windowEffort > 0) {
        windowBudget = budgets.windowEffort;
        basis = 'config';
    } else if (syncCountsFit && Number.isFinite(sync.windowBudget) && sync.windowBudget > 0) {
        windowBudget = sync.windowBudget;
        basis = 'sync';
    } else if (pinnedFresh) {
        windowBudget = pinned.windowEffort;
        basis = 'p90';
    } else if (completed.length >= MIN_WINDOWS_FOR_CALIBRATION) {
        windowBudget = Math.max(1, Math.round(percentile(completed.map((w) => w.effort), 0.9)));
        basis = 'p90';
        freshCalibration = {
            windowEffort: windowBudget,
            computedAt: now,
            basisWindows: completed.length,
            countVersion: COUNT_VERSION,
        };
    }

    // Mit abgeglichener Grenze zaehlt die echte Woche, sonst die letzten
    // sieben Tage ab jetzt.
    const weekResetAt = rollForward(sync.weekResetAt ?? limits.weekAnchor, WEEK_MS, now);
    const weekFrom = weekResetAt !== null ? weekResetAt - WEEK_MS : now - WEEK_MS;
    let weekEffort = 0;
    let weekEffortSeitAbgleich = 0;
    const abgleichInWoche = Number.isFinite(sync.at)
        && Number.isFinite(sync.weekPercent)
        && sync.at > weekFrom;
    for (const message of messages) {
        if (message.ts > weekFrom) {
            weekEffort += message.effort;
            if (abgleichInWoche && message.ts > sync.at) {
                weekEffortSeitAbgleich += message.effort;
            }
        }
    }
    let weekBudget = null;
    let weekBasis = 'insufficient';
    if (Number.isFinite(budgets.weekEffort) && budgets.weekEffort > 0) {
        weekBudget = budgets.weekEffort;
        weekBasis = 'config';
    } else if (syncCountsFit && Number.isFinite(sync.weekBudget) && sync.weekBudget > 0) {
        weekBudget = sync.weekBudget;
        weekBasis = 'sync';
    } else if (pinnedFresh && Number.isFinite(pinned.weekEffort) && pinned.weekEffort > 0) {
        weekBudget = pinned.weekEffort;
        weekBasis = 'p90';
    } else {
        const sums = rollingWeekSums(messages, now);
        if (sums.length >= MIN_WINDOWS_FOR_CALIBRATION) {
            weekBudget = Math.max(1, Math.round(percentile(sums, 0.9)));
            weekBasis = 'p90';
            if (freshCalibration) {
                freshCalibration.weekEffort = weekBudget;
            }
        }
    }

    const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
    const sinceLastMs = lastMessage ? now - lastMessage.ts : Infinity;

    // Tempo: Aufwand pro Minute in den letzten zehn Minuten.
    let recentEffort = 0;
    for (const message of messages) {
        if (message.ts > now - RATE_SAMPLE_MS) {
            recentEffort += message.effort;
        }
    }
    const rate = recentEffort / (RATE_SAMPLE_MS / 60000);
    const medianRate = median(completed
        .map((w) => w.effort / Math.max(1, (w.last - w.start) / 60000))
        .filter((v) => v > 0));

    const windowEffort = active ? active.effort : 0;

    /*
       Vom letzten bekannten Wahrheitspunkt weiterzaehlen.

       Liegt der Abgleich im laufenden Fenster, ist sein Prozentwert keine
       Schaetzung, sondern abgelesen. Die Anzeige beginnt dort und rechnet nur
       noch das dazu, was seither gemessen wurde. Das trifft im Moment des
       Abgleichs exakt und driftet danach hoechstens um den unsichtbaren
       Anteil. Ohne diese Regel teilt sie stur durch ein ausgeglichenes
       Budget: am 02.10.2026 ergab das 64 Prozent, abgelesen waren 57.
    */
    const abgleichImFenster = active
        && Number.isFinite(sync.at)
        && Number.isFinite(sync.windowPercent)
        && sync.at >= active.start
        && sync.at <= active.start + WINDOW_MS;
    let effortSeitAbgleich = 0;
    if (abgleichImFenster) {
        for (const message of messages) {
            if (message.ts > sync.at && message.ts <= active.start + WINDOW_MS) {
                effortSeitAbgleich += message.effort;
            }
        }
    }

    let windowPercent = windowBudget
        ? Math.min(100, (windowEffort / windowBudget) * 100)
        : null;
    if (abgleichImFenster && windowBudget) {
        windowPercent = Math.min(100,
            sync.windowPercent + (effortSeitAbgleich / windowBudget) * 100);
    }
    const pace = active && windowPercent !== null
        ? computePace(windowPercent, active.start, now)
        : null;

    // Anteil der Subagenten an den letzten Minuten, fuer den Dirigenten.
    let recentSub = 0;
    let recentAll = 0;
    for (const message of messages) {
        if (message.ts > now - RATE_SAMPLE_MS) {
            recentAll += message.effort;
            if (message.kind !== 'main') {
                recentSub += message.effort;
            }
        }
    }
    const subagentShare = recentAll > 0 ? recentSub / recentAll : 0;

    const state = characterState({
        percent: windowPercent, sinceLastMs, rate, medianRate, subagentShare,
    });
    const celebrate = Boolean(active && windows.length > 1 && now - active.start < FRESH_MS);

    /*
       Nach Beschriftung zusammengefasst, nicht nach Kennung. Dieselbe Familie
       taucht mit mehreren Kennungen auf, etwa mit und ohne Datumszusatz, und
       stand dann doppelt in der Liste.
    */
    const modelsByLabel = new Map();
    for (const [id, effort] of modelTotals) {
        if (!(effort > 0)) {
            continue;
        }
        const beschreibung = describeModel(id);
        const eintrag = modelsByLabel.get(beschreibung.label);
        if (eintrag) {
            eintrag.effort += effort;
            eintrag.ids.push(id);
        } else {
            modelsByLabel.set(beschreibung.label, {
                id, ids: [id], effort, ...beschreibung,
            });
        }
    }
    const models = [...modelsByLabel.values()]
        .sort((a, b) => b.effort - a.effort)
        .map((m) => ({ ...m, share: totals.effort > 0 ? m.effort / totals.effort : 0 }));

    const projects = [...projectTotals.entries()]
        .map(([dir, effort]) => ({
            dir,
            effort,
            name: describeProject(dir, projectCwd.get(dir)),
        }))
        .filter((p) => p.effort > 0)
        .sort((a, b) => b.effort - a.effort)
        .slice(0, 6)
        .map((p) => ({ ...p, share: totals.effort > 0 ? p.effort / totals.effort : 0 }));

    return {
        generatedAt: now,
        source: input.stats || {},
        plan: input.plan ?? null,
        composition: composition(totals),
        totals,
        window: {
            active: Boolean(active),
            startedAt: active ? active.start : null,
            resetAt: active ? active.start + WINDOW_MS : null,
            effort: windowEffort,
            cacheRead: active ? active.cacheRead : 0,
            messages: active ? active.messages : 0,
            percent: windowPercent,
            severity: severity(windowPercent, pace),
            pace,
            series: active
                ? bucketSeries(messages, active.start, active.start + WINDOW_MS, 30)
                : new Array(30).fill(0),
            composition: composition(active || {}),
        },
        week: {
            from: weekFrom,
            resetAt: weekResetAt,
            effort: weekEffort,
            percent: weekBudget
                ? Math.min(100, abgleichInWoche
                    ? sync.weekPercent + (weekEffortSeitAbgleich / weekBudget) * 100
                    : (weekEffort / weekBudget) * 100)
                : null,
            basis: weekBasis,
        },
        /*
           Der zweite Wochenzaehler laesst sich lokal nicht nachrechnen. Am
           09.09.2026 stand er auf 0 Prozent, waehrend im selben Zeitraum
           39,2 M Fable-Tokens im Log lagen. Was er zaehlt, ist also nicht das,
           was hier als Fable erkannt wird. Deshalb nur der Wert aus dem
           Bericht, mit seinem Alter, und keine eigene Hochrechnung.
        */
        weekScoped: Number.isFinite(sync.scopedPercent)
            ? {
                percent: sync.scopedPercent,
                resetAt: rollForward(sync.scopedResetAt, WEEK_MS, now),
                measuredAt: sync.at ?? null,
                stale: Number.isFinite(sync.at) ? now - sync.at > DAY_MS : true,
            }
            : null,
        sync: {
            at: Number.isFinite(sync.at) ? sync.at : null,
            countsFit: syncCountsFit,
            anchored: windowAnchor !== null,
            // Woher die Fenstergrenze stammt: Abgleich, Limit-Ereignis oder nichts.
            anchorFrom: Number.isFinite(sync.windowResetAt) ? 'sync'
                : (limits.anchor ? 'limit' : 'none'),
        },
        limits,
        calibration: {
            windowBudget,
            weekBudget,
            basis,
            completedWindows: completed.length,
            needed: MIN_WINDOWS_FOR_CALIBRATION,
            // Gesetzt, wenn neu gerechnet wurde. Der Aufrufer soll das sichern.
            fresh: freshCalibration,
        },
        rate: { perMinute: rate, medianPerMinute: medianRate },
        last: lastMessage
            ? {
                at: lastMessage.ts,
                sinceMs: sinceLastMs,
                model: lastMessage.model,
                ...describeModel(lastMessage.model),
            }
            : null,
        today: {
            effort: todayEffort,
            sessions: sessionsToday.size,
            buckets: bucketSeries(messages, todayFrom, todayFrom + 24 * 60 * 60 * 1000, 24),
        },
        models,
        projects,
        /*
           Auswertungen jenseits der Hauptzahl. Sie liegen im Schnappschuss,
           damit der Renderer nichts rechnet, sondern nur zeichnet.
        */
        insights: {
            kinds: byKind(messages),
            cache: cacheReuse(messages),
            cacheWindow: cacheReuse(messages, active ? active.start : now),
            history: windowHistory(windows, now, WINDOW_MS),
            days: byDay(messages, now),
            heatmap: heatmap(messages, now - 28 * DAY_MS),
            sessions: topSessions(messages, cwdBySession, describeProject, todayFrom),
            activity: activity(messages, cwdBySession, describeProject),
            cost: {
                today: estimateCost(messages, todayFrom).usd,
                week: estimateCost(messages, weekFrom).usd,
                window: active ? estimateCost(messages, active.start).usd : 0,
            },
        },
        character: { state, celebrate, subagentShare },
    };
}
