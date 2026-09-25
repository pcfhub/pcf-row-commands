/*
 * THROWAWAY. The 0.1.8 probe build: the questions 0.2.0 rests on, asked of a
 * real form before a line of the feature exists. Every answer goes into
 * SPEC.md verbatim, with the date, and an answer that comes back the wrong way
 * removes the feature that depends on it. Delete this file, and its import in
 * index.ts, before 0.2.0 is cut.
 *
 * From the browser console on the form:
 *
 *     __pcfRowCommandsProbe.all()          P1, P4, P5 at once
 *     __pcfRowCommandsProbe.select(3)      P3: select the first three rows
 *     __pcfRowCommandsProbe.selection()    P3: what the platform holds now
 *     __pcfRowCommandsProbe.passes()       P3: every updateView since load
 *     __pcfRowCommandsProbe.drag()         P6: the pointer events a header got
 *     __pcfRowCommandsProbe.confirm()      P7: press Cancel in the dialog
 *     __pcfRowCommandsProbe.openFirst()    P7: open, edit, save, close
 */

type DataSet = ComponentFramework.PropertyTypes.DataSet;

interface Pass {
    at: string;
    records: number;
    selected: string[];
    loading: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Context = ComponentFramework.Context<any>;

const ask = <T>(call: () => T): T | string => {
    try {
        return call();
    } catch (error) {
        return `throws: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`;
    }
};

let latest: { context: Context; dataset: DataSet; container: HTMLElement } | null = null;
const passes: Pass[] = [];
const pointer: string[] = [];
let listening = false;

function privileges(context: Context, table: string): Record<string, unknown> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const utils = (context as any).utils;
    const answers: Record<string, unknown> = {
        utilsPresent: utils !== undefined,
        method: typeof utils?.hasEntityPrivilege,
    };

    for (const [name, type] of [['Read', 2], ['Write', 3], ['Delete', 4]] as const) {
        for (const depth of [0, 1, 2, 3]) {
            answers[`${name}(${type}) depth ${depth}`] = ask(() => utils.hasEntityPrivilege(table, type, depth));
        }
    }

    return answers;
}

function storage(): Record<string, unknown> {
    const key = 'pcfhub.rowcommands.probe';

    return {
        read: ask(() => typeof window.localStorage),
        write: ask(() => {
            window.localStorage.setItem(key, new Date().toISOString());
            return 'ok';
        }),
        readBack: ask(() => window.localStorage.getItem(key)),
        origin: window.location.origin,
        framed: window.self !== window.top,
    };
}

function columns(dataset: DataSet, container: HTMLElement): unknown[] {
    const headers = Array.from(container.querySelectorAll('thead th'));

    return (dataset.columns ?? [])
        .filter((column) => !column.isHidden)
        .sort((a, b) => a.order - b.order)
        .map((column, index) => ({
            name: column.name,
            visualSizeFactor: column.visualSizeFactor,
            renderedWidth: headers[index] ? Math.round(headers[index].getBoundingClientRect().width) : null,
        }));
}

function listen(container: HTMLElement): void {
    if (listening) {
        return;
    }

    listening = true;

    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture']) {
        container.addEventListener(
            type,
            (event) => {
                const target = event.target as HTMLElement;

                if (!target.closest('thead')) {
                    return;
                }

                const e = event as PointerEvent;

                // Every move would bury the rest; keep the first few.
                if (type === 'pointermove' && pointer.filter((line) => line.startsWith('pointermove')).length >= 5) {
                    return;
                }

                pointer.push(`${type} x=${Math.round(e.clientX)} buttons=${e.buttons} defaultPrevented=${e.defaultPrevented}`);

                if (type === 'pointerdown') {
                    pointer.push(`  setPointerCapture: ${String(ask(() => {
                        target.setPointerCapture(e.pointerId);
                        return target.hasPointerCapture(e.pointerId);
                    }))}`);
                }
            },
            true,
        );
    }
}

/** Called from `updateView` on every pass. */
export function probe(context: Context, dataset: DataSet, container: HTMLElement): void {
    latest = { context, dataset, container };
    listen(container);

    passes.push({
        at: new Date().toISOString().slice(11, 23),
        records: (dataset.sortedRecordIds ?? []).length,
        selected: ask(() => dataset.getSelectedRecordIds()) as string[],
        loading: dataset.loading,
    });

    // Read through a getter, never a parked dataset: the dataset is a new
    // object every pass, and a probe holding the first one reads a dead
    // snapshot (the 0.5.0 finding in pcf-data-table, walked into twice).
    (window as unknown as Record<string, unknown>).__pcfRowCommandsProbe = api;
}

const current = (): NonNullable<typeof latest> => {
    if (!latest) {
        throw new Error('The control has not rendered yet.');
    }

    return latest;
};

const api = {
    /** P1, P4, P5 at once. */
    all(): Record<string, unknown> {
        const { context, dataset, container } = current();
        const table = dataset.getTargetEntityType();

        const answers = {
            table,
            P1_privileges: privileges(context, table),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            P4_viewId: ask(() => (dataset as any).getViewId?.()),
            P4_contextInfo: ask(() => (context.mode as unknown as { contextInfo?: unknown }).contextInfo),
            P4_storage: storage(),
            P5_columns: columns(dataset, container),
            allocatedWidth: context.mode.allocatedWidth,
        };

        console.log(JSON.stringify(answers, null, 2));

        return answers;
    },

    /** P3: select the first `n` rows on the page through the platform. */
    select(n = 3): string[] {
        const { dataset } = current();
        const ids = (dataset.sortedRecordIds ?? []).slice(0, n);

        dataset.setSelectedRecordIds(ids);

        return ids;
    },

    /** P3: what the platform's selection is right now. */
    selection(): unknown {
        return ask(() => current().dataset.getSelectedRecordIds());
    },

    /** P3: every updateView since load — look for the pass after a ribbon action. */
    passes(): Pass[] {
        console.table(passes);

        return passes;
    },

    /** P6: the pointer events a header received, and whether capture took. */
    drag(): string[] {
        console.log(pointer.join('\n'));

        return pointer.splice(0);
    },

    /** P7: press **Cancel**. Resolves with what the dialog answered. */
    confirm(): Promise<unknown> {
        const navigation = current().context.navigation;

        return navigation
            .openConfirmDialog({ title: 'Probe P7', text: 'Press Cancel.', confirmButtonLabel: 'OK', cancelButtonLabel: 'Cancel' })
            .then(
                (answer) => ({ settled: 'resolved', answer }),
                (error) => ({ settled: 'rejected', error }),
            );
    },

    /** P7: open the first row; edit, save and close it. Logs when the promise settles. */
    openFirst(): Promise<unknown> {
        const { context, dataset } = current();
        const id = (dataset.sortedRecordIds ?? [])[0];
        const opened = new Date().toISOString();

        return context.navigation
            .openForm({ entityName: dataset.getTargetEntityType(), entityId: id })
            .then((answer) => {
                const result = { opened, settled: new Date().toISOString(), answer };

                console.log('P7 openForm settled', result);

                return result;
            });
    },
};
