/**
 * Claude TV, Hauptprozess.
 *
 * Liest die Session-Logs, rechnet daraus den Schnappschuss und schickt ihn
 * ueber IPC an das Fenster. Kein Server, kein offener Port, keine
 * Netzwerkschicht. Der Renderer bekommt kein fs zu sehen.
 */

import {
    app, BrowserWindow, ipcMain, shell, nativeTheme, Tray, Menu, nativeImage, clipboard,
} from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Scanner } from './lib/scan.mjs';
import { aggregate } from './lib/aggregate.mjs';
import { Config, configPath } from './lib/config.mjs';
import { readPlan } from './lib/plan.mjs';
import { parseReport, buildSync } from './lib/report.mjs';
import { encodePng, paint } from './lib/png.mjs';
import { createGitWatcher } from './lib/git.mjs';
import { translate, resolveLanguage } from './lib/i18n.mjs';
import { TRAY_FRAMES, TRAY_ANIMATIONS, TRAY_PALETTE } from './lib/tray-sprite.mjs';
import { COUNT_VERSION, WINDOW_MS, WEEK_MS } from './lib/aggregate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const POLL_MS = 2000;
const BOUNDS_SAVE_MS = 700;
const DEV = process.argv.includes('--dev');
// Beim Start mit Windows: erst ins Tray, das Fenster bleibt zu.
const STARTUP = process.argv.includes('--startup');

let win = null;
let config = null;
let scanner = null;
let pollTimer = null;
let boundsTimer = null;
let watchHint = false;
let plan = null;
let tray = null;
let trayTimer = null;
let trayState = 'idle';
let trayFrame = 0;
let quitting = false;
let lastSnapshot = null;
const gitWatcher = createGitWatcher();

/** Text in der eingestellten Sprache, Vorgabe ist die von Windows. */
function t(key, vars) {
    const lang = resolveLanguage(config?.data.language ?? 'system', app.getLocale());
    return translate(lang, key, vars || {});
}

/* ------------------------------------------------------------------ *
 * Daten
 * ------------------------------------------------------------------ */

function buildSnapshot() {
    const snapshot = aggregate({
        messages: scanner.messages,
        cwdBySession: scanner.cwdBySession,
        config: config.data,
        pinned: config.data.calibration,
        sync: config.data.sync,
        plan,
        limits: scanner.limits,
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
                basisWindows: snapshot.calibration.fresh.basisWindows,
                countVersion: snapshot.calibration.fresh.countVersion,
            },
        });
    }
    return snapshot;
}

// Solange ein Durchgang laeuft, faellt jeder weitere Anstoss aus. Der Poll,
// der Watcher und der Start rufen sonst gleichzeitig an, und beim ersten Scan
// eines grossen Logbestands dauert ein Durchgang laenger als die 2 Sekunden
// des Polls.
let updating = false;

