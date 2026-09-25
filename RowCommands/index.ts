import { IInputs, IOutputs } from './generated/ManifestTypes';
import { BulkItem, BulkResult, runSequential } from './bulk';
import { canDeleteByRole } from './privileges';
import { pageState, prune, sameSet, toggle, togglePage } from './selection';
import {
    Layout,
    MAX_WIDTH,
    MIN_WIDTH,
    Overrides,
    StorageLike,
    baseWidths,
    clampWidth,
    layout,
    nudge,
    readOverrides,
    storageKey,
    writeOverrides,
} from './widths';

type DataSet = ComponentFramework.PropertyTypes.DataSet;
type Column = ComponentFramework.PropertyHelper.DataSetApi.Column;
type SortDirection = ComponentFramework.PropertyHelper.DataSetApi.Types.SortDirection;

/** `SortDirection` is a numeric union, not an enum object — there is nothing to import. */
const ASCENDING = 0 as SortDirection;
const DESCENDING = 1 as SortDirection;

/** The platform's ceiling on a page. Not in the type definitions. */
const MAX_PAGE_SIZE = 250;

/**
 * Below this many pixels of container, the commands lose their labels.
 *
 * A judgement rather than a breakpoint anybody standardised, tuned against the
 * dev harness at a phone width: a five-column view plus three labelled commands
 * needs about this much before the data columns start being squeezed into
 * nothing. It is the *control's* width and not the viewport's, which is the
 * only measurement that means anything here — the same control is full-width on
 * a phone and 380px wide in a form section on a desktop.
 */
const COMPACT_BELOW = 560;

/** How long a success or information message stays on screen. */
const STATUS_TIMEOUT_MS = 6000;

/**
 * The command column's width, in pixels, wide and compact.
 *
 * Held here rather than in the stylesheet because the table's minimum width is
 * computed from it — the columns' own widths plus this — and two copies of the
 * number in two languages is the kind of thing that drifts silently the first
 * time somebody adjusts the padding.
 *
 * Compact is three 32px buttons, two 4px gaps and the cell's padding, stated as
 * one number rather than left to the content so the right-hand edge does not
 * move between a row with one command and a row with three.
 */
const COMMANDS_WIDTH = 308;
const COMMANDS_WIDTH_COMPACT = 152;

/** The selection column: a 20px checkbox and the cell's padding. Never stretched. */
const SELECT_WIDTH = 44;

/** The commands, as they appear on `invokedCommand`. */
type CommandName = 'open' | 'url' | 'delete' | 'deleteSelected';

/**
 * `localStorage`, read through a function because **the access itself can
 * throw** — a `SecurityError` where site data is blocked — and a getter
 * evaluated inside `widths.ts`'s try is the only place that throw is caught.
 */
const browserStorage = (): StorageLike | undefined =>
    typeof globalThis.localStorage === 'undefined' ? undefined : globalThis.localStorage;

/**
 * A view with a command column: open the record, launch a link, delete it.
 *
 * Three ordinary buttons, and every one of them reaches a platform API no
 * control in this catalogue had called before. That is the reason it exists:
 * `openForm`, `openUrl`, the three navigation dialogs and `webAPI.deleteRecord`
 * were the last unexercised corner of the reference.
 *
 * **Each of those is present on a different set of hosts, and presence is per
 * method rather than per bag.** `context.navigation` is typed non-optional and
 * is not guaranteed; inside it, `openForm` and `openUrl` are everywhere, while
 * the dialogs are a model-driven affordance. `context.webAPI` is Dataverse and
 * absent in canvas outright. So the shape of this file is: decide what the host
 * can actually do, render only those buttons, and never show one that will
 * fail. A hidden command is honest; a command that throws is not.
 *
 * The consequences worth knowing before editing:
 *
 *   - **A confirm that is cancelled resolves.** `openConfirmDialog` comes back
 *     `{ confirmed: false }` through the *success* path. Reading the promise
 *     without reading `confirmed` deletes a record the user just declined to
 *     delete, and treating the cancel as a failure shows an error for something
 *     they did on purpose.
 *   - **The URL is data, so it is not trusted.** It comes off a bound column
 *     that anybody with write access can set, and `openUrl` will hand whatever
 *     it is given to the host. `safeUrl` is the boundary and the Launch button
 *     does not render without it.
 *   - **`openForm` is preferred over `openDatasetItem` for one reason**: it
 *     returns a promise, and the dataset's own route has no completion signal
 *     at all. Measured 2026-09-25 (SPEC.md P7), that promise settles on
 *     *navigation*, not on close — the form opens in place and the control is
 *     torn down — so the refresh after it rarely runs, and `disposed` is what
 *     keeps it from running against a control that is gone.
 *   - `updateView` runs on every change to any bound value, including the ones
 *     this control caused. Every mutator below is either guarded or in an event
 *     handler, and a delete ends in `refresh()` — which is a mutator in a
 *     handler, not in `updateView`, and that is why it is safe.
 *   - This control rebuilds its DOM on every render, so anything focused ceases
 *     to exist. `restoreFocus` pays for that on the pager, and a `data-focus`
 *     key on every other focusable element pays for it everywhere else; the
 *     live region is built once in `init` and lives *outside* the rebuilt
 *     surface, because an announcement destroyed in the same tick is an
 *     announcement nobody hears.
 *   - **Except during a column drag.** A render mid-drag would destroy the
 *     handle holding the pointer capture, so an `updateView` that arrives then
 *     is owed rather than performed, and paid on release.
 */
export class RowCommands implements ComponentFramework.StandardControl<IInputs, IOutputs> {
    private container!: HTMLDivElement;
    private surface!: HTMLDivElement;
    private status!: HTMLParagraphElement;
    private notifyOutputChanged!: () => void;

    private invokedRecordId = '';
    private invokedCommand = '';
    private invokeCount = 0;

    /**
     * The record a delete is in flight for, or `''`.
     *
     * Single-flight rather than a queue. Two confirms open at once is not a
     * state the platform can produce — the dialog is modal — but the rig can,
     * and so can a double press on a slow host before the dialog paints.
     */
    private pending = '';

    /**
     * Set by `destroy`, read by everything that resumes after an `await`.
     *
     * A dialog outlives the control that opened it: a form tab switch or a
     * canvas screen change tears the control down while somebody is still
     * looking at a confirmation, and the `.then` afterwards would otherwise
     * write to a detached DOM and delete a record on behalf of a control that
     * no longer exists.
     */
    private disposed = false;

    /**
     * The page size this control has already asked the platform for.
     *
     * Guarding on this rather than on `ds.paging.pageSize` is the whole trick:
     * the platform's own value will not equal the requested one until the
     * refresh lands, so comparing against it re-fires at least once more — and
     * if the platform clamps the request, it never converges at all.
     */
    private appliedPageSize = 0;

    private page = 1;

    /** Which chrome button to put focus back on after the next render. */
    private restoreFocus: 'previous' | 'next' | null = null;

    /** Whether the container is too narrow to carry the command labels. */
    private compact = false;

    /** Clears a success or information message; errors are left up. */
    private statusTimer: number | undefined;

    /**
     * The selected ids — the control's own copy, and the one that decides.
     * Kept to the page on screen; see `selection.ts` for why.
     */
    private selected: string[] = [];

    /**
     * A bulk delete in flight, or `null`. `stop` is the Stop button's only
     * effect: the record in flight finishes, and the next is not started.
     */
    private bulk: { done: number; total: number; stop: boolean } | null = null;

    /** The progress line, updated in place so the Stop button keeps focus. */
    private progressText: HTMLElement | null = null;

    /** `canDeleteByRole` per table. Roles do not change inside a session. */
    private readonly roles = new Map<string, boolean | null>();

    /**
     * The widths the user dragged, for the view in `widthKey`, and the key
     * itself — read from storage once per view rather than once per render.
     */
    private overrides: Overrides = {};
    private widthKey = '';

    /**
     * What the last render laid out, and with what: enough to lay the same
     * table out again during a drag without rebuilding it.
     */
    private drawn: {
        names: string[];
        base: number[];
        commands: number;
        fixed: number;
        available: number;
        result: Layout;
        headers: HTMLElement[];
        resizers: HTMLElement[];
        commandsHeader: HTMLElement;
        table: HTMLElement;
    } | null = null;

    /** A column drag in progress. */
    private resizing: { index: number; startX: number; startWidth: number; moved: boolean } | null = null;

    /** An `updateView` that arrived mid-drag, paid on release. */
    private renderOwed = false;

    /** The context and dataset of the latest pass — the dataset is a new object every pass. */
    private latest: { context: ComponentFramework.Context<IInputs>; dataset: DataSet } | null = null;

