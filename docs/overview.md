---
title: Overview
description: A command column on a view — open the record, launch its link, delete it with a confirm.
order: 1
---

# Row Commands

Open a record, launch a URL, or delete it with a confirm, from the row itself.

::image{src=media/screenshot.png alt="A view of accounts with an Open and an Open link button on each row" zoom}

## Why this one

A model-driven subgrid already opens a record when you click it. The other two
commands are the ones you cannot have without work: launching the address held
in a column needs a ribbon button, and deleting a row needs the command bar,
which brings the rest of the command bar with it.

This is the small version. Three buttons at the end of every row, turned on with
two checkboxes and one column mapping, and no ribbon customisation anywhere.

- **Open** goes to the record's form.
- **Open link** follows an address held in a column you map. It appears only on
  rows where that column holds an address the control is willing to open.
- **Delete** asks for confirmation, then deletes. It is off by default, and it
  is offered only where the host can do both halves.

## Commands hide rather than fail

Worth knowing before the first surprise: **a command that the host cannot
perform is not drawn.** The APIs behind these three are not present everywhere
and do not go missing together — a canvas app has no Web API at all, and the
platform's confirmation dialog is a model-driven affordance — so the control
asks what the host can actually do and renders only those buttons.

A canvas screen shows two commands and no **Delete**, and that is the finished
behaviour rather than a broken one. See [Limitations](limitations.md).

## What it works with

:::callout{type=info}
**Model-driven apps get all three commands.** Canvas apps and custom pages get
**Open** and **Open link**; **Delete** is not available there, because canvas
has no `context.webAPI` to delete through and no platform dialog to confirm
with. Power Pages is not supported.
:::

The control binds a dataset — a view, a subgrid, or a canvas table — and reads
whatever columns it is given. It bundles no framework and requests one
permission at install, for the delete.
