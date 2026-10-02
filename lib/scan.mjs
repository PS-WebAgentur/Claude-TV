/**
 * Liest die Session-Logs von Claude Code.
 *
 * Unter ~/.claude/projects/ liegt pro Projekt ein Verzeichnis, darin die
 * JSONL-Datei je Sitzung und darunter weitere Dateien fuer Subagenten und
 * Workflows. Alle zaehlen mit, denn sie verbrauchen dasselbe Kontingent.
 *
 * Gelesen wird inkrementell: pro Datei wird gemerkt, bis zu welchem Byte schon
 * ausgewertet wurde, und beim naechsten Durchgang nur der Zuwachs geparst.
 * Eine angeschnittene letzte Zeile wird gepuffert, nicht verworfen.
 */

import { readdir, readFile, stat, open } from 'node:fs/promises';
import { watch } from 'node:fs';
import { join, relative, sep, basename } from 'node:path';
import { homedir } from 'node:os';
import { parseLimitEntry } from './limits.mjs';

/**
 * Wo Claude Code seine Logs ablegt. Ueblicherweise ~/.claude, wer die
 * Umgebungsvariable CLAUDE_CONFIG_DIR gesetzt hat, hat sie woanders.
 */
export function claudeDir(env = process.env) {
    const custom = env.CLAUDE_CONFIG_DIR;
    return typeof custom === 'string' && custom.trim() !== ''
        ? custom.trim()
        : join(homedir(), '.claude');
}

export const DEFAULT_ROOT = join(claudeDir(), 'projects');

/** Nachrichtenarten, die Kontingent verbrauchen und einen Zeitstempel haben. */
const USAGE_HINT = '"usage"';

/** Wie viele Dateien gleichzeitig gelesen werden. */
const READ_CONCURRENCY = 8;

/**
 * Nur fuer so junge Zeilen werden Werkzeugaufrufe ausgewertet.
 *
 * Die Anzeige zeigt ein gutes Dutzend Schritte. Das fuer jede der
 * zehntausenden alten Nachrichten mitzurechnen kostete beim ersten Scan rund
 * die Haelfte des Durchsatzes, 139 statt 250 MB/s.
 */
const ACTIVITY_MAX_AGE_MS = 2 * 60 * 60 * 1000;

/**
 * Macht aus einem Werkzeugaufruf eine Zeile fuer die Anzeige.
 *
 * Nur Name und Ziel, also Datei, Muster oder Beschreibung. Der Inhalt von
 * Nachrichten bleibt aussen vor: die Anzeige soll zeigen, woran gearbeitet
 * wird, nicht was besprochen wurde.
 */
function describeTool(name, input) {
    const value = input && typeof input === 'object' ? input : {};
    const kurz = (text, max = 70) => {
        const clean = String(text || '').replace(/\s+/g, ' ').trim();
        return clean.length > max ? clean.slice(0, max - 1) + '…' : clean;
    };
    switch (name) {
        case 'Read':
        case 'Edit':
        case 'Write':
        case 'NotebookEdit':
            return { detail: kurz(value.file_path || value.notebook_path), file: value.file_path || null };
        case 'Bash':
        case 'PowerShell':
            return { detail: kurz(value.description || value.command), file: null };
        case 'Glob':
        case 'Grep':
            return { detail: kurz(value.pattern), file: null };
        case 'WebFetch':
        case 'WebSearch':
            return { detail: kurz(value.url || value.query), file: null };
        default:
            return { detail: kurz(value.description || value.title || ''), file: null };
    }
}

/**
 * Guete einer Zeile innerhalb einer Antwort. Die abgeschlossene Zeile schlaegt
 * jede Zwischenzeile, sonst gewinnt die mit mehr Antworttokens.
 */
function rank(message) {
    return (message.final ? 1e12 : 0) + message.output;
}

/**
 * Eine Nachricht, reduziert auf das, was die Anzeige braucht.
 * @typedef {{
 *   ts: number, model: string, effort: number, cacheRead: number,
 *   input: number, output: number, cacheCreate: number, thinking: number,
 *   project: string, session: string, kind: 'main'|'subagent'|'workflow'
 * }} Message
 */

