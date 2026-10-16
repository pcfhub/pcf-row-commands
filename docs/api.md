---
title: API reference
description: Properties, roles and outputs, generated from the control manifest.
order: 5
---

# API reference

## Input properties

::props-table{kind=input}

:::callout{type=info}
**Page size is empty by default and should usually stay that way.** The platform
already has one — the user's own *Rows per page* on a main grid, the maker's
setting on a subgrid — and the control reads it rather than replacing it. Fill
this in only to override that.
:::

:::callout{type=info}
**Two Yes/No properties, named opposite ways round, for the same reason.** A
Yes/No property has no way to default to Yes — a maker who never touches the
checkbox gets No — so a property whose sensible default is *on* has to be named
for the unusual choice. Hence **Hide the open command** rather than "Show" it.
**Show the delete command** should be off by default, so it reads correctly as
it stands. The same rule names the two added in 0.2.0: **Show row selection**
is off until asked for, and **Lock column widths** is off so that resizing is on.
:::

## Dataset

::props-table{kind=dataset}

## Dataset columns

::props-table{kind=dataset_column}

The **URL column** is optional and it is the switch for the whole **Open link**
command: unmapped, that button never appears. It accepts a `SingleLine.URL`
column or a plain `SingleLine.Text` one, because a web address lives in either
depending on how old the table is.

**The column must be on the view.** A role binds to a column the view returns,
so one that is not in the view's column list has nothing to read and every row
comes back empty.

## Outputs

::props-table{kind=output}

All three are written **before** the platform call, so a press is observable on
a host where the call itself does nothing — which is the canvas case.

**Since 0.2.0, `Invoked command` can also be `deleteSelected`**, and then
`Invoked record id` holds every selected id, comma-separated, in the order the
rows were on the page. It is written after the confirmation, never on a cancel.

**`Invoke count` is not redundant.** `OnChange` fires when a value changes, not
when one is written, so pressing the same command twice on the same row writes
the same values twice and raises one event. The counter is what makes the second
press visible.

**Since 0.3.0, `Invoked command` can also be** `activate`, `deactivate`, the
`name` of one of your commands, or any of those with `Selected` after it
(`approveSelected`), with `Invoked record id` listing the rows, comma-separated.
A command that **writes** reports **after** the write succeeds — a form script
reading the outputs reads a row that has already changed — and a refused write
reports nothing. Over a selection, the ids are the rows it succeeded on. A
command that only reports a press reports at the press.

## Your commands

The **Your commands** property takes either the JSON below, or the name of a
web resource holding it (anything that does not start with `{` or `[` is read
as a name). In the model-driven form designer, use a web resource: the designer
accepts at most 100 characters in a property.

```json
{
  "commands": [
    { "name": "approve", "label": "Approve", "icon": "check",
      "set": { "cr123_approval": 100000001 },
      "confirm": "Approve {0}?", "selection": true },
    { "name": "escalate", "label": { "1033": "Escalate", "1036": "Escalader" },
      "icon": "flag" },
    { "name": "notify", "label": "Notify owner", "icon": "send",
      "action": "cr123_NotifyOwner", "bound": true,
      "parameters": { "Reason": "Raised from row {id}" },
      "result": "Message", "confirm": "Notify the owner of {0}?" }
  ]
}
```

| Key | Required | What it does |
| --- | --- | --- |
| `name` | yes | What `Invoked command` reports. Starts with a lower-case letter; letters and digits only. Not `open`, `url`, `delete`, `activate` or `deactivate`, and not ending in `Selected`. |
| `label` | yes | The button's text: a string, or an object of language codes (LCID) to text — the user's language, then English (1033), then the first one given. Up to 60 characters. |
| `icon` | no | `run` (the default), `check`, `dismiss`, `flag`, `send`, `star`, `warning` or `archive`. |
| `set` | no | Columns to write on the row, by logical name, with text, numbers, `true`, `false` or `null`. A choice is its number; a lookup is `"<navigation>@odata.bind": "/accounts(<id>)"`. |
| `action` | no | Since 0.4.0: a Web API action to call on the row — a Custom API's unique name, or a platform message such as `QualifyLead`. **Spelled exactly**: the name is case-sensitive. Not with `set`. |
| `bound` | with `action` | `true` when the action is bound to this view's table — it is called on the row, `<set>(<id>)/Microsoft.Dynamics.CRM.<action>` — or `false` for an unbound one, called by name. Required: a guess is a 404. |
| `parameters` | no | The action's parameters, by unique name, sent as written. In any text, `{id}` becomes the row's id; a value that is exactly `"{record}"` becomes the row itself, as an entity reference. |
| `result` | no | One of the action's response properties, whose value is said after the call on one row. |
| `confirm` | no | A sentence to confirm with before writing or calling; `{0}` is the row's name. |
| `selection` | no | `true` to offer the command in the bar over a selection too. |

