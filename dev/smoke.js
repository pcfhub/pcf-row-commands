/*
 * Drives the real built bundle outside a browser.
 *
 *     npm run build && npm run smoke
 *
 * What it does: installs the DOM and the platform globals, loads
 * `out/controls/RowCommands/bundle.js` the way a form would, binds it to a
 * twelve-record view with three pages in it, and asserts what the control did —
 * both what it rendered and what it asked the platform for.
 *
 * **This control is mostly the second half.** Everything it does happens
 * somewhere else: a form opens, a tab opens, a row is deleted on a server. A
 * rendered table shows none of that, and `dev/host.js` records every call, so
 * the interesting assertions here are about what was handed to the platform and
 * what the control did with the answer.
 *
 * Four things get asserted that nothing else in this repository can:
 *
 *   - **that a cancelled confirmation deletes nothing**, and that the cancel
 *     arriving as a *resolve* is not mistaken for a failure;
 *   - **that a URL taken off a record is judged before it is opened** — the
 *     fixture carries `javascript:`, `data:` and `ftp:` values, and none of
 *     them may reach `openUrl`;
 *   - **that every command hides rather than fails** on a host missing the API
 *     behind it;
 *   - **that a failed delete reaches `openErrorDialog` with something a person
 *     can read**, rather than `[object Object]`.
 *
 * Why no test framework: there is none in this repository, and adding one to
 * run a handful of assertions against a bundle would be a dependency, a config
 * file and a second build pipeline for something `node` already does. It also
 * runs the **built bundle** rather than the TypeScript sources, which is the
 * part worth checking. CI runs it after the msbuild pack, so there it drives
 * the production bundle.
 *
 * **What passing here does NOT mean.** Every record below is supplied by this
 * file, and every platform answer is supplied by `dev/host.js`. It cannot tell
 * you that `openForm` opens anything, that a real Dataverse deletes what it is
 * asked to delete, that the confirmation dialog looks like a confirmation, or
 * that a canvas app hands over what this rig hands over. Those are in SPEC.md
 * under "Not verified".
 *
 * **The quirks default to the platform's observed misbehaviour, not to its
 * documentation**, and that is load-bearing. See the header of `dev/host.js`.
 */

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const root = path.join(__dirname, '..');
const dom = require('./dom.js');
const host = require('./host.js');
const clock = require('./clock.js');
const fixture = require('./fixture.js');

const BUNDLE = path.join(root, 'out', 'controls', 'RowCommands', 'bundle.js');

if (!fs.existsSync(BUNDLE)) {
    console.error('\n  No bundle at out/controls/RowCommands. Run npm run build first.\n');
    process.exit(1);
}

/* ----------------------------------------------------------- the platform */

dom.install(global);

/*
 * Time, replaced with something the test drives.
 *
 * `vm.runInThisContext` below evaluates the bundle in *this* realm, so the
 * `Date`, `setInterval` and `setTimeout` the control closes over are the ones
 * installed here — no injectable clock parameter, and therefore no production
 * code bent to suit a harness.
 *
 * This control takes no timer. The teardown assertion at the bottom is written
 * against one anyway, so it starts passing for a real reason the moment
 * somebody adds a debounce or an auto-refresh.
 */
const time = clock.install(Date.UTC(2026, 0, 1, 12, 0, 0), global);

const registration = host.captureRegistration(global);

/*
 * A `standard` control has no platform libraries, so the React and Fluent
 * machinery `_template/variants/dataset/dev/smoke.js` ships is deleted here
 * rather than left inert — a stub nothing reaches is a thing to read and
 * mistrust later.
 */
vm.runInThisContext(fs.readFileSync(BUNDLE, 'utf8'), { filename: 'bundle.js' });

/* ---------------------------------------------------------------- harness */

const results = [];

function check(label, ok, detail) {
    results.push({ ok, label, detail });
}

// `getString` returns a marked key rather than a real string, so an assertion
// can tell "read from the .resx" apart from "hardcoded in the source".
const marked = (key) => `resx:${key}`;

/*
 * Except for the ones carrying a `{0}`, which have to be real templates or an
 * assertion about substitution has nothing to assert on.
 */
const TEMPLATES = {
    RowCommands_OpenRecord: 'Open {0}',
    RowCommands_LaunchUrl: 'Open the link on {0}',
    RowCommands_DeleteRecord: 'Delete {0}',
    RowCommands_DeleteText: '{0} will be deleted permanently.',
    RowCommands_Deleted: '{0} was deleted.',
    RowCommands_DeleteFailed: '{0} could not be deleted.',
    RowCommands_CommandsFor: 'Commands for {0}',
    // Real, not marked, because an assertion below checks that the visible
    // label is a substring of the accessible name. Marked, the two could not
    // be compared at all. The other twenty-odd keys still prove the resx path.
    RowCommands_Open: 'Open',
};

