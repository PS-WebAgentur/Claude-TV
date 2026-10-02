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
    calibration: {
        windowEffort: null, weekEffort: null, computedAt: 0,
        basisWindows: null, countVersion: null,
    },
    // 'system' folgt Windows, sonst 'de' oder 'en'.
    language: 'system',
    // Git-Stand des Projekts anzeigen. Liest nur lokal, laesst sich abschalten.
    showGit: true,
    // Mit Windows starten, still ins Tray, nach einer Wartezeit.
    autostart: true,
    startupDelaySec: 60,
    // Schliessen legt das Fenster ins Tray, statt das Programm zu beenden.
    closeToTray: true,
    // Was der letzte Abgleich mit dem Bericht von Claude Code ergeben hat.
    sync: {
        at: 0,
        windowResetAt: null, windowBudget: null, windowPercent: null,
        weekResetAt: null, weekBudget: null, weekPercent: null,
        scopedResetAt: null, scopedPercent: null,
        countVersion: null,
        // Alle bisherigen Abgleiche, daraus wird das Budget ausgeglichen.
        points: [],
    },
};

function clampNumber(value, min, max, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/** Null ist hier ein gueltiger Wert, anders als bei Budgets. */
function optionalPercent(value) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
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
    const sync = input.sync && typeof input.sync === 'object' ? input.sync : {};

    return {
        // "system" folgt der Windows-Einstellung, aufgeloest wird im Renderer.
        theme: ['light', 'dark', 'system'].includes(input.theme) ? input.theme : 'system',
        view: input.view === 'detail' ? 'detail' : 'overview',
        alwaysOnTop: input.alwaysOnTop === true,
        language: ['de', 'en', 'system'].includes(input.language) ? input.language : 'system',
        showGit: input.showGit !== false,
        // Vorgabe ja: wer das Programm installiert, will es sehen. Abschalten
        // geht im Tray-Menue mit einem Klick.
        autostart: input.autostart !== false,
        startupDelaySec: clampNumber(input.startupDelaySec, 0, 600, DEFAULTS.startupDelaySec),
        closeToTray: input.closeToTray !== false,
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
            // Aus wie vielen abgeschlossenen Fenstern der Wert stammt.
            basisWindows: optionalPositive(cal.basisWindows),
            // Auf welcher Zaehlweise er beruht.
            countVersion: optionalPositive(cal.countVersion),
        },
        sync: {
            at: clampNumber(sync.at, 0, Number.MAX_SAFE_INTEGER, 0),
            windowResetAt: optionalPositive(sync.windowResetAt),
            windowBudget: optionalPositive(sync.windowBudget),
            windowPercent: optionalPercent(sync.windowPercent),
            weekResetAt: optionalPositive(sync.weekResetAt),
            weekBudget: optionalPositive(sync.weekBudget),
            weekPercent: optionalPercent(sync.weekPercent),
            scopedResetAt: optionalPositive(sync.scopedResetAt),
            scopedPercent: optionalPercent(sync.scopedPercent),
            countVersion: optionalPositive(sync.countVersion),
            points: Array.isArray(sync.points)
                ? sync.points
                    .filter((point) => point && Number.isFinite(Number(point.at)))
                    .map((point) => ({
                        at: Math.round(Number(point.at)),
                        countVersion: optionalPositive(point.countVersion),
                        windowPercent: optionalPercent(point.windowPercent),
                        windowEffort: Math.max(0, Math.round(Number(point.windowEffort) || 0)),
                        weekPercent: optionalPercent(point.weekPercent),
                        weekEffort: Math.max(0, Math.round(Number(point.weekEffort) || 0)),
                    }))
                    .slice(-12)
                : [],
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
