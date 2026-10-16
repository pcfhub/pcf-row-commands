/*
 * THROWAWAY. The 0.3.4 probe build: the questions 0.4.0's commands that call a
 * Custom API (or a platform message) rest on, asked of a real form before a
 * line of the feature exists. Every answer goes into SPEC.md, dated, and an
 * answer that comes back the wrong way removes the feature that depends on it.
 * Delete this file, its import and its call in index.ts before 0.4.0.
 *
 * It creates nothing. The throwaway Custom APIs it calls are created and
 * deleted from the console, beside it:
 *
 *     pcfhub_ProbeRowBound         bound to the subgrid's table   Text in, Echo out
 *     pcfhub_ProbeRowBoundAccount  bound to account (main grid)   Text in, Echo out
 *     pcfhub_ProbeRowUnbound       unbound   RowId (Guid), Target (EntityReference), no response
 *
 * From the browser console on a form (or the main grid) carrying the control:
 *
 *     __pcfRowCommandsProbe.all()                 P1  host, organisation URL, entity set, id column
 *     __pcfRowCommandsProbe.bound(row, text)      P2  the bound action on the row-th record
 *     __pcfRowCommandsProbe.bound(row, text, n)   P2  …under another spelling of the name (casing)
 *     __pcfRowCommandsProbe.unbound(row, shape)   P3, P4  'ok' | 'refNoType' | 'refWrongType' | 'notGuid'
 *     __pcfRowCommandsProbe.refuse(row)           P5  platform messages refusing a well-formed body
 *     __pcfRowCommandsProbe.gone()                P5  the bound action on an id that is no row
 *     __pcfRowCommandsProbe.sequence(n)           P6  n bound calls one after another, then a refresh
 *     __pcfRowCommandsProbe.passes()              every updateView since load
 */

type DataSet = ComponentFramework.PropertyTypes.DataSet;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Context = ComponentFramework.Context<any>;

interface Pass {
    at: string;
    records: number;
    loading: boolean;
    selected: string[];
}

interface Answer {
    path: string;
    status: number | string;
    ms: number;
    body?: unknown;
    code?: string;
    message?: string;
    messageLength?: number;
    afterInner?: string | null;
    contentType?: string | null;
}

const ask = <T>(call: () => T): T | string => {
    try {
        return call();
    } catch (error) {
        return `throws: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`;
    }
};

let latest: { context: Context; dataset: DataSet } | null = null;
const passes: Pass[] = [];

const current = (): NonNullable<typeof latest> => {
    if (!latest) {
        throw new Error('The control has not rendered yet.');
    }

    return latest;
};

const ids = (): string[] => current().dataset.sortedRecordIds ?? [];
const table = (): string => current().dataset.getTargetEntityType();
const stamp = (): string => new Date().toISOString().slice(11, 23);

/** Called from `updateView` on every pass. Read through `current()`, never a parked dataset. */
export function probe(context: Context, dataset: DataSet): void {
    latest = { context, dataset };
    passes.push({
        at: stamp(),
        records: (dataset.sortedRecordIds ?? []).length,
        loading: dataset.loading,
        selected: ask(() => dataset.getSelectedRecordIds()) as string[],
    });
    (window as unknown as Record<string, unknown>).__pcfRowCommandsProbe = api;
}

function clientUrl(): string | null {
    const page = (current().context as unknown as { page?: { getClientUrl?: () => string } }).page;
    const url = ask(() => page?.getClientUrl?.());

    return typeof url === 'string' && url !== '' ? url : null;
}

const HEADERS = {
    Accept: 'application/json',
    'Content-Type': 'application/json; charset=utf-8',
    'OData-MaxVersion': '4.0',
    'OData-Version': '4.0',
};

/** One POST, the answer whole: status, time, the body or the error's parts. */
async function post(path: string, body: unknown): Promise<Answer> {
    const base = clientUrl();

    if (base === null) {
        return { path, status: 'no organisation URL', ms: 0 };
    }

    const started = performance.now();

    try {
        const response = await fetch(`${base}/api/data/v9.2/${path}`, {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify(body),
            credentials: 'same-origin',
        });
        const ms = Math.round(performance.now() - started);
        const text = await response.text();
        const answer: Answer = { path, status: response.status, ms, contentType: response.headers.get('content-type') };

        if (text === '') {
            return answer;
        }

        const parsed = ask(() => JSON.parse(text)) as { error?: { code?: string; message?: string } };
        const error = parsed && typeof parsed === 'object' ? parsed.error : undefined;

        if (error) {
            const message = String(error.message ?? '');
            const inner = message.indexOf('InnerException : ');

            answer.code = error.code;
            answer.messageLength = message.length;
            answer.message = message.slice(0, 400);
            answer.afterInner = inner === -1 ? null : message.slice(inner + 17, inner + 17 + 300);
        } else {
            answer.body = parsed;
        }

        return answer;
    } catch (error) {
        return { path, status: `rejected: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`, ms: Math.round(performance.now() - started) };
    }
}

async function metadata(): Promise<{ set: unknown; primaryId: unknown; fetched: unknown }> {
    const { context } = current();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const utils = (context as any).utils;
    let set: unknown = 'not asked';
    let primaryId: unknown = 'not asked';

    try {
        const meta = await utils.getEntityMetadata(table());

        set = meta?.EntitySetName;
        primaryId = meta?.PrimaryIdAttribute;
    } catch (error) {
        set = `rejected: ${error instanceof Error ? error.message : JSON.stringify(error)}`;
    }

    const base = clientUrl();
    let fetched: unknown = 'no organisation URL';

    if (base !== null) {
        fetched = await fetch(`${base}/api/data/v9.2/EntityDefinitions(LogicalName='${table()}')?$select=EntitySetName,PrimaryIdAttribute`, { headers: HEADERS })
            .then((response) => response.json())
            .then((body) => ({ EntitySetName: body.EntitySetName, PrimaryIdAttribute: body.PrimaryIdAttribute }))
            .catch((error) => `rejected: ${String(error)}`);
    }

    return { set, primaryId, fetched };
}