const speaks = (key) => (TEMPLATES[key] !== undefined ? TEMPLATES[key] : marked(key));

/**
 * The manifest's own `default-value`s, seeded on every mount.
 *
 * The rig builds `context.parameters` from what it is handed and nothing else,
 * so a declared property arrives as `undefined` here and as a value on a form.
 * That is a gap in the rig rather than a reason to write a defensive `?.` in
 * the control, and this is where it is closed. They are the raw *strings* the
 * manifest carries, deliberately — `"false"` is truthy, and `asBoolean` in the
 * control is what has to survive it.
 */
const MANIFEST_DEFAULTS = { hideOpen: 'false', showDelete: 'false' };

/**
 * Every control bound and not yet destroyed.
 *
 * A suite that binds and walks away is testing something other than what it
 * says: an abandoned control keeps its `document` listeners and its timers, so
 * the next section's counts include them.
 */
const live = [];

function disposeAll() {
    while (live.length > 0) {
        live.pop().destroy();
    }
}

function bind(options = {}) {
    const handle = host.createHost(fixture, {
        getString: speaks,
        ...options,
        inputs: { ...MANIFEST_DEFAULTS, ...(options.inputs || {}) },
    });
    const container = dom.createElement('div');
    const instance = new registration.ctor();

    let notifications = 0;

    instance.init(handle.context, () => {
        notifications += 1;
    }, {}, container);

    let driven = host.drive(instance, handle, 10);

    const view = {
        instance,
        container,
        handle,
        get driven() {
            return driven;
        },
        calls: () => handle.state.calls,
        /** How many times the control said its outputs changed. */
        notifications: () => notifications,
        outputs: () => (instance.getOutputs ? instance.getOutputs() : {}),
        find: (selector) => container.querySelector(selector),
        findAll: (selector) => container.querySelectorAll(selector),
        /** Let the platform catch up after something the control asked for. */
        settle: () => {
            driven = host.drive(instance, handle, 10);

            return driven;
        },
        destroy: () => {
            instance.destroy();

            const at = live.indexOf(view);

            if (at !== -1) {
                live.splice(at, 1);
            }
        },
    };

    live.push(view);

    return view;
}

/** The rows currently drawn, as elements. */
const rowsOf = (view) => {
    const body = view.container.querySelector('tbody');

    return body ? body.children : [];
};

/** One row's command buttons, in the order the control put them in. */
const commandsIn = (row) => row.querySelectorAll('.RowCommands-command');

/** A named command on the nth row, or `null` when the control did not draw it. */
const commandOn = (view, index, name) => {
    const row = rowsOf(view)[index];

    return row ? row.querySelector(`.RowCommands-command--${name}`) : null;
};

/** Every call whose name starts with one of these. */
const callsLike = (view, prefix) => view.calls().filter((call) => call.indexOf(prefix) === 0);

/** Let every promise the control is holding settle. */
const settled = () => new Promise((resolve) => setImmediate(resolve));

/** Click, the way `dev/dom.js` does it: no bubbling, no default action. */
const press = (element) => element.dispatchEvent({ type: 'click', target: element });

check('bundle registered a control', typeof registration.ctor === 'function');

if (typeof registration.ctor !== 'function') {
    report();
}

/* ============================================================ the table */

const view = bind({});

/*
 * A control that mutates in `updateView` without a guard never stops. Two
 * passes is the settled number — one render, then one more for the page size it
 * asked for on the first.
 */
check(
    'settles instead of refreshing forever',
    !view.driven.looping && view.driven.passes === 2,
    `${view.driven.passes} passes, calls: ${view.calls().join(' ')}`,
);

const headers = view.findAll('th').map((th) => th.textContent);

check(
    'draws the view’s columns in `order`, hidden ones left out',
    headers.slice(0, 5).join('|') === 'Account name|Account number|Primary contact|Status|Website',
    headers.join(' | '),
);

check(
    'and adds one column of its own, at the end and named from the .resx',
    headers[headers.length - 1] === 'resx:RowCommands_Commands',
    headers[headers.length - 1],
);

check('renders one row per record on the page', rowsOf(view).length === 5, String(rowsOf(view).length));