    public init(
        context: ComponentFramework.Context<IInputs>,
        notifyOutputChanged: () => void,
        _state: ComponentFramework.Dictionary,
        container: HTMLDivElement,
    ): void {
        this.notifyOutputChanged = notifyOutputChanged;
        this.container = container;
        this.container.classList.add('RowCommands');

        /*
         * Ask for a width, because without this the platform supplies none.
         *
         * `allocatedWidth` is **-1 until a control calls this**, and two things
         * here need a real number. The commands drop their labels below
         * `COMPACT_BELOW`, and the table can only scroll inside a container
         * that has a definite width — a host that lays the control out
         * shrink-to-fit (`inline-block`, `fit-content`, a `table` cell) takes
         * its width *from* the content, so `overflow-x: auto` has nothing to
         * scroll inside and the columns are crushed instead. `width: 100%` on
         * the control resolves against a number the control itself produced,
         * which is a circle; the allocated width is the number from outside it.
         *
         * Feature-detected because it is typed as always present, which is a
         * claim about the type definitions rather than about the host.
         */
        if (typeof context.mode.trackContainerResize === 'function') {
            context.mode.trackContainerResize(true);
        }

        /*
         * Built once, and outside the part `render` clears.
         *
         * Everything a command does happens somewhere other than in this
         * control — a form opens, a tab opens, a row disappears — so the only
         * thing a screen-reader user has to go on is what is said here. A live
         * region rebuilt by the render that a delete triggers is a region the
         * assistive technology has never seen before, and a brand-new region
         * with text in it does not announce.
         */
        this.status = document.createElement('p');
        this.status.className = 'RowCommands-status';
        this.status.setAttribute('role', 'status');
        this.status.setAttribute('aria-live', 'polite');

        this.surface = document.createElement('div');
        this.surface.className = 'RowCommands-surface';

        this.container.append(this.status, this.surface);
    }

    public updateView(context: ComponentFramework.Context<IInputs>): void {
        const dataset = context.parameters.records;

        this.latest = { context, dataset };

        this.applyTheme(context);
        this.applyWidth(context);
        this.applyHeight(context);
        this.applyPageSize(context, dataset);

        if (this.resizing) {
            this.renderOwed = true;
            return;
        }

        this.render(context, dataset);
    }

    /**
     * Two things follow from the width the host allocated, and neither can be
     * done in CSS alone.
     *
     * **A pixel ceiling on the root**, so the table has something definite to
     * scroll inside. See the note in `init`.
     *
     * **Compact commands**, below `COMPACT_BELOW`. A container query would be
     * the tidier mechanism and it is the wrong one twice over: it reads the
     * element's own box, which on a shrink-to-fit host is the circle again, and
     * nothing in `dev/dom.js` computes layout, so a CSS-only rule is a
     * behaviour no assertion in this repository could reach. This one is driven
     * by a number the platform hands over, so `dev/smoke.js` can set it.
     *
     * `-1` and `0` are both "no answer" — the first before the control asks,
     * the second before the host has laid it out — and both mean *leave the
     * labels alone*. Guessing compact from a missing measurement would strip
     * the labels off every control on a host that reports nothing.
     */
    private applyWidth(context: ComponentFramework.Context<IInputs>): void {
        const allocated = context.mode.allocatedWidth;
        const known = typeof allocated === 'number' && allocated > 0;

        this.container.style.maxWidth = known ? `${allocated}px` : '';
        this.compact = known && allocated < COMPACT_BELOW;
        this.container.classList.toggle('RowCommands--compact', this.compact);
    }

    /**
     * Fit inside the height the host allocated, rather than running off it.
     *
     * **A main grid is the case that shows why.** The host hands the control the
     * full height of the grid area and expects it to live inside; a table of
     * twenty-five rows is taller than that, so the rows ran past the bottom of
     * the page and the pager — the only way to reach page two — went with them.
     * Nothing was hidden by CSS. The control had simply never been told how tall
     * it was allowed to be, and never asked.
     *
     * With a real height the rows scroll and the pager stays. Without one the
     * control grows to its content exactly as before, which is right for a form
     * section that sizes itself around what it holds.
     *
     * `-1` and `0` are both "no answer" — the same rule as the width, and the
     * one `pcf-sparkline` wrote down for the height half.
     */
    private applyHeight(context: ComponentFramework.Context<IInputs>): void {
        const allocated = context.mode.allocatedHeight;
        const known = typeof allocated === 'number' && allocated > 0;

        /*
         * A pixel height where the host measured one, and nothing where it did
         * not — the stylesheet's `height: 100%` covers that case, and covers it
         * better, because a main grid reports `-1` here by design and would
         * otherwise get no height at all.
         *
         * There is no class to go with this any more. Gating the scroll layout
         * on a measurement was the bug: the rules now apply always, and this
         * only decides whether the height is a number or inherited.
         */
        this.container.style.height = known ? `${allocated}px` : '';
    }

    /**
     * Picks which set of colour fallbacks the stylesheet uses.
     *
     * Only the fallbacks. The stylesheet reads Fluent's design tokens through
     * `var()`, and a model-driven form already mounts a `FluentProvider` above
     * every code component on the page — so where the host publishes them this
     * changes nothing at all. It matters on the hosts that publish nothing: a
     * canvas app, or PCFHub's demo harness.
     *
     * `@media (prefers-color-scheme: dark)` is the obvious hook and it is the
     * wrong question: a model-driven app carries its own theme and the user's OS
     * setting says nothing about it. Absent means absent.
     */
    private applyTheme(context: ComponentFramework.Context<IInputs>): void {
        const isDarkTheme = context.fluentDesignLanguage?.isDarkTheme;

        if (isDarkTheme === undefined) {
            return;
        }

        this.container.classList.toggle('RowCommands--dark', isDarkTheme);
    }

    /**
     * `undefined` means "no change" to the platform, so every field is
     * initialised to a real value and emitted directly. `?? undefined` here
     * would make a cleared value unobservable.
     */
    public getOutputs(): IOutputs {
        return {
            invokedRecordId: this.invokedRecordId,
            invokedCommand: this.invokedCommand,
            invokeCount: this.invokeCount,
        };
    }

    public destroy(): void {
        // Before the DOM, because the flag is what stops an in-flight dialog
        // writing to what is about to be cleared.
        this.disposed = true;
        this.pending = '';
        this.clearStatusTimer();

        // A bulk delete stops at the next record — `shouldStop` reads
        // `disposed` — and a drag's listeners live on its handle, below.
        this.resizing = null;
        this.drawn = null;
        this.latest = null;

        // Listeners are attached to elements inside `container`, which the
        // platform removes — but the container itself is reused, so clear it.
        this.container.innerHTML = '';
    }

    /**
     * Ask for a new page size, but only when it actually changed.
     *
     * If you add a **second** guarded mutator to `updateView`, make it skip its
     * own first run: on the very first `updateView` every "applied" field still
     * holds its initial value, so every guard fires at once and each one
     * refreshes.
     */
    private applyPageSize(context: ComponentFramework.Context<IInputs>, dataset: DataSet): void {
        const raw = context.parameters.pageSize.raw;

        /*
         * **The platform already has a page size, and it is usually the right
         * one.** `paging.pageSize` is the size the host is actually retrieving
         * with — on a main grid that is the user's own *Rows per page*
         * personalisation, on a subgrid it is what the maker set in the form
         * designer, and in canvas it is the platform default.
         *
         * The first version of this control ignored all of that: the property
         * carried `default-value="25"`, so a maker who never touched it still
         * got a control that called `setPageSize(25)` on every host and
         * overrode a setting the user had deliberately changed. That is the
         * wrong default for an input nobody asked for.
         *
         * So the property is genuinely optional now. Unset, the control adopts
         * whatever the platform is already doing and **never calls
         * `setPageSize` at all**; set, it overrides. Adopting still has to
         * record the number, because `currentPage()` and `pagerLabel()` both
         * need to know how big a page is — reading it is not the same as
         * asking for it.
         */
        if (raw === null || raw === undefined) {
            /*
             * `0` means "the host did not say", not "one row per page".
             *
             * The first version of this fell back to `1`, which is a page size
             * the platform never has and which `currentPage()` would have
             * sliced the view down to — twenty rows arriving and one drawn. A
             * host that reports no page size is a host whose paging this
             * control cannot second-guess, so it draws what it was given.
             */
            this.appliedPageSize = dataset.paging.pageSize > 0 ? dataset.paging.pageSize : 0;

            return;
        }

        const wanted = Math.min(Math.max(Math.trunc(raw), 1), MAX_PAGE_SIZE);

        if (wanted === this.appliedPageSize) {
            return;
        }

        const previous = this.appliedPageSize;

        this.appliedPageSize = wanted;
        dataset.paging.setPageSize(wanted);

        /*
         * **Repaginating makes "page 4" mean something else**, so the reader
         * goes back to the first page — the same move `sortBy` makes, and for
         * the same reason. Any change to the shape of the result set — a sort,
         * a filter, a page size — resets the page.
         *
         * **Only when it changed, though.** `previous` is 0 until a size has
         * been applied, and at mount the platform is already on page one, so
         * resetting there is a round trip bought for nothing: `reset()` is a
         * fetch in its own right and the `refresh()` below is a second one.
         *
         * Left out entirely at first, and close to unfalsifiable while the size
         * comes only from a manifest property: a property changes once, at
         * configuration time, almost always while the reader is on page one.
         * `pcf-data-table` 0.2.0 made it reachable with a rows-per-page picker,
         * and asked for page 3 of a result set that had just been recut.
         */
        if (previous > 0) {
            this.page = 1;
            this.clearSelection(dataset);
            dataset.paging.reset();
        }

        dataset.refresh();
    }

