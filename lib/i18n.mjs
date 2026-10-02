/**
 * Sprachen.
 *
 * Deutsch und Englisch, beides vollstaendig. Die Vorgabe folgt Windows; wer
 * will, stellt im Fenster um.
 *
 * Regeln fuer neue Texte: der Schluessel beschreibt die Stelle, nicht den
 * Wortlaut. Platzhalter stehen in geschweiften Klammern und heissen nach dem,
 * was sie enthalten. Zahlen und Zeiten formatiert der Renderer, hier steht
 * nur der Satz drumherum.
 */

export const LANGUAGES = ['de', 'en'];

export const TEXTS = {
    de: {
        /* Titelzeile */
        'bar.detail': 'Details',
        'bar.overview': 'Übersicht',
        'bar.theme.system': 'System',
        'bar.theme.light': 'Hell',
        'bar.theme.dark': 'Dunkel',
        'bar.pin': 'Anheften',
        'bar.sync': 'Abgleich',
        'bar.help.title': 'Was bedeuten die Zahlen? (H)',
        'bar.view.title': 'Ansicht wechseln (D)',
        'bar.theme.title': 'Farbschema (T)',
        'bar.pin.title': 'Immer im Vordergrund (P)',
        'bar.sync.title': 'Mit Claude Code abgleichen (A)',
        'bar.lang.title': 'Sprache wechseln (S)',
        'bar.minimize': 'Minimieren',
        'bar.close': 'Schliessen',
        'bar.plan': 'Abo · {plan}',

        /* Übersicht */
        'window.title': '5-Stunden-Fenster',
        'window.target': 'Ziel',
        'window.reset': 'Reset in {rest}',
        'window.resetAt': 'Reset {tag} {uhr}',
        'week.title': 'Letzte 7 Tage',
        'week.scoped': 'Zweites Wochenlimit: {prozent} %{reset} · Stand vom Abgleich{alt}',
        'week.scoped.reset': ', Reset {tag} {uhr}',
        'week.scoped.stale': ', älter als ein Tag',
        'week.noScale': 'keine Skala',
        'stat.rate': 'Tokens pro Minute',
        'stat.today': 'Verbrauch heute',
        'stat.sessions': 'Sitzungen heute',
        'stat.model': 'Zuletzt aktiv',
        'unit.tokens': 'Tokens',

        /* Tempo und Vorhersage */
        'pace.spare': '{wert} % Luft zum Ziel.',
        'pace.over': '{wert} % über dem Ziel, reicht aber bis zum Reset.',
        'pace.onTarget': 'Genau im Ziel.',
        'pace.eta': 'In diesem Tempo bei 100 % in {rest}.',
        'pace.maxed': 'Skala ausgereizt.',
        'pace.noScale': 'Ohne Skala keine Vorhersage. Nach drei abgeschlossenen Fenstern gibt es Prozente.',
        'pace.lastMessage': 'Letzte Nachricht vor {rest}.',
        'pace.nothing': 'Noch keine Nachricht in den Logs.',

        /* Limit-Meldungen */
        'limits.once': 'Einmal ins Limit gelaufen in vier Wochen',
        'limits.many': '{anzahl} mal ins Limit gelaufen in vier Wochen',
        'limits.last': ', zuletzt {tag} {uhr}',
        'limits.anchor': '. Fenstergrenze von dort übernommen.',

        /* Fußzeile */
        'foot.scale.config': '100 % = {wert} Tokens, von dir festgelegt',
        'foot.scale.sync': '100 % = {wert} Tokens · Abgleich von {wann}',
        'foot.scale.p90': '100 % = {wert} Tokens. Mehr brauchst du nur in jedem zehnten Fenster.',
        'foot.scale.none': 'Noch keine Skala: {gezaehlt} von {noetig} Fenstern gemessen',
        'foot.source': 'Nur Claude Code, {anzahl} Logdateien',
        'foot.source.missing': 'Keine Logs gefunden',
        'foot.source.demo': 'Demo: {name}',

        /* Zustände der Figur */
        'state.sleeping': 'Schläft',
        'state.idle': 'Wartet',
        'state.working': 'Arbeitet',
        'state.conducting': 'Dirigiert',
        'state.sprinting': 'Sprintet',
        'state.strained': 'Angestrengt',
        'state.spent': 'Am Anschlag',
        'state.fresh': 'Frisches Fenster',

        /* Details */
        'card.work': 'Woran gearbeitet wird',
        'card.work.none': 'noch nichts',
        'card.work.ago': '{projekt} · vor {rest}',
        'card.work.noRepo': 'Kein Git-Repository in diesem Ordner.',
        'card.work.off': 'Git-Anzeige ist aus.',
        'git.branch': 'Branch <b>{name}</b>',
        'git.changed': '{anzahl} geändert',
        'git.untracked': '{anzahl} neu',
        'git.clean': 'sauber',
        'git.ahead': '{anzahl} vor dem Remote',
        'git.behind': '{anzahl} hinterher',
        'git.lastCommit': 'zuletzt {hash} „{betreff}“',

        'card.composition': 'Woraus der Verbrauch besteht',
        'card.composition.note': 'im laufenden Fenster',
        'part.input': 'Eingabe',
        'part.input.hint': 'neu gesendeter Text',
        'part.output': 'Antwort',
        'part.output.hint': 'geschriebener Text',
        'part.thinking': 'Denken',
        'part.thinking.hint': 'internes Nachdenken',
        'part.cacheCreate': 'Cache angelegt',
        'part.cacheCreate.hint': 'Kontext neu zwischengespeichert',
        'part.cacheRead': 'Cache gelesen',
        'part.cacheRead.hint': 'wiederverwendeter Kontext, zaehlt nicht zum Verbrauch',

        'card.models': 'Modelle',
        'card.projects': 'Projekte',
        'card.history': 'Verlauf',
        'card.history.note': 'Fenster und Tag',
        'card.total': 'gesamt',
        'card.empty': 'noch nichts',

        'card.kinds': 'Wohin der Verbrauch geht',
        'kind.main': 'Hauptlauf',
        'kind.main.hint': 'was du selbst mit Claude Code machst',
        'kind.subagent': 'Subagenten',
        'kind.subagent.hint': 'Aufgaben, die Claude an sich selbst weitergibt',
        'kind.workflow': 'Workflows',
        'kind.workflow.hint': 'mehrstufige Abläufe mit eigenen Agenten',

        'card.windows': 'Fenster im Vergleich',
        'card.windows.note': 'die letzten 14',
        'card.windows.summary': 'Schnitt {schnitt}, laufendes Fenster {jetzt}',
        'card.windows.none': 'Noch kein abgeschlossenes Fenster.',

        'card.days': 'Die Woche',
        'card.days.note': 'pro Tag',
        'card.cache': 'Cache-Wiederverwendung',
        'card.cache.note': 'gesamt und im Fenster',
        'card.cache.all': 'insgesamt',
        'card.cache.window': 'laufendes Fenster',
        'card.cache.hint': 'Hoch ist gut: gelesener Cache kostet fast nichts, neu angelegter zählt voll auf dein Kontingent.',

        'card.sessions': 'Größte Sitzungen heute',
        'card.sessions.note': 'ohne Subagenten',
        'card.sessions.none': 'heute noch nichts',
        'card.sessions.hint': '{anzahl} Nachrichten, zuletzt {uhr}',

        'card.cost': 'Über die API gerechnet',
        'card.cost.note': 'Schätzung zu Listenpreisen',
        'card.cost.window': 'laufendes Fenster',
        'card.cost.today': 'heute',
        'card.cost.week': 'sieben Tage',
        'card.cost.hint': 'Was dieselbe Nutzung über die API gekostet hätte. Im Abo zahlst du nichts pro Token.',

        'card.heat': 'Wann du arbeitest',
        'card.heat.note': 'vier Wochen',
        'heat.cell': '{tag} {stunde} Uhr: {wert}',

        /* Wochentage, kurz */
        'day.0': 'So',
        'day.1': 'Mo',
        'day.2': 'Di',
        'day.3': 'Mi',
        'day.4': 'Do',
        'day.5': 'Fr',
        'day.6': 'Sa',

        /* Zeitangaben */
        'time.now': 'jetzt',
        'time.days': '{tage} Tg {stunden} Std',
        'time.hours': '{stunden} Std {minuten} Min',
        'time.minutes': '{minuten} Min',
        'time.minutesSeconds': '{minuten} Min {sekunden} Sek',
        'time.seconds': '{sekunden} Sek',
        'time.today': 'heute',
        'time.todayAt': 'heute {uhr}',
        'time.onDayAt': 'am {tag} um {uhr}',

        /* Abgleich */
        'sync.title': 'Mit Claude Code abgleichen',
        'sync.intro': 'Die echten Limits stehen in keiner Datei auf deiner Platte. Claude Code zeigt sie aber im Kontextfenster unter <b>Detaillierte Aufschlüsselung anzeigen</b>. Diesen Text hier einfügen, dann rechnet die Anzeige mit deinen echten Grenzen statt mit einer Schätzung.',
        'sync.apply': 'Übernehmen',
        'sync.foot': 'A oder Escape schließt dieses Fenster.',
        'sync.empty': 'Erst den Bericht einfügen.',
        'sync.working': 'Rechne …',
        'sync.failed': 'Hat nicht geklappt.',
        'sync.fromClipboard': 'Aus der Zwischenablage übernommen, bitte bestätigen.',
        'sync.done': 'Übernommen: {teile}.',
        'sync.part.window': '100 % = {wert} im Fenster',
        'sync.part.week': '{wert} in der Woche',
        'sync.part.drift': 'Zählung weicht um {prozent} % ab',
        'sync.part.points': 'aus {anzahl} Abgleichen ausgeglichen',

        /* Hilfe */
        'help.title': 'Was die Zahlen bedeuten',
        'help.foot': 'H oder Escape schließt dieses Fenster.',

        /* Tray */
        'tray.show': 'Claude TV zeigen',
        'tray.onTop': 'Immer im Vordergrund',
        'tray.autostart': 'Mit Windows starten',
        'tray.closeToTray': 'Schliessen legt ins Tray',
        'tray.git': 'Git-Stand anzeigen',
        'tray.quit': 'Beenden',
        'tray.tooltip.window': '{prozent} % im 5-Stunden-Fenster',
        'tray.tooltip.reset': 'Reset {uhr}',
    },

    en: {
        /* Title bar */
        'bar.detail': 'Details',
        'bar.overview': 'Overview',
        'bar.theme.system': 'System',
        'bar.theme.light': 'Light',
        'bar.theme.dark': 'Dark',
        'bar.pin': 'Pin',
        'bar.sync': 'Sync',
        'bar.help.title': 'What do the numbers mean? (H)',
        'bar.view.title': 'Switch view (D)',
        'bar.theme.title': 'Colour scheme (T)',
        'bar.pin.title': 'Always on top (P)',
        'bar.sync.title': 'Sync with Claude Code (A)',
        'bar.lang.title': 'Switch language (S)',
        'bar.minimize': 'Minimise',
        'bar.close': 'Close',
        'bar.plan': 'Plan · {plan}',

        /* Overview */
        'window.title': '5-hour window',
        'window.target': 'Target',
        'window.reset': 'Resets in {rest}',
        'window.resetAt': 'Resets {tag} {uhr}',
        'week.title': 'Last 7 days',
        'week.scoped': 'Second weekly limit: {prozent} %{reset} · as of the last sync{alt}',
        'week.scoped.reset': ', resets {tag} {uhr}',
        'week.scoped.stale': ', more than a day old',
        'week.noScale': 'no scale',
        'stat.rate': 'Tokens per minute',
        'stat.today': 'Used today',
        'stat.sessions': 'Sessions today',
        'stat.model': 'Last active',
        'unit.tokens': 'tokens',

        /* Pace and forecast */
        'pace.spare': '{wert} % below target.',
        'pace.over': '{wert} % above target, but it lasts until the reset.',
        'pace.onTarget': 'Right on target.',
        'pace.eta': 'At this rate you hit 100 % in {rest}.',
        'pace.maxed': 'Scale maxed out.',
        'pace.noScale': 'No scale, no forecast. Percentages appear after three completed windows.',
        'pace.lastMessage': 'Last message {rest} ago.',
        'pace.nothing': 'No messages in the logs yet.',

        /* Limit events */
        'limits.once': 'Hit the limit once in four weeks',
        'limits.many': 'Hit the limit {anzahl} times in four weeks',
        'limits.last': ', last on {tag} {uhr}',
        'limits.anchor': '. Window boundary taken from there.',

        /* Footer */
        'foot.scale.config': '100 % = {wert} tokens, set by you',
        'foot.scale.sync': '100 % = {wert} tokens · synced {wann}',
        'foot.scale.p90': '100 % = {wert} tokens. You only need more in one window out of ten.',
        'foot.scale.none': 'No scale yet: {gezaehlt} of {noetig} windows measured',
        'foot.source': 'Claude Code only, {anzahl} log files',
        'foot.source.missing': 'No logs found',
        'foot.source.demo': 'Demo: {name}',

        /* Character states */
        'state.sleeping': 'Asleep',
        'state.idle': 'Waiting',
        'state.working': 'Working',
        'state.conducting': 'Conducting',
        'state.sprinting': 'Sprinting',
        'state.strained': 'Strained',
        'state.spent': 'Maxed out',
        'state.fresh': 'Fresh window',

        /* Details */
        'card.work': 'What is being worked on',
        'card.work.none': 'nothing yet',
        'card.work.ago': '{projekt} · {rest} ago',
        'card.work.noRepo': 'No git repository in this folder.',
        'card.work.off': 'Git display is off.',
        'git.branch': 'Branch <b>{name}</b>',
        'git.changed': '{anzahl} changed',
        'git.untracked': '{anzahl} new',
        'git.clean': 'clean',
        'git.ahead': '{anzahl} ahead of remote',
        'git.behind': '{anzahl} behind',
        'git.lastCommit': 'last {hash} “{betreff}”',

        'card.composition': 'What the usage consists of',
        'card.composition.note': 'in the current window',
        'part.input': 'Input',
        'part.input.hint': 'newly sent text',
        'part.output': 'Output',
        'part.output.hint': 'text written back',
        'part.thinking': 'Thinking',
        'part.thinking.hint': 'internal reasoning',
        'part.cacheCreate': 'Cache written',
        'part.cacheCreate.hint': 'context cached anew',
        'part.cacheRead': 'Cache read',
        'part.cacheRead.hint': 'reused context, does not count towards usage',

        'card.models': 'Models',
        'card.projects': 'Projects',
        'card.history': 'History',
        'card.history.note': 'window and day',
        'card.total': 'total',
        'card.empty': 'nothing yet',

        'card.kinds': 'Where the usage goes',
        'kind.main': 'Main loop',
        'kind.main.hint': 'what you do with Claude Code yourself',
        'kind.subagent': 'Subagents',
        'kind.subagent.hint': 'work Claude hands to copies of itself',
        'kind.workflow': 'Workflows',
        'kind.workflow.hint': 'multi-step runs with their own agents',

        'card.windows': 'Windows compared',
        'card.windows.note': 'the last 14',
        'card.windows.summary': 'Average {schnitt}, current window {jetzt}',
        'card.windows.none': 'No completed window yet.',

        'card.days': 'The week',
        'card.days.note': 'per day',
        'card.cache': 'Cache reuse',
        'card.cache.note': 'total and in the window',
        'card.cache.all': 'overall',
        'card.cache.window': 'current window',
        'card.cache.hint': 'High is good: reading cache costs almost nothing, writing it counts in full against your quota.',

        'card.sessions': 'Biggest sessions today',
        'card.sessions.note': 'without subagents',
        'card.sessions.none': 'nothing today yet',
        'card.sessions.hint': '{anzahl} messages, last at {uhr}',

        'card.cost': 'Priced as API usage',
        'card.cost.note': 'estimate at list prices',
        'card.cost.window': 'current window',
        'card.cost.today': 'today',
        'card.cost.week': 'seven days',
        'card.cost.hint': 'What the same usage would have cost through the API. On a subscription you pay nothing per token.',

        'card.heat': 'When you work',
        'card.heat.note': 'four weeks',
        'heat.cell': '{tag} {stunde}:00 — {wert}',

        /* Weekdays, short */
        'day.0': 'Sun',
        'day.1': 'Mon',
        'day.2': 'Tue',
        'day.3': 'Wed',
        'day.4': 'Thu',
        'day.5': 'Fri',
        'day.6': 'Sat',

        /* Durations */
        'time.now': 'now',
        'time.days': '{tage} d {stunden} h',
        'time.hours': '{stunden} h {minuten} min',
        'time.minutes': '{minuten} min',
        'time.minutesSeconds': '{minuten} min {sekunden} s',
        'time.seconds': '{sekunden} s',
        'time.today': 'today',
        'time.todayAt': 'today at {uhr}',
        'time.onDayAt': 'on {tag} at {uhr}',

        /* Sync */
        'sync.title': 'Sync with Claude Code',
        'sync.intro': 'The real limits are in no file on your disk. Claude Code shows them in the context window under <b>Show detailed breakdown</b>. Paste that text here and the display works from your real limits instead of an estimate.',
        'sync.apply': 'Apply',
        'sync.foot': 'A or Escape closes this window.',
        'sync.empty': 'Paste the report first.',
        'sync.working': 'Working …',
        'sync.failed': 'That did not work.',
        'sync.fromClipboard': 'Taken from the clipboard, please confirm.',
        'sync.done': 'Applied: {teile}.',
        'sync.part.window': '100 % = {wert} per window',
        'sync.part.week': '{wert} per week',
        'sync.part.drift': 'our count differs by {prozent} %',
        'sync.part.points': 'balanced across {anzahl} syncs',

        /* Help */
        'help.title': 'What the numbers mean',
        'help.foot': 'H or Escape closes this window.',

        /* Tray */
        'tray.show': 'Show Claude TV',
        'tray.onTop': 'Always on top',
        'tray.autostart': 'Start with Windows',
        'tray.closeToTray': 'Close sends it to the tray',
        'tray.git': 'Show git status',
        'tray.quit': 'Quit',
        'tray.tooltip.window': '{prozent} % of the 5-hour window',
        'tray.tooltip.reset': 'Resets {uhr}',
    },
};

