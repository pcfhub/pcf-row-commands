/**
 * Where the maker's commands come from, and every way that can fail, named —
 * a decision module: `fetch` is handed in, so the suite drives each state.
 *
 * The **Your commands** property holds either the JSON itself (it starts with
 * `{` or `[`) or the name of a web resource holding it. Both, because each
 * host refuses one of them:
 *
 *   - **A model-driven form refuses a static value over 100 characters**
 *     (measured, pcf-code-editor 2026-09-23), which is one short command. A
 *     web resource has no such ceiling, and a dataset control reads one the
 *     way a field control does — same-origin, no `<uses-feature>`: measured
 *     from this control on a subgrid and a main grid, 2026-10-08 (SPEC.md P3).
 *   - **A canvas app has no organisation to fetch from**, and a formula has
 *     no ceiling, so there the property carries the JSON.
 *
 * What a fetch answers, measured: **200 `text/jscript`** for a Script web
 * resource (Dataverse has no JSON type, so the body is read as JSON whatever
 * the header says), **404 with an empty body** for a name that is not there —
 * the status is all there is to go on — and `cache-control: private`, so every
 * load revalidates with `cache: "no-cache"` and a new publish reaches the next
 * form load. An edit reaches nobody until it is published.
 */

import { CommandDef, isInline, parseCommands } from './config';

export type ConfigLoad =
    | { state: 'none' }
    | { state: 'ready'; commands: CommandDef[] }
    | { state: 'invalid'; problem: string }
    | { state: 'notFound'; name: string }
    | { state: 'denied'; name: string; status: number }
    | { state: 'failed'; name: string; status: number }
    | { state: 'offline'; name: string }
    | { state: 'noHost'; name: string };

export type Fetch = (url: string, init: { credentials: 'same-origin'; cache: 'no-cache' }) => Promise<{
    status: number;
    ok: boolean;
    text(): Promise<string>;
}>;

/** The address of a web resource, from the organisation's URL. */
export function webResourceUrl(name: string, clientUrl: string): string {
    const base = clientUrl.replace(/\/+$/, '');
    const path = name.split('/').map(encodeURIComponent).join('/');

    return `${base}/WebResources/${path}`;
}

/**
 * Read the property, and the web resource it names if it names one. **Never
 * rejects**: a configuration that cannot be had is a state the control says
 * out loud, and the built-in commands carry on without it.
 *
 * `clientUrl` is `null` on a host with no organisation — canvas — where a
 * name cannot be fetched and says so rather than trying a relative path.
 */
export async function loadCommands(raw: unknown, clientUrl: string | null, fetchFn: Fetch | undefined): Promise<ConfigLoad> {
    const text = typeof raw === 'string' ? raw.trim() : '';

    if (text === '') {
        return { state: 'none' };
    }

    if (isInline(text)) {
        return fromText(text);
    }

    const name = text;

    if (!clientUrl || typeof fetchFn !== 'function') {
        return { state: 'noHost', name };
    }

    let response: Awaited<ReturnType<Fetch>>;

    try {
        response = await fetchFn(webResourceUrl(name, clientUrl), { credentials: 'same-origin', cache: 'no-cache' });
    } catch {
        // A rejected fetch is the network: offline, or the request blocked.
        return { state: 'offline', name };
    }

    if (response.status === 404) {
        return { state: 'notFound', name };
    }

    if (response.status === 401 || response.status === 403) {
        return { state: 'denied', name, status: response.status };
    }

    if (!response.ok) {
        return { state: 'failed', name, status: response.status };
    }

    let body: string;

    try {
        body = await response.text();
    } catch {
        return { state: 'offline', name };
    }

    return fromText(body);
}

function fromText(text: string): ConfigLoad {
    const parsed = parseCommands(text);

    return parsed.ok ? { state: 'ready', commands: parsed.commands } : { state: 'invalid', problem: parsed.problem };
}
