---
title: Canvas apps
description: Two of the three commands, and why the third is missing.
order: 3
---

# Using it in a canvas app

**Open and Open link work. Delete is not offered, and cannot be.**

Deleting needs two things a canvas app does not have: `context.webAPI` to remove
the record, and the platform's confirmation dialog to ask first. Canvas has
neither. Rather than draw a button that fails when pressed, the control leaves
it out — so switching **Show the delete command** to **Yes** here changes
nothing you can see. See [Limitations](limitations.md).

:::steps
1. Switch on code components: **Settings → General → Code components**.
2. **Insert → Get more components → Code**, and import **Row Commands**.
3. Place it from **Insert → Code components**.
4. Set **Records** to a table — a Dataverse table, a collection, or a filtered
   view.
5. In the **Fields** flyout, choose the columns to show, and map **URL column**
   to one of them if you have addresses.
:::

## Wiring it up

```powerfx
// The dataset
RowCommands1.Records = Accounts
```

| Property | Value |
| --- | --- |
| Records | `Accounts` |
| URL column | the column holding the address, chosen in **Fields** |
| Hide the open command | `false` |
| Show the delete command | `false` — it does nothing here |
| Page size | `25` |

## Reading the output

Canvas is where the outputs earn their place: the platform calls behind the
commands do very little here, but the presses are still reported.

```powerfx
// OnChange
Notify(
    "Command " & RowCommands1.InvokedCommand &
    " on record " & RowCommands1.InvokedRecordId
)
```

| Output | What it holds |
| --- | --- |
| `InvokedRecordId` | The row whose command was pressed |
| `InvokedCommand` | `open`, `url` or `delete` |
| `InvokeCount` | How many presses there have been |

:::callout{type=info}
**`InvokeCount` is what makes a repeat visible.** `OnChange` fires when a value
changes, not when one is written, so pressing **Open** twice on the same row
writes the same two values twice and raises a single event. The counter changes
every time, which is what lets the second press run your formula.
:::

Because the outputs fire before the platform call, `OnChange` is the place to do
what canvas can do and the control cannot — `Launch()` a deep link of your own,
patch a record, or navigate to a screen:

```powerfx
// OnChange — open the record on a screen of your own
If(
    RowCommands1.InvokedCommand = "open",
    Navigate(DetailScreen, ScreenTransition.Cover,
        { SelectedId: RowCommands1.InvokedRecordId })
)
```

## Opening a record

**Open** calls the dataset's own `openDatasetItem` here, which a canvas app may
do nothing with. The output fires either way, so the formula above is the
reliable route — see [Model-driven apps](model-driven.md) for what the same
button does there.
