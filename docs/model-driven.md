---
title: Model-driven apps
description: Putting the command column on a subgrid, and mapping the URL column.
order: 4
---

# Using it on a model-driven form

**This is the host the control was built for, and the only one where all three
commands are available.** Delete needs `context.webAPI` to remove the record and
the platform's confirmation dialog to ask first, and this is the only host that
has both.

::image{src=media/screenshot-delete.png alt="A view of accounts with Open, Open link and Delete on every row" zoom}

:::steps
1. Open the form in the designer and select the subgrid — or open the table's
   **Views** and select the view you want to change.
2. On the **Controls** tab, choose **Add control** and pick **Row Commands**.
3. Tick **Web**, **Phone** and **Tablet** for the clients you want it on.
4. Map **URL column** to a column holding a web address, if you have one.
   Leave it unmapped and the **Open link** command does not appear.
5. Set **Show the delete command** to **Yes** if you want deleting.
6. Save and publish.
:::

## Mapping the URL column

The **URL column** slot accepts a `SingleLine.URL` column or a plain
`SingleLine.Text` one, because a web address lives in either depending on how
old the table is.

**The column has to be on the view.** A property-set role binds to a column the
view returns, so a column that is not in the view's column list has no value to
read — the role maps, and every row comes back empty.

## What the commands do here

| Command | What happens |
| --- | --- |
| **Open** | Opens the record's main form. The view refreshes when the form closes, so an edit made there shows up in the row. |
| **Open link** | Opens the address in a new browser tab. |
| **Delete** | Asks for confirmation in a platform dialog, then deletes. On failure it shows the platform's error dialog with the reason the server gave. |

Opening uses `navigation.openForm` rather than the dataset's own
`openDatasetItem`, for one reason: it returns a promise, so the control knows
when the form closed and can refresh. Where `openForm` is unavailable the
control falls back to `openDatasetItem`, which works but cannot refresh.

## Deleting

:::callout{type=warning}
**The confirmation cannot be turned off.** It is the only thing standing between
a delete button at the end of a row and a record nobody meant to remove, so
there is no property for it — and a host that cannot show a confirmation does
not get the delete command at all.
:::

Cancelling deletes nothing and reports nothing. The outputs move only when a
delete is actually attempted.

The user needs the **Delete** privilege on the table. Without it the server
refuses and the control shows the platform's error dialog — the button is drawn
from the host's capabilities, not from the user's privileges, which the control
cannot see.

## The subgrid's own chrome

The control does not turn on the command bar, the view selector or quick find.
The command bar acts on selection and this control never sets one; the view
selector would let a user switch to a view that does not carry the mapped URL
column, which would silently remove the **Open link** command.
