/*
 * THROWAWAY. The 0.2.5 probe build: the questions 0.3.0 rests on, asked of a
 * real form before a line of the feature exists. Every answer goes into
 * SPEC.md verbatim, with the date, and an answer that comes back the wrong way
 * removes the feature that depends on it. Delete this file, its import and its
 * call in index.ts, and the probe's `<event>` strings if 0.3.0 renames them,
 * before 0.3.0 is cut.
 *
 * From the browser console on a form (or the main grid) carrying the control:
 *
 *     __pcfRowCommandsProbe.all()              P2, P4, P6 at once
 *     __pcfRowCommandsProbe.controls()         P1: the form's subgrids, to find the name
 *     __pcfRowCommandsProbe.raise()            P1, P7: raise onRowCommand, write the outputs
 *     __pcfRowCommandsProbe.heard()            P1: what the payload's callbacks recorded
 *     __pcfRowCommandsProbe.resource(name?)    P3: fetch a web resource, and a missing one
 *     __pcfRowCommandsProbe.addState()         P4: addColumn('statecode') + refresh, then all()
 *     __pcfRowCommandsProbe.states()           P5: statecode / statuscode options
 *     __pcfRowCommandsProbe.setState(row, s)   P5: deactivate (1) or activate (0) the row-th record
 *     __pcfRowCommandsProbe.write(row, data)   P6: updateRecord with any payload, refusal whole
 *     __pcfRowCommandsProbe.passes()           every updateView since load
 */

type DataSet = ComponentFramework.PropertyTypes.DataSet;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Context = ComponentFramework.Context<any>;

interface Pass {
    at: string;
    records: number;
    loading: boolean;
    statecodeColumn: boolean;
    firstStatecode: unknown;
}

const ask = <T>(call: () => T): T | string => {
    try {
        return call();
    } catch (error) {
        return `throws: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`;
    }
};

/** A rejection as it arrived — a Web API one is a plain object, not an Error. */
const whole = (error: unknown): unknown => {
    if (error instanceof Error) {
        return { name: error.name, message: error.message };
    }

    try {
        return JSON.parse(JSON.stringify(error));
    } catch {
        return String(error);
    }
};

let latest: { context: Context; dataset: DataSet; report: (id: string, command: string) => void } | null = null;
const passes: Pass[] = [];
const heardLog: string[] = [];
let raises = 0;

const current = (): NonNullable<typeof latest> => {
    if (!latest) {
        throw new Error('The control has not rendered yet.');
    }

    return latest;
};

const ids = (): string[] => current().dataset.sortedRecordIds ?? [];

const table = (): string => current().dataset.getTargetEntityType();

const stamp = (): string => new Date().toISOString().slice(11, 23);

function statecodeOn(dataset: DataSet): { column: boolean; first: unknown } {
    const first = (dataset.sortedRecordIds ?? [])[0];
    const record = first ? dataset.records[first] : undefined;

    return {
        column: (dataset.columns ?? []).some((column) => column.name === 'statecode'),
        first: record ? ask(() => ({ raw: record.getValue('statecode'), formatted: record.getFormattedValue('statecode') })) : 'no rows',
    };
}

/** Called from `updateView` on every pass. */
export function probe(context: Context, dataset: DataSet, report: (id: string, command: string) => void): void {
    latest = { context, dataset, report };

    const state = statecodeOn(dataset);

    passes.push({
        at: stamp(),
        records: (dataset.sortedRecordIds ?? []).length,
        loading: dataset.loading,
        statecodeColumn: state.column,
        firstStatecode: state.first,
    });

    // Read through `current()`, never a parked dataset: the dataset is a new
    // object every pass, and a probe holding the first one reads a dead
    // snapshot (pcf-data-table 0.5.0, walked into twice since).
    (window as unknown as Record<string, unknown>).__pcfRowCommandsProbe = api;
}