check(
    'groups a row’s commands and names the group after the row',
    view.find('.RowCommands-commands').getAttribute('aria-label') === 'Commands for Fabrikam Manufacturing',
    view.find('.RowCommands-commands').getAttribute('aria-label'),
);

/* ================================================= which commands appear */

check(
    'shows open and launch by default, and not delete',
    commandsIn(rowsOf(view)[0]).length === 2 &&
        commandOn(view, 0, 'open') !== null &&
        commandOn(view, 0, 'url') !== null &&
        commandOn(view, 0, 'delete') === null,
    commandsIn(rowsOf(view)[0]).map((b) => b.className).join(' '),
);

check(
    'titles each command with the row it acts on',
    commandOn(view, 0, 'open').title === 'Open Fabrikam Manufacturing',
    commandOn(view, 0, 'open').title,
);

/*
 * The `property-set` role is found by `alias` and read by `name`, and the
 * fixture gives that column two different strings for exactly this assertion:
 * done backwards, no row has a Launch button and nothing throws.
 */
check(
    'finds the URL column by its alias, not by its name',
    commandOn(view, 0, 'url') !== null,
    'urlField -> websiteurl',
);

const unmapped = bind({ columns: fixture.columns.filter((column) => column.alias !== 'urlField') });

check(
    'and drops the launch command entirely when no URL column is mapped',
    unmapped.find('.RowCommands-command--url') === null &&
        commandsIn(rowsOf(unmapped)[0]).length === 1,
    String(commandsIn(rowsOf(unmapped)[0]).length),
);

const hidden = bind({ inputs: { hideOpen: true } });

check(
    'hideOpen removes the open command and leaves the others',
    commandOn(hidden, 0, 'open') === null && commandOn(hidden, 0, 'url') !== null,
);

check(
    'and reads the manifest default as the string it arrives as, not as a boolean',
    commandOn(view, 0, 'open') !== null,
    'hideOpen="false" is truthy until asBoolean sees it',
);

const disabled = bind({ disabled: true });

check(
    'a read-only form still draws every command, disabled',
    commandsIn(rowsOf(disabled)[0]).length === 2 &&
        commandsIn(rowsOf(disabled)[0]).every((button) => button.disabled === true),
);

press(commandOn(disabled, 0, 'open'));

check(
    'and a disabled command does nothing when the DOM dispatches to it anyway',
    disabled.outputs().invokeCount === 0 && callsLike(disabled, 'navigation.openForm').length === 0,
    JSON.stringify(disabled.outputs()),
);

/* ========================================================== the URL guard */

/*
 * The values live in `dev/fixture.js`, one per row, and the point of every one
 * of them is that it came off a record — which is to say from anybody with
 * write access to it.
 */
const urls = bind({ pageSize: 12 });
const launchable = rowsOf(urls).map((row, index) => (commandOn(urls, index, 'url') !== null ? index : -1));

check(
    'opens an https URL',
    launchable.indexOf(0) !== -1,
    'a01 https://fabrikam.example.com',
);
check('opens a plain http URL', launchable.indexOf(1) !== -1, 'a02 http://…');
check('keeps a query string', launchable.indexOf(2) !== -1, 'a03 ?ref=view');
check('draws nothing for an empty cell', launchable.indexOf(3) === -1, 'a04 ""');
check('draws nothing for a null cell', launchable.indexOf(4) === -1, 'a05 null');

check(
    'REFUSES a javascript: URL — no button, and nothing to press',
    launchable.indexOf(5) === -1,
    'a06 javascript:alert(document.cookie)',
);
check(
    'REFUSES a data: URL, which is the one a block-list forgets',
    launchable.indexOf(9) === -1,
    'a10 data:text/html,…',
);
check('REFUSES an ftp: URL', launchable.indexOf(11) === -1, 'a12 ftp://…');

check(
    'refuses a relative path rather than guessing a base for it',
    launchable.indexOf(6) === -1,
    'a07 /main.aspx?etn=account',
);
check(
    'accepts an uppercase scheme, because a scheme is case-insensitive',
    launchable.indexOf(7) !== -1,
    'a08 HTTPS://Wingtip.Example.com',
);
check(
    'and trims a copy-pasted URL rather than refusing it',
    launchable.indexOf(8) !== -1,
    'a09 "  https://blueyonder.example.com  "',
);

press(commandOn(urls, 0, 'url'));

check(
    'hands the normalised URL to navigation.openUrl',
    callsLike(urls, 'navigation.openUrl').length === 1 &&
        callsLike(urls, 'navigation.openUrl')[0].indexOf('https://fabrikam.example.com') !== -1,
    urls.calls().join(' | '),
);

