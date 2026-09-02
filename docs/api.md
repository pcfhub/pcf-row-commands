---
title: API reference
description: Properties, roles and outputs, generated from the control manifest.
order: 5
---

# API reference

## Input properties

::props-table{kind=input}

:::callout{type=info}
**Two Yes/No properties, named opposite ways round, for the same reason.** A
Yes/No property has no way to default to Yes — a maker who never touches the
checkbox gets No — so a property whose sensible default is *on* has to be named
for the unusual choice. Hence **Hide the open command** rather than "Show" it.
**Show the delete command** should be off by default, so it reads correctly as
it stands.
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

**`Invoke count` is not redundant.** `OnChange` fires when a value changes, not
when one is written, so pressing the same command twice on the same row writes
the same values twice and raises one event. The counter is what makes the second
press visible.

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
| `visualSizeFactor` | The column's width, as the view designer set it. Canvas reports 0 for every column, and every column then gets the same default rather than none. |

## The commands column

One column is added at the end, past the view's own, holding up to three
buttons. Which of them appear is decided per row and per host:

| Command | Appears when |
| --- | --- |
| **Open** | **Hide the open command** is No. There is always a route to a record, so this one never degrades away. |
| **Open link** | A URL column is mapped, the host has `navigation.openUrl`, and *that row's* value is an `http` or `https` address. |
| **Delete** | **Show the delete command** is Yes **and** the host has both `webAPI.deleteRecord` and the platform's confirmation dialog. |

## What the control asks the platform for

| API | Used for | Declared as |
| --- | --- | --- |
| `navigation.openForm` | Open, preferred route | no feature needed |
| `dataset.openDatasetItem` | Open, fallback | no feature needed |
| `navigation.openUrl` | Open link | no feature needed |
| `navigation.openConfirmDialog` | Asking before a delete | no feature needed |
| `navigation.openErrorDialog` | Reporting a failed delete | no feature needed |
| `webAPI.deleteRecord` | The delete itself | `<uses-feature name="WebAPI" required="false" />` |

`required="false"` is deliberate. `true` on a host lacking the feature is
component load failure at runtime rather than a degraded button — the whole
control fails to appear.