    private render(context: ComponentFramework.Context<IInputs>, dataset: DataSet): void {
        const getString = (id: string): string => context.resources.getString(id);

        this.surface.innerHTML = '';

        /*
         * Canvas relies on this; a model-driven form hides the section itself.
         *
         * The live region has to go with it, and that is not obvious from where
         * it is built: it lives *outside* the surface — deliberately, so that a
         * render cannot destroy an announcement mid-sentence — which means
         * clearing the surface leaves it behind. A hidden control was still
         * showing the last thing it had to say, floating above whatever the
         * form put there instead.
         */
        if (!context.mode.isVisible) {
            this.clearStatusTimer();
            this.status.textContent = '';

            return;
        }

        if (dataset.error) {
            this.message(dataset.errorMessage || getString('RowCommands_Error'));
            return;
        }

        // `isHidden` and `order` are the maker's decisions in the view
        // designer. A table that ignores either looks broken to whoever set
        // them.
        const columns = (dataset.columns ?? [])
            .filter((column) => !column.isHidden)
            .sort((a, b) => a.order - b.order);

        if (columns.length === 0) {
            this.message(
                dataset.loading ? getString('RowCommands_Loading') : getString('RowCommands_NoColumns'),
            );
            return;
        }

        // `loading` is true on the first updateView, before any records arrive,
        // so rendering the empty state here flashes "No records" on every load.
        const all = dataset.sortedRecordIds ?? [];

        if (all.length === 0) {
            this.message(dataset.loading ? getString('RowCommands_Loading') : getString('RowCommands_Empty'));
            return;
        }

        const ids = this.currentPage(all);
        const selectable = asBoolean(context.parameters.showSelection?.raw, false);

        /*
         * The selection is kept to the rows on screen, and handed back to the
         * platform only when that changed it — `setSelectedRecordIds` is the
         * command bar's contract (P3), and a render that re-sent an unchanged
         * selection on every pass would be a mutator in `updateView` for
         * nothing. A ribbon Delete is how rows leave without this control
         * hearing of it; the intersection is how it catches up.
         */
        const kept = selectable ? prune(this.selected, ids) : [];

        if (!sameSet(kept, this.selected)) {
            this.selected = kept;
            this.commitSelection(dataset);
        }

        // Whatever had focus is about to be destroyed; remember which one it was.
        const focused = (document.activeElement as HTMLElement | null)?.dataset?.focus;

        if (selectable && (this.selected.length > 0 || this.bulk)) {
            this.surface.appendChild(this.bulkBar(context, dataset, columns, getString));
        }

        this.surface.appendChild(this.table(context, dataset, columns, ids, selectable, getString));
        this.surface.appendChild(this.pager(context, dataset, ids.length, getString));
        this.fitToScroll();

        if (focused) {
            // `Array.from`: a browser's NodeList has no `find`, and dev/dom.js
            // returns an array that does — the difference would pass here.
            const again = Array.from(this.surface.querySelectorAll<HTMLElement>('.RowCommands-focusable'))
                .find((element) => element.dataset.focus === focused);

            again?.focus();
        }

        // The button that caused this render no longer exists. Put focus on its
        // replacement, or fall back to the other one when this page turn was
        // the last: a disabled button cannot take focus.
        if (this.restoreFocus) {
            const wanted = this.restoreFocus;
            this.restoreFocus = null;

            const button = this.surface.querySelector<HTMLButtonElement>(`.RowCommands-${wanted}`);
            const other = this.surface.querySelector<HTMLButtonElement>(
                `.RowCommands-${wanted === 'next' ? 'previous' : 'next'}`,
            );

            (button?.disabled ? other : button)?.focus();
        }
    }

    /**
     * The records belonging to the page the pager says it is on.
     *
     * A repair for one specific platform behaviour, written to disappear the
     * moment that behaviour changes: `loadNextPage(true)` was observed on a
     * real model-driven form returning the whole page range rather than the new
     * page, so page 2 rendered under page 1. When the array is no longer than a
     * page it already is the page, and nothing is cut.
     */
    private currentPage(ids: string[]): string[] {
        // No page size means no basis for slicing: draw everything the platform
        // handed over, which is what it expects a control to do anyway.
        if (this.appliedPageSize <= 0 || ids.length <= this.appliedPageSize) {
            return ids;
        }

        const start = (this.page - 1) * this.appliedPageSize;
        const slice = ids.slice(start, start + this.appliedPageSize);

        // Never empty the table: showing the wrong page is recoverable by
        // clicking, showing nothing looks like data loss.
        return slice.length > 0 ? slice : ids.slice(-this.appliedPageSize);
    }

    private message(text: string): void {
        const p = document.createElement('p');
        p.className = 'RowCommands-message';
        p.textContent = text;
        this.surface.appendChild(p);
    }

    /**
     * The bound URL column, found by `alias` and read by `name`.
     *
     * Backwards, the find never matches, nothing errors, and no Launch button
     * appears against a real view — which is how that bug reached production in
     * `pcf-tag-list`. The demo fixture gives this column an `alias` that differs
     * from its `name` so the mistake fails where it can be seen.
     */
    private urlColumn(dataset: DataSet): Column | undefined {
        return (dataset.columns ?? []).find((column) => column.alias === 'urlField');
    }

    private table(
        context: ComponentFramework.Context<IInputs>,
        dataset: DataSet,
        columns: Column[],
        ids: string[],
        selectable: boolean,
        getString: (id: string) => string,
    ): HTMLElement {
        const table = document.createElement('table');
        table.className = 'RowCommands-table';

        const caption = document.createElement('caption');
        caption.className = 'RowCommands-caption';
        caption.textContent = dataset.getTitle();
        table.appendChild(caption);

        const head = table.createTHead().insertRow();
        const enabled = !context.mode.isControlDisabled;
        const resizable = !asBoolean(context.parameters.lockColumnWidths?.raw, false);

        /*
         * The maker's own column widths, from the view designer, and any the
         * user dragged since — see `widths.ts`, which owns the arithmetic.
         *
         * Read from storage once per view: the key is table + view, so a
         * different view, or the same one on another form, starts from its
         * own. **A locked control draws the maker's widths whatever was
         * stored**, so a maker who locks widths after users have dragged them
         * gets the view they designed, not a leftover.
         */
        const key = storageKey(dataset.getTargetEntityType(), viewIdOf(dataset), columns);

        if (key !== this.widthKey) {
            this.widthKey = key;
            this.overrides = readOverrides(browserStorage, key, columns);
        }

        const names = columns.map((column) => column.name);
        const commands = this.compact ? COMMANDS_WIDTH_COMPACT : COMMANDS_WIDTH;
        const fixed = selectable ? SELECT_WIDTH : 0;
        const allocated = context.mode.allocatedWidth;

        if (selectable) {
            head.appendChild(this.selectAllCell(dataset, ids, enabled, getString));
        }

        const headers: HTMLElement[] = [];
        const resizers: HTMLElement[] = [];

        for (const [index, column] of columns.entries()) {
            const th = document.createElement('th');
            th.scope = 'col';

            if (column.disableSorting) {
                th.textContent = column.displayName;
            } else {
                // `sorting` is typed as a required array, and `npm start`
                // supplies `undefined` for it — so this reads through a
                // fallback. Without it the control renders as an empty box and
                // the TypeError is swallowed.
                const status = (dataset.sorting ?? []).find((entry) => entry.name === column.name);
                th.setAttribute(
                    'aria-sort',
                    status ? (status.sortDirection === DESCENDING ? 'descending' : 'ascending') : 'none',
                );

                // A real <button>, so sorting is reachable by keyboard. A click
                // handler on the <th> is not.
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'RowCommands-sort RowCommands-focusable';
                button.dataset.focus = `sort:${column.name}`;
                button.textContent = column.displayName;
                button.title = getString('RowCommands_SortBy').replace('{0}', column.displayName);
                button.addEventListener('click', () => this.sortBy(dataset, column.name));
                th.appendChild(button);
            }

            if (resizable) {
                const handle = this.resizer(index, column, getString);

                th.classList.add('is-resizable');
                th.appendChild(handle);
                resizers.push(handle);
            }

            headers.push(th);
            head.appendChild(th);
        }

        const commandsHeader = document.createElement('th');
        commandsHeader.scope = 'col';
        commandsHeader.className = 'RowCommands-commandsHeader';
        commandsHeader.textContent = getString('RowCommands_Commands');
        head.appendChild(commandsHeader);

        this.drawn = {
            names,
            base: baseWidths(columns),
            commands,
            fixed,
            available: typeof allocated === 'number' && allocated > 0 ? allocated : 0,
            result: { columns: [], commands, table: 0 },
            headers,
            resizers,
            commandsHeader,
            table,
        };
        this.relayout();

        const body = table.createTBody();
        const primary = columns.find((column) => column.isPrimary) ?? columns[0];
        const urls = this.urlColumn(dataset);

        for (const id of ids) {
            const record = dataset.records[id];

            if (!record) {
                continue;
            }

            const row = body.insertRow();

            /*
             * A record whose primary column is empty is a real record, and
             * without this it renders as a blank row — indistinguishable from a
             * row that failed to render, and sitting next to a Delete button.
             *
             * Seen on a real form: a view sorted by name puts every unnamed
             * record at the top, so the first thing anybody saw was ten blank
             * rows and a working command column beside them. Nothing was wrong;
             * it just looked exactly like something was.
             *
             * **Only the primary column gets this.** An empty phone number is
             * an empty phone number and a placeholder in every blank cell would
             * be noise — it is the row's *identity* that has to be legible,
             * because that is what the commands act on and what the
             * confirmation dialog names.
             */
            const primaryValue = record.getFormattedValue(primary.name);
            const label = primaryValue !== '' ? primaryValue : getString('RowCommands_Untitled');

            if (selectable) {
                const on = this.selected.includes(id);

                row.className = on ? 'is-selected' : '';
                row.appendChild(this.selectCell(dataset, id, label, on, enabled, getString));
            }

            for (const column of columns) {
                const cell = row.insertCell();
                const value = record.getFormattedValue(column.name);

                if (value === '' && column.name === primary.name) {
                    cell.textContent = label;
                    cell.className = 'RowCommands-untitled';

                    continue;
                }

                // `getFormattedValue` takes the column's *name*, never its
                // alias.
                cell.textContent = value;
            }

            row.insertCell().appendChild(this.commands(context, dataset, id, label, urls, getString));
        }

        const scroll = document.createElement('div');
        scroll.className = dataset.loading ? 'RowCommands-scroll is-loading' : 'RowCommands-scroll';
        scroll.appendChild(table);

        return scroll;
    }

