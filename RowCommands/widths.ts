/**
 * Column widths: what the maker set, what the user dragged, and how the two
 * are laid out in the width the host gave.
 *
 * A decision module — nothing here touches the DOM or the platform, so
 * `dev/smoke.js` loads it directly through `dev/modules.js` and asserts the
 * arithmetic rather than a rendering of it.
 *
 * **`visualSizeFactor` is pixels.** Measured on a subgrid 2026-09-25 (SPEC.md
 * P5): at an allocated width narrower than the columns, every column drew at
 * exactly its factor — 117, 130, 122, 119, widths somebody had dragged in the
 * view designer. On a main grid wider than the columns, 0.1.x drew every
 * column ×2.23, because the table was `width: 100%` and the browser shared the
 * surplus out. A width the user drags has to draw at the number dragged to, so
 * the stretch is computed here instead, explicitly: every column keeps the
 * width it had before anything was dragged, and what a drag frees goes to the
 * command column (see `layout`).
 */

/** The narrowest a column is drawn or dragged to. A header needs its label and a resizer. */
export const MIN_WIDTH = 64;

/** The widest a column can be dragged. A column wider than a laptop screen is a mistake with no way back but Reset. */
export const MAX_WIDTH = 800;

/** One arrow key's worth, and one Shift+arrow's. */
export const STEP = 16;
export const STEP_LARGE = 64;

/** What a column is given when the host reports no width for it — canvas reports 0 for every one. */
export const FALLBACK_WIDTH = 140;

/** Dragged widths by column name. A column absent from the map has none. */
export type Overrides = Record<string, number>;

export interface ColumnLike {
    name: string;
    visualSizeFactor: number;
}

export interface Layout {
    /** One per data column, in the order given. */
    columns: number[];
    /** The command column, which takes the surplus when every data column has been resized. */
    commands: number;
    /** The table's own width: the sum of the above plus the fixed columns. */
    table: number;
}

export function clampWidth(width: number): number {
    if (!Number.isFinite(width)) {
        return MIN_WIDTH;
    }

    return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width)));
}

/**
 * The maker's widths — 0.1.x's rule, unchanged.
 *
 * Canvas reports 0 for every column, and a table of zero-width columns is not
 * a degraded layout but an invisible one, so the factors are used only when at
 * least one is real.
 */
export function baseWidths(columns: ColumnLike[]): number[] {
    const factors = columns.map((column) => (column.visualSizeFactor > 0 ? column.visualSizeFactor : 0));
    const measured = factors.some((factor) => factor > 0);

    return factors.map((factor) => (measured ? Math.max(factor, MIN_WIDTH) : FALLBACK_WIDTH));
}

/**
 * What every column draws at before anybody drags one: its base width, plus a
 * share of any surplus in proportion to it — 0.1.x's stretch, so a control
 * nobody has resized draws as it always did.
 *
 * Floor each share and give the remainder to the last column, so the widths
 * add up to `available` exactly — a pixel short and the table does not reach
 * the edge, a pixel over and a horizontal scrollbar appears for nothing.
 */
function stretched(base: number[], commandsWidth: number, fixed: number, available: number): number[] {
    const total = base.reduce((sum, width) => sum + width, 0);
    const surplus = available > 0 ? available - total - commandsWidth - fixed : 0;

    if (surplus <= 0 || total === 0) {
        return base.slice();
    }

    let given = 0;

    const scaled = base.map((width) => {
        const share = Math.floor((surplus * width) / total);

        given += share;

        return width + share;
    });

    scaled[scaled.length - 1] += surplus - given;

    return scaled;
}