check(
    'and reports the press through the outputs before the platform sees it',
    urls.outputs().invokedCommand === 'url' &&
        urls.outputs().invokedRecordId === 'a01' &&
        urls.outputs().invokeCount === 1,
    JSON.stringify(urls.outputs()),
);

/* ======================================================= opening a record */

const opened = bind({});

press(commandOn(opened, 0, 'open'));

check(
    'prefers navigation.openForm, with the table’s own entity name',
    callsLike(opened, 'navigation.openForm').length === 1 &&
        callsLike(opened, 'navigation.openForm')[0].indexOf('"entityName":"account"') !== -1 &&
        callsLike(opened, 'navigation.openForm')[0].indexOf('"entityId":"a01"') !== -1,
    opened.calls().join(' | '),
);

check(
    'and does not also call openDatasetItem — one route per press, not both',
    callsLike(opened, 'openDatasetItem').length === 0,
    opened.calls().join(' | '),
);

press(commandOn(opened, 0, 'open'));

check(
    'a second identical press is a second event, because OnChange fires on a change',
    opened.outputs().invokeCount === 2 && opened.notifications() === 2,
    `count ${opened.outputs().invokeCount}, notified ${opened.notifications()}`,
);

const noNavigation = bind({ hasNavigation: false });

press(commandOn(noNavigation, 0, 'open'));

check(
    'falls back to openDatasetItem when the whole navigation bag is missing',
    callsLike(noNavigation, 'openDatasetItem').length === 1,
    noNavigation.calls().join(' | '),
);

check(
    'and still reports the press, which is the only channel canvas has',
    noNavigation.outputs().invokedCommand === 'open' && noNavigation.outputs().invokeCount === 1,
    JSON.stringify(noNavigation.outputs()),
);

check(
    'the launch command goes with the bag it lives in',
    noNavigation.find('.RowCommands-command--url') === null,
    'no navigation, no openUrl',
);

/* ================================= the size of a page, and whose it is */

/*
 * **The platform already has a page size.** `paging.pageSize` is what the host
 * is actually retrieving with — a user's own *Rows per page* on a main grid,
 * the maker's setting on a subgrid — and the first version of this control
 * overrode it on every host, because the property carried
 * `default-value="25"` and so arrived as a real number from a maker who had
 * never touched it.
 *
 * The rig keeps the two separate: `pageSize` is the platform's, `inputs.pageSize`
 * is the control's own property. They are one option on a real host only
 * because nobody had needed to tell them apart before.
 */
const adopted = bind({ pageSize: 7, inputs: { pageSize: null } });

check(
    'an unset page size adopts the host’s own, and asks for nothing',
    callsLike(adopted, 'setPageSize').length === 0,
    adopted.calls().join(' | '),
);

check(
    'and pages by it — reading a size is not the same as requesting one',
    rowsOf(adopted).length === 7,
    `${rowsOf(adopted).length} rows against paging.pageSize 7`,
);

const overridden = bind({ pageSize: 7, inputs: { pageSize: 4 } });

check(
    'a page size the maker did set overrides the host',
    callsLike(overridden, 'setPageSize').length === 1 &&
        callsLike(overridden, 'setPageSize')[0].indexOf('4') !== -1,
    overridden.calls().join(' | '),
);

check(
    'and settles rather than asking again on every render',
    !overridden.driven.looping && overridden.driven.passes === 2,
    `${overridden.driven.passes} passes`,
);

/*
 * **Repaginating resets the page, and applying the first size does not.**
 *
 * A page size that changes *after* one has been applied recuts the result set,
 * so "page 3" stops meaning what it meant and the platform answers a request
 * for it with nothing. The first application is the other case: at mount the
 * platform is already on page one, and `reset()` is a fetch — so resetting
 * there buys a round trip for nothing.
 *
 * Mutating the maker's input mid-flight is the only way to reach this from a
 * suite. The property is read fresh from `options.inputs` on every pass, so
 * this is the rig's model of a property edited in the form designer — which is
 * the only way it changes in this control, and why the bug went unnoticed here
 * long enough for `pcf-data-table` to find it with a rows-per-page picker.
 */
const resetOnMount = callsLike(overridden, 'paging.reset').length;

overridden.handle.options.inputs.pageSize = 9;
overridden.settle();

check(
    'the first page size costs no reset, and changing it afterwards does',
    resetOnMount === 0 && callsLike(overridden, 'paging.reset').length === 1,
    `${resetOnMount} at mount, ${callsLike(overridden, 'paging.reset').length} after the change`,
);