function classify(relPath) {
    const parts = relPath.split(sep);
    if (parts.includes('subagents')) {
        return 'subagent';
    }
    if (parts.includes('workflows')) {
        return 'workflow';
    }
    return 'main';
}

/**
 * Wandelt einen Wert in eine nicht negative ganze Zahl. Fremde Logs koennen
 * alles enthalten, auch Text oder null.
 */
function num(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/**
 * Zerlegt eine Logzeile. Gibt null zurueck, wenn die Zeile keine
 * Assistant-Nachricht mit Verbrauch ist oder nicht lesbar war.
 */
export function parseLine(line, context) {
    if (!line || line.indexOf(USAGE_HINT) === -1) {
        return null;
    }
    let entry;
    try {
        entry = JSON.parse(line);
    } catch {
        return null;
    }
    if (!entry || entry.type !== 'assistant') {
        return null;
    }

    /*
       Ins Limit gelaufen. Die Zeile traegt eine leere Verbrauchsangabe und
       waere sonst als Nachricht mit Aufwand null durchgegangen; dann haette
       die Figur gearbeitet, obwohl nichts ging. Stattdessen wird sie als
       Ereignis gemeldet, denn im Text steht die echte Fenstergrenze.
    */
    if (entry.error === 'rate_limit') {
        const limit = parseLimitEntry(entry);
        return limit ? { limit } : null;
    }

    const message = entry.message;
    const usage = message && message.usage;
    if (!usage) {
        return null;
    }
    const ts = Date.parse(entry.timestamp);
    if (!Number.isFinite(ts)) {
        return null;
    }

    // Werkzeugaufrufe derselben Antwort, fuer die Arbeitsanzeige.
    const tools = [];
    if (Array.isArray(message.content) && Date.now() - ts < ACTIVITY_MAX_AGE_MS) {
        for (const block of message.content) {
            if (block && block.type === 'tool_use' && typeof block.name === 'string') {
                const { detail, file } = describeTool(block.name, block.input);
                tools.push({ name: block.name, detail, file });
            }
        }
    }

    const input = num(usage.input_tokens);
    const output = num(usage.output_tokens);
    const cacheCreate = num(usage.cache_creation_input_tokens);
    const cacheRead = num(usage.cache_read_input_tokens);

    return {
        ts,
        // Kennung der Antwort. Claude Code schreibt pro Inhaltsblock eine
        // eigene Zeile mit derselben id und derselben Verbrauchsangabe, also
        // Denken, Werkzeugaufruf und Abschluss getrennt. Ohne diese Kennung
        // zaehlt dieselbe Antwort mehrfach.
        id: message.id || entry.requestId || entry.uuid || null,
        // Die Zeile mit stop_reason ist die vollstaendige, nur dort steht die
        // endgueltige Zahl der Antworttokens.
        final: Boolean(message.stop_reason),
        model: typeof message.model === 'string' ? message.model : 'unbekannt',
        // Aufwand ohne Cache-Lesevorgaenge: die sind der billige Teil und
        // wuerden jede Lastanzeige dominieren.
        effort: input + output + cacheCreate,
        cacheRead,
        input,
        output,
        cacheCreate,
        thinking: num(usage.output_tokens_details && usage.output_tokens_details.thinking_tokens),
        project: context.project,
        session: context.session,
        kind: context.kind,
        tools,
    };
}

/** Sammelt alle JSONL-Dateien unter dem Wurzelverzeichnis. */
async function collectFiles(root) {
    const found = [];

    async function walk(dir) {
        let entries;
        try {
            entries = await readdir(dir, { withFileTypes: true });
        } catch {
            return; // Verzeichnis verschwunden oder ohne Leserecht
        }
        for (const entry of entries) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) {
                await walk(full);
            } else if (entry.name.endsWith('.jsonl')) {
                found.push(full);
            }
        }
    }

    await walk(root);
    return found;
}

/**
 * Liest einen Byte-Bereich einer Datei. Bewusst nicht readFile, damit bei
 * grossen Dateien nur der Zuwachs im Speicher landet.
 */
async function readRange(path, from, to) {
    if (to <= from) {
        return '';
    }
    const handle = await open(path, 'r');
    try {
        const length = to - from;
        const buffer = Buffer.allocUnsafe(length);
        const { bytesRead } = await handle.read(buffer, 0, length, from);
        return buffer.subarray(0, bytesRead).toString('utf8');
    } finally {
        await handle.close();
    }
}

