/**
 * The maker's own commands — a decision module: text in, a list of commands or
 * one sentence saying what is wrong with it out. Nothing here touches the
 * platform, so the suite can drive every rule with a string.
 *
 * The text is JSON, from one of two places (`configLoader.ts` decides which):
 * the **Your commands** property itself, or a web resource it names. Either
 * shape is accepted at the top — `{ "commands": [ … ] }` or the bare array:
 *
 *     {
 *       "commands": [
 *         { "name": "approve", "label": "Approve", "icon": "check",
 *           "set": { "cll_approval": 100000001 }, "confirm": "Approve {0}?",
 *           "selection": true },
 *         { "name": "escalate", "label": { "1033": "Escalate", "1036": "Escalader" } }
 *       ]
 *     }
 *
 * **A command with `set` writes those columns on the row**, through the Web
 * API, in one update. **A command without `set` writes nothing**: it is a
 * press, reported on the outputs (and raised as `onRowCommand`) for a form
 * script or a canvas formula to act on.
 *
 * **Strict on purpose.** An unknown key is refused by name rather than
 * ignored: `"lable"` silently dropped is a command with no label and a maker
 * who cannot see why. And `statecode`/`statuscode` are refused in `set` —
 * the pair has rules a single column cannot keep (a reason belongs to a
 * state, and the server refuses a reason sent into the other state, measured
 * twice), which is what **Show Activate and Deactivate** is for.
 */

export type SetValue = string | number | boolean | null;

/** The glyphs a command may name. Drawn by `index.ts`; `run` is the default. */
export const ICON_NAMES = ['run', 'check', 'dismiss', 'flag', 'send', 'star', 'warning', 'archive'] as const;

export type IconName = (typeof ICON_NAMES)[number];

export interface CommandDef {
    /** What `invokedCommand` reports. Lower camel case. */
    name: string;
    /** One label, or one per language by LCID. */
    label: string | Record<string, string>;
    icon: IconName;
    /** The columns this command writes, or `null` for a press-only command. */
    set: Record<string, SetValue> | null;
    /** A sentence to confirm with, `{0}` the record's name, or `null` for none. */
    confirm: string | null;
    /** Whether the bar over a selection offers it too. */
    selection: boolean;
}

export type ParseResult = { ok: true; commands: CommandDef[] } | { ok: false; problem: string };

/** The names the control's own commands already report on `invokedCommand`. */
const RESERVED = ['open', 'url', 'delete', 'activate', 'deactivate'];

/** More than this and the row is a toolbar, which a command column is not. */
export const MAX_COMMANDS = 6;

const NAME = /^[a-z][A-Za-z0-9]{0,31}$/;

/** A logical name, or a lookup's navigation property with `@odata.bind`. */
const COLUMN = /^[a-z_][a-z0-9_]*(@odata\.bind)?$/i;

const KEYS = ['name', 'label', 'icon', 'set', 'confirm', 'selection'];

/**
 * Whether the property holds the JSON itself rather than a web resource's
 * name. A web resource name never starts with a brace or a bracket.
 */
export function isInline(raw: string): boolean {
    const first = raw.trim().charAt(0);

    return first === '{' || first === '[';
}