Without `set` or `action`, a command writes nothing and only reports the press.

At most six commands. A mistake — an unknown key, a misspelt one, a name used
twice, `statecode` in `set`, `action` without `bound`, `{record}` inside other
text — is reported by name in the line above the table, and the control's own
commands carry on.

**Where each command appears.** A command that writes needs a model-driven app
and a user whose roles allow Write on the table; it is left off a row that
already holds every value it would write. A command that calls an action needs
a model-driven app and is on every row, a main grid's included — nothing on a
row says it already ran. A command that only reports a press appears on a form
and in a canvas app, where something can hear it, and not on a main grid, where
nothing can.

## Commands that call an action

The call is a `POST` to the organisation's Web API from the browser, as the
signed-in user, the way the platform's own pages call it — no connection, no
flow, no premium licence. For a **bound** action the row is the action's
target; for an **unbound** one, pass the row in `parameters`:

| In `parameters` | Is sent as |
| --- | --- |
| `"{id}"` | `"5a3c…e0f1"` — the row's id, as text; also inside longer text, `"/accounts({id})"` |
| `"{record}"` | `{ "@odata.type": "Microsoft.Dynamics.CRM.account", "accountid": "5a3c…e0f1" }` — the row as an entity reference, for an `EntityReference` parameter |

Anything else is sent as written: numbers, `true`/`false`, `null`, objects and
arrays. Once the call succeeds the command reports on the outputs (after the
call, so a form script reacting to them sees what it did), the `result`
property — if you named one and the action returned it — is shown in the line
above the table, and the view refreshes once, so whatever the action changed
shows up.

**When the server refuses.** The error dialog and the line above the table say
the server's own words, shortened — in the dialog's message, because the
platform's dialog shows nothing else; the full text goes into its *Download
Log File*: for a bad parameter, the sentence that says which (*Cannot convert
the literal 'x' to the expected type 'Edm.Guid'.*); for a refusal the action
raises itself — a plug-in's message, or the platform's (*Entity 'systemuser'
With Id = … Does Not Exist*) — the message as it came. When the action's own
name is what the server could not find, the dialog adds a reminder to check
the name and `bound`: a name spelled `cr123_notifyowner` instead of
`cr123_NotifyOwner` is a different name to the Web API.

**Over a selection** the action is called on each selected row one after
another, after one confirmation naming how many; **Stop** takes effect at the
next row; a row the server refuses is named in the error dialog while the rest
go ahead; the outputs carry `<name>Selected` and only the rows it ran on. The
`result` is not shown for a selection.

## Activate and Deactivate

**Show Activate and Deactivate** puts Deactivate on each active row and
Activate on each inactive one, and both in the bar over a selection. The control
reads each row's Status — asking the dataset for it if the view does not show
it — and writes the state with that state's default Status Reason in one
update. Only on a table whose Status is exactly Active and Inactive, in a
model-driven app, for a user whose roles allow Write.

## Reacting from a form script

**Use the outputs.** On the subgrid's control, `addOnOutputChange` fires every
time a command runs, and `getOutputs()` says which and on what:

```js
function onLoad(executionContext) {
    const formContext = executionContext.getFormContext();
    const grid = formContext.getControl("Accounts"); // the subgrid's name
    grid.addOnOutputChange(() => {
        const outputs = grid.getOutputs();
        const command = outputs[`${grid.getName()}.invokedCommand`]?.value;
        const ids = (outputs[`${grid.getName()}.invokedRecordId`]?.value ?? "").split(",");
        if (command === "escalate") {
            // ...the rows in ids
        }
    });
}
```

The control also raises a custom event, **`onRowCommand`**, with `{ command,
recordIds, entityName, refresh }` — but on a model-driven subgrid, when
measured, a handler added with `addEventHandler("onRowCommand", …)` was never
called. It is declared and raised for a host that delivers it, and **a canvas app
does**: there it is the control's **onRowCommand** behaviour property, and it
ran at every press when measured — see [Canvas apps](canvas.md).

## Columns

The other columns are the view's.

