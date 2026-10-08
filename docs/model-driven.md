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
6. Set **Show row selection** to **Yes** if you want checkboxes, **Delete
   selected**, and the command bar acting on the ticked rows.
7. Leave **Lock column widths** at **No** to let users resize columns.
8. Save and publish.
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
| **Open** | Opens the record's main form, in place. Coming back to the page mounts the control again, so an edit made there shows up in the row. |
| **Open link** | Opens the address in a new browser tab. |
| **Delete** | Asks for confirmation in a platform dialog, then deletes. On failure it shows the platform's error dialog with the reason the server gave. |

Opening uses `navigation.openForm`, falling back to the dataset's own
`openDatasetItem` where `openForm` is unavailable. Measured on a real subgrid,
`openForm` resolves as the form opens — the navigation replaces the page — so
there is nothing for the control to wait for.

## Your own commands

Put the commands' JSON in a **Script (JScript)** web resource, publish it, and
type its name — `cr123_/rowcommands/claims.json` — in **Your commands**. The
form designer accepts at most 100 characters in a property, so inline JSON fits
only one short command. The control reads the published copy, on every form
load: edit, publish, reload the form. A name it cannot find, or JSON it cannot
read, is said in the line above the table, naming the problem.

A command that **writes** works on a form's subgrid and on a main grid; one that
only **reports a press** appears on a form's subgrid, where a form script can
read the outputs, and not on a main grid. See [API reference](api.md) for the
JSON and the form-script route.

## Activate and Deactivate

**Show Activate and Deactivate** adds one button per row — Deactivate on an
active row, Activate on an inactive one — and both to the selection bar. The
view does not need a Status column: the control asks for it, and does not draw
it. A view of active records loses a row on the refresh after Deactivate, which
is the point.

The app's own command bar also offers **Activate** and **Deactivate** for selected
rows, on a main grid and — since 0.2.0 turned it on — on a subgrid. This
control's are on each row, and its selection bar's skip the rows already in that
state and report on the outputs; use whichever a form needs.

## Deleting

:::callout{type=warning}
**The confirmation cannot be turned off.** It is the only thing standing between
a delete button at the end of a row and a record nobody meant to remove, so
there is no property for it — and a host that cannot show a confirmation does
not get the delete command at all.
:::

Cancelling deletes nothing and reports nothing. The outputs move only when a
delete is actually attempted.

Since 0.2.0 the control asks the user's security roles first: a user with no
**Delete** privilege on the table at any depth is not offered **Delete** at all.
A user who may delete only some records — their own, their business unit's —
still sees it everywhere, and the server's refusal is shown on a record outside
their reach. See [Limitations](limitations.md).

## Deleting several at once

With **Show row selection** on, tick the rows and press **Delete selected**. One
confirmation names the count; then the records are deleted one after another,
with the progress above the table and a **Stop** that takes effect at the next
record. The view refreshes once at the end. If any fail, the error dialog lists
each by name with the server's reason, and they stay ticked for a second try.

::image{src=media/screenshot.png alt="Two rows ticked, the bar reading 2 selected with Delete selected and Clear selection" zoom}

## Resizing columns

Drag the edge of a column heading, or tab to it and use ← and →. Home, or a
double-click on the edge, puts that column back to the view's width; **Reset
column widths** under the table puts them all back. The widths are remembered
for the user in this browser, for this view.

## The subgrid's own chrome

**Since 0.2.0 the subgrid's command bar appears above the control**, because
it acts on the rows the control selects: tick three rows and **Assign**, **Share**
or **Run flow** act on those three — measured on a real subgrid. It appears on
every subgrid carrying the control as soon as 0.2.0 is imported, with no change
to the form; see [Migrating](migration.md). A main grid already has the
app's command bar and is unchanged.

The view selector and quick find stay off. The view selector would let a user
switch to a view that does not carry the mapped URL column, which would silently
remove the **Open link** command, and a quick find is a filter the control
cannot see, so its pager would describe the wrong result set.
