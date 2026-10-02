#!/usr/bin/env node
/**
 * Entwicklungsserver.
 *
 * Liefert dieselbe Oberflaeche, die spaeter im Electron-Fenster laeuft, nur
 * ueber HTTP. Das ist der einzige Weg, sie im Browser wirklich anzusehen und zu
 * pruefen. Die Daten kommen entweder aus den echten Logs oder aus einem
 * Demoszenario.
 *
 *   npm run serve
 *   http://127.0.0.1:8790/?demo=spent
 *   http://127.0.0.1:8790/?demo=working&theme=dark&view=detail
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Scanner } from '../lib/scan.mjs';
import { aggregate } from '../lib/aggregate.mjs';
import { demoSnapshot, SCENARIO_NAMES } from '../lib/demo.mjs';
import { readPlan } from '../lib/plan.mjs';
import { Config, configPath } from '../lib/config.mjs';
import { createGitWatcher } from '../lib/git.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PORT = Number(process.argv.includes('--port')
    ? process.argv[process.argv.indexOf('--port') + 1]
    : 8790);

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.woff2': 'font/woff2',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
};

const scanner = new Scanner();
let realSnapshot = null;
const plan = await readPlan();

/*
   Dieselbe Konfiguration wie im Programm, damit die Vorschau nicht anders
   rechnet als das Fenster. Electron legt sie unter APPDATA ab; liegt dort
   nichts, gilt der Projektordner.
*/
const config = new Config(configPath(process.env.APPDATA
    ? join(process.env.APPDATA, 'claude-tv')
    : ROOT));
await config.load();

const gitWatcher = createGitWatcher();

async function refreshReal() {
    try {
        await scanner.refresh();
        await config.load();
        realSnapshot = aggregate({
            messages: scanner.messages,
            cwdBySession: scanner.cwdBySession,
            config: config.data,
            pinned: config.data.calibration,
            sync: config.data.sync,
            plan,
            limits: scanner.limits,
            stats: scanner.stats(),
        });
        if (config.data.showGit) {
            realSnapshot.git = await gitWatcher.follow(realSnapshot.insights?.activity?.cwd ?? null)
                ?? gitWatcher.current;
        } else {
            realSnapshot.gitOff = true;
        }
    } catch (error) {
        console.error('Scan fehlgeschlagen:', error.message);
    }
}

await refreshReal();
setInterval(refreshReal, 2000);

const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');

    if (url.pathname === '/feed') {
        const demo = url.searchParams.get('demo');
        response.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-store',
            Connection: 'keep-alive',
        });
        const send = () => {
            const snapshot = demo ? demoSnapshot(demo) : realSnapshot;
            if (snapshot) {
                response.write('data: ' + JSON.stringify(snapshot) + '\n\n');
            }
        };
        send();
        const timer = setInterval(send, 2000);
        request.on('close', () => clearInterval(timer));
        return;
    }

    if (url.pathname === '/scenarios') {
        response.writeHead(200, { 'Content-Type': MIME['.json'] });
        response.end(JSON.stringify(SCENARIO_NAMES));
        return;
    }

    // Umleiten statt direkt ausliefern: so loesen die relativen Pfade in der
    // Seite genauso auf wie spaeter unter file:// im Electron-Fenster.
    if (url.pathname === '/') {
        response.writeHead(302, { Location: '/renderer/index.html' + url.search });
        response.end();
        return;
    }

    let file = url.pathname.slice(1);
    file = normalize(file).replace(/^(\.\.[/\\])+/, '');
    try {
        const body = await readFile(join(ROOT, file));
        response.writeHead(200, {
            'Content-Type': MIME[extname(file)] || 'application/octet-stream',
            'Cache-Control': 'no-store',
        });
        response.end(body);
    } catch {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('nicht gefunden: ' + file);
    }
});

server.listen(PORT, '127.0.0.1', () => {
    console.log('Claude TV Entwicklungsserver: http://127.0.0.1:' + PORT);
    console.log('Echte Daten:  http://127.0.0.1:' + PORT + '/');
    console.log('Szenarien:    ' + SCENARIO_NAMES.map((s) => '?demo=' + s).join('  '));
    console.log('Zusaetzlich:  &theme=dark  &view=detail');
});
