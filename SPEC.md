# Row Commands

Open a record, launch a URL, or delete it with a confirm, from the row itself.

Four platform APIs here had never been called by any control in this catalogue:
`navigation.openUrl`, `openConfirmDialog`, `openErrorDialog`, and
`webAPI.deleteRecord` from a dataset control. Most of what follows comes from
that.

## What the build disagreed with

**`width: 1%` collapses a column instead of shrinking it, under
`table-layout: fixed`.** The commands column has to be as wide as its buttons
and no wider, and the shrink-to-fit trick every table uses — a percentage
narrower than the content — is the obvious move. Under fixed layout a declared
width is taken *literally*: the column became 1% of the table and the buttons
vanished under the `overflow: hidden` that the cells already had. Nothing
errored, and it looked like the commands had stopped rendering.

Under fixed layout the choice is a real width or none at all, and none means an
equal share of the table — which stacks three buttons one per line and turns a
six-row view into twelve rows of chrome. The column is `22em`, and the commands
are right-aligned so the two-command case reads as a column that ends at the
table's edge rather than one with a hole in it.

**The dev harness rendered nothing at all, and the control was right.** First
run of `npm run harness`: an empty box and
`TypeError: Cannot read properties of undefined (reading 'raw')`. The rig builds
`context.parameters` from the `inputs` bag it is handed and nothing else, so
`hideOpen` — declared in the manifest with a `default-value` — arrived as
`undefined` here and as a value on a form.

That is the rig's gap, not the control's, and the fix belongs in the rig: the
harness page now seeds this control's manifest defaults, and `dev/smoke.js` does
the same through `MANIFEST_DEFAULTS`. The alternative — a defensive `?.` in
`index.ts` — would have made production code carry a workaround for a test
harness, and hidden the next property somebody forgets to declare. The same
finding was recorded for `pcf-sparkline`; this is the second control to hit it,
and `_template/TEMPLATE.md` now says so under *The dev rig*.

They are seeded as the raw XML **strings** the manifest carries, deliberately.
`default-value="false"` reaches a control as `"false"`, which is truthy.

## Platform behaviour worth knowing

**A cancelled confirmation is a resolve, not a rejection.**
`openConfirmDialog` resolves with `{ confirmed: boolean }` either way; the
promise settling says the dialog closed, not that the user agreed. There are two
ways to get this wrong and both are one line from correct: putting the delete in
`.then()` without reading `confirmed` deletes the record the user just declined
to delete, and treating the cancel as a failure shows an error for something
they did on purpose. Neither shows up without a rig that can produce a cancel.

**`openUrl` returns `void`.** The odd one out in `context.navigation` —
`void openUrl(url, options?)` in the type definitions, where every neighbour
returns a promise. So there is nothing to await and `.catch()` on it is a
TypeError, and more importantly **there is no failure channel at all**: a URL
the host will not open reports nothing back. That is the whole reason the
address has to be judged before the call rather than after it.

**`deleteRecord` resolves with a `LookupValue`, not with nothing.**
`Promise<LookupValue>` — `{ entityType, id, name }` for the record that is now
gone. Useful for naming it in a message without having remembered it first.

**`openForm` and `openDatasetItem` are not two spellings of the same thing.**
Every dataset control in this catalogue opens records with
`dataset.openDatasetItem(record.getNamedReference())`, which takes an
`EntityReference` — there is no id-based overload — and returns nothing. So a
control has no idea when, or whether, the record was opened, edited or
abandoned. `navigation.openForm` returns a promise that settles when the form
closes, which is what lets the view refresh and show an edit the user just made.
That is the reason to prefer it, and the fallback is not a lesser version of the
same call: it simply cannot refresh.

Its `OpenFormSuccessResponse.savedEntityReference` is populated only when a
*quick create* form saved something. An ordinary form opening resolves with an
empty array, so a control waiting for a reference from one waits forever.

**Presence is per method, not per bag.** `context.navigation` is typed
non-optional, and inside it `openForm` and `openUrl` are everywhere, `openFile`
is model-driven only, and the three dialogs are a model-driven affordance canvas
does not have. A control that checks `context.navigation` once and then calls
four methods through it passes on the host it was written on and throws on the
next one. Every call site here is guarded independently, and `dev/host.js` can
now remove each independently.

**A Yes/No property still cannot default to on**, so the two boolean inputs are
named opposite ways round: `hideOpen`, because open should be on by default and
the platform's `false` has to mean that; `showDelete`, because delete should be
off and the platform's `false` already means it. Same rule, read twice. Promoted
long ago — see `references/control-patterns.md`, "A `TwoOptions` input cannot
default to on".

## The dev rig, and what it could not do before

The dataset rig had `webAPI.retrieveRecord` and `navigation.openFile` and
nothing else — no `openForm`, no `openUrl`, no dialogs, no `deleteRecord`. This
control could not be tested at all. What went into `_template`:

- **The whole `navigation` bag**, assembled method by method, plus a
  `hasNavigation` switch that removes it entirely.