/**
 * Welche Sprache gilt?
 *
 * @param {string} setting 'system', 'de' oder 'en'
 * @param {string} locale etwa 'de-DE'
 */
export function resolveLanguage(setting, locale = 'en') {
    if (LANGUAGES.includes(setting)) {
        return setting;
    }
    const kurz = String(locale || '').slice(0, 2).toLowerCase();
    return LANGUAGES.includes(kurz) ? kurz : 'en';
}

/**
 * Text zu einem Schluessel, mit eingesetzten Platzhaltern.
 *
 * Fehlt ein Schluessel, kommt er selbst zurueck. Das faellt in der Anzeige
 * sofort auf und ist besser als ein leeres Feld.
 */
export function translate(lang, key, vars = {}) {
    const tabelle = TEXTS[lang] || TEXTS.en;
    const roh = tabelle[key] ?? TEXTS.en[key] ?? key;
    return String(roh).replace(/\{(\w+)\}/g, (ganz, name) => (
        Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : ganz
    ));
}

/**
 * Die Hilfe. Als Liste, nicht als Markup im HTML: so steht der Text in beiden
 * Sprachen an derselben Stelle wie alles andere, und eine neue Zeile kostet
 * einen Eintrag statt eines Eingriffs in die Seite.
 *
 * Im zweiten Feld ist einfaches Markup erlaubt, mehr als <b> braucht es nicht.
 */
