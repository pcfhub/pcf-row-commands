/**
 * Whether the user's roles let them delete from this table — a decision
 * module, handed `context.utils` rather than reaching for it.
 *
 * Three answers, and the third is the one that keeps 0.1.x's behaviour:
 *
 *   true   some depth answers yes. The button is shown; whether *this* record
 *          is within that depth is the server's to say, and it says it the
 *          way it always did — the error dialog.
 *   false  every depth answers no. The button is not shown, because a user
 *          with no Delete anywhere can only ever reach the refusal.
 *   null   the host cannot say: no `utils`, no method, a non-boolean, or a
 *          throw. **An undeclared `Utility` is a throw** — measured 2026-09-25
 *          (SPEC.md P1): the method is published whether or not the manifest
 *          declares the feature, and every call without it throws. `null`
 *          leaves the decision to the server, as 0.1.x did.
 *
 * Asked per table, not per record: the roles say whether the user may delete
 * *somewhere*, and owner-only Delete still shows the button on other people's
 * rows. A per-record answer costs a request per row, and was declined.
 */

/** `PrivilegeType.Delete`. Write is 3 — measured on a form by pcf-audit-history. */
export const PRIVILEGE_DELETE = 4;

/** Basic, Local, Deep, Global. */
const DEPTHS = [0, 1, 2, 3];

export function canDeleteByRole(utils: unknown, table: string): boolean | null {
    const ask = (utils as { hasEntityPrivilege?: unknown } | undefined)?.hasEntityPrivilege;

    if (table === '' || typeof ask !== 'function') {
        return null;
    }

    try {
        const answers = DEPTHS.map((depth) => (ask as (t: string, p: number, d: number) => unknown).call(utils, table, PRIVILEGE_DELETE, depth));

        if (answers.some((answer) => typeof answer !== 'boolean')) {
            return null;
        }

        return answers.some((answer) => answer === true);
    } catch {
        return null;
    }
}
