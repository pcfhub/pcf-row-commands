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

On a model-driven form, yes. The control opens the form with
`navigation.openForm`, which reports when the form closes, and refreshes then.
Where that method is unavailable it falls back to the dataset's own open, which
gives no completion signal — so there is nothing to refresh on.

## Where does the delete confirmation's wording come from?

The control's own string table, in all five shipped languages: English, German,
French, Japanese and Spanish. The record's name in the message is the value of
the view's primary column.

## What permission does it ask for at install?

One: **WebAPI**, declared optional, and used only by the delete. Nothing else is
declared — opening a record, opening a URL and the dialogs need no feature
declaration at all.
