/**
 * Erfundene Daten fuer die Entwicklung.
 *
 * Die Szenarien erzeugen echte Nachrichtenlisten und schicken sie durch
 * aggregate(). Damit hat die Oberflaeche im Demomodus garantiert dieselbe
 * Datenform wie im Betrieb, und jeder Figurenzustand ist gezielt ansteuerbar.
 */

import { aggregate, WINDOW_MS } from './aggregate.mjs';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

const MODELS = ['claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5', 'claude-haiku-4-5-20251001'];

function message(ts, effort, model = 'claude-opus-5') {
    return {
        ts,
        model,
        effort,
        cacheRead: effort * 18,
        input: Math.round(effort * 0.04),
        output: Math.round(effort * 0.12),
        cacheCreate: Math.round(effort * 0.84),
        thinking: Math.round(effort * 0.05),
        project: 'C--Users-demo-Documents-GitHub-beispiel-app',
        session: 'demo-' + (ts % 7),
        kind: ts % 3 === 0 ? 'subagent' : 'main',
    };
}

/** Geschichte aus abgeschlossenen Fenstern, damit die Kalibrierung greift. */
function history(now, windows = 26) {
    const out = [];
    for (let w = windows; w >= 1; w--) {
        // Ueber drei Wochen verteilt, damit auch die Wochenskala kalibriert.
        const start = now - w * 20 * HOUR;
        const count = 6 + (w % 5);
        const size = 140000 + (w % 4) * 60000;
        for (let i = 0; i < count; i++) {
            out.push(message(start + i * 12 * MINUTE, size, MODELS[(w + i) % MODELS.length]));
        }
    }
    return out;
}

/** Nachrichten im laufenden Fenster, so verteilt dass es den Zustand ergibt. */
function currentWindow(now, { startedAgo, effortTotal, lastAgo, burst = false }) {
    const start = now - startedAgo;
    const out = [];
    if (burst) {
        // Alles in den letzten Minuten: hohes Tempo.
        const count = 8;
        for (let i = 0; i < count; i++) {
            out.push(message(now - lastAgo - (count - 1 - i) * MINUTE,
                Math.round(effortTotal / count), MODELS[i % MODELS.length]));
        }
        return out;
    }
    const spread = Math.max(1, startedAgo - lastAgo);
    const count = 10;
    for (let i = 0; i < count; i++) {
        out.push(message(start + Math.round((spread * i) / (count - 1)),
            Math.round(effortTotal / count), MODELS[i % MODELS.length]));
    }
    out.push(message(now - lastAgo, Math.round(effortTotal / count), 'claude-opus-5'));
    return out;
}

const BUDGET = 1_400_000;

export const SCENARIOS = {
    working: (now) => ({
        messages: [...history(now), ...currentWindow(now,
            { startedAgo: 2 * HOUR, effortTotal: BUDGET * 0.38, lastAgo: 25 * 1000 })],
        config: { budgets: { windowEffort: BUDGET } },
    }),
    idle: (now) => ({
        messages: [...history(now), ...currentWindow(now,
            { startedAgo: 3 * HOUR, effortTotal: BUDGET * 0.3, lastAgo: 9 * MINUTE })],
        config: { budgets: { windowEffort: BUDGET } },
    }),
    sleeping: (now) => ({
        messages: [...history(now), ...currentWindow(now,
            { startedAgo: 4 * HOUR, effortTotal: BUDGET * 0.22, lastAgo: 70 * MINUTE })],
        config: { budgets: { windowEffort: BUDGET } },
    }),
    sprinting: (now) => ({
        messages: [...history(now), ...currentWindow(now,
            { startedAgo: 40 * MINUTE, effortTotal: BUDGET * 0.5, lastAgo: 15 * 1000, burst: true })],
        config: { budgets: { windowEffort: BUDGET } },
    }),
    strained: (now) => ({
        messages: [...history(now), ...currentWindow(now,
            { startedAgo: 3 * HOUR, effortTotal: BUDGET * 0.82, lastAgo: 40 * 1000 })],
        config: { budgets: { windowEffort: BUDGET } },
    }),
    spent: (now) => ({
        messages: [...history(now), ...currentWindow(now,
            { startedAgo: 4.2 * HOUR, effortTotal: BUDGET * 0.97, lastAgo: 30 * 1000 })],
        config: { budgets: { windowEffort: BUDGET } },
    }),
    fresh: (now) => ({
        messages: [...history(now), message(now - 20 * 1000, Math.round(BUDGET * 0.02))],
        config: { budgets: { windowEffort: BUDGET } },
    }),
    uncalibrated: (now) => ({
        messages: [
            message(now - 30 * HOUR, 200000),
            ...currentWindow(now, { startedAgo: HOUR, effortTotal: 300000, lastAgo: 60 * 1000 }),
        ],
        config: {},
    }),
    empty: () => ({ messages: [], config: {} }),
};

export const SCENARIO_NAMES = Object.keys(SCENARIOS);

/**
 * Baut einen Schnappschuss fuer ein Szenario.
 * @param {string} name
 * @param {number} [now]
 */
export function demoSnapshot(name, now = Date.now()) {
    const build = SCENARIOS[name] || SCENARIOS.working;
    const { messages, config } = build(now);
    const cwdBySession = new Map();
    for (const m of messages) {
        cwdBySession.set(m.session, 'C:/Users/demo/Documents/GitHub/beispiel-app');
    }
    const snapshot = aggregate({
        messages,
        cwdBySession,
        config,
        now,
        plan: 'Max 5x',
        stats: { files: 12, messages: messages.length, watching: true, rootMissing: false, demo: name },
    });
    // Damit die Detailansicht nicht nur ein Projekt zeigt.
    if (snapshot.projects.length === 1 && snapshot.totals.effort > 0) {
        const base = snapshot.projects[0];
        snapshot.projects = [
            base,
            { dir: 'x2', name: 'Spam-Cleaner', effort: Math.round(base.effort * 0.6), share: 0.24 },
            { dir: 'x3', name: 'Inventar-Tool', effort: Math.round(base.effort * 0.35), share: 0.14 },
            { dir: 'x4', name: 'Claude TV (Worktree)', effort: Math.round(base.effort * 0.18), share: 0.07 },
        ];
    }
    return snapshot;
}

export { WINDOW_MS };