function privileges(context: Context, name: string): Record<string, unknown> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const utils = (context as any).utils;
    const answers: Record<string, unknown> = { method: typeof utils?.hasEntityPrivilege };

    for (const [label, type] of [['Write', 3], ['Delete', 4]] as const) {
        for (const depth of [0, 1, 2, 3]) {
            answers[`${label}(${type}) depth ${depth}`] = ask(() => utils.hasEntityPrivilege(name, type, depth));
        }
    }

    return answers;
}

const api = {
    /** P2, P4, P6 — the host's shape, the state column, the Write privilege, the event bag. */
    all(): Record<string, unknown> {
        const { context, dataset } = current();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const events = (context as any).events;
        const answers = {
            P2_host: {
                table: table(),
                contextInfo: ask(() => JSON.parse(JSON.stringify((context.mode as unknown as { contextInfo?: unknown }).contextInfo ?? null))),
                clientUrl: ask(() => (context as unknown as { page?: { getClientUrl?: () => string } }).page?.getClientUrl?.()),
                viewId: ask(() => dataset.getViewId()),
                eventsBag: events === undefined ? 'undefined' : Object.keys(events),
                onRowCommand: typeof events?.onRowCommand,
            },
            P4_statecode: statecodeOn(dataset),
            P6_privileges: privileges(context, table()),
        };

        console.log('[RowCommands probe] all', answers);

        return answers;
    },

    /** P1 — every subgrid on the form, with whether it carries addEventHandler. */
    controls(): unknown {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const xrm = (window as any).Xrm;

        if (!xrm?.Page?.ui?.controls) {
            return 'no Xrm.Page.ui.controls in this window';
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const list = xrm.Page.ui.controls.get().map((control: any) => ({
            name: ask(() => control.getName()),
            type: ask(() => control.getControlType()),
            addEventHandler: typeof control.addEventHandler,
            addOnOutputChange: typeof control.addOnOutputChange,
            getOutputs: typeof control.getOutputs,
        }));

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return list.filter((row: any) => row.type === 'subgrid' || row.addEventHandler === 'function');
    },

    /**
     * P1 and P7 — write the outputs (as a press does) and raise `onRowCommand`
     * with a payload carrying two callbacks. Bind first, from the console:
     *
     *   const c = Xrm.Page.getControl('<name from controls()>');
     *   c.addEventHandler('onRowCommand', (p) => { console.log('P1 handler', p); p.ping('from the handler'); });
     *   c.addOnOutputChange && c.addOnOutputChange(() => console.log('P7 output change', c.getOutputs && c.getOutputs()));
     */
    raise(): Record<string, unknown> {
        const { context, dataset, report } = current();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const events = (context as any).events;
        const token = (raises += 1);
        const recordIds = ids().slice(0, 2);
        const payload = {
            command: 'probe',
            recordIds,
            entityName: table(),
            ping: (from?: string) => {
                heardLog.push(`${stamp()} ping #${token}${from ? ` (${from})` : ''}`);
            },
            refresh: () => {
                heardLog.push(`${stamp()} refresh #${token}`);
                dataset.refresh();
            },
        };

        report(recordIds[0] ?? '', 'probe');

        const result: Record<string, unknown> = { token, onRowCommand: typeof events?.onRowCommand };

        if (typeof events?.onRowCommand === 'function') {
            const before = heardLog.length;

            try {
                events.onRowCommand(payload);
                result.raised = 'returned';
            } catch (error) {
                result.raised = whole(error);
            }

            // A handler that calls back synchronously has done so by now.
            result.heardSynchronously = heardLog.slice(before);
        }

        console.log('[RowCommands probe] raise', result);

        return result;
    },

    heard(): string[] {
        return heardLog.slice();
    },

    /**
     * P3 — a same-origin fetch of a web resource from a dataset control. With
     * no name, the first published Script (JScript) web resource the Web API
     * lists; a name that cannot exist is fetched beside it for the 404 shape.
     */
    async resource(name?: string): Promise<Record<string, unknown>> {
        const { context } = current();
        const base = String(ask(() => (context as unknown as { page: { getClientUrl: () => string } }).page.getClientUrl()));
        let chosen = name;

        if (!chosen) {
            const found = await context.webAPI
                .retrieveMultipleRecords('webresource', '?$select=name&$filter=webresourcetype eq 3&$top=1')
                .then((result) => result.entities[0]?.name as string | undefined, (error: unknown) => whole(error));

            if (typeof found !== 'string') {
                return { listed: found };
            }

            chosen = found;
        }

        const read = async (resourceName: string): Promise<Record<string, unknown>> => {
            const url = `${base.startsWith('http') ? base : ''}/WebResources/${resourceName.split('/').map(encodeURIComponent).join('/')}`;

            try {
                const response = await fetch(url, { credentials: 'same-origin', cache: 'no-cache' });
                const text = await response.text();

                return {
                    url,
                    status: response.status,
                    contentType: response.headers.get('content-type'),
                    cacheControl: response.headers.get('cache-control'),
                    length: text.length,
                    head: text.slice(0, 80),
                };
            } catch (error) {
                return { url, threw: whole(error) };
            }
        };

        const answers = {
            P3_found: await read(chosen),
            P3_missing: await read('pcfhub_/rowcommands-probe-does-not-exist.json'),
        };

        console.log('[RowCommands probe] resource', answers);

        return answers;
    },

    /** P4 — ask for the state column; the answer is in the next pass, so run all() after. */
    addState(): string {
        const { dataset } = current();
        const added = ask(() => {
            dataset.addColumn?.('statecode');
            return 'addColumn called';
        });

        dataset.refresh();

        return `${String(added)}; refresh() called — run all() or passes() once the view has redrawn`;
    },

    /** P5 — the two columns' options, as `getEntityMetadata` hands them to a dataset control. */
    async states(): Promise<unknown> {
        const { context } = current();

        try {
            const meta = await context.utils.getEntityMetadata(table(), ['statecode', 'statuscode']);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const attributes = (meta as any).Attributes;
            const read = (name: string): unknown => {
                const attribute = typeof attributes?.get === 'function' ? attributes.get(name) : attributes?.[name];

                return attribute ? JSON.parse(JSON.stringify(attribute.attributeDescriptor?.OptionSet ?? attribute)) : 'absent';
            };
            const answers = { statecode: read('statecode'), statuscode: read('statuscode') };

            console.log('[RowCommands probe] states', answers);

            return answers;
        } catch (error) {
            return whole(error);
        }
    },

    /**
     * P5 — `{ statecode, statuscode }` in one update, the reason being the
     * state's DefaultStatus read from `states()`. Use a test record.
     */
    async setState(row: number, state: number, reason?: number): Promise<unknown> {
        const { dataset } = current();
        const id = ids()[row];

        if (!id) {
            return `no row ${row}`;
        }

        let statuscode = reason;

        if (statuscode === undefined) {
            const options = (await api.states()) as { statecode?: Array<{ Value: number; DefaultStatus?: number }> };
            statuscode = Array.isArray(options.statecode)
                ? options.statecode.find((option) => option.Value === state)?.DefaultStatus
                : undefined;
        }

        const payload: Record<string, number> = { statecode: state };

        if (typeof statuscode === 'number') {
            payload.statuscode = statuscode;
        }

        return api.write(row, payload).then((answer) => {
            dataset.refresh();
            return { id, payload, answer };
        });
    },

    /** P6 — any update on the row-th record, with the refusal printed whole. */
    async write(row: number, data: Record<string, unknown>): Promise<unknown> {
        const { context } = current();
        const id = ids()[row];

        if (!id) {
            return `no row ${row}`;
        }

        const started = Date.now();

        try {
            const answer = await context.webAPI.updateRecord(table(), id, data);
            const result = { id, data, resolved: whole(answer), ms: Date.now() - started };

            console.log('[RowCommands probe] write', result);

            return result;
        } catch (error) {
            const result = { id, data, rejected: whole(error), ms: Date.now() - started };

            console.log('[RowCommands probe] write', result);

            return result;
        }
    },

    passes(): Pass[] {
        return passes.slice();
    },
};
