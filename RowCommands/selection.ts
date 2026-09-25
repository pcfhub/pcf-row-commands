/**
 * Which rows are selected — a decision module, no DOM, no platform.
 *
 * **The selection belongs to the page on screen.** Turning a page, sorting or
 * changing the page size clears it, and every render intersects it with the
 * rows actually drawn. Two reasons, and the second decides it:
 *
 *   - A delete confirmation that says "12 records" should be about twelve rows
 *     the user can see. A selection carried across pages deletes rows that
 *     scrolled out of sight two pages ago.
 *   - The command bar acts on `setSelectedRecordIds` (measured 2026-09-25,
 *     P3), and a ribbon Delete removes rows the control never hears about
 *     except as their absence on the next render. Intersecting with the page
 *     drops them; a cross-page selection could not tell "deleted" from "on
 *     another page", and would say "3 selected" about rows that are gone.
 *
 * The control keeps its own copy rather than reading the platform's back: the
 * platform kept a selection through a ribbon refresh (P3), but a page turn with
 * a selection is unmeasured, and a copy of our own is what the next render is
 * certain to have.
 */

/** Add the id, or take it out if it is there. */
export function toggle(selected: string[], id: string): string[] {
    return selected.includes(id) ? selected.filter((each) => each !== id) : [...selected, id];
}

/** What the header checkbox shows. */
export function pageState(selected: string[], pageIds: string[]): 'none' | 'some' | 'all' {
    const on = pageIds.filter((id) => selected.includes(id)).length;

    if (on === 0) {
        return 'none';
    }

    return on === pageIds.length ? 'all' : 'some';
}

/**
 * The header checkbox pressed: everything on the page when anything is off,
 * nothing when all of it is on — the same rule every list with a tri-state
 * header uses.
 */
export function togglePage(selected: string[], pageIds: string[]): string[] {
    return pageState(selected, pageIds) === 'all' ? [] : [...pageIds];
}

/** The selection, kept to rows on this page, in the page's order. */
export function prune(selected: string[], pageIds: string[]): string[] {
    return pageIds.filter((id) => selected.includes(id));
}

/** Same ids, whatever the order. */
export function sameSet(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((id) => b.includes(id));
}