    /**
     * Lay the drawn table out again from `drawn` and `overrides`, touching
     * widths only — no rebuild, so a drag keeps its handle and a key press
     * keeps its focus.
     *
     * **The table's width is set, not only its minimum.** 0.1.x set
     * `min-width` and left `width: 100%` to stretch every column on a wide host
     * (×2.23 on a 2,490px main grid, P5), which a dragged width cannot survive:
     * the browser would share the surplus into it too. `layout()` shares it out
     * instead, to the columns nobody resized.
     */
    private relayout(): void {
        const drawn = this.drawn;

        if (!drawn) {
            return;
        }

        const overrides = drawn.resizers.length > 0 ? drawn.names.map((name) => this.overrides[name]) : [];
        const result = layout(drawn.base, overrides, drawn.commands, drawn.fixed, drawn.available);

        drawn.result = result;
        drawn.headers.forEach((th, index) => {
            th.style.width = `${result.columns[index]}px`;
        });
        drawn.resizers.forEach((handle, index) => {
            handle.setAttribute('aria-valuenow', String(result.columns[index]));
        });
        drawn.commandsHeader.style.width = `${result.commands}px`;
        drawn.table.style.width = `${result.table}px`;
        drawn.table.style.minWidth = `${result.table}px`;
    }

    /**
     * Narrow the width `layout()` fills to what the scroll box actually has.
     *
     * `allocatedWidth` is the host's number and can overstate the room — the
     * hub's demo counted its own padding into it, and a vertical scrollbar
     * takes its width out of the box without telling anyone. Filling the
     * allocated width exactly would then add a horizontal scrollbar for a few
     * pixels. So once the table is in the page, the box's own `clientWidth` is
     * the ceiling: draw at min(measured, allocated). `dev/dom.js` computes no
     * layout, so there this is a no-op and the allocated width stands.
     */
    private fitToScroll(): void {
        const drawn = this.drawn;
        const box = drawn?.table.parentElement;
        const measured = box && typeof box.clientWidth === 'number' ? box.clientWidth : 0;

        if (!drawn || measured <= 0) {
            return;
        }

        const available = drawn.available > 0 ? Math.min(drawn.available, measured) : measured;

        if (available !== drawn.available) {
            drawn.available = available;
            this.relayout();
        }
    }

    /**
     * The handle at a column's trailing edge.
     *
     * A `separator` with a value, because that is what a resizer is to
     * assistive technology: focusable, announced with its width, moved by the
     * arrow keys. The pointer route and the keyboard route write the same
     * override.
     *
     * **The handle alone takes the press.** Measured 2026-09-25 (P6): a press
     * on a header in a subgrid reaches the control, `setPointerCapture`
     * holds, and `pointerup` and `lostpointercapture` follow. The listeners
     * are on the handle and nowhere else, because `pcf-calendar-view` found
     * that a second `pointerup` listener on a parent commits the drag twice.
     */
    private resizer(index: number, column: Column, getString: (id: string) => string): HTMLElement {
        const handle = document.createElement('span');

        handle.className = 'RowCommands-resizer RowCommands-focusable';
        handle.dataset.focus = `resize:${column.name}`;
        handle.setAttribute('role', 'separator');
        handle.setAttribute('aria-orientation', 'vertical');
        handle.setAttribute('aria-label', getString('RowCommands_ResizeColumn').replace('{0}', column.displayName));
        handle.setAttribute('aria-valuemin', String(MIN_WIDTH));
        handle.setAttribute('aria-valuemax', String(MAX_WIDTH));
        handle.tabIndex = 0;

        const move = (event: PointerEvent): void => {
            const drag = this.resizing;

            if (!drag || drag.index !== index) {
                return;
            }

            const delta = (event.clientX - drag.startX) * (this.rtl() ? -1 : 1);
            const width = clampWidth(drag.startWidth + delta);

            if (width === drag.startWidth && !drag.moved) {
                return;
            }

            drag.moved = true;
            this.overrides = { ...this.overrides, [column.name]: width };
            this.relayout();
        };

        const end = (): void => {
            const drag = this.resizing;

            if (!drag || drag.index !== index) {
                return;
            }

            this.resizing = null;
            handle.classList.remove('is-dragging');
            handle.removeEventListener('pointermove', move as EventListener);
            handle.removeEventListener('pointerup', end);
            handle.removeEventListener('pointercancel', end);
            handle.removeEventListener('lostpointercapture', end);

            // A width changes only on a move, so a press that never moved has
            // nothing to store — and storage is not rewritten for nothing.
            if (drag.moved) {
                writeOverrides(browserStorage, this.widthKey, this.overrides);
            }

            this.payRenderOwed();
        };

        handle.addEventListener('pointerdown', (event: PointerEvent) => {
            if (event.button !== 0 || this.resizing || !this.drawn) {
                return;
            }

            // No text selection and no native drag for the length of it.
            event.preventDefault();

            this.resizing = {
                index,
                startX: event.clientX,
                startWidth: this.drawn.result.columns[index],
                moved: false,
            };

            try {
                handle.setPointerCapture(event.pointerId);
            } catch {
                // A host that refuses capture still gets the drag while the
                // pointer stays on the handle; the release still ends it.
            }

            handle.classList.add('is-dragging');
            handle.addEventListener('pointermove', move as EventListener);
            handle.addEventListener('pointerup', end);
            handle.addEventListener('pointercancel', end);
            handle.addEventListener('lostpointercapture', end);
        });

        handle.addEventListener('keydown', (event: KeyboardEvent) => {
            if (!this.drawn) {
                return;
            }

            if (event.key === 'Home') {
                event.preventDefault();
                this.resetColumn(column.name);

                return;
            }

            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
                return;
            }

            event.preventDefault();

            const wider = (event.key === 'ArrowRight') !== this.rtl();

            this.overrides = {
                ...this.overrides,
                [column.name]: nudge(this.drawn.result.columns[index], wider ? 1 : -1, event.shiftKey),
            };
            this.relayout();
            writeOverrides(browserStorage, this.widthKey, this.overrides);
        });

        // The maker's width back for this one column: a double-click, as in
        // every grid that has resizers, and Home from the keyboard.
        handle.addEventListener('dblclick', () => this.resetColumn(column.name));

