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
six-row view into twelve rows of chrome. The column carries a real pixel width,
and the commands are right-aligned so the two-command case reads as a column
that ends at the table's edge rather than one with a hole in it.

That width lives in `index.ts` rather than the stylesheet, and moving it there
was the second half of the fix: the table's minimum width is the columns' own
widths plus this one, so a copy of the number in CSS is a copy that drifts the
first time somebody adjusts the padding.

**A sticky cell does not paint over a collapsed border.** The command column is
`position: sticky; right: 0` so it stays reachable while the data scrolls under
it, and with `border-collapse: collapse` a one-pixel strip of the column beneath
showed through its leading edge — a flicker of the wrong text down the join,
which reads as a rendering fault rather than as a CSS rule. Collapsed borders
are painted outside the cell's background box, so there is nothing to be opaque
there. `border-collapse: separate` with `border-spacing: 0` puts the geometry
back exactly, and nothing here depended on collapsing: every cell draws a
`border-bottom` and no two borders ever meet.

**`visualSizeFactor` was being ignored, and that is what "unreadable on a phone"
turned out to mean.** Under `table-layout: fixed` a table with no widths divides
its space equally, so the primary column — the one anybody actually reads — got
the same 74 pixels as a two-state status, and every value came out as an
ellipsis. The factor is what the person who built the view dragged the column
edges to; it is applied to the header row now, and the table's minimum width is
their sum plus the command column rather than a constant guessed here. Canvas
reports 0 for every column, so the factors are used only when at least one is
real — a table of zero-width columns is not a degraded layout, it is an
invisible one.

**A 20-pixel target fails WCAG 2.2.** A 16px glyph with 2px of padding is 20
high, and SC 2.5.8 asks for 24 at **AA** — not the 44 of 2.5.5 at AAA, which a
button inside a 44px row cannot have. The commands are 32 now, which clears the
requirement with room and is the same size in both modes, so the target does not
change when the label goes away. This shipped wrong in 0.1.0.

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

## What a real form showed

**0.1.0 went on a model-driven subgrid, and two things came back.**

The first is that the control loads, renders a bound view, and completes a
delete: a record was removed and the row went. That settles more than it looks
like — `openConfirmDialog` resolved, its `confirmed` flag was read correctly,
`webAPI.deleteRecord` succeeded against a real Dataverse, and the refresh
afterwards took the row off the screen. All four were read from the type
definitions and asserted only against `dev/host.js` until then.

The second is that **the live region looked like a stray sentence somebody had
left in the page.** It was `margin: 0` and a grey colour, so on a real form it
sat hard against the table header as an unstyled line of prose — not obviously
part of the control, and not obviously a report of anything. A message about a
record that was just deleted is a notification and has to look like one: a
surface, a border, an icon, and padding. It also stayed up forever, which is how
a status becomes furniture; a success or an information message now clears
itself after six seconds and a failure does not, because by then the platform's
error dialog has been dismissed and this line is the only remaining trace.

Neither of those is something the harness could have shown. The first needed a
Dataverse and the second needed somebody to look at it on a form.

**And a third, which was reported as a bug and was not one.** The top of the
view was a run of ten completely blank rows with working commands beside them.
Nothing had failed: they were real records with no Account Name, and a view
sorted ascending by name puts every unnamed record first. The control was
rendering exactly what it was given.

That is still worth fixing, because *correct* and *legible* are different
claims. A blank row is indistinguishable from a row that failed to render, and
this one has a Delete button on it. The primary cell now shows the same
`RowCommands_Untitled` string the commands and the confirmation dialog already
used, muted and italic so it reads as an absence rather than as a name somebody
typed. Only the primary column: an empty phone number is an empty phone number,
and a placeholder in every gap would be noise.

The fixture grew the case — `a09` has no name — because nothing in it had one
before, which is why twelve records' worth of edges missed the row shape that a
real view produced within a day.

## What the main grid showed

**A control replacing a view's own grid gets the whole grid area, and has to
live inside it.** On a subgrid nothing had ever constrained the height, so
nothing exposed that the control never asked for one: twenty-five rows rendered
twenty-five rows tall, ran past the bottom of the page, and took the pager with
them — and the pager is the only route to page two. `allocatedHeight` bounds the
container now, the rows scroll inside it, the header is sticky, and the pager
keeps its place. With no allocated height the control grows to its content
exactly as before, which is right for a form section.

**And the page size property was overriding a setting nobody asked it to
touch.** `dataset.paging.pageSize` is what the host is already retrieving with —
a user's own *Rows per page* personalisation on a main grid, the maker's setting
on a subgrid — and the property shipped with `default-value="25"`, so a maker who
never touched it still produced a control calling `setPageSize(25)` on every
host. It has no default now: unset, the control reads the platform's size and
asks for nothing; set, it overrides.

That distinction is only expressible because `Whole.None` reads back as
`number | null`. It is the same gap that forces the two boolean inputs to be
named around the problem — a `TwoOptions` has no null, so "the maker did not
choose" and "the maker chose false" are one value.

**And a defect in this repository rather than in the control: `README.md`
carried its whole body twice**, from the first commit, through four releases.
The script that filled in the authoring placeholders searched for a comment by a
string containing `\n`, the file had `\r\n`, `indexOf` returned `-1`, and
`slice(0, -1)` joined to a slice taken from a different comment's end —
overlapping, and repeating everything between. Nothing checks a README for
saying the same thing twice.

## The height a main grid does not give you

**`allocatedHeight` is always `-1` on a model-driven table main grid**, and on a
related-records grid. That is documented rather than discovered — the framework
docs say so outright, and say what to do instead: *"The code component must use
a CSS style to fill 100% of the available space."* A measured height is the
**subgrid** case, where the maker types a number into the control configuration.

0.1.4 got that exactly backwards. It bounded the control to the allocated height
and gated the entire scroll layout on having been given one — so on the host
that most needed it, the measurement never arrived, the class never applied, and
the rows ran off the bottom of the page precisely as they had before the fix.
Worse, the symptom was indistinguishable from an old build still being installed,
which is what it was mistaken for.

The layout is unconditional now and `height: 100%` does the work. It is safe on
every host: against a parent with a definite height it fills it, and against an
auto-height parent — a form section sizing itself around its contents — a
percentage height computes to `auto` and nothing changes. The inline pixel
height still wins where a subgrid supplied one.

**The general lesson is about which half of a pair the platform expects to
supply.** `allocatedWidth` is measured and `allocatedHeight` is not, on the same
host, for the same control, after the same `trackContainerResize(true)` — and
nothing in the type definitions distinguishes them, because both are `number`.
Promoted to the skill; see `references/control-patterns.md`.

## Not verified

Nothing in this repository has been on a real Power App **except what is
recorded above**. Every platform answer
comes from `dev/host.js`, which was written from the type definitions and the
reference. Four items are load-bearing:

- **That a cancelled `openConfirmDialog` really does resolve** with
  `{ confirmed: false }` rather than rejecting. Still open, and note what the
  form above did *not* show: that delete was confirmed, not cancelled, so the
  success path is proven and the cancel path is exactly as unproven as it was.
  It is the one that costs a record if it is wrong. Proving it: one press and
  one **Cancel**.
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