/*
 * A host that reports no page size at all. `0` means "did not say", and the
 * first version of this treated it as one-row-per-page — so a view handing over
 * twenty rows would have drawn one, which is the worst possible reading of a
 * missing number.
 */
const unsized = bind({ pageSize: 12, inputs: { pageSize: null }, quirks: { uncounted: true } });

unsized.handle.options.pageSize = 0;
unsized.settle();

check(
    'a host that reports no page size gets everything it handed over, not one row',
    rowsOf(unsized).length === 12,
    `${rowsOf(unsized).length} rows`,
);

/* ==================================== the height the host allocated */

/*
 * A main grid reports `allocatedHeight: -1` **by design** — documented, not a
 * gap: the platform expects a component there to fill the space with CSS, and
 * measures a height only on a subgrid, where the maker types one in.
 *
 * So the class that used to gate the scroll layout on a measurement is gone.
 * What is left for JS to decide is narrow: a pixel height where the host gave
 * one, and nothing where it did not, leaving the stylesheet's `height: 100%` to
 * do the work. The layout itself is CSS and nothing here computes layout, which
 * is why this asserts the input to it rather than the result.
 */
const bounded = bind({ height: 420 });

check(
    'a measured height is taken as a pixel ceiling',
    bounded.container.style.height === '420px',
    bounded.container.style.height,
);

check(
    'and an unmeasured one leaves no inline height, so the stylesheet decides',
    (view.container.style.height || '') === '',
    `height -1 -> "${view.container.style.height || ''}"`,
);

/* ============================================ a record with no name */

/*
 * Reported from a real form, and it was not a bug: a view sorted by name puts
 * every unnamed record at the top, so the first screenful was blank rows with a
 * working command column beside them. Nothing had failed. It just looked
 * exactly like something had — which is a problem worth fixing even when the
 * rendering is correct, because the row next to a Delete button has to be
 * identifiable.
 */
const nameless = bind({ pageSize: 12 });
const namelessRow = rowsOf(nameless)[8];

check(
    'a record whose primary column is empty says so, rather than rendering blank',
    namelessRow.querySelector('td').textContent === 'resx:RowCommands_Untitled',
    `"${namelessRow.querySelector('td').textContent}"`,
);

check(
    'and the placeholder is marked, so it can be styled as an absence not a value',
    namelessRow.querySelector('td').className === 'RowCommands-untitled',
    namelessRow.querySelector('td').className,
);

/*
 * Only the primary column. An empty phone number is an empty phone number, and
 * a placeholder in every blank cell would be noise rather than information.
 */
check(
    'and no other empty cell is filled in — it is the row identity, not every gap',
    namelessRow.querySelectorAll('td').filter((cell) => cell.textContent === 'resx:RowCommands_Untitled')
        .length === 1,
    namelessRow.querySelectorAll('td').map((cell) => `"${cell.textContent}"`).join(' '),
);

check(
    'and its commands name it the same way the cell does',
    commandOn(nameless, 8, 'open').getAttribute('aria-label') === 'Open resx:RowCommands_Untitled',
    commandOn(nameless, 8, 'open').getAttribute('aria-label'),
);

/* ============================================== which hosts can delete */

const deletable = bind({ inputs: { showDelete: true } });

check(
    'showDelete adds a third command where the host can confirm and delete',
    commandsIn(rowsOf(deletable)[0]).length === 3 && commandOn(deletable, 0, 'delete') !== null,
);

const noWebApi = bind({ inputs: { showDelete: true }, webAPI: false });

check(
    'and withholds it where there is no webAPI — canvas, and not a maker’s mistake',
    commandOn(noWebApi, 0, 'delete') === null && commandOn(noWebApi, 0, 'open') !== null,
);

const noDialogs = bind({ inputs: { showDelete: true }, dialogs: 'absent' });

check(
    'and withholds it where nothing can ask first, even though webAPI is right there',
    commandOn(noDialogs, 0, 'delete') === null,
    'a delete that cannot be confirmed is not offered',
);

check(
    'the rest of the control is unaffected by either absence',
    rowsOf(noDialogs).length === 5 && commandsIn(rowsOf(noDialogs)[0]).length === 2,
);

/* =================================================== the narrow container */

check(
    'asks the platform to report its width, without which there is none',
    view.calls().indexOf('trackContainerResize(true)') !== -1,
    view.calls().join(' | '),
);

/*
 * -1 is the platform's answer before anything is laid out, and 0 is a host that
 * measured nothing. Both mean "no answer" — and guessing compact from a missing
 * measurement would strip the labels off every control on a host that reports
 * neither.
 */
