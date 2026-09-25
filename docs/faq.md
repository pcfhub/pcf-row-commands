---
title: FAQ
description: The questions this control actually gets asked.
order: 8
---

# FAQ

## Why is there no Delete button?

Three possibilities, in the order they are worth checking:

1. **Show the delete command** is No. It is off by default, deliberately.
2. You are in a canvas app or a custom page. Delete is model-driven only —
   see [Canvas apps](canvas.md).
3. The control could not find both `webAPI.deleteRecord` and the platform's
   confirmation dialog on this host. It draws the button only when it can do the
   whole operation, confirmation included.
4. Your security roles allow no **Delete** on this table. Since 0.2.0 the
   control asks, and does not offer a command the server would refuse.

## Why is there no Open link on some rows?

Because that row's URL column is empty, or holds something the control will not
open. Only `http` and `https` addresses are opened; a relative path, a
`javascript:` or `data:` value, or an `ftp:` address gets no button. That is
deliberate — see [Limitations](limitations.md).

If *no* row has the button, the URL column is probably not mapped, or the column
you mapped is not on the view.

## Can I turn off the delete confirmation?

No, and there is no plan to add it. The confirmation is the safeguard for a
destructive command sitting at the end of a table row.

## Can I add my own commands?

Not in this control. It does three things, and each exists because it needed a
platform API a maker cannot reach from a formula. Anything you *can* do from a
formula is better done in canvas from the `OnChange` output — see
[Examples](examples.md).

## Why does pressing Open twice only fire OnChange once?

It does not, if you read `InvokeCount`. `OnChange` fires when a value changes,
and two presses on the same row write the same record id and the same command
name. The counter changes every time, which is what makes the repeat visible.

## Does the view refresh after I edit a record I opened?

On a model-driven form, yes, though not for the reason earlier versions of this
page gave. The form opens in place of the page, and coming back mounts the
control again with fresh rows. `navigation.openForm` was measured resolving as
the form opens, not as it closes.

## Why did a command bar appear above my subgrid?

Because of 0.2.0. The command bar acts on the rows this control selects, so it
is switched on — and the platform reads that from the installed control, not
from the form, so it appeared on every subgrid when 0.2.0 was imported. See
[Migrating to 0.2.0](migration.md).

## Why did my ticks disappear when I turned the page?

A selection is the rows on screen. Turning a page, sorting or changing the page
size clears it, so a delete can never reach a row you are not looking at. Raise
**Page size** to select more at once.

## My column widths are gone on another computer.

They are kept by the browser, for this site, per view — not in your Dataverse
profile. Another browser, another machine, or clearing site data starts from the
view's own widths.

## Where does the delete confirmation's wording come from?

The control's own string table, in all five shipped languages: English, German,
French, Japanese and Spanish. The record's name in the message is the value of
the view's primary column.

## What permission does it ask for at install?

Two, both declared optional. **WebAPI**, used only by the deletes, and since
0.2.0 **Utility**, used only to ask whether the user's roles allow a delete —
the platform refuses that question from a control that has not declared it.
Opening a record, opening a URL, the dialogs, the selection and the column
widths need no feature declaration at all.