export class Scanner {
    /**
     * @param {{root?: string}} [options]
     */
    constructor(options = {}) {
        this.root = options.root || DEFAULT_ROOT;
        /** @type {Map<string, {offset: number, partial: string, meta: object}>} */
        this.files = new Map();
        /** @type {Message[]} */
        this.messages = [];
        /** Echter Arbeitspfad je Sitzung, aus dem Log gelesen. */
        this.cwdBySession = new Map();
        this.rootMissing = false;
        /** Laufender Durchgang, damit sich zwei nie ueberholen. */
        this.pending = null;
        /** message.id -> bereits gezaehlte Nachricht, gegen Doppelzaehlung. */
        this.byId = new Map();
        /** Limit-Ereignisse, siehe lib/limits.mjs. */
        this.limits = [];
    }

    /**
     * Sucht neue und gewachsene Dateien und wertet nur den Zuwachs aus.
     *
     * Laeuft schon einer, wird dessen Versprechen zurueckgegeben statt ein
     * zweiter gestartet. Sonst holen sich ueberlappende Durchgaenge dieselben
     * Dateien doppelt: der zweite sieht bei allem, was der erste noch nicht
     * erreicht hat, `offset: 0` und liest es noch einmal ganz. Beim ersten
     * Scan eines gewachsenen Logbestands dauert ein Durchgang laenger als der
     * Abstand der Abfrage, dann stapeln sich die Laeufe, der Speicher laeuft
     * voll und die Anzeige bekommt nie einen Schnappschuss.
     *
     * @returns {Promise<Message[]>} die neu erkannten Nachrichten
     */
    refresh() {
        if (this.pending) {
            return this.pending;
        }
        const run = this.scanOnce().finally(() => {
            if (this.pending === run) {
                this.pending = null;
            }
        });
        this.pending = run;
        return run;
    }

    /** Ein einzelner Durchgang. Nur ueber refresh() aufrufen. */
    async scanOnce() {
        let paths;
        try {
            paths = await collectFiles(this.root);
            this.rootMissing = false;
        } catch {
            this.rootMissing = true;
            return [];
        }
        if (paths.length === 0) {
            try {
                await stat(this.root);
            } catch {
                this.rootMissing = true;
            }
        }

        // Mehrere Dateien gleichzeitig. Der erste Start liest den ganzen
        // Bestand, und der ist schnell ein paar hundert Megabyte gross;
        // nacheinander wartet dabei fast nur die Platte. Jede Datei fuehrt
        // ihren eigenen Zustand, sie kommen sich also nicht in die Quere.
        const fresh = [];
        let next = 0;
        let changed = false;
        const worker = async () => {
            while (next < paths.length) {
                for (const message of await this.scanFile(paths[next++])) {
                    const state = this.absorb(message);
                    if (state === 'new') {
                        fresh.push(message);
                    }
                    if (state !== 'ignored') {
                        changed = true;
                    }
                }
            }
        };
        await Promise.all(
            Array.from({ length: Math.min(READ_CONCURRENCY, paths.length) }, worker),
        );

        if (fresh.length > 0) {
            this.messages.push(...fresh);
        }
        if (changed) {
            // Auch eine nachgereichte Zeile kann den Zeitstempel um
            // Millisekunden verschieben, deshalb bei jeder Aenderung sortieren.
            this.messages.sort((a, b) => a.ts - b.ts);
        }
        return fresh;
    }

    /**
     * Nimmt eine gelesene Nachricht auf und haelt Doppelte heraus.
     *
     * Claude Code schreibt eine Zeile je Inhaltsblock derselben Antwort. Alle
     * tragen dieselbe `message.id` und dieselben Cache-Zahlen, nur die
     * Antworttokens stehen erst in der letzten Zeile vollstaendig drin. Wer
     * jede Zeile zaehlt, zaehlt den Verbrauch mehrfach; gemessen am eigenen
     * Bestand war es fast das Dreifache.
     *
     * @returns {'new'|'updated'|'ignored'}
     */
    absorb(message) {
        if (!message.id) {
            return 'new';
        }
        const known = this.byId.get(message.id);
        if (!known) {
            this.byId.set(message.id, message);
            return 'new';
        }
        if (rank(message) <= rank(known)) {
            return 'ignored';
        }
        // Die bessere Zeile gewinnt. An Ort und Stelle ersetzen, damit die
        // Nachricht im Verzeichnis und in der Liste dieselbe bleibt.
        Object.assign(known, message);
        return 'updated';
    }

