/**
 * Activate and Deactivate — a decision module: what a table's Status options
 * are, which state a row is in, and what one update sends to move it.
 *
 * Measured on `account` from this control, 2026-10-08 (SPEC.md P4, P5):
 *
 *   - `getEntityMetadata(table, ['statecode'])` hands each Status option over
 *     with its **`DefaultStatus`** — 0 → 1, 1 → 2 on account — on
 *     `Attributes.get('statecode').attributeDescriptor.OptionSet`.
 *   - **`{ statecode, statuscode }` in one `updateRecord` moves a row**; a
 *     reason sent alone into the other state is **refused**, `2147779592`
 *     (the same as Kanban measured on `cll_task`). So the reason always goes
 *     with the state, and it is the state's own default.
 *   - **`getValue('statecode')` is the string `"0"`**, as every choice is.
 *
 * And one rule that is a judgement rather than a measurement: **only a table
 * whose Status is exactly Active (0) and Inactive (1) gets the commands.** A
 * case has Active, Resolved and Cancelled; "Deactivate" there would be a
 * guess at which, and resolving a case is not an update anyway.
 */

export interface StateOption {
    value: number;
    defaultStatus: number | null;
}

/**
 * The Status options out of a `getEntityMetadata` answer, or `null` when it
 * carries none. Reads the descriptor's array, the shape measured; a node with
 * none is a column the metadata says nothing about.
 */
export function stateOptionsFrom(metadata: unknown): StateOption[] | null {
    const attributes = (metadata as { Attributes?: { get?: (name: string) => unknown } } | null)?.Attributes;
    const node = typeof attributes?.get === 'function' ? attributes.get('statecode') : undefined;
    const options = (node as { attributeDescriptor?: { OptionSet?: unknown } } | undefined)?.attributeDescriptor?.OptionSet;

    if (!Array.isArray(options) || options.length === 0) {
        return null;
    }

    const read: StateOption[] = [];

    for (const option of options) {
        const value = (option as { Value?: unknown }).Value;
        const fallback = (option as { DefaultStatus?: unknown }).DefaultStatus;

        if (typeof value !== 'number') {
            return null;
        }

        read.push({ value, defaultStatus: typeof fallback === 'number' ? fallback : null });
    }

    return read;
}

/** Whether a table's Status is the plain pair this control offers commands for. */
export function isActiveInactive(options: StateOption[] | null): boolean {
    if (!options || options.length !== 2) {
        return false;
    }

    const values = options.map((option) => option.value).sort();

    return values[0] === 0 && values[1] === 1;
}

/** A row's state as a number, from whatever `getValue` handed over, or `null`. */
export function readState(raw: unknown): number | null {
    if (typeof raw === 'number' && Number.isInteger(raw)) {
        return raw;
    }

    if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) {
        return Number(raw.trim());
    }

    return null;
}

/** The state a row's command moves it to: Deactivate on an active row, Activate on an inactive one. */
export function targetState(current: number | null): 0 | 1 | null {
    if (current === 0) {
        return 1;
    }

    if (current === 1) {
        return 0;
    }

    return null;
}

/**
 * The one update that moves a row to `target`: the state, and that state's
 * default reason beside it. Without a known default the state goes alone,
 * and the server picks the default — never a bare reason, which it refuses.
 */
export function statePayload(target: 0 | 1, options: StateOption[] | null): Record<string, number> {
    const option = (options ?? []).find((candidate) => candidate.value === target);

    return option && option.defaultStatus !== null
        ? { statecode: target, statuscode: option.defaultStatus }
        : { statecode: target };
}
