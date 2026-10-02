/* ============================================================
   Claude TV, Anzeigelogik.

   Die Daten kommen entweder ueber IPC aus dem Electron-Hauptprozess
   (window.claudeTV) oder im Entwicklungsmodus als Server-Sent-Events vom
   Dev-Server. Beide liefern denselben Schnappschuss.

   Sprache: Satzschreibung, "Reset in 2 Std 59 Min" wie Claude selbst, und
   jede Zahl hat eine Zeile, die sagt was sie bedeutet. Die Taste H erklaert
   den Rest.
   ============================================================ */

import { translate, resolveLanguage, LANGUAGES, HELP } from '../lib/i18n.mjs';

(function () {
    'use strict';

    /** Eingestellte Sprache, bis die Vorlieben geladen sind die des Systems. */
    var lang = resolveLanguage('system', navigator.language);

    /** Kurzform, damit die Aufrufe lesbar bleiben. */
    function t(key, vars) {
        return translate(lang, key, vars || {});
    }

    var params = new URLSearchParams(location.search);
    var forcedState = params.get('state');

    var WINDOW_BLOCKS = 20;
    var WEEK_BLOCKS = 28;
    var STACK_BLOCKS = 40;

    var THEME_CYCLE = ['system', 'light', 'dark'];

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
        weekReset: el('week-reset'),
        scopedLine: el('scoped-line'),
        sync: el('sync'),
        syncInput: el('sync-input'),
        syncStatus: el('sync-status'),
        rateValue: el('rate-value'),
        todayValue: el('today-value'),
        sessionsValue: el('sessions-value'),
        modelValue: el('model-value'),
        compBlocks: el('comp-blocks'),
        kindBlocks: el('kind-blocks'),
        rowsKinds: el('rows-kinds'),
        sparkHistory: el('spark-history'),
        historyNote: el('history-note'),
        days: el('days'),
        cacheAll: el('cache-all'),
        cacheWindow: el('cache-window'),
        rowsSessions: el('rows-sessions'),
        costWindow: el('cost-window'),
        costToday: el('cost-today'),
        costWeek: el('cost-week'),
        heat: el('heat'),
        clawdWork: el('clawd-work'),
        windowLimits: el('window-limits'),
        workProject: el('work-project'),
        workGit: el('work-git'),
        workSteps: el('work-steps'),
        workFiles: el('work-files'),
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
    var prefs = { theme: 'system', view: 'overview', alwaysOnTop: false, language: 'system' };
    var darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

    /* ---------- Formatierung ---------- */

    /** Zahlen in der eingestellten Sprache: 7,3 M deutsch, 7.3 M englisch. */
    function fmtNumber(value, digits) {
        return value.toLocaleString(lang === 'de' ? 'de-DE' : 'en-US', {
            minimumFractionDigits: digits,
            maximumFractionDigits: digits,
        });
    }

    /** Tokenzahlen kurz: 1,15 Mrd, 2,3 M, 840 k, 512. */
    function fmtTokens(value) {
        var n = Number(value) || 0;
        if (n >= 1e9) {
            return fmtNumber(n / 1e9, 2) + (lang === 'de' ? ' Mrd' : ' B');
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
            return t('time.now');
        }
        var s = Math.floor(ms / 1000);
        var d = Math.floor(s / 86400);
        var h = Math.floor((s % 86400) / 3600);
        var m = Math.floor((s % 3600) / 60);
        var sec = s % 60;
        if (d > 0) {
            return t('time.days', { tage: d, stunden: h });
        }
        if (h > 0) {
            /*
               Ab einer Stunde wird auf die angefangene Minute aufgerundet.
               Abgerundet stand hier "1 Std 43 Min", waehrend Claude Code
               daneben "1 Std 44 Min" zeigte: derselbe Zeitpunkt, ein anderer
               Umgang mit den Sekunden. Bei einer Restzeit erwartet man die
               angefangene Minute.
            */
            var aufgerundet = Math.ceil((ms - d * 86400000) / 60000);
            return t('time.hours', {
                stunden: Math.floor(aufgerundet / 60), minuten: aufgerundet % 60,
            });
        }
        // Sekunden erst zeigen, wenn es knapp wird, sonst zappelt die Zeile.
        if (m >= 10) {
            return t('time.minutes', { minuten: m });
        }
        if (m > 0) {
            return t('time.minutesSeconds', { minuten: m, sekunden: sec });
        }
        return t('time.seconds', { sekunden: sec });
    }

    /** Kurzes Datum, ohne Jahr. Fuer Grenzen, die nicht heute liegen. */
    function fmtDay(ts) {
        if (!ts) {
            return '';
        }
        var date = new Date(ts);
        var heute = new Date();
        if (date.toDateString() === heute.toDateString()) {
            return t('time.today');
        }
        // Deutsch 25.09., englisch Sep 25.
        return lang === 'de'
            ? String(date.getDate()).padStart(2, '0') + '.'
                + String(date.getMonth() + 1).padStart(2, '0') + '.'
            : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    /** "heute 16:08" oder "am 08.09. um 16:08", je nachdem. */
    function fmtWhen(ts) {
        if (!ts) {
            return '';
        }
        var tag = fmtDay(ts);
        return tag === t('time.today')
            ? t('time.todayAt', { uhr: fmtClock(ts) })
            : t('time.onDayAt', { tag: tag, uhr: fmtClock(ts) });
    }

    /**
     * Uhrzeit auf die naechste Minute gerundet.
     *
     * Abgeschnitten wurde aus 18:59:59 die Anzeige "18:59", waehrend die
     * Grenze in Wahrheit auf 19:00 liegt. Eine Sekunde Unterschied, aber eine
     * andere Zahl auf dem Bildschirm als in Claude Code.
     */
    function fmtClock(ts) {
        if (!ts) {
            return '';
        }
        var date = new Date(Math.round(ts / 60000) * 60000);
        return String(date.getHours()).padStart(2, '0') + ':'
            + String(date.getMinutes()).padStart(2, '0');
    }

    /* ---------- Bausteine ---------- */

    /**
     * Blockbalken. Der Block, in dem das Ziel steht, bekommt eine Kerbe, und
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

    /* ---------- Einsichten in der Detailansicht ---------- */

    /** Balkenreihe der letzten Fenster, das laufende rechts abgesetzt. */
    function historyBars(container, history, current) {
        var values = history.map(function (h) { return h.effort; }).concat([current]);
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
            bar.className = k === values.length - 1 ? 'is-current' : '';
        }
    }

    function renderDays(container, days) {
        var max = Math.max.apply(null, days.map(function (d) { return d.effort; }).concat([1]));
        container.textContent = '';
        days.forEach(function (day) {
            var cell = document.createElement('div');
            cell.className = 'day' + (day.today ? ' day--today' : '');

            var value = document.createElement('span');
            value.className = 'day-value';
            value.textContent = day.effort > 0 ? fmtTokens(day.effort) : '';

            var bar = document.createElement('span');
            bar.className = 'day-bar';
            bar.style.height = Math.max(2, (day.effort / max) * 58).toFixed(0) + 'px';

            var label = document.createElement('span');
            label.className = 'day-label';
            label.textContent = t('day.' + day.weekday);

            cell.append(value, bar, label);
            container.appendChild(cell);
        });
    }

    /**
     * Heatmap Wochentag mal Stunde. Die Farbe kommt aus der Deckkraft, so
     * bleibt es bei einer Farbe und liest sich in beiden Farbschemata.
     */
    function renderHeat(container, heat) {
        container.textContent = '';
        for (var tag = 0; tag < 7; tag++) {
            var label = document.createElement('span');
            label.className = 'heat-label';
            label.textContent = t('day.' + tag);
            container.appendChild(label);

            for (var stunde = 0; stunde < 24; stunde++) {
                var wert = heat.grid[tag][stunde];
                var cell = document.createElement('span');
                cell.className = 'heat-cell';
                // Wurzel statt linear: sonst verschwindet alles neben der Spitze.
                var anteil = heat.max > 0 ? Math.sqrt(wert / heat.max) : 0;
                cell.style.opacity = wert > 0 ? (0.12 + anteil * 0.88).toFixed(2) : '0.06';
                cell.title = t('heat.cell', {
                    tag: t('day.' + tag), stunde: stunde, wert: fmtTokens(wert),
                });
                container.appendChild(cell);
            }
        }
        var hours = document.createElement('div');
        hours.className = 'heat-hours';
        ['0', '6', '12', '18', '23'].forEach(function (h) {
            var span = document.createElement('span');
            span.textContent = h;
            hours.appendChild(span);
        });
        container.appendChild(hours);
    }

    function fmtDollar(value) {
        if (!(value > 0)) {
            return '$0';
        }
        if (value >= 100) {
            return '$' + Math.round(value);
        }
        return '$' + value.toFixed(2);
    }

    /**
     * Werkzeugname kurz. Angebundene Dienste heissen intern
     * `mcp__Server__werkzeug`, das sprengt jede Spalte.
     */
    function shortTool(name) {
        var m = /^mcp__(.+?)__(.+)$/.exec(String(name || ''));
        return m ? m[2] : name;
    }

    /** Dateiname ohne Pfad, der Rest passt ohnehin nicht in die Zeile. */
    function basename(path) {
        var parts = String(path || '').split(/[\\/]/);
        return parts[parts.length - 1] || path;
    }

    /**
     * Woran gerade gearbeitet wird. Werkzeug, Ziel, Projekt und der Zustand
     * des Repositories daneben.
     */
    function renderWork(snapshot) {
        var work = snapshot.insights && snapshot.insights.activity;
        if (!work) {
            return;
        }

        var letzter = work.steps[0];
        dom.clawdWork.textContent = work.project && letzter
            ? work.project + ' · ' + shortTool(letzter.tool)
                + (letzter.detail ? ' ' + basename(letzter.detail) : '')
            : (work.project || '');

        dom.workProject.textContent = work.project
            ? (work.at
                ? t('card.work.ago', {
                    projekt: work.project, rest: fmtDuration(Date.now() - work.at),
                })
                : work.project)
            : t('card.work.none');

        var git = snapshot.git;
        if (git && git.branch) {
            var teile = [t('git.branch', { name: escapeHtml(git.branch) })];
            if (git.changed > 0) {
                teile.push(t('git.changed', { anzahl: git.changed }));
            }
            if (git.untracked > 0) {
                teile.push(t('git.untracked', { anzahl: git.untracked }));
            }
            if (git.changed === 0 && git.untracked === 0) {
                teile.push(t('git.clean'));
            }
            if (git.ahead > 0) {
                teile.push(t('git.ahead', { anzahl: git.ahead }));
            }
            if (git.behind > 0) {
                teile.push(t('git.behind', { anzahl: git.behind }));
            }
            if (git.lastCommit) {
                teile.push(t('git.lastCommit', {
                    hash: escapeHtml(git.lastCommit.hash),
                    betreff: escapeHtml(git.lastCommit.subject),
                }));
            }
            dom.workGit.innerHTML = teile.join(' · ');
        } else if (snapshot.gitOff) {
            dom.workGit.textContent = t('card.work.off');
        } else {
            dom.workGit.textContent = git === null && work.cwd
                ? t('card.work.noRepo')
                : '';
        }

        dom.workSteps.textContent = '';
        work.steps.forEach(function (step) {
            var row = document.createElement('div');
            row.className = 'work-step' + (step.kind === 'main' ? '' : ' work-step--sub');

            var zeit = document.createElement('span');
            zeit.className = 'work-step-time';
            zeit.textContent = fmtClock(step.ts);

            var tool = document.createElement('span');
            tool.className = 'work-step-tool';
            tool.textContent = shortTool(step.tool);

            var detail = document.createElement('span');
            detail.className = 'work-step-detail';
            detail.textContent = step.detail;
            detail.title = step.detail;

            row.append(zeit, tool, detail);
            dom.workSteps.appendChild(row);
        });

        dom.workFiles.textContent = '';
        work.files.forEach(function (file) {
            var chip = document.createElement('span');
            chip.className = 'work-file';
            chip.textContent = basename(file);
            chip.title = file;
            dom.workFiles.appendChild(chip);
        });
    }

    /** Hinweis auf echte Limit-Treffer aus den Logs. */
    function renderLimits(snapshot) {
        var limits = snapshot.limits;
        if (!limits || limits.windowHits === 0) {
            dom.windowLimits.hidden = true;
            return;
        }
        dom.windowLimits.hidden = false;
        var text = limits.windowHits === 1
            ? t('limits.once')
            : t('limits.many', { anzahl: limits.windowHits });
        if (limits.last) {
            text += t('limits.last', {
                tag: fmtDay(limits.last.ts), uhr: fmtClock(limits.last.ts),
            });
        }
        if (snapshot.sync && snapshot.sync.anchorFrom === 'limit') {
            text += t('limits.anchor');
        }
        dom.windowLimits.textContent = text;
    }

    function renderInsights(snapshot) {
        var ins = snapshot.insights;
        if (!ins) {
            return;
        }

        stack(dom.kindBlocks, ins.kinds);
        dom.rowsKinds.textContent = '';
        ins.kinds.forEach(function (kind) {
            dom.rowsKinds.appendChild(legendRow({
                color: kind.color,
                name: t('kind.' + kind.key),
                hint: t('kind.' + kind.key + '.hint'),
                value: fmtTokens(kind.effort),
                share: Math.round(kind.share * 100) + ' %',
            }));
        });

        historyBars(dom.sparkHistory, ins.history, snapshot.window.effort);
        var schnitt = ins.history.length
            ? ins.history.reduce(function (a, h) { return a + h.effort; }, 0) / ins.history.length
            : 0;
        dom.historyNote.textContent = ins.history.length
            ? t('card.windows.summary', {
                schnitt: fmtTokens(schnitt), jetzt: fmtTokens(snapshot.window.effort),
            })
            : t('card.windows.none');

        renderDays(dom.days, ins.days);

        dom.cacheAll.textContent = ins.cache.share === null
            ? '--' : Math.round(ins.cache.share * 100) + ' %';
        dom.cacheWindow.textContent = ins.cacheWindow.share === null
            ? '--' : Math.round(ins.cacheWindow.share * 100) + ' %';

        dom.rowsSessions.textContent = '';
        if (ins.sessions.length === 0) {
            dom.rowsSessions.appendChild(legendRow({
                name: t('card.sessions.none'), value: '0', share: '',
            }));
        }
        ins.sessions.forEach(function (session) {
            dom.rowsSessions.appendChild(legendRow({
                color: 'var(--accent)',
                name: session.project,
                hint: t('card.sessions.hint', {
                    anzahl: session.messages, uhr: fmtClock(session.last),
                }),
                value: fmtTokens(session.effort),
                share: '',
            }));
        });

        dom.costWindow.textContent = fmtDollar(ins.cost.window);
        dom.costToday.textContent = fmtDollar(ins.cost.today);
        dom.costWeek.textContent = fmtDollar(ins.cost.week);

        renderHeat(dom.heat, ins.heatmap);
    }

    function render() {
        if (!snapshot) {
            return;
        }
        var win = snapshot.window;
        var cal = snapshot.calibration;

        if (snapshot.plan) {
            dom.pillPlan.hidden = false;
            dom.pillPlan.textContent = t('bar.plan', { plan: snapshot.plan });
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
                : fmtTokens(win.effort) + ' ' + t('unit.tokens'))
            : '';

        dom.weekNote.textContent = fmtTokens(snapshot.week.effort)
            + (snapshot.week.percent !== null
                ? ' · ' + Math.round(snapshot.week.percent) + ' %'
                : ' · ' + t('week.noScale'));
        dom.weekReset.textContent = snapshot.week.resetAt
            ? t('window.resetAt', {
                tag: fmtDay(snapshot.week.resetAt), uhr: fmtClock(snapshot.week.resetAt),
            })
            : '';
        blocks(dom.weekBar, dom.weekBlocks, snapshot.week.percent || 0, WEEK_BLOCKS, null);

        var scoped = snapshot.weekScoped;
        dom.scopedLine.hidden = !scoped;
        if (scoped) {
            dom.scopedLine.textContent = t('week.scoped', {
                prozent: Math.round(scoped.percent),
                reset: scoped.resetAt
                    ? t('week.scoped.reset', {
                        tag: fmtDay(scoped.resetAt), uhr: fmtClock(scoped.resetAt),
                    })
                    : '',
                alt: scoped.stale ? t('week.scoped.stale') : '',
            });
        }

        dom.rateValue.textContent = fmtTokens(snapshot.rate.perMinute);
        dom.todayValue.textContent = fmtTokens(snapshot.today.effort);
        dom.sessionsValue.textContent = String(snapshot.today.sessions);
        dom.modelValue.textContent = snapshot.last ? snapshot.last.label : '--';

        var state = forcedState || snapshot.character.state;
        dom.clawdCaption.textContent = t('state.' + state);

        if (cal.basis === 'config') {
            dom.footScale.textContent = t('foot.scale.config', {
                wert: fmtTokens(cal.windowBudget),
            });
        } else if (cal.basis === 'sync') {
            dom.footScale.textContent = t('foot.scale.sync', {
                wert: fmtTokens(cal.windowBudget), wann: fmtWhen(snapshot.sync.at),
            });
        } else if (cal.basis === 'p90') {
            dom.footScale.textContent = t('foot.scale.p90', {
                wert: fmtTokens(cal.windowBudget),
            });
        } else {
            dom.footScale.textContent = t('foot.scale.none', {
                gezaehlt: cal.completedWindows, noetig: cal.needed,
            });
        }

        var source = snapshot.source || {};
        if (source.demo) {
            dom.footSource.textContent = t('foot.source.demo', { name: source.demo });
        } else if (source.rootMissing) {
            dom.footSource.textContent = t('foot.source.missing');
        } else {
            dom.footSource.textContent = t('foot.source', { anzahl: source.files || 0 });
        }

        var comp = win.composition;
        stack(dom.compBlocks, comp.parts);
        dom.compLegend.textContent = '';
        comp.parts.forEach(function (part) {
            part = Object.assign({}, part, {
                label: t('part.' + part.key), hint: t('part.' + part.key + '.hint'),
            });
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
            dom.rowsModels.appendChild(legendRow({ name: t('card.empty'), value: '0', share: '' }));
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

        renderInsights(snapshot);
        renderWork(snapshot);
        renderLimits(snapshot);

        tick();
    }

    /** Jede Sekunde: Restzeit, Zielmarke und Vorhersage nachziehen. */
    function tick() {
        if (!snapshot) {
            return;
        }
        var win = snapshot.window;
        var now = Date.now();

        if (!win.active || !win.resetAt) {
            dom.windowReset.textContent = '';
            dom.windowLine.textContent = snapshot.last
                ? t('pace.lastMessage', { rest: fmtDuration(now - snapshot.last.at) })
                : t('pace.nothing');
            blocks(dom.windowBar, dom.windowBlocks, win.percent || 0, WINDOW_BLOCKS, null);
            return;
        }

        dom.windowReset.textContent = t('window.reset', {
            rest: fmtDuration(win.resetAt - now),
        });

        if (win.percent === null) {
            dom.windowLine.textContent = t('pace.noScale');
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
            text = t('pace.maxed');
        } else if (projected !== null && projected > 100) {
            var perMs = win.percent / (now - win.startedAt);
            var etaMs = perMs > 0 ? (100 - win.percent) / perMs : null;
            text = t('pace.eta', { rest: fmtDuration(etaMs) });
        } else if (delta <= -3) {
            text = t('pace.spare', { wert: Math.abs(delta) });
        } else if (delta >= 3) {
            text = t('pace.over', { wert: delta });
        } else {
            text = t('pace.onTarget');
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
        lang = resolveLanguage(prefs.language, navigator.language);
        document.documentElement.lang = lang;
        applyStatic();
        document.querySelector('[data-act="theme"]').textContent = t('bar.theme.' + prefs.theme);
        document.querySelector('[data-act="view"]').textContent = prefs.view === 'detail'
            ? t('bar.overview')
            : t('bar.detail');
        document.querySelector('[data-act="lang"]').textContent = lang.toUpperCase();
        document.querySelector('[data-act="pin"]').setAttribute('aria-pressed', String(prefs.alwaysOnTop));
        if (snapshot) {
            render();
        }
    }

    /**
     * Setzt alle festen Beschriftungen.
     *
     * `data-i18n` fuellt den Text, `data-i18n-title` den Tooltip,
     * `data-i18n-html` laesst einfaches Markup durch. Die Hilfe entsteht aus
     * der Liste in der Sprachtabelle, damit ein neuer Eintrag nur dort steht.
     */
    /** Reihum durch die Sprachen, beginnend bei der gerade gezeigten. */
    function naechsteSprache() {
        var jetzt = LANGUAGES.indexOf(lang);
        return LANGUAGES[(jetzt + 1) % LANGUAGES.length];
    }

    function applyStatic() {
        document.querySelectorAll('[data-i18n]').forEach(function (node) {
            node.textContent = t(node.dataset.i18n);
        });
        document.querySelectorAll('[data-i18n-title]').forEach(function (node) {
            node.title = t(node.dataset.i18nTitle);
        });
        document.querySelectorAll('[data-i18n-html]').forEach(function (node) {
            node.innerHTML = t(node.dataset.i18nHtml);
        });

        var liste = document.getElementById('help-list');
        if (liste) {
            liste.textContent = '';
            (HELP[lang] || HELP.en).forEach(function (eintrag) {
                var dt = document.createElement('dt');
                dt.textContent = eintrag[0];
                var dd = document.createElement('dd');
                dd.innerHTML = eintrag[1];
                liste.append(dt, dd);
            });
        }
    }

    /** Fuer die wenigen Stellen, an denen Daten in Markup landen. */
    function escapeHtml(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function setPref(patch) {
        Object.assign(prefs, patch);
        applyPrefs();
        if (window.claudeTV && window.claudeTV.savePrefs) {
            window.claudeTV.savePrefs({
                theme: prefs.theme,
                view: prefs.view,
                language: prefs.language,
                alwaysOnTop: prefs.alwaysOnTop,
            });
        }
    }

    function toggleHelp(force) {
        dom.help.hidden = force === undefined ? !dom.help.hidden : !force;
    }

    function toggleSync(force) {
        var zeigen = force === undefined ? dom.sync.hidden : force;
        dom.sync.hidden = !zeigen;
        if (!zeigen) {
            return;
        }
        dom.syncInput.focus();
        // Liegt der Bericht schon in der Zwischenablage, steht er gleich drin.
        if (dom.syncInput.value.trim() === '' && window.claudeTV
            && window.claudeTV.readClipboard) {
            window.claudeTV.readClipboard().then(function (text) {
                if (text && dom.syncInput.value.trim() === '') {
                    dom.syncInput.value = text;
                    setSyncStatus(t('sync.fromClipboard'), '');
                }
            }).catch(function () { /* dann eben von Hand */ });
        }
    }

    /** Nimmt den eingefuegten Bericht entgegen und meldet, was dabei herauskam. */
    function applyReport() {
        if (!window.claudeTV) {
            return;
        }
        var text = dom.syncInput.value;
        if (text.trim() === '') {
            setSyncStatus(t('sync.empty'), 'bad');
            return;
        }
        setSyncStatus(t('sync.working'), '');
        window.claudeTV.applyReport(text).then(function (result) {
            if (!result || !result.ok) {
                setSyncStatus(result && result.message ? result.message : t('sync.failed'), 'bad');
                return;
            }
            var teile = [];
            if (result.windowBudget) {
                teile.push(t('sync.part.window', { wert: fmtTokens(result.windowBudget) }));
            }
            if (result.weekBudget) {
                teile.push(t('sync.part.week', { wert: fmtTokens(result.weekBudget) }));
            }
            if (result.requests7d && result.ourRequests7d) {
                var ab = Math.round(Math.abs(result.ourRequests7d - result.requests7d)
                    / result.requests7d * 100);
                teile.push(t('sync.part.drift', { prozent: ab }));
            }
            if (result.points > 1) {
                teile.push(t('sync.part.points', { anzahl: result.points }));
            }
            setSyncStatus(t('sync.done', { teile: teile.join(', ') }), 'good');
            dom.syncInput.value = '';
        }).catch(function () {
            setSyncStatus(t('sync.failed'), 'bad');
        });
    }

    function setSyncStatus(text, tone) {
        dom.syncStatus.textContent = text;
        dom.syncStatus.dataset.tone = tone || '';
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
        } else if (act === 'lang') {
            setPref({ language: naechsteSprache() });
        } else if (act === 'help') {
            toggleHelp();
        } else if (act === 'help-close') {
            toggleHelp(false);
        } else if (act === 'sync') {
            toggleSync();
        } else if (act === 'sync-close') {
            toggleSync(false);
        } else if (act === 'sync-apply') {
            applyReport();
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
            toggleSync(false);
            return;
        }
        // Wer gerade Text einfuegt, meint keine Kuerzel.
        if (event.target && event.target.tagName === 'TEXTAREA') {
            return;
        }
        if (key === 'a') {
            toggleSync();
        } else if (key === 'h' || key === '?') {
            toggleHelp();
        } else if (key === 'd') {
            setPref({ view: prefs.view === 'detail' ? 'overview' : 'detail' });
        } else if (key === 't') {
            setPref({ theme: THEME_CYCLE[(THEME_CYCLE.indexOf(prefs.theme) + 1) % THEME_CYCLE.length] });
        } else if (key === 'p') {
            setPref({ alwaysOnTop: !prefs.alwaysOnTop });
        } else if (key === 's') {
            setPref({ language: naechsteSprache() });
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
