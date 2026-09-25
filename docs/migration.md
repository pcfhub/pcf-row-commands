---
title: Migrating to 0.2.0
description: What an upgrade from 0.1.x changes on its own, and what to do about it.
appliesTo: ">=0.2.0"
order: 9
---

# Migrating to 0.2.0

Nothing you configured changes meaning. Every 0.1.x setting reads the same, and
the two new ones — **Show row selection** and **Lock column widths** — arrive set
so that a form looks as it did. Two things change without being asked, and one
permission is new.

## What changed on its own

**Subgrids gain the command bar.** 0.2.0 turns on the subgrid's own command bar,
because it acts on the rows this control selects. The platform reads that from
the installed control, not from the form, so every subgrid carrying Row Commands
shows the bar as soon as 0.2.0 is imported — measured on a real form, with no
form published in between. A table's main grid already has the app's command bar
and does not change.

**Delete follows security roles.** A user whose roles allow no **Delete** on the
table no longer sees **Delete**. Before, they saw it and met the server's
refusal. Users who can delete see no difference.

**Column widths can be dragged.** Nothing moves until somebody drags an edge.
One difference is visible on a host much wider than the view's columns: the
command column no longer stretches along with the data columns, so the room goes
to the data.

## What to do

:::steps
1. **Expect the import to ask for *Utility*.** It is new, optional, and used only
   to ask whether the user's roles allow a delete. Declining it keeps 0.1.x's
   **Delete** behaviour.
2. **Look at each form with a Row Commands subgrid.** The command bar is now
   above it, and it cannot be switched off from the form. If a subgrid should
   not offer a ribbon command, hide that command for the table in the command
   designer.
3. **Turn on Show row selection** where you want **Delete selected**, or the
   command bar acting on ticked rows. It is off until you do.
4. **Lock column widths** on any view whose layout has to stay as designed.
:::

:::callout{type=info}
No data changes, and nothing needs migrating. Column widths live in each user's
browser, not in Dataverse.
:::