check(
    'an unmeasured container is not treated as a narrow one',
    view.container.classList.contains('RowCommands--compact') === false &&
        (view.container.style.maxWidth || '') === '',
    `width -1 -> compact=${view.container.classList.contains('RowCommands--compact')}`,
);

const wide = bind({ width: 900 });

check(
    'a wide container keeps the labels, and takes a pixel ceiling',
    wide.container.classList.contains('RowCommands--compact') === false &&
        wide.container.style.maxWidth === '900px',
    wide.container.style.maxWidth,
);

const narrow = bind({ width: 380, inputs: { showDelete: true } });

check(
    'a phone-width container goes compact',
    narrow.container.classList.contains('RowCommands--compact'),
    narrow.container.style.maxWidth,
);

check(
    'and still draws every command it drew before — collapsing is not hiding',
    commandsIn(rowsOf(narrow)[0]).length === 3,
    String(commandsIn(rowsOf(narrow)[0]).length),
);

/*
 * The assertion the compact mode rests on. The label is hidden by CSS, which
 * nothing here can see — so what has to be true in the DOM is that the button
 * never depended on the label for its name in the first place.
 */
check(
    'every command names itself and its row, whether or not the label is visible',
    commandOn(narrow, 0, 'open').getAttribute('aria-label') === 'Open Fabrikam Manufacturing' &&
        commandOn(wide, 0, 'open').getAttribute('aria-label') === 'Open Fabrikam Manufacturing',
    commandOn(narrow, 0, 'open').getAttribute('aria-label'),
);

check(
    'and the visible label is a substring of that name, so the two agree',
    commandOn(narrow, 0, 'open')
        .getAttribute('aria-label')
        .indexOf(narrow.find('.RowCommands-commandLabel').textContent) === 0,
    narrow.find('.RowCommands-commandLabel').textContent,
);

/*
 * Counted against the commands actually drawn rather than against rows times
 * three — the first version of this assumed a fixed three per row and failed,
 * which is the control being right: a row whose URL column is empty has two
 * commands, and that is the whole behaviour.
 */
const drawnCommands = rowsOf(narrow).reduce((total, row) => total + commandsIn(row).length, 0);

check(
    'the label is still in the DOM, moved off-screen rather than deleted',
    narrow.findAll('.RowCommands-commandLabel').length === drawnCommands && drawnCommands > 0,
    `${narrow.findAll('.RowCommands-commandLabel').length} labels, ${drawnCommands} commands`,
);

/* ====================================================== the delete itself */