/**
 * Every column's drawn width, in the width available.
 *
 *   - A column nobody resized draws at its stretched width — what it drew
 *     before anything was dragged — **and keeps it while others are dragged**.
 *   - A resized column draws at exactly its override.
 *   - Whatever that leaves goes to the command column, whose buttons are
 *     right-aligned: the blank lands between the data and the commands, not
 *     inside a column somebody sized on purpose.
 *   - Nothing ever shrinks below its width to fit. A table wider than the host
 *     scrolls, as it did.
 *
 * **Why the slack is not shared out among the free columns, as 0.2.x did.**
 * Sharing it moves the columns *before* the one being dragged: narrow the
 * third column and the first two widen, which pushes the third's own left edge
 * right, so its handle slides away from the pointer — by about half the drag
 * for a column between two free ones. The command column is after every data
 * column, so giving it the slack moves nothing a drag can see.
 * `pcf-data-table` 0.7.0 made the same choice with its last column.
 *
 * `available <= 0` is a host that reported no width (`allocatedWidth` is -1
 * until asked, 0 before layout): nothing to stretch or fill, every column at
 * its width.
 *
 * `fixed` is the width of the columns that are neither data nor commands —
 * the selection column — and is never stretched.
 */
export function layout(
    base: number[],
    overrides: Array<number | undefined>,
    commandsWidth: number,
    fixed: number,
    available: number,
): Layout {
    const unresized = stretched(base, commandsWidth, fixed, available);

    const columns = unresized.map((width, index) => {
        const override = overrides[index];

        return override === undefined ? width : clampWidth(override);
    });

    const used = columns.reduce((sum, width) => sum + width, 0) + commandsWidth + fixed;
    const slack = available > 0 ? available - used : 0;

    if (slack <= 0) {
        return { columns, commands: commandsWidth, table: used };
    }

    return { columns, commands: commandsWidth + slack, table: available };
}

/** One arrow key on a resizer. Right widens in a left-to-right layout; the RTL caller flips `direction`. */
export function nudge(width: number, direction: 1 | -1, large: boolean): number {
    return clampWidth(width + direction * (large ? STEP_LARGE : STEP));
}

/**
 * Where a view's widths live.
 *
 * By table **and** view, because a column's width is a decision about one
 * view: the name column of *Active Accounts* and of *My Accounts* are sized
 * for different company. `getViewId()` was measured present and stable on a
 * subgrid and a main grid (P4). A host without one — canvas has no saved view
 * — keys by the column set instead, which is the next best description of
 * "this view".
 */
export function storageKey(table: string, viewId: string | null | undefined, columns: ColumnLike[]): string {
    const view = viewId && viewId !== '' ? viewId.toLowerCase() : `cols:${columns.map((column) => column.name).join(',')}`;

    return `pcfhub.rowcommands.widths:${table}:${view}`;
}

/** Whatever `localStorage` answers — which may be a throw on the access itself. */
export interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

/**
 * The overrides stored for this view, kept only for columns it still has.
 *
 * **Every step can fail and none of them is an error the user should see.**
 * Reading `localStorage` throws when site data is blocked (the access, not a
 * method), the value may be somebody else's JSON or none, and a column the
 * maker has since removed from the view leaves a width behind. Each of those
 * is "no overrides" — the maker's widths — which is exactly what 0.1.x drew.
 */
export function readOverrides(
    storage: () => StorageLike | undefined,
    key: string,
    columns: ColumnLike[],
): Overrides {
    let raw: string | null = null;

    try {
        raw = storage()?.getItem(key) ?? null;
    } catch {
        return {};
    }

    if (raw === null) {
        return {};
    }

    let parsed: unknown;

    try {
        parsed = JSON.parse(raw);
    } catch {
        return {};
    }

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {};
    }

    const names = new Set(columns.map((column) => column.name));
    const kept: Overrides = {};

    for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (names.has(name) && typeof value === 'number' && Number.isFinite(value)) {
            kept[name] = clampWidth(value);
        }
    }

    return kept;
}

/**
 * Store the overrides, or remove the key when there are none. `false` when
 * the store refused — a full quota, blocked site data — so the caller can keep
 * the widths for this session and say nothing: the drag still worked.
 */
export function writeOverrides(storage: () => StorageLike | undefined, key: string, overrides: Overrides): boolean {
    try {
        const store = storage();

        if (!store) {
            return false;
        }

        if (Object.keys(overrides).length === 0) {
            store.removeItem(key);
        } else {
            store.setItem(key, JSON.stringify(overrides));
        }

        return true;
    } catch {
        return false;
    }
}
