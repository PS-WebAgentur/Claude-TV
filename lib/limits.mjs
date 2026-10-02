/**
 * Limit-Ereignisse aus den Logs.
 *
 * Wenn Claude Code ins Limit laeuft, schreibt es das in die Logzeile: eine
 * Antwort mit `error: "rate_limit"`, Status 429, und im Text steht die
 * Resetzeit im Klartext, etwa "You've hit your session limit · resets 7:10pm
 * (Europe/Berlin)".
 *
 * Das ist die einzige Stelle, an der eine echte Fenstergrenze lokal auf der
 * Platte landet, ganz ohne Zugangsdaten. Im eigenen Bestand lagen 229 solcher
 * Zeilen, nach Entdoppeln 24 Ereignisse.
 *
 * **Wofuer sie nicht taugen.** Es liegt nahe, so ein Ereignis als
 * 100-Prozent-Punkt zu nehmen und daraus das Budget zu rechnen. Gemessen
 * ergaben neun Ereignisse aus vier Wochen aber 5,97 M bis 10,11 M, also ein
 * Viertel Streuung. Der Grund ist bekannt: wer nebenher im Browser mit Claude
 * arbeitet, erreicht die Grenze, ohne dass der lokal messbare Verbrauch dort
 * ankommt. Jeder Punkt ist damit eine Untergrenze, kein Wert. Als Grundlage
 * der Skala bleibt deshalb der Abgleich, der genau diesen unsichtbaren Anteil
 * schon enthaelt.
 */

const WINDOW_MS = 5 * 60 * 60 * 1000;
const MONATE = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Liest die Resetzeit aus dem Meldungstext.
 *
 * Drei Formen kommen vor: "resets 7pm", "resets 7:10pm" und mit Datum
 * "resets Sep 16, 7pm". Ohne Datum gilt derselbe Tag, und wenn die Uhrzeit
 * dann schon vorbei waere, der naechste.
 *
 * Gelesen wird in der Zeitzone des Rechners. Der Text nennt zwar eine Zone,
 * aber es ist dieselbe, in der Claude Code laeuft; weicht die ab, ist die
 * Grenze um den Unterschied verschoben und der Wert wird verworfen.
 */
export function parseResetText(text, ts) {
    const match = /resets?\s+(?:([A-Za-z]{3})\s+(\d{1,2}),\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i
        .exec(String(text || ''));
    if (!match || !Number.isFinite(ts)) {
        return null;
    }
    const stunde12 = Number(match[3]);
    if (!(stunde12 >= 1 && stunde12 <= 12)) {
        return null;
    }
    let stunde = stunde12 % 12;
    if (/pm/i.test(match[5])) {
        stunde += 12;
    }

    const ziel = new Date(ts);
    ziel.setHours(stunde, Number(match[4] || 0), 0, 0);
    if (match[1]) {
        const monat = MONATE[match[1].toLowerCase()];
        if (monat === undefined) {
            return null;
        }
        ziel.setMonth(monat, Number(match[2]));
        // Jahreswechsel: ein Datum weit in der Vergangenheit meint naechstes Jahr.
        if (ziel.getTime() < ts - 180 * 24 * 60 * 60 * 1000) {
            ziel.setFullYear(ziel.getFullYear() + 1);
        }
    } else if (ziel.getTime() <= ts) {
        ziel.setDate(ziel.getDate() + 1);
    }
    return ziel.getTime();
}

/** Art des Limits aus dem Text. */
export function limitKind(text) {
    const value = String(text || '');
    if (/weekly/i.test(value)) {
        return 'week';
    }
    // "You've reached your Fable limit." nennt ein einzelnes Modell.
    if (/reached your\s+\S+\s+limit/i.test(value)) {
        return 'model';
    }
    return 'window';
}

/**
 * Macht aus einer Logzeile ein Limit-Ereignis, oder null.
 * @param {object} entry bereits geparste Zeile
 */
export function parseLimitEntry(entry) {
    if (!entry || entry.error !== 'rate_limit') {
        return null;
    }
    const ts = Date.parse(entry.timestamp);
    if (!Number.isFinite(ts)) {
        return null;
    }
    const content = entry.message && entry.message.content;
    const text = Array.isArray(content) && content[0] && typeof content[0].text === 'string'
        ? content[0].text
        : '';
    const kind = limitKind(text);
    const resetAt = parseResetText(text, ts);
    // Ein Fensterreset liegt nie weiter als eine Fensterlaenge weg. Alles
    // andere waere falsch gelesen und richtet mehr Schaden an als Nutzen.
    const plausibel = resetAt !== null
        && (kind !== 'window' || (resetAt > ts && resetAt - ts <= WINDOW_MS));
    return { ts, kind, text, resetAt: plausibel ? resetAt : null };
}

/**
 * Entdoppelt die Ereignisse.
 *
 * Claude Code versucht es nach dem 429 mehrfach, im eigenen Bestand bis zu
 * fuenfzigmal in derselben Minute. Gezaehlt wird je Art und Resetzeit nur das
 * erste Auftreten.
 */
export function dedupeLimits(events) {
    const gesehen = new Map();
    for (const event of [...events].sort((a, b) => a.ts - b.ts)) {
        const key = event.kind + ':' + (event.resetAt ?? Math.floor(event.ts / 600000));
        if (!gesehen.has(key)) {
            gesehen.set(key, event);
        }
    }
    return [...gesehen.values()].sort((a, b) => a.ts - b.ts);
}

/**
 * Fasst zusammen, was die Ereignisse fuer die Anzeige hergeben.
 *
 * @param {{ts: number, kind: string, resetAt: number|null}[]} events
 * @param {number} now
 */
export function summarizeLimits(events, now, spanMs = 28 * 24 * 60 * 60 * 1000) {
    const sauber = dedupeLimits(events || []);
    const jung = sauber.filter((e) => now - e.ts < spanMs);
    const fenster = jung.filter((e) => e.kind === 'window');
    const letztes = sauber.filter((e) => e.kind === 'window').at(-1) ?? null;
    const letzteWoche = sauber.filter((e) => e.kind === 'week').at(-1) ?? null;

    return {
        // Nur das juengste Fensterereignis taugt als Anker fuer das Raster.
        anchor: letztes && letztes.resetAt ? letztes.resetAt : null,
        anchorAt: letztes ? letztes.ts : null,
        weekAnchor: letzteWoche && letzteWoche.resetAt ? letzteWoche.resetAt : null,
        windowHits: fenster.length,
        weekHits: jung.filter((e) => e.kind === 'week').length,
        modelHits: jung.filter((e) => e.kind === 'model').length,
        spanMs,
        last: letztes ? { ts: letztes.ts, resetAt: letztes.resetAt } : null,
    };
}