        return handle;
    }

    private resetColumn(name: string): void {
        if (!(name in this.overrides)) {
            return;
        }

        const next = { ...this.overrides };

        delete next[name];
        this.overrides = next;
        this.relayout();
        writeOverrides(browserStorage, this.widthKey, this.overrides);
    }

    /** Every dragged width forgotten, for this view. */
    private resetWidths(): void {
        this.overrides = {};
        writeOverrides(browserStorage, this.widthKey, this.overrides);

        if (this.latest) {
            this.announce(this.latest.context.resources.getString('RowCommands_WidthsReset'));
            this.render(this.latest.context, this.latest.dataset);
        }
    }

    /** The render an `updateView` asked for while a drag held the table. */
    private payRenderOwed(): void {
        if (!this.renderOwed || this.disposed || !this.latest) {
            this.renderOwed = false;
            return;
        }

        this.renderOwed = false;
        this.render(this.latest.context, this.latest.dataset);
    }

    /**
     * Right-to-left flips which way is wider. Read from the computed style,
     * because the `dir` that decides it may be on any ancestor — the form's,
     * not this control's. A host with no `getComputedStyle` is left-to-right.
     */
    private rtl(): boolean {
        try {
            return getComputedStyle(this.container).direction === 'rtl';
        } catch {
            return false;
        }
    }

    /* ---------------------------------------------------------- selection */

    private selectAllCell(
        dataset: DataSet,
        ids: string[],
        enabled: boolean,
        getString: (id: string) => string,
    ): HTMLElement {
        const th = document.createElement('th');
        th.scope = 'col';
        th.className = 'RowCommands-selectCell';
        th.style.width = `${SELECT_WIDTH}px`;

        const box = document.createElement('input');
        const state = pageState(this.selected, ids);

        box.type = 'checkbox';
        box.className = 'RowCommands-select RowCommands-focusable';
        box.dataset.focus = 'select:page';
        box.setAttribute('aria-label', getString('RowCommands_SelectPage'));
        box.checked = state === 'all';
        box.indeterminate = state === 'some';
        box.disabled = !enabled || this.bulk !== null;
        box.addEventListener('change', () => {
            if (box.disabled) {
                return;
            }

            this.selected = togglePage(this.selected, ids);
            this.commitSelection(dataset);
            this.rerender();
        });

        th.appendChild(box);

        return th;
    }

    private selectCell(
        dataset: DataSet,
        id: string,
        label: string,
        on: boolean,
        enabled: boolean,
        getString: (id: string) => string,
    ): HTMLTableCellElement {
        const td = document.createElement('td');
        td.className = 'RowCommands-selectCell';

        const box = document.createElement('input');

        box.type = 'checkbox';
        box.className = 'RowCommands-select RowCommands-focusable';
        box.dataset.focus = `select:${id}`;
        box.setAttribute('aria-label', getString('RowCommands_SelectRow').replace('{0}', label));
        box.checked = on;
        box.disabled = !enabled || this.bulk !== null;
        box.addEventListener('change', () => {
            if (box.disabled) {
                return;
            }

            this.selected = toggle(this.selected, id);
            this.commitSelection(dataset);
            this.rerender();
        });

        td.appendChild(box);

        return td;
    }

    /**
     * Hand the selection to the platform. Not bookkeeping: on a subgrid it is
     * what the command bar acts on — measured, P3 — so it is called on every
     * change rather than once at the end.
     */
    private commitSelection(dataset: DataSet): void {
        if (typeof dataset.setSelectedRecordIds === 'function') {
            dataset.setSelectedRecordIds([...this.selected]);
        }
    }

    /** A page turn, a sort, a new page size: the rows on screen are other rows. */
    private clearSelection(dataset: DataSet): void {
        if (this.selected.length === 0) {
            return;
        }

        this.selected = [];
        this.commitSelection(dataset);
    }

    private rerender(): void {
        if (this.latest && !this.disposed) {
            this.render(this.latest.context, this.latest.dataset);
        }
    }

    /**
     * The bar over the table while anything is selected: the count, Delete
     * selected where the row's Delete would be offered, and Clear. During a
     * bulk delete it is the progress line and Stop instead — the one control a
     * user needs then.
     */
    private bulkBar(
        context: ComponentFramework.Context<IInputs>,
        dataset: DataSet,
        columns: Column[],
        getString: (id: string) => string,
    ): HTMLElement {
        const bar = document.createElement('div');
        bar.className = 'RowCommands-bulk';

        const text = document.createElement('span');
        text.className = 'RowCommands-bulkText';
        bar.appendChild(text);
        this.progressText = null;

        if (this.bulk) {
            text.textContent = this.progressLine(getString);
            this.progressText = text;

            const stop = this.barButton('stop', getString('RowCommands_Stop'), () => {
                if (this.bulk) {
                    this.bulk.stop = true;
                    stop.disabled = true;
                }
            });

            stop.disabled = this.bulk.stop;
            bar.appendChild(stop);

            return bar;
        }

        text.textContent = getString('RowCommands_SelectedCount').replace('{0}', String(this.selected.length));

        if (this.canOfferDelete(context, dataset) && !context.mode.isControlDisabled && this.pending === '') {
            const remove = this.barButton(
                'delete',
                getString('RowCommands_DeleteSelected'),
                () => this.askToDeleteSelected(context, dataset, columns, getString),
                GLYPH_DELETE,
            );

            remove.classList.add('RowCommands-bulkDelete');
            bar.appendChild(remove);
        }

        bar.appendChild(
            this.barButton('clear', getString('RowCommands_ClearSelection'), () => {
                this.clearSelection(dataset);
                this.rerender();
            }),
        );

        return bar;
    }

    private barButton(name: string, text: string, run: () => void, glyph?: string): HTMLButtonElement {
        const button = document.createElement('button');

        button.type = 'button';
        button.className = 'RowCommands-bulkButton RowCommands-focusable';
        button.dataset.focus = `bulk:${name}`;

        if (glyph) {
            button.appendChild(icon(glyph));
        }

        button.appendChild(document.createTextNode(text));
        button.addEventListener('click', () => {
            if (!button.disabled) {
                run();
            }
        });

        return button;
    }

    private progressLine(getString: (id: string) => string): string {
        const bulk = this.bulk;

        if (!bulk) {
            return '';
        }

        return getString('RowCommands_DeletingProgress')
            .replace('{0}', String(Math.min(bulk.done + 1, bulk.total)))
            .replace('{1}', String(bulk.total));
    }

    /**
     * Whether a Delete — the row's or the selection's — is offered at all:
     * the maker asked for it, the host can confirm and delete, and the user's
     * roles do not rule it out. `null` from the roles is "cannot say", which
     * offers it, as 0.1.x did, and leaves the refusal to the server.
     */
    private canOfferDelete(context: ComponentFramework.Context<IInputs>, dataset: DataSet): boolean {
        return (
            asBoolean(context.parameters.showDelete.raw, false) &&
            canDelete(context) &&
            this.roleAllows(context, dataset) !== false
        );
    }

    private roleAllows(context: ComponentFramework.Context<IInputs>, dataset: DataSet): boolean | null {
        const table = dataset.getTargetEntityType();

        if (!this.roles.has(table)) {
            this.roles.set(table, canDeleteByRole((context as { utils?: unknown }).utils, table));
        }

        return this.roles.get(table) ?? null;
    }

    /**
     * Confirm once, then delete the selection one record at a time.
     *
     * The single-record path's rules hold — a cancel resolves, the press is
     * reported only after the confirmation, a rejection is a plain object —
     * and three are added:
     *
     *   - **One selected row is the row's own Delete**, with its own wording.
     *     "Delete 1 records?" is the sentence nobody proofreads.
     *   - **One refresh, at the end.** The rows leave the fetch, not the call,
     *     and twelve refreshes in flight would each be dropped for the next.
     *   - **What failed is named**, in the error dialog's details, record by
     *     record. A delete that stopped at a cascade restriction on row 7 of 12
     *     is not the same outcome as twelve that failed, and says so.
     */
    private askToDeleteSelected(
        context: ComponentFramework.Context<IInputs>,
        dataset: DataSet,
        columns: Column[],
        getString: (id: string) => string,
    ): void {
        const ids = [...this.selected];
        const primary = columns.find((column) => column.isPrimary) ?? columns[0];
        const labelOf = (id: string): string => {
            const value = dataset.records[id]?.getFormattedValue(primary.name) ?? '';

            return value !== '' ? value : getString('RowCommands_Untitled');
        };

        if (ids.length === 0) {
            return;
        }

        if (ids.length === 1) {
            this.askToDelete(context, dataset, ids[0], labelOf(ids[0]), getString);
            return;
        }

        const navigation = context.navigation;
        const webAPI = context.webAPI;

        if (!this.canOfferDelete(context, dataset) || this.pending !== '' || this.bulk || !navigation || !webAPI) {
            return;
        }

        const table = dataset.getTargetEntityType();
        const items: BulkItem[] = ids.map((id) => ({ id, label: labelOf(id) }));
        const count = String(ids.length);

        this.pending = 'bulk';

        void navigation
            .openConfirmDialog({
                title: getString('RowCommands_DeleteSelectedTitle').replace('{0}', count),
                text: getString('RowCommands_DeleteSelectedText').replace('{0}', count),
                confirmButtonLabel: getString('RowCommands_DeleteConfirm'),
                cancelButtonLabel: getString('RowCommands_DeleteCancel'),
            })
            .then((response) => {
                if (this.disposed) {
                    return undefined;
                }

                if (!response?.confirmed) {
                    this.announce(getString('RowCommands_DeleteCancelled'));
                    return undefined;
                }

                this.report(ids.join(','), 'deleteSelected');
                this.bulk = { done: 0, total: ids.length, stop: false };
                this.announce(getString('RowCommands_DeletingStarted').replace('{0}', count));
                this.rerender();

                return runSequential(items, (id) => webAPI.deleteRecord(table, id), {
                    shouldStop: () => this.disposed || this.bulk === null || this.bulk.stop,
                    onProgress: (done) => {
                        if (this.bulk) {
                            this.bulk.done = done;
                        }

                        if (this.progressText) {
                            this.progressText.textContent = this.progressLine(getString);
                        }
                    },
                    describe: describeError,
                }).then((result) => this.finishBulk(context, result, ids.length, getString));
            })
            .catch(() => {
                // Only the dialog can land here — `runSequential` never rejects.
                if (!this.disposed) {
                    this.announce(getString('RowCommands_DeleteSelectedFailed'), 'error');
                }
            })
            .then(() => {
                this.pending = '';
                this.bulk = null;

                if (!this.disposed) {
                    this.rerender();
                }
            });
    }

    private finishBulk(
        context: ComponentFramework.Context<IInputs>,
        result: BulkResult,
        total: number,
        getString: (id: string) => string,
    ): void {
        if (this.disposed) {
            return;
        }

        const gone = result.deleted.map((item) => item.id);

        this.selected = this.selected.filter((id) => !gone.includes(id));

        if (this.latest) {
            this.commitSelection(this.latest.dataset);

            // The rows leave the fetch, not the call. Once, for all of them.
            if (gone.length > 0) {
                this.latest.dataset.refresh();
            }
        }

        const deleted = String(result.deleted.length);

        if (result.failed.length > 0) {
            this.announce(
                getString('RowCommands_DeletedSome')
                    .replace('{0}', deleted)
                    .replace('{1}', String(total))
                    .replace('{2}', String(result.failed.length)),
                'error',
            );

            const navigation = context.navigation;

            if (typeof navigation?.openErrorDialog === 'function') {
                void navigation
                    .openErrorDialog({
                        message: getString('RowCommands_DeleteSelectedFailed'),
                        details: result.failed.map((item) => `${item.label}: ${item.detail}`).join('\n'),
                    })
                    .catch(() => undefined);
            }

            return;
        }

        if (result.stopped) {
            this.announce(getString('RowCommands_DeleteStopped').replace('{0}', deleted).replace('{1}', String(total)));
            return;
        }

        this.announce(getString('RowCommands_DeletedMany').replace('{0}', deleted), 'success');
    }

    /**
     * The command cell for one row.
     *
     * Every button here is conditional, and each condition is a different host
     * fact rather than a preference:
     *
     *   - **Open** is hidden by the maker's own `hideOpen`, and by nothing else.
     *     There is always *a* route to a record — `openDatasetItem` is a method
     *     on the dataset itself — so this one never has to degrade away.
     *   - **Launch** appears when the host has an `openUrl` to call, a URL
     *     column is mapped, *and* the value in it is a URL this control is
     *     willing to open. A missing `context.navigation`, an unmapped column,
     *     an empty cell and a `javascript:` payload are four different reasons
     *     for the same absence, and none of them is worth a button that looks
     *     pressable and does nothing.
     *   - **Delete** needs `webAPI` to do the work and `openConfirmDialog` to
     *     ask first, and canvas has neither. `showDelete` is the maker's half of
     *     the decision and the host has a veto — asking for confirmation is not
     *     optional, so a host that cannot ask does not get the button.
     */
    private commands(
        context: ComponentFramework.Context<IInputs>,
        dataset: DataSet,
        id: string,
        label: string,
        urls: Column | undefined,
        getString: (id: string) => string,
    ): HTMLElement {
        const group = document.createElement('div');
        group.className = 'RowCommands-commands';
        group.setAttribute('role', 'group');
        group.setAttribute('aria-label', getString('RowCommands_CommandsFor').replace('{0}', label));

        const enabled = !context.mode.isControlDisabled;

        if (!asBoolean(context.parameters.hideOpen.raw, false)) {
            group.appendChild(
                this.command(
                    'open',
                    GLYPH_OPEN,
                    getString('RowCommands_Open'),
                    getString('RowCommands_OpenRecord').replace('{0}', label),
                    enabled,
                    () => this.openRecord(context, dataset, id),
                ),
            );
        }

        const url =
            urls && typeof context.navigation?.openUrl === 'function'
                ? safeUrl(dataset.records[id]?.getValue(urls.name))
                : '';

        if (url !== '') {
            group.appendChild(
                this.command(
                    'url',
                    GLYPH_LAUNCH,
                    getString('RowCommands_Launch'),
                    getString('RowCommands_LaunchUrl').replace('{0}', label),
                    enabled,
                    () => this.launch(context, id, url),
                ),
            );
        }

        if (this.canOfferDelete(context, dataset)) {
            group.appendChild(
                this.command(
                    'delete',
                    GLYPH_DELETE,
                    getString('RowCommands_Delete'),
                    getString('RowCommands_DeleteRecord').replace('{0}', label),
                    enabled && this.pending === '' && this.bulk === null,
                    () => this.askToDelete(context, dataset, id, label, getString),
                ),
            );
        }

        return group;
    }

    /**
     * One command button: a glyph, a label, and a name that survives the label
     * being taken away.
     *
     * **The `aria-label` is set whether or not the label is visible**, and that
     * is the whole reason this is safe to collapse. Left to the text content,
     * the accessible name would silently become the `title` in compact mode —
     * which happens to work and is a rule about fallback order rather than an
     * intention, and it would break the day somebody removed the title. Setting
     * it outright means the narrow control and the wide one are the same
     * control to a screen reader.
     *
     * It names the row as well as the verb — *Open Fabrikam Manufacturing* —
     * because in compact mode the visible glyph is all there is, and "Open"
     * repeated down twenty-five rows identifies nothing. The visible text stays
     * a substring of it, so the accessible name still contains the visible
     * label where there is one.
     */
    private command(
        name: CommandName,
        glyph: string,
        text: string,
        title: string,
        enabled: boolean,
        run: () => void,
    ): HTMLButtonElement {
        const button = document.createElement('button');
        const caption = document.createElement('span');

        caption.className = 'RowCommands-commandLabel';
        caption.textContent = text;

        button.type = 'button';
        button.className = `RowCommands-command RowCommands-command--${name}`;
        button.title = title;
        button.setAttribute('aria-label', title);
        button.disabled = !enabled;
        button.append(icon(glyph), caption);

        /*
         * Guarded here rather than trusted to `button.disabled`. A disabled
         * button does not fire a click in a browser, but the control should not
         * depend on that: `dev/dom.js` dispatches whatever it is handed, and a
         * control whose safety rests on the DOM refusing is one nothing can
         * assert.
         */
        button.addEventListener('click', () => {
            if (button.disabled) {
                return;
            }

            run();
        });

        return button;
    }

    /**
     * Report the press before doing anything about it.
     *
     * The three outputs are the only channel a canvas app has, and they are
     * written *before* the platform call so the press is observable even where
     * the call does nothing. `invokeCount` is the part that is easy to leave
     * out: `OnChange` fires on a change and not on a write, so pressing Open
     * twice on the same row is one event and one silence without a counter.
     */
    private report(id: string, command: CommandName): void {
        this.invokedRecordId = id;
        this.invokedCommand = command;
        this.invokeCount += 1;
        this.notifyOutputChanged();
    }

    /**
     * Say what happened, in the one place a screen reader is listening.
     *
     * Two things beyond writing the text. **The region is blanked first**, so
     * an identical second announcement still announces — assistive technology
     * reports a *change*, and deleting two records with the same name would
     * otherwise be silent the second time.
     *
     * And **a success or an information message clears itself**, because this
     * bar sits above the table for as long as it has text in it and a sentence
     * about a record deleted ten minutes ago is furniture. A failure does not
     * clear: the platform's error dialog has already been dismissed by then, so
     * this line is the only remaining trace that anything went wrong, and it
     * stays until the next command replaces it.
     */
    private announce(text: string, kind: 'info' | 'success' | 'error' = 'info'): void {
        this.clearStatusTimer();

        this.status.className = `RowCommands-status RowCommands-status--${kind}`;
        this.status.textContent = '';
        const glyph = kind === 'error' ? GLYPH_ERROR : kind === 'success' ? GLYPH_SUCCESS : GLYPH_INFO;

        this.status.append(icon(glyph), document.createTextNode(text));

        if (kind === 'error') {
            return;
        }

        this.statusTimer = window.setTimeout(() => {
            this.statusTimer = undefined;
            this.status.textContent = '';
        }, STATUS_TIMEOUT_MS);
    }

    private clearStatusTimer(): void {
        if (this.statusTimer !== undefined) {
            window.clearTimeout(this.statusTimer);
            this.statusTimer = undefined;
        }
    }

    /**
     * Open the record, preferring `navigation.openForm`.
     *
     * **The two routes are not interchangeable, and the difference is the
     * return value.** `dataset.openDatasetItem()` takes an `EntityReference` —
     * `getNamedReference()` is the only way to build one, there is no id-based
     * overload — and returns nothing, so a control has no idea when or whether
     * the record was opened, edited or abandoned. `openForm` returns a promise
     * that settles when the form closes, which is what lets the view show an
     * edit the user just made rather than the row as it was before they left.
     *
     * So `openForm` is the route and the dataset's own is the fallback, taken
     * when `context.navigation` is absent or does not carry the method. The
     * fallback is not a lesser version of the same thing: it just cannot
     * refresh.
     */
    private openRecord(context: ComponentFramework.Context<IInputs>, dataset: DataSet, id: string): void {
        const record = dataset.records[id];

        if (!record) {
            return;
        }

        this.report(id, 'open');

        const openForm = context.navigation?.openForm;

        if (typeof openForm !== 'function') {
            dataset.openDatasetItem(record.getNamedReference());
            return;
        }

        void openForm
            .call(context.navigation, { entityName: dataset.getTargetEntityType(), entityId: id })
            .then(() => {
                if (this.disposed) {
                    return;
                }

                // The form has closed, and what it closed on may not be what
                // the row says. Refreshing here is a mutator in a handler
                // rather than in `updateView`, which is the only reason it is
                // safe to call at all.
                dataset.refresh();
            })
            .catch(() => {
                /*
                 * A rejection here is the form failing to open — a record
                 * somebody else deleted, a privilege the user does not have.
                 * There is nothing to undo and nothing the control can fix, so
                 * it is said and swallowed rather than raised as a dialog on
                 * top of whatever the platform already showed.
                 */
                if (!this.disposed) {
                    this.announce(context.resources.getString('RowCommands_OpenFailed'), 'error');
                }
            });
    }

    /**
     * Hand a URL to the host.
     *
     * `openUrl` returns **void**, not a promise — the odd one out in
     * `context.navigation`, and `void openUrl(url, options?)` in the type
     * definitions. There is no failure channel and nothing to await, which is
     * the whole reason the URL has to be judged acceptable *before* the call:
     * afterwards there is no report of any kind.
     */
    private launch(context: ComponentFramework.Context<IInputs>, id: string, url: string): void {
        const openUrl = context.navigation?.openUrl;

        if (typeof openUrl !== 'function') {
            return;
        }

        this.report(id, 'url');
        openUrl.call(context.navigation, url);
    }

    /**
     * Ask, then delete.
     *
     * The order of the four steps is the whole of it, and three of them are
     * where this goes wrong elsewhere:
     *
     *   1. **Ask.** `openConfirmDialog` resolves either way. `confirmed` is the
     *      answer; the promise settling is not.
     *   2. **Report.** After the confirmation, because an output saying a delete
     *      was invoked when the user pressed Cancel is a lie a canvas app will
     *      act on.
     *   3. **Delete**, and then `refresh()`. The row leaves the *fetch*, not the
     *      call — without the refresh it stays on screen and the next press
     *      deletes something that is already gone.
     *   4. **Report the failure to the user.** `openErrorDialog` is the platform's
     *      own way of doing that, and `describeError` exists because a `webAPI`
     *      rejection is a plain object with `errorCode` and `message` rather than
     *      an `Error` — so `error.message` alone is `undefined` half the time and
     *      the object itself renders as `[object Object]`.
     *
     * `pcf-tag-list` does the same delete with `.finally()` and no `.catch()`,
     * which its own SPEC records as an unfixed defect: an unhandled rejection
     * that took the smoke process down with it. This is what that should have
     * been.
     */
    private askToDelete(
        context: ComponentFramework.Context<IInputs>,
        dataset: DataSet,
        id: string,
        label: string,
        getString: (id: string) => string,
    ): void {
        const navigation = context.navigation;
        const webAPI = context.webAPI;

        // Re-checked rather than trusted to the render that drew the button:
        // between the two, a `updateView` may have arrived from a host that
        // took the feature away.
        if (!this.canOfferDelete(context, dataset) || this.pending !== '' || this.bulk || !navigation || !webAPI) {
            return;
        }

        this.pending = id;

        void navigation
            .openConfirmDialog({
                title: getString('RowCommands_DeleteTitle'),
                text: getString('RowCommands_DeleteText').replace('{0}', label),
                confirmButtonLabel: getString('RowCommands_DeleteConfirm'),
                cancelButtonLabel: getString('RowCommands_DeleteCancel'),
            })
            .then((response) => {
                if (this.disposed) {
                    return undefined;
                }

                // The success path, and the user said no. Not an error, and
                // nothing to report on the outputs — nothing happened.
                if (!response?.confirmed) {
                    this.announce(getString('RowCommands_DeleteCancelled'));
                    return undefined;
                }

                this.report(id, 'delete');

                return webAPI.deleteRecord(dataset.getTargetEntityType(), id).then(() => {
                    if (this.disposed) {
                        return;
                    }

                    this.announce(getString('RowCommands_Deleted').replace('{0}', label), 'success');
                    dataset.refresh();
                });
            })
            .catch((error: unknown) => {
                if (this.disposed) {
                    return;
                }

                const detail = describeError(error);

                this.announce(getString('RowCommands_DeleteFailed').replace('{0}', label), 'error');

                const openErrorDialog = navigation.openErrorDialog;

                if (typeof openErrorDialog !== 'function') {
                    return;
                }

                /*
                 * And this one is caught too. The error dialog is the last
                 * thing standing between a failed delete and silence, so a host
                 * that refuses to open it must not turn a handled failure into
                 * an unhandled rejection — the live region above has already
                 * said what happened.
                 */
                void openErrorDialog
                    .call(navigation, {
                        message: getString('RowCommands_DeleteFailed').replace('{0}', label),
                        details: detail,
                    })
                    .catch(() => undefined);
            })
            .then(() => {
                // `finally` in all but name, and written as a `then` because
                // the control targets ES5 through pcf-scripts and this is the
                // one place the difference would be a build error rather than a
                // style note.
                this.pending = '';

                if (!this.disposed) {
                    // The delete button on every row was disabled while this
                    // one was in flight; give them back.
                    this.render(context, dataset);
                }
            });
    }

    private pager(
        context: ComponentFramework.Context<IInputs>,
        dataset: DataSet,
        rowsOnPage: number,
        getString: (id: string) => string,
    ): HTMLElement {
        const wrap = document.createElement('div');
        wrap.className = 'RowCommands-pager';

        /*
         * `hasPreviousPage` answers a different question than it appears to.
         *
         * Observed on a real model-driven form: after paging forward it stays
         * false, so Previous never unlocks. The control's own counter is what
         * answers "is there a page before this one".
         */
        const previous = document.createElement('button');
        previous.type = 'button';
        previous.className = 'RowCommands-previous';
        previous.append(chevron(CHEVRON_PREVIOUS), document.createTextNode(getString('RowCommands_Previous')));
        previous.disabled = this.page <= 1;
        previous.addEventListener('click', () => {
            if (this.page <= 1) {
                return;
            }

            this.restoreFocus = 'previous';
            this.goToPage(dataset, this.page - 1);
        });

        const status = document.createElement('span');
        status.className = 'RowCommands-pagerStatus';
        status.setAttribute('aria-live', 'polite');
        status.textContent = this.pagerLabel(dataset, rowsOnPage, getString);

        // `hasNextPage` has behaved, and it is the only available answer to
        // "is there more" — a local counter cannot supply that one.
        const next = document.createElement('button');
        next.type = 'button';
        next.className = 'RowCommands-next';
        next.append(document.createTextNode(getString('RowCommands_Next')), chevron(CHEVRON_NEXT));
        next.disabled = !dataset.paging.hasNextPage;
        next.addEventListener('click', () => {
            if (!dataset.paging.hasNextPage) {
                return;
            }

            this.restoreFocus = 'next';
            this.goToPage(dataset, this.page + 1);
        });

        wrap.append(previous, status, next);

        /*
         * Only while there is something to reset, and never on a locked
         * control — a button that does nothing is the thing this control's
         * every other command is built to avoid.
         */
        if (!asBoolean(context.parameters.lockColumnWidths?.raw, false) && Object.keys(this.overrides).length > 0) {
            const reset = document.createElement('button');

            reset.type = 'button';
            reset.className = 'RowCommands-resetWidths RowCommands-focusable';
            reset.dataset.focus = 'reset-widths';
            reset.textContent = getString('RowCommands_ResetWidths');
            reset.addEventListener('click', () => this.resetWidths());
            wrap.appendChild(reset);
        }

        return wrap;
    }

    /**
     * Turn to an absolute page.
     *
     * `loadExactPage` is typed as required and feature-detected anyway: a
     * required member is a claim about the type definitions, not about the
     * host, and this method exists because one of those claims did not hold.
     */
    private goToPage(dataset: DataSet, target: number): void {
        const back = target < this.page;

        // The rows on screen are about to be other rows. See `selection.ts`.
        this.clearSelection(dataset);

        this.page = Math.max(1, target);

        if (typeof dataset.paging.loadExactPage === 'function') {
            dataset.paging.loadExactPage(this.page);
            return;
        }

        if (back) {
            dataset.paging.loadPreviousPage(true);
        } else {
            dataset.paging.loadNextPage(true);
        }
    }

    /**
     * `totalResultCount` is -1 when the platform did not count the rows, which
     * is common on large views. Printing "of -1" is the tell that nobody
     * checked, so name the page instead of the range.
     */
    private pagerLabel(dataset: DataSet, rowsOnPage: number, getString: (id: string) => string): string {
        const total = dataset.paging.totalResultCount;

        if (total < 0) {
            return getString('RowCommands_PageStatus').replace('{0}', String(this.page));
        }

        const start = (this.page - 1) * this.appliedPageSize + 1;

        return getString('RowCommands_RangeStatus')
            .replace('{0}', String(Math.min(start, total)))
            .replace('{1}', String(Math.min(start + rowsOnPage - 1, total)))
            .replace('{2}', String(total));
    }

    /**
     * Sorting is server-side, applied across every page.
     *
     * A client-side sort reorders the rows on screen — 25 out of 240 — which is
     * a wrong answer that looks completely right. `dataset.sorting` is an array
     * you mutate in place, and it is the whole ORDER BY; replacing rather than
     * appending is what stops three clicks building a three-deep sort nobody
     * asked for.
     */
    private sortBy(dataset: DataSet, columnName: string): void {
        const sorting = dataset.sorting;

        // Typed as required, absent on `npm start`. Decline rather than throw:
        // a click that does nothing there is a great deal better than a control
        // that disappears.
        if (!sorting) {
            return;
        }

        const current = sorting.find((status) => status.name === columnName);
        const direction: SortDirection = current?.sortDirection === ASCENDING ? DESCENDING : ASCENDING;

        sorting.length = 0;
        sorting.push({ name: columnName, sortDirection: direction });

        // A new order makes "page 4" meaningless, and a selection of rows
        // the user can no longer see.
        this.clearSelection(dataset);
        this.page = 1;
        dataset.paging.reset();
        dataset.refresh();
    }
}

