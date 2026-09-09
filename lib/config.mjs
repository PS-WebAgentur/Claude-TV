/**
 * Kleine Konfiguration in einer JSON-Datei.
 *
 * Sie enthaelt nur Vorlieben und die gemerkte Kalibrierung, keine Geheimnisse.
 * Im Programm liegt sie im userData-Verzeichnis von Electron, im
 * Entwicklungsmodus neben dem Projekt.
 */

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

export const DEFAULTS = {
    theme: 'system',
    view: 'overview',
    alwaysOnTop: false,
    window: { width: 900, height: 620, x: null, y: null },
    // null heisst: selbst kalibrieren. Eine Zahl ueberschreibt die Kalibrierung.
    budgets: { windowEffort: null, weekEffort: null },
    calibration: { windowEffort: null, weekEffort: null, computedAt: 0 },
};

function clampNumber(value, min, max, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function optionalPositive(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** Fuellt Luecken auf und wirft Unsinn raus. */
export function normalizeConfig(raw) {
    const input = raw && typeof raw === 'object' ? raw : {};
    const win = input.window && typeof input.window === 'object' ? input.window : {};
    const budgets = input.budgets && typeof input.budgets === 'object' ? input.budgets : {};
    const cal = input.calibration && typeof input.calibration === 'object' ? input.calibration : {};

    return {
        // "system" folgt der Windows-Einstellung, aufgeloest wird im Renderer.
        theme: ['light', 'dark', 'system'].includes(input.theme) ? input.theme : 'system',
        view: input.view === 'detail' ? 'detail' : 'overview',
        alwaysOnTop: input.alwaysOnTop === true,
        window: {
            width: clampNumber(win.width, 480, 6000, DEFAULTS.window.width),
            height: clampNumber(win.height, 360, 4000, DEFAULTS.window.height),
            x: Number.isFinite(Number(win.x)) ? Math.round(Number(win.x)) : null,
            y: Number.isFinite(Number(win.y)) ? Math.round(Number(win.y)) : null,
        },
        budgets: {
            windowEffort: optionalPositive(budgets.windowEffort),
            weekEffort: optionalPositive(budgets.weekEffort),
        },
        calibration: {
            windowEffort: optionalPositive(cal.windowEffort),
            weekEffort: optionalPositive(cal.weekEffort),
            computedAt: clampNumber(cal.computedAt, 0, Number.MAX_SAFE_INTEGER, 0),
        },
    };
}

export class Config {
    constructor(path) {
        this.path = path;
        this.data = normalizeConfig(null);
    }

    async load() {
        try {
            this.data = normalizeConfig(JSON.parse(await readFile(this.path, 'utf8')));
        } catch {
            // Fehlt oder ist kaputt: mit den Vorgaben weitermachen.
            this.data = normalizeConfig(null);
        }
        return this.data;
    }

    async save(patch) {
        this.data = normalizeConfig({ ...this.data, ...(patch || {}) });
        const tmp = this.path + '.tmp';
        try {
            await mkdir(dirname(this.path), { recursive: true });
            await writeFile(tmp, JSON.stringify(this.data, null, 2) + '\n', 'utf8');
            await rename(tmp, this.path);
        } catch (error) {
            // Nicht schreiben zu koennen darf die Anzeige nicht anhalten.
            console.error('claude-tv: Konfiguration nicht gespeichert:', error.message);
        }
        return this.data;
    }
}

export function configPath(dir) {
    return join(dir, 'claude-tv.config.json');
}
