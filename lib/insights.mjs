/**
 * Auswertungen, die ueber die Hauptzahl hinausgehen.
 *
 * Alles hier beantwortet eine Frage, die die Prozentanzeige offenlaesst:
 * Wofuer geht der Verbrauch drauf, wie gut wird Kontext wiederverwendet, ist
 * dieses Fenster normal, und was haette dasselbe ueber die API gekostet.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ *
 * Art der Nachricht
 * ------------------------------------------------------------------ */

/** Nur Farben, beschriftet wird im Fenster nach eingestellter Sprache. */
const KIND_COLORS = {
    main: '#d97757',
    subagent: '#5f7d99',
    workflow: '#9a6b9e',
};

/**
 * Wie sich der Verbrauch auf Hauptlauf, Subagenten und Workflows verteilt.
 *
 * Die Zahl ueberrascht die meisten: am eigenen Bestand gemessen ging rund die
 * Haelfte an Subagenten, ohne dass das irgendwo zu sehen war.
 */
export function byKind(messages) {
    const totals = new Map();
    let sum = 0;
    for (const message of messages) {
        totals.set(message.kind, (totals.get(message.kind) || 0) + message.effort);
        sum += message.effort;
    }
    return [...totals.entries()]
        .map(([key, effort]) => ({
            key,
            color: KIND_COLORS[key] || '#8c8578',
            effort,
            share: sum > 0 ? effort / sum : 0,
        }))
        .sort((a, b) => b.effort - a.effort);
}

/* ------------------------------------------------------------------ *
 * Cache
 * ------------------------------------------------------------------ */

/**
 * Wie viel Kontext wiederverwendet statt neu aufgebaut wird.
 *
 * Hoch ist gut: gelesener Cache kostet fast nichts, neu angelegter zaehlt voll
 * auf das Kontingent. Faellt der Wert, wird staendig neuer Kontext geschrieben.
 */
export function cacheReuse(messages, from = 0) {
    let read = 0;
    let create = 0;
    for (const message of messages) {
        if (message.ts < from) {
            continue;
        }
        read += message.cacheRead;
        create += message.cacheCreate;
    }
    const total = read + create;
    return { read, create, share: total > 0 ? read / total : null };
}

/* ------------------------------------------------------------------ *
 * Verlauf
 * ------------------------------------------------------------------ */

/**
 * Die letzten abgeschlossenen Fenster als Reihe, damit sich das laufende
 * einordnen laesst. Ohne diesen Vergleich sagt eine Prozentzahl wenig.
 */
export function windowHistory(windows, now, windowMs, limit = 14) {
    const done = windows.filter((w) => now >= w.start + windowMs);
    return done.slice(-limit).map((w) => ({ start: w.start, effort: w.effort }));
}

/** Die letzten sieben Tage einzeln, jeweils von Mitternacht bis Mitternacht. */
export function byDay(messages, now, days = 7) {
    const heute = new Date(now);
    heute.setHours(0, 0, 0, 0);
    const start = heute.getTime() - (days - 1) * DAY_MS;

    const buckets = new Array(days).fill(0);
    for (const message of messages) {
        if (message.ts < start) {
            continue;
        }
        const index = Math.floor((message.ts - start) / DAY_MS);
        if (index >= 0 && index < days) {
            buckets[index] += message.effort;
        }
    }
    return buckets.map((effort, i) => {
        const tag = new Date(start + i * DAY_MS);
        return {
            at: tag.getTime(),
            // Nummer des Wochentags, der Name kommt aus der Sprachtabelle.
            weekday: tag.getDay(),
            today: i === days - 1,
            effort,
        };
    });
}

/**
 * Wochentag mal Stunde. Zeigt, wann wirklich gearbeitet wird.
 * @returns {{grid: number[][], max: number}} sieben Zeilen zu 24 Werten
 */
export function heatmap(messages, from = 0) {
    const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
    let max = 0;
    for (const message of messages) {
        if (message.ts < from) {
            continue;
        }
        const at = new Date(message.ts);
        const value = grid[at.getDay()][at.getHours()] + message.effort;
        grid[at.getDay()][at.getHours()] = value;
        if (value > max) {
            max = value;
        }
    }
    return { grid, max };
}

/* ------------------------------------------------------------------ *
 * Sitzungen
 * ------------------------------------------------------------------ */

/**
 * Die teuersten Sitzungen eines Zeitraums.
 *
 * Nur Hauptlaeufe: eine Sitzung ist das, was du im Fenster von Claude Code
 * siehst. Die Subagenten dazu laufen unter eigenen Kennungen und haetten die
 * Liste sonst mit Namen gefuellt, die niemand zuordnen kann.
 */