    /**
     * Wertet den Zuwachs einer einzelnen Datei aus.
     * @returns {Promise<Message[]>} die dort neu gefundenen Nachrichten
     */
    async scanFile(path) {
        let size;
        try {
            size = (await stat(path)).size;
        } catch {
            return []; // gerade geloescht
        }

        let state = this.files.get(path);
        if (!state) {
            const rel = relative(this.root, path);
            const parts = rel.split(sep);
            state = {
                offset: 0,
                partial: '',
                meta: {
                    project: parts[0] || 'unbekannt',
                    session: basename(path, '.jsonl'),
                    kind: classify(rel),
                },
            };
            this.files.set(path, state);
        }

        // Kleiner als zuvor heisst: neu geschrieben oder gekuerzt.
        if (size < state.offset) {
            state.offset = 0;
            state.partial = '';
            const gehoertDazu = (m) => m.session === state.meta.session
                && m.project === state.meta.project && m.kind === state.meta.kind;
            this.messages = this.messages.filter((m) => !gehoertDazu(m));
            // Auch aus dem Kennungsverzeichnis raus, sonst gilt die Nachricht
            // beim erneuten Einlesen als schon gezaehlt und fehlt dann ganz.
            for (const [id, m] of this.byId) {
                if (gehoertDazu(m)) {
                    this.byId.delete(id);
                }
            }
        }
        if (size === state.offset) {
            return [];
        }

        const chunk = await readRange(path, state.offset, size);
        state.offset = size;

        const text = state.partial + chunk;
        const lines = text.split('\n');
        // Die letzte Zeile kann angeschnitten sein, solange die Datei nicht
        // mit einem Zeilenumbruch endet.
        state.partial = text.endsWith('\n') ? '' : (lines.pop() ?? '');

        const found = [];
        for (const line of lines) {
            this.rememberCwd(line, state.meta.session);
            const message = parseLine(line, state.meta);
            if (!message) {
                continue;
            }
            if (message.limit) {
                this.limits.push(message.limit);
                continue;
            }
            found.push(message);
        }
        return found;
    }

    /**
     * Fischt den echten Arbeitspfad aus einer Logzeile. Die Verzeichnisnamen
     * unter projects/ sind verlustbehaftet kodiert, jedes Sonderzeichen wird
     * zu einem Bindestrich. Der cwd im Log ist die verlaessliche Quelle.
     */
    rememberCwd(line, session) {
        if (this.cwdBySession.has(session) || !line || line.indexOf('"cwd"') === -1) {
            return;
        }
        const match = /"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(line);
        if (!match) {
            return;
        }
        try {
            this.cwdBySession.set(session, JSON.parse('"' + match[1] + '"'));
        } catch {
            /* egal, dann bleibt der Verzeichnisname */
        }
    }

    /** Beobachtet das Wurzelverzeichnis, falls die Plattform mitspielt. */
    startWatching(onHint) {
        try {
            this.watcher = watch(this.root, { recursive: true }, () => onHint());
            this.watcher.on('error', () => this.stopWatching());
            return true;
        } catch {
            this.watcher = null;
            return false;
        }
    }

    stopWatching() {
        if (this.watcher) {
            try {
                this.watcher.close();
            } catch { /* schon zu */ }
            this.watcher = null;
        }
    }

    stats() {
        return {
            files: this.files.size,
            messages: this.messages.length,
            rootMissing: this.rootMissing,
            watching: Boolean(this.watcher),
        };
    }
}

/** Einmaliger vollstaendiger Durchlauf, fuer Tests und Werkzeuge. */
export async function scanOnce(root = DEFAULT_ROOT) {
    const scanner = new Scanner({ root });
    await scanner.refresh();
    return scanner;
}

export { readFile };