/**
 * Whether this host can delete at all.
 *
 * Both halves, because they go missing for different reasons: `webAPI` is
 * Dataverse and absent in canvas, while `openConfirmDialog` is a model-driven
 * dialog that some hosts simply do not carry. **The confirmation is not
 * optional** — a delete button that removes a row on one press, in a table, at
 * the end of a row, next to two harmless buttons, is a mistake waiting to be
 * made — so a host that cannot ask does not get to delete.
 */
/**
 * Whether this host is one where a model-driven-only API means anything.
 *
 * **`typeof x.method === 'function'` is not that test.** Measured with a host
 * probe on a real canvas app, 2026-09-22: **fifteen of fifteen** platform
 * surfaces are published there — `webAPI.deleteRecord` and
 * `navigation.openConfirmDialog` among them — and the ones safe to call throw
 * `Method not implemented.` from the call itself. So a presence test passes on
 * canvas and the feature is offered where it can only fail.
 *
 * What does discriminate is **an answer rather than a method**. `getClientUrl`
 * refuses by throwing, and a thrown refusal is an answer once it is caught. It
 * is undocumented — absent from the API reference entirely — which is why it is
 * read defensively and why the `Xrm` global is tried after it.
 *
 * A model-driven host that publishes neither loses the Delete command. That is
 * the safe direction: a command that is missing is a smaller wrong than one
 * that deletes nothing and reports an error.
 */