export function topSessions(messages, cwdBySession, describeProject, from, limit = 5) {
    const sessions = new Map();
    for (const message of messages) {
        if (message.ts < from || message.kind !== 'main') {
            continue;
        }
        let entry = sessions.get(message.session);
        if (!entry) {
            entry = {
                id: message.session,
                project: describeProject(message.project, cwdBySession.get(message.session)),
                effort: 0,
                messages: 0,
                first: message.ts,
                last: message.ts,
            };
            sessions.set(message.session, entry);
        }
        entry.effort += message.effort;
        entry.messages += 1;
        entry.last = message.ts;
    }
    return [...sessions.values()]
        .sort((a, b) => b.effort - a.effort)
        .slice(0, limit);
}

/* ------------------------------------------------------------------ *
 * Kosten
 * ------------------------------------------------------------------ */

/*
   Listenpreise der Claude-API in Dollar je Million Tokens.

   Cache-Schreiben kostet das 1,25-fache der Eingabe, Cache-Lesen ein Zehntel;
   Fable 5.1 hat einen eigenen, guenstigeren Lesepreis. Die Zahl ist eine
   Schaetzung und keine Rechnung: im Abo zahlst du nichts pro Token, und ob
   Anthropic intern genauso rechnet, steht nirgends. Sie beantwortet nur die
   Frage, was derselbe Verbrauch ueber die API gekostet haette.
*/
const PRICES = [
    [/fable-5-1/, { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 0.25 }],
    [/fable/, { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 1 }],
    [/opus/, { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 }],
    [/sonnet-4-6/, { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 }],
    [/sonnet/, { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 }],
    [/haiku/, { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 }],
];

/** Preis eines Modells, oder null fuer Unbekanntes. */
export function priceFor(model) {
    const key = String(model || '').toLowerCase();
    for (const [pattern, price] of PRICES) {
        if (pattern.test(key)) {
            return price;
        }
    }
    return null;
}

/**
 * Was der Verbrauch ueber die API gekostet haette, in Dollar.
 *
 * Denken steckt bereits in den Antworttokens, wird also nicht extra gezaehlt.
 */
export function estimateCost(messages, from = 0) {
    let usd = 0;
    let unknown = 0;
    for (const message of messages) {
        if (message.ts < from) {
            continue;
        }
        const price = priceFor(message.model);
        if (!price) {
            unknown += message.effort;
            continue;
        }
        usd += (message.input * price.input
            + message.output * price.output
            + message.cacheCreate * price.cacheWrite
            + message.cacheRead * price.cacheRead) / 1e6;
    }
    return { usd, unknownEffort: unknown };
}

/* ------------------------------------------------------------------ *
 * Woran gerade gearbeitet wird
 * ------------------------------------------------------------------ */

/**
 * Die letzten Arbeitsschritte, aus den Werkzeugaufrufen der Logzeilen.
 *
 * Gezeigt wird nur, was getan wird: Werkzeug, Datei, Projekt. Kein Text aus
 * Nachrichten, keine Befehle im Wortlaut ausser der Beschreibung, die Claude
 * Code selbst dazuschreibt.
 *
 * @param {object[]} messages
 * @param {Map<string,string>} cwdBySession
 * @param {(dir: string, cwd: string|undefined) => string} describeProject
 */
export function activity(messages, cwdBySession, describeProject, limit = 12) {
    const steps = [];
    const files = [];
    // Von hinten, die juengsten zuerst, und frueh abbrechen.
    for (let i = messages.length - 1; i >= 0 && steps.length < limit; i--) {
        const message = messages[i];
        if (!message.tools || message.tools.length === 0) {
            continue;
        }
        const projekt = describeProject(message.project, cwdBySession.get(message.session));
        for (let t = message.tools.length - 1; t >= 0 && steps.length < limit; t--) {
            const tool = message.tools[t];
            steps.push({
                ts: message.ts,
                tool: tool.name,
                detail: tool.detail,
                project: projekt,
                kind: message.kind,
            });
            if (tool.file && !files.includes(tool.file)) {
                files.push(tool.file);
            }
        }
    }

    const last = messages.length > 0 ? messages[messages.length - 1] : null;
    return {
        project: last ? describeProject(last.project, cwdBySession.get(last.session)) : null,
        // Echter Pfad, damit der Hauptprozess dort nach git fragen kann.
        cwd: last ? (cwdBySession.get(last.session) ?? null) : null,
        session: last ? last.session : null,
        at: last ? last.ts : null,
        kind: last ? last.kind : null,
        steps,
        files: files.slice(0, 8),
    };
}