async function setAndId(): Promise<{ set: string; id: string }> {
    const meta = await metadata();
    const set = typeof meta.set === 'string' ? meta.set : (meta.fetched as { EntitySetName?: string }).EntitySetName ?? '';
    const id = typeof meta.primaryId === 'string' ? meta.primaryId : (meta.fetched as { PrimaryIdAttribute?: string }).PrimaryIdAttribute ?? `${table()}id`;

    return { set, id };
}

const boundName = (): string => (table() === 'account' ? 'pcfhub_ProbeRowBoundAccount' : 'pcfhub_ProbeRowBound');

const log = <T>(label: string, value: T): T => {
    console.log(`[RowCommands probe] ${label}`, value);

    return value;
};

const api = {
    /** P1 — the host, the organisation URL, how a bound path is spelled for this table. */
    async all(): Promise<unknown> {
        const { context, dataset } = current();

        return log('all', {
            P1_host: {
                table: table(),
                contextInfo: ask(() => JSON.parse(JSON.stringify((context.mode as unknown as { contextInfo?: unknown }).contextInfo ?? null))),
                clientUrl: clientUrl(),
                viewId: ask(() => dataset.getViewId()),
                rows: ids().length,
                webAPI: typeof context.webAPI?.updateRecord,
                fetch: typeof fetch,
            },
            P1_metadata: await metadata(),
            boundName: boundName(),
        });
    },

    /** P2 — the bound action on the row-th record; `name` to try another spelling. */
    async bound(row = 0, text = 'from the probe', name?: string): Promise<unknown> {
        const id = ids()[row];

        if (!id) {
            return `no row ${row}`;
        }

        const { set } = await setAndId();

        return log('bound', await post(`${set}(${id})/Microsoft.Dynamics.CRM.${name ?? boundName()}`, { Text: text }));
    },

    /** P3, P4 — the unbound action with the row as a Guid and as an entity reference; each shape but `ok` spoils one. */
    async unbound(row = 0, shape: 'ok' | 'refNoType' | 'refWrongType' | 'notGuid' = 'ok'): Promise<unknown> {
        const id = ids()[row];

        if (!id) {
            return `no row ${row}`;
        }

        const { id: key } = await setAndId();
        const reference = { '@odata.type': `Microsoft.Dynamics.CRM.${table()}`, [key]: id };
        const body: Record<string, unknown> = { RowId: shape === 'notGuid' ? 'not-a-guid' : id, Target: reference };

        if (shape === 'refNoType') {
            body.Target = { [key]: id };
        } else if (shape === 'refWrongType') {
            body.Target = { '@odata.type': 'Microsoft.Dynamics.CRM.contact', contactid: id };
        }

        return log(`unbound ${shape}`, { sent: body, answer: await post('pcfhub_ProbeRowUnbound', body) });
    },

    /** P5 — platform messages refusing a well-formed body for a reason of their own. */
    async refuse(row = 0): Promise<unknown> {
        const id = ids()[row];

        if (!id) {
            return `no row ${row}`;
        }

        const { id: key } = await setAndId();
        const nobody = '00000000-0000-0000-0000-0000000000a1';

        return log('refuse', {
            grantToNobody: await post('GrantAccess', {
                Target: { '@odata.type': `Microsoft.Dynamics.CRM.${table()}`, [key]: id },
                PrincipalAccess: { Principal: { '@odata.type': 'Microsoft.Dynamics.CRM.systemuser', systemuserid: nobody }, AccessMask: 'ReadAccess' },
            }),
            qualifyNoLead: await post(`leads(${nobody})/Microsoft.Dynamics.CRM.QualifyLead`, {
                CreateAccount: false, CreateContact: false, CreateOpportunity: false, Status: 3,
            }),
        });
    },

    /** P5 — the bound action on an id that is no row: a record deleted while the page showed it. */
    async gone(): Promise<unknown> {
        const { set } = await setAndId();

        return log('gone', await post(`${set}(00000000-0000-0000-0000-0000000000b2)/Microsoft.Dynamics.CRM.${boundName()}`, { Text: 'gone' }));
    },

    /** P6 — n bound calls one after another, then one refresh; the selection before and after. */
    async sequence(n = 5): Promise<unknown> {
        const { dataset } = current();
        const targets = ids().slice(0, n);
        const { set } = await setAndId();

        ask(() => dataset.setSelectedRecordIds(targets));

        const before = ask(() => current().dataset.getSelectedRecordIds());
        const started = performance.now();
        const answers: Array<{ status: unknown; ms: number }> = [];

        for (const id of targets) {
            const answer = await post(`${set}(${id})/Microsoft.Dynamics.CRM.${boundName()}`, { Text: `seq ${answers.length + 1}` });

            answers.push({ status: answer.status, ms: answer.ms });
        }

        const total = Math.round(performance.now() - started);

        dataset.refresh();
        await new Promise((resolve) => setTimeout(resolve, 3000));

        return log('sequence', { targets: targets.length, total, answers, selectedBefore: before, selectedAfterRefresh: ask(() => current().dataset.getSelectedRecordIds()) });
    },

    passes(): Pass[] {
        return passes.slice();
    },
};
