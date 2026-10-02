/**
 * Zustand des Projekts, an dem gerade gearbeitet wird.
 *
 * Liest nur, schreibt nie, und kommt ohne Zugangsdaten aus: `git` kennt
 * Branch, Zaehlerstand gegenueber dem Remote, geaenderte Dateien und den
 * letzten Commit, alles lokal im Arbeitsverzeichnis.
 *
 * Bewusst ohne GitHub. Dafuer braeuchte es `gh` oder einen eigenen Token, und
 * damit haette die Anzeige wieder eine Abhaengigkeit nach aussen.
 */

import { execFile } from 'node:child_process';

/** Laenger als das darf kein Aufruf dauern, sonst haengt die Anzeige. */
const TIMEOUT_MS = 2500;

function run(args, cwd) {
    return new Promise((resolve) => {
        execFile('git', args, { cwd, timeout: TIMEOUT_MS, windowsHide: true },
            (error, stdout) => resolve(error ? null : String(stdout)));
    });
}

/**
 * Zerlegt die Kopfzeilen von `git status --porcelain=v2 --branch`.
 *
 * Dort steht alles in einem Aufruf: Branch, Vorsprung und Rueckstand zum
 * Remote, und je eine Zeile pro geaenderter Datei.
 */
export function parseStatus(text) {
    const lines = String(text || '').split('\n');
    const status = { branch: null, ahead: 0, behind: 0, changed: 0, untracked: 0 };
    for (const line of lines) {
        if (line.startsWith('# branch.head ')) {
            const name = line.slice(14).trim();
            status.branch = name === '(detached)' ? null : name;
        } else if (line.startsWith('# branch.ab ')) {
            const match = /\+(\d+)\s+-(\d+)/.exec(line);
            if (match) {
                status.ahead = Number(match[1]);
                status.behind = Number(match[2]);
            }
        } else if (line.startsWith('1 ') || line.startsWith('2 ') || line.startsWith('u ')) {
            status.changed += 1;
        } else if (line.startsWith('? ')) {
            status.untracked += 1;
        }
    }
    return status;
}

/**
 * @param {string} cwd Arbeitsverzeichnis
 * @returns {Promise<object|null>} null, wenn dort kein Repository liegt
 */
export async function readRepo(cwd) {
    if (typeof cwd !== 'string' || cwd.trim() === '') {
        return null;
    }
    const status = await run(['status', '--porcelain=v2', '--branch'], cwd);
    if (status === null) {
        return null; // kein Repository, kein git, oder zu langsam
    }
    const info = parseStatus(status);

    // Hash, Betreff und Zeit in einer Zeile, durch Zeichen getrennt, die in
    // einer Commit-Betreffzeile nicht vorkommen.
    const log = await run(['log', '-1', '--format=%h%x1f%s%x1f%ct'], cwd);
    if (log) {
        const [hash, subject, seconds] = log.trim().split('\u001f');
        if (hash) {
            info.lastCommit = {
                hash,
                subject: subject || '',
                at: Number(seconds) * 1000 || null,
            };
        }
    }
    return info;
}

/**
 * Haelt den zuletzt gelesenen Stand vor und liest hoechstens alle paar
 * Sekunden nach. Die Anzeige fragt im Sekundentakt, git muss das nicht.
 */
export function createGitWatcher({ intervalMs = 12000 } = {}) {
    let cwd = null;
    let state = null;
    let lastRead = 0;
    let laufend = false;

    return {
        /** Setzt das Verzeichnis und liest bei Bedarf nach. */
        async follow(nextCwd, now = Date.now()) {
            if (nextCwd !== cwd) {
                cwd = nextCwd;
                state = null;
                lastRead = 0;
            }
            if (!cwd || laufend || now - lastRead < intervalMs) {
                return state;
            }
            laufend = true;
            try {
                state = await readRepo(cwd);
                lastRead = now;
            } finally {
                laufend = false;
            }
            return state;
        },
        get current() {
            return state;
        },
    };
}
