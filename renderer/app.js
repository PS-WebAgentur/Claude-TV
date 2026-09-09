/* ============================================================
   Claude TV, Anzeigelogik.

   Die Daten kommen entweder ueber IPC aus dem Electron-Hauptprozess
   (window.claudeTV) oder im Entwicklungsmodus als Server-Sent-Events vom
   Dev-Server. Beide liefern denselben Schnappschuss.

   Sprache: Satzschreibung, "Reset in 2 Std 59 Min" wie Claude selbst, und
   jede Zahl hat eine Zeile, die sagt was sie bedeutet. Die Taste H erklaert
   den Rest.
   ============================================================ */

(function () {
    'use strict';

    var params = new URLSearchParams(location.search);
    var forcedState = params.get('state');

    var WINDOW_BLOCKS = 20;
    var WEEK_BLOCKS = 28;
    var STACK_BLOCKS = 40;

    var STATE_CAPTION = {
        sleeping: 'Schläft',
        idle: 'Wartet',
        working: 'Arbeitet',
        sprinting: 'Sprintet',
        strained: 'Angestrengt',
        spent: 'Am Anschlag',
        fresh: 'Frisches Fenster',
    };

    var THEME_CYCLE = ['system', 'light', 'dark'];
    var THEME_LABEL = { system: 'System', light: 'Hell', dark: 'Dunkel' };

    function el(id) {
        return document.getElementById(id);
    }

    var dom = {
        body: document.body,
        pillPlan: el('pill-plan'),
        clawd: el('clawd'),
        clawdCaption: el('clawd-caption'),
        mainPanel: document.querySelector('.panel--main'),
        windowReset: el('window-reset'),
        windowPercent: el('window-percent'),
        windowUnit: el('window-unit'),
        windowAside: el('window-aside'),
        windowBar: el('window-bar'),
        windowBlocks: el('window-blocks'),
        windowLine: el('window-line'),
        weekNote: el('week-note'),
        weekBar: el('week-bar'),
        weekBlocks: el('week-blocks'),
        rateValue: el('rate-value'),
        todayValue: el('today-value'),
        sessionsValue: el('sessions-value'),
        modelValue: el('model-value'),
        compBlocks: el('comp-blocks'),
        compLegend: el('comp-legend'),
        rowsModels: el('rows-models'),
        rowsProjects: el('rows-projects'),
        sparkWindow: el('spark-window'),
        sparkDay: el('spark-day'),
        sparkFrom: el('spark-from'),
        sparkTo: el('spark-to'),
        footScale: el('foot-scale'),
        footSource: el('foot-source'),
        help: el('help'),
    };

    var clawd = window.ClaudeCreature.create(dom.clawd);
    var snapshot = null;
    var lastMessageCount = null;
    var lastWindowStart = null;
    var prefs = { theme: 'system', view: 'overview', alwaysOnTop: false };
    var darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

    /* ---------- Formatierung ---------- */

    function fmtNumber(value, digits) {
        return value.toLocaleString('de-DE', {
            minimumFractionDigits: digits,
            maximumFractionDigits: digits,
        });
    }

    /** Tokenzahlen kurz: 1,15 Mrd, 2,3 M, 840 k, 512. */
    function fmtTokens(value) {
        var n = Number(value) || 0;
        if (n >= 1e9) {
            return fmtNumber(n / 1e9, 2) + ' Mrd';
        }
        if (n >= 1e8) {
            return fmtNumber(Math.round(n / 1e6), 0) + ' M';
        }
        if (n >= 1e6) {
            return fmtNumber(n / 1e6, 1) + ' M';
        }
        if (n >= 1e4) {
            return fmtNumber(Math.round(n / 1e3), 0) + ' k';
        }
        return fmtNumber(Math.round(n), 0);
    }

    /** Dauer in der Schreibweise, die Claude selbst benutzt. */
    function fmtDuration(ms) {
        if (ms === null || ms === undefined || !isFinite(ms)) {
            return '';
        }
        if (ms <= 0) {
            return 'jetzt';
        }
        var s = Math.floor(ms / 1000);
        var d = Math.floor(s / 86400);
        var h = Math.floor((s % 86400) / 3600);
        var m = Math.floor((s % 3600) / 60);
        var sec = s % 60;
        if (d > 0) {
            return d + ' Tg ' + h + ' Std';
        }
        if (h > 0) {
            return h + ' Std ' + m + ' Min';
        }
        // Sekunden erst zeigen, wenn es knapp wird, sonst zappelt die Zeile.
        if (m >= 10) {
            return m + ' Min';
        }
        if (m > 0) {
            return m + ' Min ' + sec + ' Sek';
        }
        return sec + ' Sek';
    }

    function fmtClock(ts) {
        if (!ts) {
            return '';
        }
        var date = new Date(ts);
        return String(date.getHours()).padStart(2, '0') + ':'
            + String(date.getMinutes()).padStart(2, '0');
    }

    /* ---------- Bausteine ---------- */

    /**
     * Blockbalken. Der Block, in dem die Uhr steht, bekommt eine Kerbe, und
     * die Beschriftung sitzt prozentgenau darueber.
     */
    function blocks(bar, container, percent, count, clockPercent) {
        var filled = Math.round((Math.max(0, Math.min(100, percent || 0)) / 100) * count);
        var clockIndex = clockPercent === null || clockPercent === undefined
            ? -1
            : Math.min(count - 1, Math.floor((clockPercent / 100) * count));

        if (container.children.length !== count) {
            container.textContent = '';
            for (var i = 0; i < count; i++) {
                container.appendChild(document.createElement('i'));
            }
        }
        for (var k = 0; k < count; k++) {
            var cls = k < filled ? 'is-on' : '';
            if (k === clockIndex) {
                cls += (cls ? ' ' : '') + 'is-clock';
            }
            if (container.children[k].className !== cls) {
                container.children[k].className = cls;
            }
        }
        if (!bar) {
            return;
        }
        if (clockIndex === -1) {
            bar.dataset.clock = 'none';
        } else {
            bar.dataset.clock = 'on';
            bar.dataset.clockSide = clockPercent > 78 ? 'right' : 'left';
            bar.style.setProperty('--clock-left', clockPercent.toFixed(1) + '%');
        }
    }

    /** Gestapelter Balken: jeder Anteil bekommt so viele Bloecke wie ihm zusteht. */
    function stack(container, parts) {
        container.textContent = '';
        var assigned = 0;
        parts.forEach(function (part, index) {
            var take = index === parts.length - 1
                ? STACK_BLOCKS - assigned
                : Math.round(part.share * STACK_BLOCKS);
            assigned += take;
            for (var i = 0; i < take; i++) {
                var block = document.createElement('i');
                block.className = 'is-on';
                block.style.background = part.color;
                container.appendChild(block);
            }
        });
        while (container.children.length < STACK_BLOCKS) {
            container.appendChild(document.createElement('i'));
        }
    }

    function legendRow(options) {
        var wrap = document.createElement('div');
        wrap.className = 'legend-row' + (options.quiet ? ' legend-row--quiet' : '');

        var swatch = document.createElement('span');
        swatch.className = 'legend-swatch';
        if (options.color) {
            swatch.style.background = options.color;
        }

        var name = document.createElement('span');
        name.className = 'legend-name';
        name.textContent = options.name;
        name.title = options.name;

        var value = document.createElement('span');
        value.className = 'legend-value';
        value.textContent = options.value;

        var share = document.createElement('span');
        share.className = 'legend-share';
        share.textContent = options.share;

        wrap.append(swatch, name, value, share);

        if (options.hint) {
            var hint = document.createElement('span');
            hint.className = 'legend-hint';
            hint.textContent = options.hint;
            wrap.appendChild(hint);
        }
        return wrap;
    }

    function spark(container, values) {
        var max = Math.max.apply(null, values.concat([1]));
        if (container.children.length !== values.length) {
            container.textContent = '';
            for (var i = 0; i < values.length; i++) {
                container.appendChild(document.createElement('i'));
            }
        }
        for (var k = 0; k < values.length; k++) {
            var bar = container.children[k];
            bar.style.height = (values[k] > 0 ? Math.max(6, (values[k] / max) * 100) : 3).toFixed(0) + '%';
            bar.className = values[k] > 0 ? '' : 'is-empty';
        }
    }

    /* ---------- Zeichnen ---------- */

    function render() {
        if (!snapshot) {
            return;
        }
        var win = snapshot.window;
        var cal = snapshot.calibration;

        if (snapshot.plan) {
            dom.pillPlan.hidden = false;
            dom.pillPlan.textContent = snapshot.plan;
        } else {
            dom.pillPlan.hidden = true;
        }

        if (win.percent === null) {
            var short = fmtTokens(win.effort).split(' ');
            dom.windowPercent.textContent = short[0];
            dom.windowUnit.textContent = short[1] || '';
            dom.mainPanel.dataset.severity = 'none';
            dom.windowBar.dataset.severity = 'none';
        } else {
            dom.windowPercent.textContent = String(Math.round(win.percent));
            dom.windowUnit.textContent = '%';
            dom.mainPanel.dataset.severity = win.severity;
            dom.windowBar.dataset.severity = win.severity;
        }

        dom.windowAside.textContent = win.active
            ? (cal.windowBudget
                ? fmtTokens(win.effort) + ' / ' + fmtTokens(cal.windowBudget)
                : fmtTokens(win.effort) + ' Tokens')
            : '';

        dom.weekNote.textContent = fmtTokens(snapshot.week.effort)
            + (snapshot.week.percent !== null
                ? ' · ' + Math.round(snapshot.week.percent) + ' %'
                : ' · keine Skala');
        blocks(dom.weekBar, dom.weekBlocks, snapshot.week.percent || 0, WEEK_BLOCKS, null);

        dom.rateValue.textContent = fmtTokens(snapshot.rate.perMinute);
        dom.todayValue.textContent = fmtTokens(snapshot.today.effort);
        dom.sessionsValue.textContent = String(snapshot.today.sessions);
        dom.modelValue.textContent = snapshot.last ? snapshot.last.label : '--';

        var state = forcedState || snapshot.character.state;
        dom.clawdCaption.textContent = STATE_CAPTION[state] || '';

        if (cal.basis === 'config') {
            dom.footScale.textContent = '100 % = ' + fmtTokens(cal.windowBudget)
                + ' Tokens, von dir festgelegt';
        } else if (cal.basis === 'p90') {
            dom.footScale.textContent = '100 % = ' + fmtTokens(cal.windowBudget)
                + ' Tokens, dein p90 aus ' + cal.completedWindows + ' Fenstern';
        } else {
            dom.footScale.textContent = 'Noch keine Skala: ' + cal.completedWindows
                + ' von ' + cal.needed + ' Fenstern gemessen';
        }

        var source = snapshot.source || {};
        if (source.demo) {
            dom.footSource.textContent = 'Demo: ' + source.demo;
        } else if (source.rootMissing) {
            dom.footSource.textContent = 'Keine Logs gefunden';
        } else {
            dom.footSource.textContent = 'Nur Claude Code, ' + (source.files || 0) + ' Logdateien';
        }

        var comp = win.composition;
        stack(dom.compBlocks, comp.parts);
        dom.compLegend.textContent = '';
        comp.parts.forEach(function (part) {
            dom.compLegend.appendChild(legendRow({
                color: part.color,
                name: part.label,
                hint: part.hint,
                value: fmtTokens(part.value),
                share: Math.round(part.share * 100) + ' %',
            }));
        });
        dom.compLegend.appendChild(legendRow({
            color: comp.cacheRead.color,
            name: comp.cacheRead.label,
            hint: comp.cacheRead.hint,
            value: fmtTokens(comp.cacheRead.value),
            share: '',
            quiet: true,
        }));

        dom.rowsModels.textContent = '';
        if (snapshot.models.length === 0) {
            dom.rowsModels.appendChild(legendRow({ name: 'noch nichts', value: '0', share: '' }));
        }
        snapshot.models.forEach(function (model) {
            dom.rowsModels.appendChild(legendRow({
                color: model.color,
                name: model.label,
                value: fmtTokens(model.effort),
                share: Math.round(model.share * 100) + ' %',
            }));
        });

        dom.rowsProjects.textContent = '';
        if (snapshot.projects.length === 0) {
            dom.rowsProjects.appendChild(legendRow({ name: 'noch nichts', value: '0', share: '' }));
        }
        snapshot.projects.forEach(function (project) {
            dom.rowsProjects.appendChild(legendRow({
                color: 'var(--accent)',
                name: project.name,
                value: fmtTokens(project.effort),
                share: Math.round(project.share * 100) + ' %',
            }));
        });

        spark(dom.sparkWindow, win.series || []);
        spark(dom.sparkDay, snapshot.today.buckets || []);
        dom.sparkFrom.textContent = win.startedAt ? 'Start ' + fmtClock(win.startedAt) : 'kein Fenster';
        dom.sparkTo.textContent = win.resetAt ? 'Reset ' + fmtClock(win.resetAt) : '';

        tick();
    }

    /** Jede Sekunde: Restzeit, Uhr-Marke und Vorhersage nachziehen. */
    function tick() {
        if (!snapshot) {
            return;
        }
        var win = snapshot.window;
        var now = Date.now();

        if (!win.active || !win.resetAt) {
            dom.windowReset.textContent = '';
            dom.windowLine.textContent = snapshot.last
                ? 'Letzte Nachricht vor ' + fmtDuration(now - snapshot.last.at) + '.'
                : 'Noch keine Nachricht in den Logs.';
            blocks(dom.windowBar, dom.windowBlocks, win.percent || 0, WINDOW_BLOCKS, null);
            return;
        }

        dom.windowReset.textContent = 'Reset in ' + fmtDuration(win.resetAt - now);

        if (win.percent === null) {
            dom.windowLine.textContent = 'Ohne Skala keine Vorhersage. '
                + 'Nach drei abgeschlossenen Fenstern gibt es Prozente.';
            blocks(dom.windowBar, dom.windowBlocks, 0, WINDOW_BLOCKS, null);
            return;
        }

        var span = win.resetAt - win.startedAt;
        var elapsed = Math.min(1, Math.max(0, (now - win.startedAt) / span));
        var clockPercent = elapsed * 100;
        var delta = Math.round(win.percent - clockPercent);
        var projected = elapsed > 0.01 ? win.percent / elapsed : null;

        blocks(dom.windowBar, dom.windowBlocks, win.percent, WINDOW_BLOCKS, clockPercent);

        var text;
        if (win.percent >= 100) {
            text = 'Skala ausgereizt.';
        } else if (projected !== null && projected > 100) {
            var perMs = win.percent / (now - win.startedAt);
            var etaMs = perMs > 0 ? (100 - win.percent) / perMs : null;
            text = 'In diesem Tempo bei 100 % in ' + fmtDuration(etaMs) + '.';
        } else if (delta <= -3) {
            text = Math.abs(delta) + ' % Reserve gegenüber der Uhr.';
        } else if (delta >= 3) {
            text = delta + ' % schneller als die Uhr, reicht aber bis zum Reset.';
        } else {
            text = 'Genau im Takt der Uhr.';
        }
        dom.windowLine.textContent = text;
    }

    /* ---------- Neue Daten ---------- */

    function accept(next) {
        if (!next || typeof next !== 'object') {
            return;
        }
        var previousCount = lastMessageCount;
        snapshot = next;

        var count = next.totals.messages;
        if (previousCount !== null && count > previousCount) {
            clawd.spark(next.last ? next.last.color : null, count - previousCount);
        }
        lastMessageCount = count;

        if (next.character.celebrate && next.window.startedAt !== lastWindowStart) {
            clawd.celebrate();
        }
        if (next.window.startedAt) {
            lastWindowStart = next.window.startedAt;
        }

        clawd.setState(forcedState || next.character.state);
        clawd.setSeverity(next.window.percent === null ? 'none' : next.window.severity);
        render();
    }

    /* ---------- Vorlieben und Bedienung ---------- */

    /** "System" folgt der Windows-Einstellung, wird hier aufgeloest. */
    function resolvedTheme() {
        if (prefs.theme === 'light' || prefs.theme === 'dark') {
            return prefs.theme;
        }
        return darkQuery && darkQuery.matches ? 'dark' : 'light';
    }

    function applyPrefs() {
        dom.body.dataset.theme = resolvedTheme();
        dom.body.dataset.view = prefs.view;
        document.querySelector('[data-act="theme"]').textContent = THEME_LABEL[prefs.theme];
        document.querySelector('[data-act="view"]').textContent = prefs.view === 'detail'
            ? 'Übersicht'
            : 'Details';
        document.querySelector('[data-act="pin"]').setAttribute('aria-pressed', String(prefs.alwaysOnTop));
    }

    function setPref(patch) {
        Object.assign(prefs, patch);
        applyPrefs();
        if (window.claudeTV && window.claudeTV.savePrefs) {
            window.claudeTV.savePrefs({
                theme: prefs.theme,
                view: prefs.view,
                alwaysOnTop: prefs.alwaysOnTop,
            });
        }
    }

    function toggleHelp(force) {
        dom.help.hidden = force === undefined ? !dom.help.hidden : !force;
    }

    if (darkQuery && darkQuery.addEventListener) {
        darkQuery.addEventListener('change', function () {
            if (prefs.theme === 'system') {
                applyPrefs();
            }
        });
    }

    document.addEventListener('click', function (event) {
        var button = event.target.closest('[data-act]');
        if (!button) {
            return;
        }
        var act = button.dataset.act;
        if (act === 'view') {
            setPref({ view: prefs.view === 'detail' ? 'overview' : 'detail' });
        } else if (act === 'theme') {
            var next = THEME_CYCLE[(THEME_CYCLE.indexOf(prefs.theme) + 1) % THEME_CYCLE.length];
            setPref({ theme: next });
        } else if (act === 'pin') {
            setPref({ alwaysOnTop: !prefs.alwaysOnTop });
        } else if (act === 'help') {
            toggleHelp();
        } else if (act === 'help-close') {
            toggleHelp(false);
        } else if (act === 'minimize' && window.claudeTV) {
            window.claudeTV.minimize();
        } else if (act === 'close' && window.claudeTV) {
            window.claudeTV.close();
        }
    });

    document.addEventListener('keydown', function (event) {
        var key = event.key.toLowerCase();
        if (key === 'escape') {
            toggleHelp(false);
        } else if (key === 'h' || key === '?') {
            toggleHelp();
        } else if (key === 'd') {
            setPref({ view: prefs.view === 'detail' ? 'overview' : 'detail' });
        } else if (key === 't') {
            setPref({ theme: THEME_CYCLE[(THEME_CYCLE.indexOf(prefs.theme) + 1) % THEME_CYCLE.length] });
        } else if (key === 'p') {
            setPref({ alwaysOnTop: !prefs.alwaysOnTop });
        }
    });

    /* ---------- Start ---------- */

    (function start() {
        var themeParam = params.get('theme');
        if (THEME_CYCLE.indexOf(themeParam) !== -1) {
            prefs.theme = themeParam;
        }
        if (params.get('view') === 'detail' || params.get('view') === 'overview') {
            prefs.view = params.get('view');
        }
        applyPrefs();

        if (window.claudeTV) {
            window.claudeTV.getPrefs().then(function (stored) {
                if (stored) {
                    prefs.theme = themeParam || stored.theme || prefs.theme;
                    prefs.view = params.get('view') || stored.view || prefs.view;
                    prefs.alwaysOnTop = Boolean(stored.alwaysOnTop);
                    applyPrefs();
                }
            }).catch(function () { /* Vorgaben bleiben */ });
            window.claudeTV.onUpdate(accept);
        } else {
            var source = new EventSource('/feed' + location.search);
            source.addEventListener('message', function (event) {
                try {
                    accept(JSON.parse(event.data));
                } catch (error) {
                    console.error('Schnappschuss unlesbar', error);
                }
            });
        }

        if (forcedState) {
            clawd.setState(forcedState);
        }
        setInterval(tick, 1000);
    }());
}());
