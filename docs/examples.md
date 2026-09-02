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
a user without the Delete privilege on the table gets the platform's error
dialog rather than a silent failure.

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