function modelDrivenHost(context: ComponentFramework.Context<IInputs>): boolean {
    const ask = <T>(call: () => T): T | undefined => {
        try {
            return call();
        } catch {
            return undefined;
        }
    };

    const page = (context as { page?: { getClientUrl?: unknown } }).page;
    const fromPage = typeof page?.getClientUrl === 'function'
        ? ask(() => (page.getClientUrl as () => unknown)())
        : undefined;
    const fromGlobal = ask(() => (globalThis as {
        Xrm?: { Utility?: { getGlobalContext?: () => { getClientUrl?: () => unknown } } };
    }).Xrm?.Utility?.getGlobalContext?.()?.getClientUrl?.());

    return [fromPage, fromGlobal].some((url) => typeof url === 'string' && url !== '');
}

function canDelete(context: ComponentFramework.Context<IInputs>): boolean {
    return (
        typeof context.webAPI?.deleteRecord === 'function' &&
        typeof context.navigation?.openConfirmDialog === 'function' &&
        modelDrivenHost(context)
    );
}

/**
 * A URL this control is prepared to hand to `openUrl`, or `''`.
 *
 * **The value comes off a bound column**, which means it is whatever anybody
 * with write access to the record put there — and `openUrl` navigates to what
 * it is given. `javascript:` is the one everybody thinks of; `data:` and
 * `blob:` are the two they do not. So this is an allow-list of two schemes
 * rather than a block-list of the ones that came to mind, because a block-list
 * is only ever as long as its author's imagination.
 *
 * Relative paths are refused as well, and that is a real cost rather than an
 * oversight: `/main.aspx?...` is a perfectly ordinary thing to store, and
 * resolving it needs a base this control cannot honestly choose — the form's
 * origin is not the app's is not the record's. An absolute URL says where it
 * goes.
 */
