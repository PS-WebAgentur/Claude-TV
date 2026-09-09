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

export const DEFAULT_ROOT = join(homedir(), '.claude', 'projects');

/** Nachrichtenarten, die Kontingent verbrauchen und einen Zeitstempel haben. */
const USAGE_HINT = '"usage"';

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
    const message = entry.message;
    const usage = message && message.usage;
    if (!usage) {
        return null;
    }
    const ts = Date.parse(entry.timestamp);
    if (!Number.isFinite(ts)) {
        return null;
    }

    const input = num(usage.input_tokens);
    const output = num(usage.output_tokens);
    const cacheCreate = num(usage.cache_creation_input_tokens);
    const cacheRead = num(usage.cache_read_input_tokens);

    return {
        ts,
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
    }

    /**
     * Sucht neue und gewachsene Dateien und wertet nur den Zuwachs aus.
     * @returns {Promise<Message[]>} die neu erkannten Nachrichten
     */
    async refresh() {
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

        const fresh = [];
        for (const path of paths) {
            let size;
            try {
                size = (await stat(path)).size;
            } catch {
                continue; // gerade geloescht
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
                this.messages = this.messages.filter((m) => m.session !== state.meta.session
                    || m.project !== state.meta.project || m.kind !== state.meta.kind);
            }
            if (size === state.offset) {
                continue;
            }

            const chunk = await readRange(path, state.offset, size);
            state.offset = size;

            const text = state.partial + chunk;
            const lines = text.split('\n');
            // Die letzte Zeile kann angeschnitten sein, solange die Datei
            // nicht mit einem Zeilenumbruch endet.
            state.partial = text.endsWith('\n') ? '' : (lines.pop() ?? '');

            for (const line of lines) {
                this.rememberCwd(line, state.meta.session);
                const message = parseLine(line, state.meta);
                if (message) {
                    fresh.push(message);
                }
            }
        }

        if (fresh.length > 0) {
            this.messages.push(...fresh);
            this.messages.sort((a, b) => a.ts - b.ts);
        }
        return fresh;
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
