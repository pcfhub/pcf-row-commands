---
title: Limitations
description: What Row Commands does not do, and why each of those is a decision.
order: 7
---

# Limitations

Each of these is a constraint that was chosen, not a defect waiting on a fix.

- **Delete is model-driven only.** It needs `context.webAPI` to remove the
  record and the platform's confirmation dialog to ask first, and a canvas app
  has neither. The control does not draw the button there. Showing one that
  fails on press would be worse, and faking the confirmation with an in-control
  one would leave the delete itself with nothing behind it. Use `Remove()` in
  canvas from the `OnChange` formula in [Canvas apps](canvas.md).

- **The confirmation cannot be switched off.** There is no property for it. A
  delete button at the end of a row, next to two harmless buttons, is pressed by
  accident sooner or later, and the dialog is the only thing in the way. This
  also means a host without the dialog gets no delete command at all.

- **Only `http` and `https` addresses are opened.** The URL comes off a bound
  column, so it is whatever anybody with write access to the record put there,
  and `openUrl` follows what it is given. The control uses an allow-list of two
  schemes rather than a block-list of the dangerous ones, because a block-list
  is only ever as long as its author's imagination. A row with anything else in
  that column gets no **Open link** button.

- **Relative paths are not opened either.** `/main.aspx?etn=account&…` is an
  ordinary thing to store and resolving it needs a base — the form's origin, the
  app's, the record's — that this control cannot honestly choose. Store the
  absolute URL, or handle it from `OnChange` in canvas.

- **One page at a time.** The pager turns pages; it does not scroll infinitely
  and does not load everything. Page size is a request rather than an
  instruction, and the platform's ceiling is 250.

- **No selection, and no bulk commands.** Every command acts on the row it is
  in. Deleting twenty rows is twenty presses and twenty confirmations. Bulk
  actions belong on the subgrid command bar, which already does them.

- **The buttons reflect the host, not the user's privileges.** The control can
  ask what APIs exist; it cannot ask whether this user may delete this record.
  A user without the Delete privilege sees the button and gets the platform's
  error dialog when the server refuses.

- **Below about 560 pixels the commands lose their labels.** The buttons stay,
  in the same order, at the same size, and each still names itself and its row
  to a screen reader — but visually there is only the icon. Under that width a
  labelled command column takes more than half a phone screen, and the choice is
  between icons and a table with nothing readable in it. The measurement is the
  control's own width, not the browser's, so a narrow form section on a desktop
  collapses too.

- **Wide views scroll sideways rather than squeezing.** The columns keep the
  widths the view designer gave them, and the command column stays pinned to the
  right edge while the rest scrolls under it. That is deliberate: columns
  squeezed to forty pixels each are an ellipsis in every cell, which reads as a
  table that fits when nothing in it can be read.

- **On a host that allocates a height — replacing a view's own grid — the rows
  scroll inside it.** The column headers stay put and the pager stays at the
  bottom, because the pager is the only route to page two and it is what runs
  off the screen otherwise. Where the host allocates no height, such as a form
  section that sizes itself around its contents, the control grows to fit its
  rows instead.

- **Not supported on Power Pages.**
