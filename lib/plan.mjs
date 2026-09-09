/**
 * Liest den Tarif aus der Claude-Code-Konfiguration.
 *
 * Gelesen wird genau ein Feld: oauthAccount.userRateLimitTier. Adresse, Name
 * und Organisation stehen in derselben Datei, werden hier aber bewusst nicht
 * angefasst. Die Datei mit den Zugangsdaten bleibt komplett unberuehrt.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const TIERS = [
    [/max_20x/, 'Max 20x'],
    [/max_5x/, 'Max 5x'],
    [/max/, 'Max'],
    [/pro/, 'Pro'],
    [/team/, 'Team'],
    [/enterprise/, 'Enterprise'],
    [/free/, 'Free'],
];

export function describeTier(raw) {
    const key = String(raw || '').toLowerCase();
    if (key === '') {
        return null;
    }
    for (const [pattern, label] of TIERS) {
        if (pattern.test(key)) {
            return label;
        }
    }
    return null;
}

/** @returns {Promise<string|null>} zum Beispiel "Max 5x", oder null */
export async function readPlan(path = join(homedir(), '.claude.json')) {
    try {
        const raw = await readFile(path, 'utf8');
        // Nur das eine Feld herausziehen, die Datei nicht komplett auswerten.
        const match = /"userRateLimitTier"\s*:\s*"([^"]{0,64})"/.exec(raw);
        return match ? describeTier(match[1]) : null;
    } catch {
        return null;
    }
}