(async () => {
    /* -------------------------------------------------------- cancelled */

    const cancelled = bind({ inputs: { showDelete: true }, dialogs: 'cancelled' });

    press(commandOn(cancelled, 0, 'delete'));
    await settled();

    check(
        'asks before deleting, naming the record in the dialog',
        callsLike(cancelled, 'navigation.openConfirmDialog').length === 1 &&
            callsLike(cancelled, 'navigation.openConfirmDialog')[0].indexOf(
                'Fabrikam Manufacturing will be deleted',
            ) !== -1,
        cancelled.calls().join(' | '),
    );

    check(
        'A CANCELLED CONFIRM DELETES NOTHING — and it arrives as a resolve, not a reject',
        callsLike(cancelled, 'webAPI.deleteRecord').length === 0,
        cancelled.calls().join(' | '),
    );

    check(
        'and is not reported as an invocation, because nothing was invoked',
        cancelled.outputs().invokeCount === 0 && cancelled.outputs().invokedCommand === '',
        JSON.stringify(cancelled.outputs()),
    );

    check(
        'and is not treated as a failure either — no error dialog for a deliberate no',
        callsLike(cancelled, 'navigation.openErrorDialog').length === 0,
        cancelled.calls().join(' | '),
    );

    check(
        'says so in the live region instead',
        cancelled.find('.RowCommands-status').textContent === 'resx:RowCommands_DeleteCancelled',
        cancelled.find('.RowCommands-status').textContent,
    );

    check(
        'and the row is still there',
        rowsOf(cancelled).length === 5,
        String(rowsOf(cancelled).length),
    );

    /* -------------------------------------------------------- confirmed */

    const confirmed = bind({ inputs: { showDelete: true }, dialogs: 'confirmed' });

    press(commandOn(confirmed, 0, 'delete'));
    await settled();

    check(
        'a confirmed delete reaches webAPI.deleteRecord with the table and the id',
        callsLike(confirmed, 'webAPI.deleteRecord').length === 1 &&
            callsLike(confirmed, 'webAPI.deleteRecord')[0].indexOf('account a01') !== -1,
        confirmed.calls().join(' | '),
    );

    check(
        'and is reported only once it has been confirmed',
        confirmed.outputs().invokedCommand === 'delete' &&
            confirmed.outputs().invokedRecordId === 'a01' &&
            confirmed.outputs().invokeCount === 1,
        JSON.stringify(confirmed.outputs()),
    );

    check(
        'refreshes afterwards — the row leaves the fetch, not the call',
        callsLike(confirmed, 'refresh').length >= 1,
        confirmed.calls().join(' | '),
    );

    confirmed.settle();

    check(
        'so the row is gone once the refresh lands',
        rowsOf(confirmed).every((row) => row.querySelector('td').textContent !== 'Fabrikam Manufacturing'),
        rowsOf(confirmed).map((row) => row.querySelector('td').textContent).join(', '),
    );

    check(
        'and says which record went',
        confirmed.find('.RowCommands-status').textContent === 'Fabrikam Manufacturing was deleted.',
        confirmed.find('.RowCommands-status').textContent,
    );

    check(
        'as a success, not as an undifferentiated line of grey text',
        confirmed.find('.RowCommands-status').className.indexOf('RowCommands-status--success') !== -1,
        confirmed.find('.RowCommands-status').className,
    );

    /*
     * The bar sits above the table for as long as it has text in it, so a
     * sentence about a record deleted ten minutes ago is furniture. Six seconds
     * is long enough to read and short enough not to become part of the form.
     */
    check('a success message is holding a timer', time.pending() >= 1, String(time.pending()));

    time.advance(6000);

    check(
        'and clears itself, rather than living above the table forever',
        confirmed.find('.RowCommands-status').textContent === '',
        confirmed.find('.RowCommands-status').textContent,
    );

    /* ----------------------------------------------------------- failed */

    const failing = bind({ inputs: { showDelete: true }, dialogs: 'confirmed', webApiFails: true });

    press(commandOn(failing, 0, 'delete'));
    await settled();

    check(
        'a rejected delete opens the platform’s error dialog',
        callsLike(failing, 'navigation.openErrorDialog').length === 1,
        failing.calls().join(' | '),
    );

    const dialog = callsLike(failing, 'navigation.openErrorDialog')[0];

    check(
        'saying which record it was, in the control’s own words',
        dialog.indexOf('"message":"Fabrikam Manufacturing could not be deleted."') !== -1,
        dialog,
    );

    /*
     * And the platform's own explanation in `details`, which is the half that
     * proves the rejection was decoded at all.
     *
     * Asserting on `message` alone would pass whether or not `describeError`
     * ever ran — that string is the control's template and the platform never
     * touches it. A `webAPI` rejection is a plain object with `errorCode` and
     * `message` rather than an `Error`, so the two ways to get this wrong are
     * reading `error.message` off something that has none (`undefined`) and
     * handing the object straight to a template (`[object Object]`). Both are
     * ruled out here and neither is by the line above.
     */
    check(
        'and the platform’s explanation in details — not [object Object], not undefined',
        dialog.indexOf('"details":"The record could not be deleted."') !== -1 &&
            dialog.indexOf('[object Object]') === -1 &&
            dialog.indexOf('"details":"undefined"') === -1,
        dialog,
    );

    check(
        'and the row stays, because nothing was deleted',
        rowsOf(failing).length === 5,
        String(rowsOf(failing).length),
    );

    check(
        'a failure is announced too, not only shown in a dialog',
        failing.find('.RowCommands-status').textContent.indexOf('could not be deleted') !== -1,
        failing.find('.RowCommands-status').textContent,
    );

    check(
        'and is marked as an error rather than sharing the success styling',
        failing.find('.RowCommands-status').className.indexOf('RowCommands-status--error') !== -1,
        failing.find('.RowCommands-status').className,
    );

    /*
     * **A failure does not clear itself**, and that asymmetry is deliberate: by
     * the time anybody looks, the platform's error dialog has been dismissed,
     * so this line is the only remaining trace that the delete did not happen.
     * It stays until the next command replaces it.
     */
    time.advance(60000);

    check(
        'and stays put, because the error dialog it followed is long gone',
        failing.find('.RowCommands-status').textContent.indexOf('could not be deleted') !== -1,
        failing.find('.RowCommands-status').textContent,
    );

    /* ------------------------------------------ the dialog itself refusing */

    const refusing = bind({ inputs: { showDelete: true }, dialogs: 'rejected' });

    press(commandOn(refusing, 0, 'delete'));
    await settled();

    check(
        'a host that refuses to open the confirmation deletes nothing',
        callsLike(refusing, 'webAPI.deleteRecord').length === 0,
        refusing.calls().join(' | '),
    );

    check(
        'and survives it — an unhandled rejection here would take the process with it',
        refusing.find('.RowCommands-status').textContent.indexOf('could not be deleted') !== -1,
        refusing.find('.RowCommands-status').textContent,
    );

    /* --------------------------------------------------------- in flight */

    const inFlight = bind({ inputs: { showDelete: true }, dialogs: 'confirmed' });

    press(commandOn(inFlight, 0, 'delete'));
    press(commandOn(inFlight, 1, 'delete'));
    await settled();

    check(
        'two presses while a confirmation is open ask once, not twice',
        callsLike(inFlight, 'navigation.openConfirmDialog').length === 1,
        inFlight.calls().join(' | '),
    );

    check(
        'and exactly one record is deleted',
        callsLike(inFlight, 'webAPI.deleteRecord').length === 1,
        inFlight.calls().join(' | '),
    );

    /* ----------------------------------------------- torn down mid-dialog */

    const abandoned = bind({ inputs: { showDelete: true }, dialogs: 'confirmed' });

    press(commandOn(abandoned, 0, 'delete'));
    abandoned.destroy();
    await settled();

    check(
        'a control destroyed while its confirmation is open deletes nothing',
        callsLike(abandoned, 'webAPI.deleteRecord').length === 0,
        abandoned.calls().join(' | '),
    );

    /* ------------------------------------------- hidden means hidden */

    /*
     * The live region is built *outside* the part `render` clears, deliberately,
     * so an announcement cannot be destroyed by the render its own command
     * triggered. The cost is this: clearing the surface leaves the message
     * behind, and a hidden control went on showing the last thing it had to say
     * — floating above whatever the form had put there instead.
     *
     * `handle.options` is the live bag `createContext()` reads, so flipping
     * `visible` and re-driving is what the platform does when a form tab is
     * switched away from.
     */
    const hiding = bind({ inputs: { showDelete: true }, dialogs: 'confirmed' });

    press(commandOn(hiding, 0, 'delete'));
    await settled();

    check(
        'a visible control shows what it announced',
        hiding.find('.RowCommands-status').textContent !== '',
        hiding.find('.RowCommands-status').textContent,
    );

    hiding.handle.options.visible = false;
    hiding.settle();

    check(
        'and a hidden one says nothing at all, message included',
        hiding.find('.RowCommands-status').textContent === '' && rowsOf(hiding).length === 0,
        `status "${hiding.find('.RowCommands-status').textContent}", ${rowsOf(hiding).length} rows`,
    );

    /* ---------------------------------------------------------- teardown */

    disposeAll();

    const timersBefore = time.pending();
    const listeners = () =>
        Object.values(dom.document.listeners).reduce((total, list) => total + list.length, 0);
    const listenersBefore = listeners();

    const short = bind({ inputs: { showDelete: true }, dialogs: 'confirmed' });

    press(commandOn(short, 0, 'delete'));
    await settled();

    /*
     * The positive half, first. A teardown assertion that only checks the
     * count returns to zero passes trivially against a control that took no
     * timer at all — which is what this file did until the status bar started
     * clearing itself.
     */
    check(
        'a control that has announced something is holding a timer',
        time.pending() === timersBefore + 1,
        `${timersBefore} before, ${time.pending()} now`,
    );

    short.settle();

    const afterFirst = time.pending();

    short.settle();

    check(
        'and re-rendering does not accumulate a timer',
        time.pending() === afterFirst,
        `${afterFirst} then ${time.pending()}`,
    );

    short.destroy();

    check(
        'destroy() releases every timer the control took',
        time.pending() === timersBefore,
        `${timersBefore} before, ${time.pending()} after`,
    );

    check(
        'and every document-level listener',
        listeners() === listenersBefore,
        `${listenersBefore} before, ${listeners()} after`,
    );

    disposeAll();

    report();
})();

function report() {
    const failed = results.filter((result) => !result.ok);

    for (const result of results) {
        const detail = result.detail ? `  — ${result.detail}` : '';

        console.log(`  ${result.ok ? 'ok  ' : 'FAIL'}  ${result.label}${detail}`);
    }

    console.log(
        failed.length > 0
            ? `\n  ${failed.length} of ${results.length} failed\n`
            : `\n  ${results.length} passed — the control's own decisions only; see SPEC.md for what a real view still has to confirm\n`,
    );

    process.exit(failed.length > 0 ? 1 : 0);
}