- **`dialogs`, with four values rather than two** — `confirmed`, `cancelled`,
  `rejected`, `absent`. `absent` deletes the three dialog methods from the bag,
  because absence and refusal are different states and only one of them is the
  control's bug. That framing is `pcf-geo-stamp`'s, from the device APIs.
- **`webAPI.deleteRecord`**, with a `webApiFails` switch whose rejection is a
  plain `{ errorCode, message }` object rather than an `Error` — the shape the
  Client API documents and the reason `describeError` exists.
- **Real selection state.** `getSelectedRecordIds()` was a hardcoded `[]` and
  `setSelectedRecordIds` logged only `ids.length`, so a control could set a
  selection and read back nothing. Unrelated to this control; found while
  reading the file, and it made "selects the row it acted on" unassertable for
  every dataset control before it.
- **`mode.isControlDisabled`**, which was hardcoded `false` — so no dataset
  control could be asserted against a read-only form, the state a maker produces
  by unticking one box.

**A delete leaves the fetch, not the call.** The first version of the stub
removed the row from the record set inside `deleteRecord`, which would have
passed a control that deletes and forgets `dataset.refresh()`. It is two lists
now — deleted on the server, and gone from the data the client is holding — with
`fetched()` moving one to the other, for the same reason `pageSize` and
`requestedPageSize` are two variables.

## What the suite caught in this control

**A button that was drawn and could not work.** With `context.navigation`
removed entirely, **Open link** still rendered: the render checked that a URL
column was mapped and that the value was acceptable, and never checked that the
host had an `openUrl` to hand it to. Pressing it returned silently from the
guard inside the handler. The control's whole stated principle is that a command
hides rather than fails, and it was two-thirds implemented.

**An assertion that was proving nothing.** "The error dialog does not say
`[object Object]`" passed against a `message` field the control fills in from
its own string table — a slot the platform never touches, so it would have
passed whether or not the rejection was ever decoded. The rig now logs
`details` as well, and the assertion reads that instead. This is the same class
of bug as the `img.src` one `pcf-geo-stamp` found in `dev/dom.js`: an assertion
reading a slot nothing wrote to and reporting the absence as proof.

## Demo

`limited`, and three separate things put it there — any one would have been
enough. Opening a record needs a Dataverse to open it in. Delete needs
`webAPI` and a confirmation dialog, and the harness has neither, so the button
is not drawn there — which is exactly what a canvas app shows. And the harness
seeds one page with no next or previous, so the pager is inert.

What *is* real there is which commands each row offers: the address is read from
the bound column and checked before a button appears, so the record with no
website has no link button. That is the control's logic running rather than a
picture of it.

The fourth preset switches `showDelete` on and visibly changes nothing. That is
deliberate — a preset demonstrating the degradation is worth more than one
hiding it.

## Not verified

Nothing in this repository has been on a real Power App. Every platform answer
comes from `dev/host.js`, which was written from the type definitions and the
reference. Four items are load-bearing:

- **That a cancelled `openConfirmDialog` really does resolve** with
  `{ confirmed: false }` rather than rejecting. This is read from the type
  signature and the documented behaviour, and the entire delete path is built on
  it. Proving it: one press and one Cancel on a real model-driven form.
- **That `openForm`'s promise settles when the form closes**, rather than when
  it opens. The refresh-after-edit behaviour is worth nothing if it resolves
  immediately, and the type definitions do not say which it is. Proving it: open
  a record, change the primary column, save, close, and see whether the row
  updates.
- **That `of-type-group` works on a dataset `property-set` in canvas.**
  Microsoft's property schema reference is commonly read as listing
  `of-type-group` under model-driven apps only, and this control uses one for
  the URL role. If that reading is right, the **Open link** command is
  model-driven only and `docs/canvas.md` is wrong about it. Treated as
  unconfirmed rather than assumed either way. Proving it: bind the role in a
  canvas app and see whether the column picker offers anything.
- **That the outputs reach a canvas `OnChange` at all**, and that `InvokeCount`
  is what makes a repeated press fire it. Inherited from `pcf-action-button`'s
  `PressCount`, which has not been on a real app either. Proving it: two
  identical presses and a `Notify()`.

Two smaller ones: that a subgrid without `cds-data-set-options` really does
suppress the command bar as intended, and that the platform's error dialog shows
`details` in the way the type documentation describes — the control puts the
server's explanation there rather than in `message`, and nobody has seen it
rendered.

## Promoting a finding

Everything general has gone to `references/control-patterns.md`, in a new
**Navigation and dialogs** section: the two routes to opening a record, the
scheme allow-list for a URL that came out of a record, the three dialogs and the
cancel-resolves rule, confirm-then-destructive, and a Navigation row in the
canvas-versus-model-driven matrix.

What stays here is what is true of this control rather than of PCF — the table
layout, the two bugs the suite caught, the demo reasoning, and the list of what
a real environment still has to confirm.
