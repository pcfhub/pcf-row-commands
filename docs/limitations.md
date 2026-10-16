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

- **A selection is the page on screen.** Turning a page, sorting, or changing
  the page size clears it, so **Select all** means the rows you can see and a
  delete or a command never reaches a row that scrolled away. To act on more than a page,
  raise **Page size** — up to the platform's 250.

- **Selected rows are changed one after another, not in one request.** Each
  record is its own delete or update, so **Stop** takes effect at the next
  record, and a record that fails — a cascade restriction, a plug-in's refusal,
  a record somebody else deleted — is named in the error dialog while the rest
  go ahead. It is slower than a batch past a few dozen rows, and deliberately so.

- **Your own commands write columns, call an action, or report a press.** A
  command does one of the three. It does not run a flow or open a page: call a
  Custom API whose plug-in starts the flow, or act on the press from a form
  script (model-driven) or a formula (canvas). Status and Status Reason cannot
  be set by a command: use **Show Activate and Deactivate**, which sends the
  pair together.

- **An action runs as the user, from the browser, with nothing around it.**
  It is the same call the platform's own pages make, so the user's roles apply
  and whatever the action changes is its plug-in's doing. Over a selection
  each row is its own call: there is no transaction across them, and a row
  that fails does not undo the rows before it.

- **A successful call is not proof anything changed.** A Custom API with no
  plug-in answers success and does nothing; so does one called on a row
  somebody deleted a moment earlier (measured). The view refreshes after every
  call, so what the action really did is what the rows then show.

- **An action's answer is shown only through `result`**, and only on a
  single row: one response property, as text. Anything else the action
  returns is not read.

- **The action's name is case-sensitive, and `bound` is not guessed.** Both
  are sent as written; a mismatch is a refusal from the server, shown with a
  reminder to check them.

- **Nothing asks first whether the user may run the action.** A Custom API's
  execute privilege is not something a control can read, so the button is
  offered and the server's refusal is shown.

- **A form script hears your commands through the outputs, not the event.**
  The control raises `onRowCommand`, but on a model-driven subgrid, when
  measured, a handler added with `addEventHandler` was never called. The
  outputs are what works: `addOnOutputChange` on the subgrid fires for every
  command, and `getOutputs()` says which. See [API reference](api.md). In a canvas
  app it is the other way round in speed: **onRowCommand** runs at the press,
  and the outputs arrive a moment later.

- **A command that only reports a press is not drawn on a main grid.** There
  is no form there and no script to listen, so the button would do nothing.
  Commands that write work on a main grid as anywhere else.

- **Commands that write or call an action, and Activate/Deactivate, are
  model-driven only.** Like Delete, they need the organisation's Web API, which
  a canvas app does not give a control. A canvas app gets the commands that
  only report a press, for `OnChange` — where Power Fx can call the action
  itself, through the `Environment` object.

- **In the form designer, the JSON fits only if it is short.** The modern form
  designer accepts at most 100 characters in a property, which is about one
  command. Put the JSON in a web resource (Script type — Dataverse has no JSON
  type) and type its name instead; publish the web resource after every edit,
  because the control reads the published copy.

- **Write follows roles for the table, not for each record**, as Delete does: a
  user whose roles allow no Write on the table at any depth gets no command that
  writes and no Activate/Deactivate; one whose roles allow Write on their own
  records sees the commands on every row and gets the server's refusal on
  someone else's.

- **Activate and Deactivate only on a table whose Status is exactly Active and
  Inactive.** A case's Status has Active, Resolved and Cancelled, and which of
  those "Deactivate" should mean is not something the control can guess; such
  tables get neither command. They also need the table's Status options, read
  through the *Utility* feature — a host without it gets neither.

- **Delete follows roles for the table, not for each record.** The control asks
  whether the user's security roles allow Delete on the table at any depth, and
  hides both **Delete** commands when they allow none. A user whose roles allow
  deleting only their own records still sees **Delete** on other people's rows,
  and gets the server's refusal there. Asking per record would cost a request
  per row.

- **Where the question cannot be asked, Delete is offered as before.** Checking
  roles needs the *Utility* feature, which the control declares as optional. A
  host that withholds it — or a canvas app, which has no delete anyway — gets
  0.1.x's behaviour.

- **Column widths are remembered per browser, not per user profile.** They live
  in the browser's own storage for this site, keyed by table and view. Another
  browser, another machine or a cleared cache starts from the view's widths. A
  browser that refuses storage — a private window, blocked site data — still
  resizes, for that visit.

- **The subgrid's command bar appears above the control.** Since 0.2.0 it is
  switched on, because it acts on the rows this control selects. It appears on
  every subgrid the control is on as soon as 0.2.0 is imported — no form change
  needed — and it cannot be turned off from the form. See
  [Migrating](migration.md). The view selector and quick find stay off.

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

- **The error dialog shows the reason in its message, and at most three.**
  The platform's error dialog draws only its message: *Show Details* reveals an
  error code and a session id, and anything more goes into the file its
  *Download Log File* saves (measured, and as Learn describes). So since 0.4.0
  the server's reason is added to the message — shortened to the sentence a
  person can act on, and for a selection the first three rows' — and the whole
  of it is in the log file. Before 0.4.0 the dialog said only *could not be
  deleted* or *could not be updated*, and the reason was in the file alone.
