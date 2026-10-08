---
title: Examples
description: Configurations worth copying, and the formulas behind them.
order: 6
---

# Examples

## A subgrid with links out

The common case. A view of accounts, each with a website, and one press to get
there.

| Setting | Value |
| --- | --- |
| URL column | `websiteurl` |
| Hide the open command | No |
| Show the delete command | No |
| Page size | 25 |

Nothing else to do. Rows whose `websiteurl` is empty get no **Open link**
button, so the column is not full of buttons that go nowhere.

## Links only

A reference list nobody needs to open — vendors, suppliers, documentation links.
Switch the open command off and the row carries exactly one button.

| Setting | Value |
| --- | --- |
| URL column | the address column |
| Hide the open command | **Yes** |
| Show the delete command | No |

## A staging table people clear out

A holding table for imported rows, where deleting the bad ones is the point.

| Setting | Value |
| --- | --- |
| URL column | *unmapped* |
| Hide the open command | No |
| Show the delete command | **Yes** |
| Page size | 50 |

Model-driven only — see [Canvas apps](canvas.md). Every delete asks first, and
a user whose roles allow no Delete on the table is not offered it.

## Clearing out many at once

The same staging table, where the bad rows come in dozens. Tick them, press
**Delete selected**, confirm once.

| Setting | Value |
| --- | --- |
| Show the delete command | **Yes** |
| Show row selection | **Yes** |
| Page size | 100 |

The page size matters here: a selection is the page on screen, so the page is
the most one confirmation can reach. The command bar that appears above the
subgrid acts on the same ticks — **Assign** a batch to a colleague instead of
deleting it.

## A wide view people read

Nine columns and a long account name. Leave **Lock column widths** at No, and
each user can widen what they read and narrow what they do not; the next visit
remembers. Lock it for a view whose layout is part of a process — a view
printed or screenshotted into a procedure — so everyone sees the same thing.

## Reacting to a command in canvas

The outputs fire before the platform call, so canvas can do the thing the
control cannot.

```powerfx
// RowCommands1.OnChange
Switch(
    RowCommands1.InvokedCommand,
    "open",
        Navigate(DetailScreen, ScreenTransition.Cover,
            { SelectedId: RowCommands1.InvokedRecordId }),
    "url",
        Notify("Opening the link…", NotificationType.Information)
)
```

## Approve from the row

A subgrid of expense claims where a manager approves or sends back, without
opening each one. Create a web resource of type **Script (JScript)** named, say,
`cr123_/rowcommands/claims.json` — Dataverse has no JSON type, and the control
reads it as JSON whatever the type says — publish it, and type its name in
**Your commands**:

```json
{
  "commands": [
    { "name": "approve", "label": "Approve", "icon": "check",
      "set": { "cr123_status": 100000001 }, "selection": true },
    { "name": "sendBack", "label": "Send back", "icon": "dismiss",
      "set": { "cr123_status": 100000002 }, "confirm": "Send {0} back to its owner?" }
  ]
}
```

An approved claim no longer offers **Approve**, because it already holds that
value. Tick several and **Approve** runs over them one by one, with a Stop. A
flow triggered on *When a row is modified* for `cr123_status` does whatever
approving means beyond the column.

## Escalate to a form script

A command with no `set` writes nothing and reports the press. The form's script
reads it from the subgrid's outputs:

```json
{ "commands": [ { "name": "escalate", "label": "Escalate", "icon": "flag", "selection": true } ] }
```

```js
// On Load of the parent form
function onLoad(executionContext) {
    const formContext = executionContext.getFormContext();
    const grid = formContext.getControl("Claims");
    grid.addOnOutputChange(() => {
        const out = grid.getOutputs();
        if (out["Claims.invokedCommand"]?.value?.startsWith("escalate")) {
            const ids = out["Claims.invokedRecordId"].value.split(",");
            Xrm.Navigation.openAlertDialog({ text: `Escalating ${ids.length} claim(s).` });
        }
    });
}
```

## Deactivating old accounts in bulk

**Show Activate and Deactivate** and **Show row selection** on, on a view of
accounts with no activity this year: tick the rows, **Deactivate selected**, one
confirmation, and each is deactivated with its default reason. Rows already
inactive are skipped rather than written again.

## Counting presses

`InvokeCount` changes on every press, which is what makes a repeat visible to
`OnChange`:

```powerfx
// RowCommands1.OnChange
Collect(
    CommandLog,
    {
        Sequence: RowCommands1.InvokeCount,
        Command: RowCommands1.InvokedCommand,
        Record: RowCommands1.InvokedRecordId,
        At: Now()
    }
)
```

Without the counter, two identical presses in a row would log once.

## A URL the control will not open

Nothing to configure — it is worth knowing it happens. The address comes off a
record, so it is whatever somebody with write access typed. The control opens
`http` and `https` and nothing else, so a row whose column holds
`javascript:…`, `data:…`, an `ftp:` address or a relative path like
`/main.aspx?…` simply has no **Open link** button.

If your addresses are relative and you want them followed, store the absolute
URL, or handle it in canvas from `OnChange` with `Launch()` and a base you
choose.
