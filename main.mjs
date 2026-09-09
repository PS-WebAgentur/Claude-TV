/**
 * Claude TV, Hauptprozess.
 *
 * Liest die Session-Logs, rechnet daraus den Schnappschuss und schickt ihn
 * ueber IPC an das Fenster. Kein Server, kein offener Port, keine
 * Netzwerkschicht. Der Renderer bekommt kein fs zu sehen.
 */

import { app, BrowserWindow, ipcMain, shell, nativeTheme } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Scanner } from './lib/scan.mjs';
import { aggregate } from './lib/aggregate.mjs';
import { Config, configPath } from './lib/config.mjs';
import { readPlan } from './lib/plan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const POLL_MS = 2000;
const BOUNDS_SAVE_MS = 700;
const DEV = process.argv.includes('--dev');

let win = null;
let config = null;
let scanner = null;
let pollTimer = null;
let boundsTimer = null;
let watchHint = false;
let plan = null;

/* ------------------------------------------------------------------ *
 * Daten
 * ------------------------------------------------------------------ */

function buildSnapshot() {
    const snapshot = aggregate({
        messages: scanner.messages,
        cwdBySession: scanner.cwdBySession,
        config: config.data,
        pinned: config.data.calibration,
        plan,
        stats: scanner.stats(),
    });

    // Neu gerechnete Kalibrierung festhalten, damit die Skala einen Tag ruhig
    // bleibt. Fehlschlaege beim Speichern sind unkritisch.
    if (snapshot.calibration.fresh) {
        config.save({
            calibration: {
                windowEffort: snapshot.calibration.fresh.windowEffort,
                weekEffort: snapshot.calibration.fresh.weekEffort
                    ?? config.data.calibration.weekEffort,
                computedAt: snapshot.calibration.fresh.computedAt,
            },
        });
    }
    return snapshot;
}

async function pushUpdate() {
    if (!win || win.isDestroyed()) {
        return;
    }
    try {
        await scanner.refresh();
        win.webContents.send('snapshot', buildSnapshot());
    } catch (error) {
        console.error('claude-tv: Auswertung fehlgeschlagen:', error.message);
    }
}

function startPolling() {
    clearInterval(pollTimer);
    pollTimer = setInterval(pushUpdate, POLL_MS);

    // Der Watcher ist nur Beschleunigung. Ob er auf dieser Plattform
    // Ereignisse liefert, ist nicht garantiert, deshalb laeuft der Poll
    // unabhaengig davon weiter.
    scanner.startWatching(() => {
        if (watchHint) {
            return;
        }
        watchHint = true;
        setTimeout(() => {
            watchHint = false;
            pushUpdate();
        }, 250);
    });
}

/* ------------------------------------------------------------------ *
 * Fenster
 * ------------------------------------------------------------------ */

/**
 * Hintergrundfarbe des Fensters. Muss zum Farbschema passen, sonst blitzt
 * beim Start die falsche Flaeche auf. "system" fragt Windows.
 */
function backgroundColor() {
    const theme = config.data.theme;
    const dark = theme === 'dark' || (theme !== 'light' && nativeTheme.shouldUseDarkColors);
    return dark ? '#17140f' : '#f5f1e8';
}

function saveBoundsSoon() {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
        if (!win || win.isDestroyed() || win.isMinimized()) {
            return;
        }
        const bounds = win.getNormalBounds ? win.getNormalBounds() : win.getBounds();
        config.save({
            window: {
                width: bounds.width,
                height: bounds.height,
                x: bounds.x,
                y: bounds.y,
            },
        });
    }, BOUNDS_SAVE_MS);
}

function createWindow() {
    const stored = config.data.window;
    win = new BrowserWindow({
        width: stored.width,
        height: stored.height,
        x: stored.x ?? undefined,
        y: stored.y ?? undefined,
        minWidth: 520,
        minHeight: 380,
        show: false,
        frame: false,
        title: 'Claude TV',
        backgroundColor: backgroundColor(),
        alwaysOnTop: config.data.alwaysOnTop,
        autoHideMenuBar: true,
        webPreferences: {
            preload: join(HERE, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            spellcheck: false,
        },
    });

    win.removeMenu();
    win.loadFile(join(HERE, 'renderer', 'index.html'));

    win.once('ready-to-show', () => {
        win.show();
        if (DEV) {
            win.webContents.openDevTools({ mode: 'detach' });
        }
    });

    win.on('resize', saveBoundsSoon);
    win.on('move', saveBoundsSoon);
    win.on('close', () => {
        clearTimeout(boundsTimer);
        if (!win.isMinimized()) {
            const bounds = win.getNormalBounds ? win.getNormalBounds() : win.getBounds();
            config.save({ window: bounds });
        }
    });
    win.on('closed', () => {
        win = null;
    });

    // Externe Links gehoeren in den Browser, nicht in dieses Fenster.
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//.test(url)) {
            shell.openExternal(url);
        }
        return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (event) => event.preventDefault());
}

/* ------------------------------------------------------------------ *
 * IPC
 * ------------------------------------------------------------------ */

ipcMain.handle('get-prefs', () => ({
    theme: config.data.theme,
    view: config.data.view,
    alwaysOnTop: config.data.alwaysOnTop,
}));

ipcMain.handle('save-prefs', async (event, patch) => {
    const next = patch && typeof patch === 'object' ? patch : {};
    await config.save({
        theme: next.theme,
        view: next.view,
        alwaysOnTop: next.alwaysOnTop,
    });
    if (win && !win.isDestroyed()) {
        win.setAlwaysOnTop(config.data.alwaysOnTop);
        win.setBackgroundColor(backgroundColor());
    }
    return config.data;
});

ipcMain.on('renderer-ready', () => {
    pushUpdate();
});

ipcMain.on('minimize', () => {
    if (win && !win.isDestroyed()) {
        win.minimize();
    }
});

ipcMain.on('close', () => {
    if (win && !win.isDestroyed()) {
        win.close();
    }
});

/* ------------------------------------------------------------------ *
 * Start
 * ------------------------------------------------------------------ */

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (win) {
            if (win.isMinimized()) {
                win.restore();
            }
            win.focus();
        }
    });

    app.whenReady().then(async () => {
        config = new Config(configPath(app.getPath('userData')));
        await config.load();

        scanner = new Scanner();
        plan = await readPlan();
        // Der Tarif aendert sich selten, einmal pro Stunde nachsehen reicht.
        setInterval(async () => { plan = await readPlan(); }, 60 * 60 * 1000);

        createWindow();
        startPolling();
        // Erster Durchlauf sofort, damit das Fenster nicht leer aufgeht.
        pushUpdate();

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                createWindow();
            }
        });
    });

    app.on('window-all-closed', () => {
        clearInterval(pollTimer);
        if (scanner) {
            scanner.stopWatching();
        }
        app.quit();
    });
}