function safeUrl(value: unknown): string {
    if (typeof value !== 'string') {
        return '';
    }

    const trimmed = value.trim();

    if (trimmed === '') {
        return '';
    }

    let parsed: URL;

    try {
        parsed = new URL(trimmed);
    } catch {
        return '';
    }

    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '';
}

/**
 * A `TwoOptions` value that survives arriving as a string.
 *
 * A manifest `default-value` reaches the control as the raw XML text on hosts
 * that do not coerce it — PCFHub's demo harness among them — so
 * `default-value="false"` is the string `"false"`, and `Boolean("false")` is
 * `true`. Every read of a boolean input goes through here.
 */
function asBoolean(raw: unknown, fallback: boolean): boolean {
    if (typeof raw === 'boolean') {
        return raw;
    }

    if (typeof raw === 'string') {
        return raw.toLowerCase() === 'true';
    }

    return fallback;
}

/**
 * The view's id, or `null`. `getViewId` is not in every host's dataset —
 * canvas has no saved view — so it is detected and its throw caught.
 * Measured present and stable on a subgrid and a main grid (P4).
 */
function viewIdOf(dataset: DataSet): string | null {
    try {
        const id = (dataset as unknown as { getViewId?: () => unknown }).getViewId?.();

        return typeof id === 'string' && id !== '' ? id : null;
    } catch {
        return null;
    }
}

/**
 * Something a person can read out of a platform rejection.
 *
 * **A `webAPI` rejection is not an `Error`.** It is a plain object carrying
 * `errorCode` and `message`, exactly as the Client API's `errorCallback`
 * documents — so `error.message` is `undefined` on the shapes that use a
 * different key, and handing the object itself to a template renders
 * `[object Object]` where the platform's explanation belongs. The device APIs
 * use `code` rather than `errorCode`, which is why both are read here.
 */
function describeError(error: unknown): string {
    if (typeof error === 'string') {
        return error;
    }

    if (error instanceof Error) {
        return error.message;
    }

    if (error !== null && typeof error === 'object') {
        const bag = error as { message?: unknown; errorCode?: unknown; code?: unknown };

        if (typeof bag.message === 'string' && bag.message !== '') {
            return bag.message;
        }

        const code = bag.errorCode ?? bag.code;

        if (code !== undefined) {
            return String(code);
        }
    }

    return '';
}

/** The SVG namespace. `createElement('svg')` makes an *HTML* element of that
 *  name: it parses, it appends, it occupies no space and draws nothing. */
const SVG_NS = 'http://www.w3.org/2000/svg';

/** The pager chevrons, on a 20×20 grid. Two strokes each. */
const CHEVRON_PREVIOUS = 'M12.5 5 7.5 10l5 5';
const CHEVRON_NEXT = 'M7.5 5l5 5-5 5';

/**
 * The three command glyphs, filled, on a 20×20 grid.
 *
 * Path data traced from `@fluentui/react-icons` at the size it was drawn for —
 * a 20px icon scaled down from the 24px cut loses the hinting it was drawn
 * with, and looks it.
 */
const GLYPH_OPEN =
    'M6 3h5.5a.5.5 0 0 1 0 1H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8.5a.5.5 0 0 1 1 0V14a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Z';
const GLYPH_LAUNCH =
    'M12.5 3h4a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-1 0V4.7l-5.15 5.15a.5.5 0 0 1-.7-.7L15.3 4h-2.8a.5.5 0 0 1 0-1ZM5 4h3.5a.5.5 0 0 1 0 1H5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-3.5a.5.5 0 0 1 1 0V15a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z';
/** A filled circle with a tick, an "i" and an "!", at the same 20px cut. */
const GLYPH_SUCCESS =
    'M10 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16Zm3.36 5.65a.75.75 0 0 0-1.06 0L9 10.94 7.7 9.65a.75.75 0 1 0-1.06 1.06l1.83 1.83a.75.75 0 0 0 1.06 0l3.83-3.83a.75.75 0 0 0 0-1.06Z';
const GLYPH_INFO =
    'M10 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16Zm0 6.5a.75.75 0 0 0-.75.75v4a.75.75 0 0 0 1.5 0v-4A.75.75 0 0 0 10 8.5Zm0-3a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8Z';
const GLYPH_ERROR =
    'M10 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16Zm0 9.25a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8Zm0-6a.75.75 0 0 0-.75.75v4a.75.75 0 0 0 1.5 0v-4A.75.75 0 0 0 10 5.25Z';
const GLYPH_DELETE =
    'M8.5 3h3a1.5 1.5 0 0 1 1.5 1.5V5h3a.5.5 0 0 1 0 1h-.55l-.85 9.36A2 2 0 0 1 12.61 17H7.39a2 2 0 0 1-1.99-1.64L4.55 6H4a.5.5 0 0 1 0-1h3v-.5A1.5 1.5 0 0 1 8.5 3Zm-.5 2h4v-.5a.5.5 0 0 0-.5-.5h-3a.5.5 0 0 0-.5.5V5Zm-2.45 1 .84 9.27a1 1 0 0 0 1 .73h5.22a1 1 0 0 0 1-.73L14.45 6h-8.9Zm2.95 1.5a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V8a.5.5 0 0 1 .5-.5Zm3 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V8a.5.5 0 0 1 .5-.5Z';

/**
 * An icon, inline, so it can follow the theme.
 *
 * **An `<img>` cannot do this job**, whatever the file format. An image behind
 * `<img src>` — a resource, a data URL, PNG or SVG alike — renders as an
 * isolated document that cannot see this control's stylesheet, so a
 * `currentColor` inside it resolves to black and a dark form gets a black glyph
 * on a dark background. A control in this house shipped exactly that and it was
 * found on a real form.
 *
 * Three things bite while writing one: `createElement('svg')` makes an HTML
 * element named "svg" that draws nothing; `className` on an SVG element is a
 * read-only `SVGAnimatedString` and assigning to it silently does nothing; and
 * `hidden` is an `HTMLElement` property, so hiding one needs the attribute.
 *
 * Decorative, because every one of these sits beside its own label.
 */
function icon(d: string): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;

    svg.classList.add('RowCommands-icon');
    svg.setAttribute('viewBox', '0 0 20 20');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');

    const path = document.createElementNS(SVG_NS, 'path');

    path.setAttribute('d', d);
    path.setAttribute('fill', 'currentColor');

    svg.appendChild(path);

    return svg;
}

/** A chevron, inline, for the same reason. Stroked rather than filled. */
function chevron(d: string): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;

    svg.classList.add('RowCommands-chevron');
    svg.setAttribute('viewBox', '0 0 20 20');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');

    const path = document.createElementNS(SVG_NS, 'path');

    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');

    svg.appendChild(path);

    return svg;
}