export function parseCommands(text: string): ParseResult {
    let data: unknown;

    try {
        data = JSON.parse(text);
    } catch (error) {
        return fail(`it is not JSON (${error instanceof Error ? error.message : String(error)})`);
    }

    const list = Array.isArray(data)
        ? data
        : isObject(data) && Array.isArray(data.commands)
            ? data.commands
            : null;

    if (list === null) {
        return fail('expected { "commands": [ … ] } or an array of commands');
    }

    if (isObject(data) && !Array.isArray(data)) {
        const extra = Object.keys(data).filter((key) => key !== 'commands');

        if (extra.length > 0) {
            return fail(`unknown key "${extra[0]}" at the top`);
        }
    }

    if (list.length > MAX_COMMANDS) {
        return fail(`${list.length} commands; at most ${MAX_COMMANDS} fit on a row`);
    }

    const commands: CommandDef[] = [];

    for (const [index, item] of list.entries()) {
        const where = `command ${index + 1}`;

        if (!isObject(item)) {
            return fail(`${where} is not an object`);
        }

        const unknown = Object.keys(item).find((key) => !KEYS.includes(key));

        if (unknown !== undefined) {
            return fail(`${where} has an unknown key "${unknown}"`);
        }

        const name = item.name;

        if (typeof name !== 'string' || !NAME.test(name)) {
            return fail(`${where}: "name" must start with a lower-case letter and hold only letters and digits`);
        }

        if (RESERVED.includes(name) || /Selected$/.test(name)) {
            return fail(`${where}: "${name}" is a name the control's own commands report`);
        }

        if (commands.some((command) => command.name === name)) {
            return fail(`${where}: "${name}" is used twice`);
        }

        const label = readLabel(item.label);

        if (label === null) {
            return fail(`${where} ("${name}"): "label" must be text, or an object of language codes to text`);
        }

        let icon: IconName = 'run';

        if (item.icon !== undefined) {
            if (typeof item.icon !== 'string' || !(ICON_NAMES as readonly string[]).includes(item.icon)) {
                return fail(`${where} ("${name}"): "icon" must be one of ${ICON_NAMES.join(', ')}`);
            }

            icon = item.icon as IconName;
        }

        let set: Record<string, SetValue> | null = null;

        if (item.set !== undefined) {
            if (!isObject(item.set) || Object.keys(item.set).length === 0) {
                return fail(`${where} ("${name}"): "set" must be an object of column names to values`);
            }

            set = {};

            for (const [column, value] of Object.entries(item.set)) {
                if (!COLUMN.test(column)) {
                    return fail(`${where} ("${name}"): "${column}" is not a column's logical name`);
                }

                if (column === 'statecode' || column === 'statuscode') {
                    return fail(`${where} ("${name}"): "${column}" cannot be set by a command — use Show Activate and Deactivate`);
                }

                if (!isSetValue(value)) {
                    return fail(`${where} ("${name}"): the value for "${column}" must be text, a number, true, false or null`);
                }

                set[column] = value;
            }
        }

        let confirm: string | null = null;

        if (item.confirm !== undefined) {
            if (typeof item.confirm !== 'string' || item.confirm.trim() === '') {
                return fail(`${where} ("${name}"): "confirm" must be a sentence`);
            }

            confirm = item.confirm;
        }

        if (item.selection !== undefined && typeof item.selection !== 'boolean') {
            return fail(`${where} ("${name}"): "selection" must be true or false`);
        }

        commands.push({ name, label, icon, set, confirm, selection: item.selection === true });
    }

    return { ok: true, commands };
}

/**
 * The label for the user's language: their LCID, then English, then whatever
 * the maker wrote first. A string label is the label everywhere.
 */
export function labelFor(command: CommandDef, languageId: number | undefined): string {
    if (typeof command.label === 'string') {
        return command.label;
    }

    const byLanguage = command.label;

    return byLanguage[String(languageId)] ?? byLanguage['1033'] ?? Object.values(byLanguage)[0] ?? command.name;
}

/**
 * Whether a row already holds every value a command would write — in which
 * case the command is not offered on it: an Approve on an approved row does
 * nothing a user can see.
 *
 * `read` answers a column's raw value, or `undefined` when the column is not
 * on the dataset at all — then nothing is known, and the command is offered.
 * A choice reads back as a string ("3", measured), a Yes/No as a boolean, so
 * values are compared by kind rather than by identity. A lookup bind is never
 * "held": the row carries a reference, not the bind path.
 */
export function holdsAll(set: Record<string, SetValue>, read: (column: string) => unknown): boolean {
    return Object.entries(set).every(([column, wanted]) => {
        if (column.endsWith('@odata.bind')) {
            return false;
        }

        const have = read(column);

        if (have === undefined) {
            return false;
        }

        return sameValue(have, wanted);
    });
}

/** Every column a command list writes — the ones the control asks the dataset for. */
export function columnsWritten(commands: CommandDef[]): string[] {
    const names = new Set<string>();

    for (const command of commands) {
        for (const column of Object.keys(command.set ?? {})) {
            if (!column.endsWith('@odata.bind')) {
                names.add(column);
            }
        }
    }

    return [...names];
}

function sameValue(have: unknown, wanted: SetValue): boolean {
    if (wanted === null) {
        return have === null || have === '' || (typeof have === 'string' && have.trim() === '');
    }

    if (have === null) {
        return false;
    }

    if (typeof wanted === 'boolean') {
        return have === wanted || String(have).toLowerCase() === String(wanted) || (have === 1 && wanted) || (have === 0 && !wanted);
    }

    if (typeof wanted === 'number') {
        return Number(have) === wanted && String(have).trim() !== '';
    }

    return String(have) === wanted;
}

function readLabel(value: unknown): string | Record<string, string> | null {
    if (typeof value === 'string') {
        return value.trim() === '' || value.length > 60 ? null : value;
    }

    if (!isObject(value)) {
        return null;
    }

    const entries = Object.entries(value);

    if (entries.length === 0) {
        return null;
    }

    const labels: Record<string, string> = {};

    for (const [lcid, text] of entries) {
        if (!/^\d{4,5}$/.test(lcid) || typeof text !== 'string' || text.trim() === '' || text.length > 60) {
            return null;
        }

        labels[lcid] = text;
    }

    return labels;
}

function isSetValue(value: unknown): value is SetValue {
    return value === null
        || typeof value === 'string'
        || typeof value === 'boolean'
        || (typeof value === 'number' && Number.isFinite(value));
}

function isObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fail(problem: string): ParseResult {
    return { ok: false, problem };
}
