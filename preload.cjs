/**
 * Bruecke zwischen Fenster und Hauptprozess.
 *
 * Der Renderer bekommt genau diese sieben Funktionen und sonst nichts. Kein fs,
 * kein Zugriff auf Pfade, keine Moeglichkeit, etwas auszufuehren.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('claudeTV', {
    /** Meldet sich fuer neue Schnappschuesse an. */
    onUpdate(callback) {
        if (typeof callback !== 'function') {
            return;
        }
        ipcRenderer.on('snapshot', (_event, snapshot) => callback(snapshot));
        // Sagt dem Hauptprozess, dass das Fenster bereit ist.
        ipcRenderer.send('renderer-ready');
    },

    getPrefs() {
        return ipcRenderer.invoke('get-prefs');
    },

    savePrefs(patch) {
        return ipcRenderer.invoke('save-prefs', patch);
    },

    /** Uebergibt den kopierten Bericht aus Claude Code zum Abgleich. */
    applyReport(text) {
        return ipcRenderer.invoke('apply-report', String(text || ''));
    },

    /**
     * Liest die Zwischenablage, einmal und nur auf Anforderung.
     *
     * Kein Lauschen im Hintergrund: gelesen wird genau dann, wenn das
     * Abgleichfenster aufgeht.
     */
    readClipboard() {
        return ipcRenderer.invoke('read-clipboard');
    },

    minimize() {
        ipcRenderer.send('minimize');
    },

    close() {
        ipcRenderer.send('close');
    },
});