export const HELP = {
    de: [
        ['Verbrauch',
            'Eingabe plus Antwort plus neu angelegter Cache. Das ist die Zahl, die auf dein Kontingent geht. Wiederverwendeter Cache steht getrennt, er ist der billige Teil und würde sonst alles andere erdrücken.'],
        ['5-Stunden-Fenster',
            'Claude Code rechnet in Fenstern von fünf Stunden. Wo eins beginnt, steht nicht in den Logs: es kann auch durch Arbeit im Browser geöffnet worden sein. Mit einem Abgleich oder einer Limit-Meldung steht die Grenze fest, sonst schätzt die Anzeige sie aus der ersten Nachricht, abgerundet auf zehn Minuten.'],
        ['Die Marke „Ziel“',
            'Dort stünde der Balken bei gleichmäßiger Auslastung: nach der Hälfte der Zeit die Hälfte des Kontingents. Balken links davon heißt, du hast Luft. Balken rechts davon heißt, in diesem Tempo bist du vor dem Reset am Anschlag.'],
        ['Die Prozente',
            'Ohne Abgleich geschätzt: 100 Prozent ist dann der Verbrauch, den 9 von 10 deiner abgeschlossenen Fenster nicht überschreiten. Nach einem Abgleich zählt die Anzeige vom abgelesenen Wert weiter und rechnet nur dazu, was seither gemessen wurde. Die Fußzeile schreibt immer hin, was gerade gilt.'],
        ['Abgleich',
            'Claude Code kennt deine echten Limits, holt sie aber live von der API und schreibt sie nirgends hin. Sichtbar sind sie im Kontextfenster unter „Detaillierte Aufschlüsselung anzeigen“. Diesen Text mit <b>A</b> hier einfügen. Jeder weitere Abgleich schärft die Skala, wobei frische Punkte schwerer wiegen als alte: nach einer Woche zählt einer noch halb.'],
        ['Letzte 7 Tage',
            'Ohne Abgleich ein rollendes Fenster über sieben Tage, keine Kalenderwoche. Mit Abgleich die echte Woche bis zu deinem Reset.'],
        ['Zweites Wochenlimit',
            'Der Wert stammt unverändert aus dem Abgleich und altert. Nachrechnen lässt er sich lokal nicht: er stand auf 0 Prozent, während im selben Zeitraum 39 Millionen Fable-Tokens in den Logs lagen. Was er zählt, ist also etwas anderes als das, was hier zu sehen ist.'],
        ['Ins Limit gelaufen',
            'Wenn Claude Code das Limit meldet, steht die echte Resetzeit in der Logzeile. Die Anzeige liest sie mit und übernimmt die Fenstergrenze, solange kein Abgleich vorliegt. Als Maßstab für 100 Prozent taugen die Treffer nicht: wer nebenher im Browser arbeitet, erreicht die Grenze, ohne dass der lokal messbare Verbrauch dort ankommt.'],
        ['Subagenten',
            'Aufgaben, die Claude an sich selbst weitergibt. Sie laufen mit eigenen Sitzungen und verbrauchen dasselbe Kontingent. Überwiegen sie gerade, dirigiert Clawd statt selbst zu tippen.'],
        ['Woran gearbeitet wird',
            'Aus den Werkzeugaufrufen in denselben Logs: Projekt, Werkzeug, Datei. Dazu Branch und Stand des Repositories, lokal von <b>git</b> gelesen. Inhalte von Nachrichten werden nicht angefasst, und die Git-Anzeige lässt sich im Tray abschalten.'],
        ['Über die API gerechnet',
            'Was dieselbe Nutzung zu Listenpreisen gekostet hätte. Im Abo zahlst du nichts pro Token, die Zahl ist nur ein Vergleich, und sie liegt eher etwas zu hoch: die einzige Gegenprobe gegen Claude Code wich um rund ein Viertel nach oben ab.'],
        ['Was fehlt',
            'Nur Claude Code ist hier zu sehen. Deine Chats auf claude.ai und in der Desktop-App stehen in diesen Logs nicht.'],
    ],
    en: [
        ['Usage',
            'Input plus output plus newly written cache. That is the number counting against your quota. Reused cache is listed separately: it is the cheap part and would otherwise drown out everything else.'],
        ['5-hour window',
            'Claude Code bills in five-hour windows. Where one begins is not in the logs — it may have been opened by work in the browser. With a sync or a limit message the boundary is known; otherwise the display estimates it from the first message, rounded down to ten minutes.'],
        ['The “Target” mark',
            'That is where the bar would stand at an even pace: half the quota after half the time. Bar to the left means you have room. Bar to the right means that at this rate you run out before the reset.'],
        ['The percentages',
            'Without a sync they are estimated: 100 % is the usage that 9 out of 10 of your completed windows stay under. After a sync the display starts from the figure you read off and only adds what has been measured since. The footer always states what currently counts as 100 %.'],
        ['Sync',
            'Claude Code knows your real limits but fetches them live and writes them nowhere. They are visible in the context window under “Show detailed breakdown”. Paste that text here with <b>A</b>. Every further sync sharpens the scale, with fresh points weighing more than old ones: after a week a point counts half.'],
        ['Last 7 days',
            'Without a sync a rolling seven-day window, not a calendar week. With a sync the real week up to your reset.'],
        ['Second weekly limit',
            'The value comes straight from the sync and ages. It cannot be recomputed locally: it read 0 % while 39 million Fable tokens sat in the logs for the same period. Whatever it counts, it is not what is shown here.'],
        ['Hitting the limit',
            'When Claude Code reports the limit, the real reset time is in the log line. The display reads it and adopts the window boundary as long as there is no sync. As a yardstick for 100 % those hits are useless: work done in the browser reaches the limit without the locally measurable usage getting there.'],
        ['Subagents',
            'Work Claude hands to copies of itself. They run in their own sessions and draw on the same quota. While they dominate, Clawd conducts instead of typing.'],
        ['What is being worked on',
            'From the tool calls in the same logs: project, tool, file. Plus branch and repository state, read locally by <b>git</b>. Message contents are never touched, and the git display can be switched off in the tray.'],
        ['Priced as API usage',
            'What the same usage would have cost at list prices. On a subscription you pay nothing per token; the figure is a comparison only, and it runs somewhat high: the one cross-check against Claude Code came out about a quarter above.'],
        ['What is missing',
            'Only Claude Code is visible here. Your chats on claude.ai and in the desktop app are not in these logs.'],
    ],
};