async function pushUpdate() {
    // Ohne Fenster laeuft es weiter, das Tray zeigt ja auch dann etwas an.
    if (updating) {
        return;
    }
    updating = true;
    try {
        await scanner.refresh();
        lastSnapshot = buildSnapshot();
        // Git liest nur alle paar Sekunden nach, der Rest kommt aus dem Cache.
        if (config.data.showGit) {
            lastSnapshot.git = await gitWatcher.follow(lastSnapshot.insights?.activity?.cwd ?? null)
                ?? gitWatcher.current;
        } else {
            lastSnapshot.git = null;
            lastSnapshot.gitOff = true;
        }
        updateTray(lastSnapshot);
        if (win && !win.isDestroyed()) {
            win.webContents.send('snapshot', lastSnapshot);
        }
    } catch (error) {
        console.error('claude-tv: Auswertung fehlgeschlagen:', error.message);
    } finally {
        updating = false;
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
    return dark ? '#000000' : '#f5f1e8';
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

    /*
       Fehler aus dem Fenster im Entwicklungslauf sichtbar machen. Ohne das
       bleibt ein kaputtes Skript stumm: das Fenster steht da, nur ohne Zahlen.
    */
    if (DEV) {
        win.webContents.on('console-message', (event, level, message, line, source) => {
            if (level >= 2) {
                console.error('renderer:', message, '(' + source + ':' + line + ')');
            }
        });
    }

    win.once('ready-to-show', () => {
        win.show();
        if (DEV) {
            win.webContents.openDevTools({ mode: 'detach' });
        }
    });

    win.on('resize', saveBoundsSoon);
    win.on('move', saveBoundsSoon);
    win.on('close', (event) => {
        clearTimeout(boundsTimer);
        if (!win.isMinimized()) {
            const bounds = win.getNormalBounds ? win.getNormalBounds() : win.getBounds();
            config.save({ window: bounds });
        }
        // Nur verstecken, nicht beenden: das Programm lebt im Tray weiter.
        if (config.data.closeToTray && !quitting) {
            event.preventDefault();
            win.hide();
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
 * Tray
 * ------------------------------------------------------------------ */

/** Koerperfarbe des Tray-Bildes, passend zum Farbschema von Windows. */
function trayBody() {
    return nativeTheme.shouldUseDarkColors ? [0xe0, 0x8b, 0x6b] : [0xc4, 0x64, 0x46];
}

const trayCache = new Map();

/**
 * Ein Tray-Bild als nativeImage.
 *
 * Gezeichnet wird 32 mal 32 und mit Massstab 2 uebergeben. Windows verlangt
 * bei 100 Prozent 16 Punkte, bei 200 Prozent 32; so liegt fuer beide Faelle
 * genug Auflösung bereit und nichts wird weichgezeichnet.
 */
function trayImage(name) {
    const key = name + (nativeTheme.shouldUseDarkColors ? ':dark' : ':light');
    if (trayCache.has(key)) {
        return trayCache.get(key);
    }
    const map = TRAY_FRAMES[name] || TRAY_FRAMES.open;
    const drawn = paint(map, TRAY_PALETTE(trayBody()), { size: 32, scale: 2 });
    const image = nativeImage.createFromBuffer(
        encodePng(drawn.width, drawn.height, drawn.pixels), { scaleFactor: 2 },
    );
    trayCache.set(key, image);
    return image;
}

function trayTooltip(snapshot) {
    if (!snapshot) {
        return 'Claude TV';
    }
    const teile = ['Claude TV'];
    if (snapshot.window.percent !== null) {
        teile.push(t('tray.tooltip.window', { prozent: Math.round(snapshot.window.percent) }));
    }
    if (snapshot.window.resetAt) {
        const reset = new Date(Math.round(snapshot.window.resetAt / 60000) * 60000);
        teile.push(t('tray.tooltip.reset', {
            uhr: String(reset.getHours()).padStart(2, '0')
                + ':' + String(reset.getMinutes()).padStart(2, '0'),
        }));
    }
    return teile.join('\n');
}

/** Spielt den Ablauf des aktuellen Zustands, Bild fuer Bild. */
function stepTray() {
    if (!tray || tray.isDestroyed()) {
        return;
    }
    const ablauf = TRAY_ANIMATIONS[trayState] || TRAY_ANIMATIONS.idle;
    const frame = ablauf[trayFrame % ablauf.length];
    tray.setImage(trayImage(frame.frame));

    clearTimeout(trayTimer);
    trayTimer = setTimeout(() => {
        trayFrame++;
        stepTray();
    }, frame.hold || 1000);
}

function buildTrayMenu() {
    return Menu.buildFromTemplate([
        { label: t('tray.show'), click: () => showWindow() },
        { type: 'separator' },
        {
            label: t('tray.onTop'),
            type: 'checkbox',
            checked: config.data.alwaysOnTop,
            click: async (item) => {
                await config.save({ alwaysOnTop: item.checked });
                if (win && !win.isDestroyed()) {
                    win.setAlwaysOnTop(item.checked);
                }
            },
        },
        {
            label: t('tray.autostart'),
            type: 'checkbox',
            checked: config.data.autostart,
            click: async (item) => {
                await config.save({ autostart: item.checked });
                applyAutostart();
            },
        },
        {
            label: t('tray.closeToTray'),
            type: 'checkbox',
            checked: config.data.closeToTray,
            click: async (item) => {
                await config.save({ closeToTray: item.checked });
            },
        },
        {
            label: t('tray.git'),
            type: 'checkbox',
            checked: config.data.showGit,
            click: async (item) => {
                await config.save({ showGit: item.checked });
                pushUpdate();
            },
        },
        { type: 'separator' },
        {
            label: t('tray.quit'),
            click: () => {
                quitting = true;
                app.quit();
            },
        },
    ]);
}

function createTray() {
    tray = new Tray(trayImage('open'));
    tray.setToolTip('Claude TV');
    tray.setContextMenu(buildTrayMenu());
    tray.on('click', () => {
        if (win && !win.isDestroyed() && win.isVisible() && !win.isMinimized()) {
            win.hide();
        } else {
            showWindow();
        }
    });
    // Das Farbschema von Windows kann sich im Betrieb aendern.
    nativeTheme.on('updated', () => {
        trayCache.clear();
        stepTray();
    });
    stepTray();
}

function updateTray(snapshot) {
    if (!tray || tray.isDestroyed()) {
        return;
    }
    tray.setToolTip(trayTooltip(snapshot));
    const next = snapshot.character.state;
    if (next !== trayState && TRAY_ANIMATIONS[next]) {
        trayState = next;
        trayFrame = 0;
        stepTray();
    }
}

function showWindow() {
    if (!win || win.isDestroyed()) {
        createWindow();
        win.once('ready-to-show', () => win.show());
        return;
    }
    if (win.isMinimized()) {
        win.restore();
    }
    win.show();
    win.focus();
}

/**
 * Autostart eintragen oder loeschen.
 *
 * Ueber den Anmeldeeintrag von Windows, nicht ueber die Aufgabenplanung: der
 * verschwindet mit dem Programm wieder und braucht kein Administratorrecht.
 * Die Verzoegerung macht das Programm selbst, siehe --startup.
 */
function applyAutostart() {
    if (!app.isPackaged) {
        return; // im Entwicklungslauf nichts in die Registrierung schreiben
    }
    app.setLoginItemSettings({
        openAtLogin: config.data.autostart,
        args: ['--startup'],
    });
}

/* ------------------------------------------------------------------ *
 * IPC
 * ------------------------------------------------------------------ */

ipcMain.handle('get-prefs', () => ({
    theme: config.data.theme,
    view: config.data.view,
    alwaysOnTop: config.data.alwaysOnTop,
    language: config.data.language,
}));

ipcMain.handle('save-prefs', async (event, patch) => {
    const next = patch && typeof patch === 'object' ? patch : {};
    await config.save({
        theme: next.theme,
        view: next.view,
        alwaysOnTop: next.alwaysOnTop,
        language: next.language,
    });
    if (win && !win.isDestroyed()) {
        win.setAlwaysOnTop(config.data.alwaysOnTop);
        win.setBackgroundColor(backgroundColor());
    }
    // Das Tray-Menue spricht dieselbe Sprache wie das Fenster.
    if (tray && !tray.isDestroyed()) {
        tray.setContextMenu(buildTrayMenu());
    }
    return config.data;
});

/**
 * Uebernimmt den kopierten Bericht aus Claude Code.
 *
 * Aus Prozentwert und dem, was wir im selben Zeitraum gemessen haben, ergibt
 * sich das echte Budget. Der Zeitraum kommt aus dem Bericht selbst, also aus
 * der Resetzeit minus Fensterlaenge, nicht aus unserer eigenen Schaetzung.
 */
ipcMain.handle('apply-report', async (event, text) => {
    const report = parseReport(text);
    if (!report) {
        return { ok: false, message: 'Darin steht kein Limit, das ich lesen kann.' };
    }

    const effortBetween = (from, to) => {
        let sum = 0;
        for (const message of scanner.messages) {
            if (message.ts > from && message.ts <= to) {
                sum += message.effort;
            }
        }
        return sum;
    };

    const sync = buildSync(report, effortBetween, {
        windowMs: WINDOW_MS,
        weekMs: WEEK_MS,
        countVersion: COUNT_VERSION,
        // Frueher Abgeglichenes fliesst mit ein, das glaettet die Skala.
        points: config.data.sync.points,
    });

    await config.save({ sync });
    pushUpdate();

    return {
        ok: true,
        windowBudget: sync.windowBudget,
        weekBudget: sync.weekBudget,
        windowResetAt: sync.windowResetAt,
        // Was Claude Code an Anfragen gezaehlt hat, gegen unsere eigene Zahl.
        requests7d: report.requests7d,
        ourRequests7d: scanner.messages
            .filter((m) => m.ts > report.at - WEEK_MS && m.ts <= report.at).length,
        points: sync.points.length,
    };
});

/*
   Die Zwischenablage wird nur auf Anforderung gelesen, nicht beobachtet.
   Zurueckgegeben wird nur, was wie ein Bericht aussieht; alles andere waere
   fremder Text, der hier nichts zu suchen hat.
*/
ipcMain.handle('read-clipboard', () => {
    const text = clipboard.readText();
    return parseReport(text) ? text : null;
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
        win.close(); // je nach Einstellung verstecken oder beenden
    }
});

/* ------------------------------------------------------------------ *
 * Start
 * ------------------------------------------------------------------ */

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', () => {
        showWindow();
    });

    app.whenReady().then(async () => {
        config = new Config(configPath(app.getPath('userData')));
        await config.load();

        scanner = new Scanner();
        plan = await readPlan();
        // Der Tarif aendert sich selten, einmal pro Stunde nachsehen reicht.
        setInterval(async () => { plan = await readPlan(); }, 60 * 60 * 1000);

        createTray();
        applyAutostart();

        if (!STARTUP) {
            createWindow();
            startPolling();
            // Erster Durchlauf sofort, damit das Fenster nicht leer aufgeht.
            pushUpdate();
        } else {
            /*
               Mit Windows gestartet: das Fenster bleibt zu, und der erste
               Scan wartet. Der Bestand ist ein paar hundert Megabyte gross,
               und waehrend der Anmeldung ist die Platte ohnehin belegt.
            */
            const wait = Math.max(0, config.data.startupDelaySec) * 1000;
            setTimeout(() => {
                startPolling();
                pushUpdate();
            }, wait);
        }

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                createWindow();
            }
        });
    });

    // Ohne Fenster wird nicht beendet, das Tray bleibt.
    app.on('window-all-closed', () => {});

    app.on('before-quit', () => {
        quitting = true;
        clearInterval(pollTimer);
        clearTimeout(trayTimer);
        if (scanner) {
            scanner.stopWatching();
        }
        if (tray && !tray.isDestroyed()) {
            tray.destroy();
        }
    });
}