Apart from the URL role, this control renders whatever `dataset.columns`
reports — the columns the maker put in the view, in the view's own `order` —
and skips the ones marked hidden. There is nothing to configure per column.

| Metadata | Effect |
| --- | --- |
| `isPrimary` | Its value names the row: it goes in each command's tooltip and in the confirmation the delete asks for. Falls back to the first visible column. A record whose primary value is empty shows a muted placeholder in that cell rather than a blank one, so it reads as a record with no name rather than as a row that failed to render. |
| `disableSorting` | No sort control on that column, and no `aria-sort`. |
| `isHidden` | The column is not drawn. |
| `visualSizeFactor` | The column's width in pixels, as the view designer set it — measured on a real subgrid, where every column drew at exactly its factor. On a host wider than the columns, they share the extra room in proportion, and keep those widths while another column is dragged. A user's own dragged width replaces it for them. Canvas reports 0 for every column, and every column then gets the same default rather than none. |

## The commands column

One column is added at the end, past the view's own, holding up to three
buttons. Which of them appear is decided per row and per host:

| Command | Appears when |
| --- | --- |
| **Open** | **Hide the open command** is No. There is always a route to a record, so this one never degrades away. |
| **Open link** | A URL column is mapped, the host has `navigation.openUrl`, and *that row's* value is an `http` or `https` address. |
| **Delete** | **Show the delete command** is Yes, the host has both `webAPI.deleteRecord` and the platform's confirmation dialog, **and** the user's roles allow Delete on the table at some depth. |

## Selection

With **Show row selection** on, a checkbox column comes first and a bar appears
over the table while anything is selected: the count, **Delete selected** (under
exactly the conditions the row's **Delete** has), and **Clear selection**.

- The selection is **the page on screen**. Turning a page, sorting or changing
  the page size clears it, and a selected row that disappears — deleted from the
  command bar, say — drops out of it.
- Every change is handed to the platform with `setSelectedRecordIds`, which is
  what the subgrid's command bar acts on.
- **One selected row** is deleted the row's own way, with the row's own
  confirmation.

## Column widths

Each data column's header has a resize handle on its trailing edge — a
separator a screen reader announces with its width.

| Action | Effect |
| --- | --- |
| Drag the edge | The column follows the pointer, 64 to 800 pixels. |
| Focus it, then ← / → | 16 pixels narrower or wider; with Shift, 64. |
| Home, or double-click the edge | That column back to the view's width. |
| **Reset column widths** in the pager | Every column back. Shown only while something is resized. |

Resizing one column moves no other data column: narrow one and the room it
frees goes to the command column, whose buttons stay right-aligned; widen one
and the table scrolls. So the edge you are dragging stays under the pointer.

Widths are stored in the browser's `localStorage`, keyed by table and view, and
read back on the next visit. Where the browser refuses storage the resize still
works, for that visit. **Lock column widths** removes the handles and draws the
view's widths whatever was stored.

## What the control asks the platform for

| API | Used for | Declared as |
| --- | --- | --- |
| `navigation.openForm` | Open, preferred route | no feature needed |
| `dataset.openDatasetItem` | Open, fallback | no feature needed |
| `navigation.openUrl` | Open link | no feature needed |
| `navigation.openConfirmDialog` | Asking before a delete | no feature needed |
| `navigation.openErrorDialog` | Reporting a failed delete | no feature needed |
| `webAPI.deleteRecord` | Both deletes | `<uses-feature name="WebAPI" required="false" />` |
| `utils.hasEntityPrivilege` | Whether to offer Delete | `<uses-feature name="Utility" required="false" />` |
| `dataset.setSelectedRecordIds` | Handing the selection to the command bar | no feature needed |
| `dataset.getViewId` | Which view's widths to read | no feature needed |
| `utils.getEntityMetadata` | How a row is addressed for an action: the table's entity set and id column | `<uses-feature name="Utility" required="false" />`, already declared |
| A same-origin `POST` to `/api/data/v9.2/` | Calling an action — `context.webAPI` has no way to | no feature needed; the session is the credential |

`hasEntityPrivilege` is published whether or not `Utility` is declared, and
throws when it is not — measured on a real form. So it is declared, and a host
that withholds it keeps the 0.1.x behaviour: **Delete** offered, and the server's
refusal shown if the user may not.

`required="false"` is deliberate. `true` on a host lacking the feature is
component load failure at runtime rather than a degraded button — the whole
control fails to appear.
