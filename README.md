# Row Commands

Open a record, launch a URL, or delete it with a confirm, from the row itself.

[![Build](https://github.com/pcfhub/pcf-row-commands/actions/workflows/build.yml/badge.svg)](https://github.com/pcfhub/pcf-row-commands/actions/workflows/build.yml)
[![Release](https://github.com/pcfhub/pcf-row-commands/actions/workflows/release.yml/badge.svg)](https://github.com/pcfhub/pcf-row-commands/actions/workflows/release.yml)

Documentation lives on [PCFHub](https://pcfhub.dev/components/pcf-row-commands), built
from the `docs/` directory in this repository. Edit the Markdown here; the hub
recompiles it.



## What it does

A view, with a command column on the end of every row: **Open**, **Open
link**, and — where the host allows it — **Delete**.

A model-driven subgrid already opens a record when you click it, so the open
command is the least of it. The two that are not built in are the other two. A
subgrid cannot launch the address held in a column without a maker writing a
ribbon button, and it cannot delete a row without the command bar, which brings
the rest of the command bar with it. This is the small version: three buttons,
per row, that a maker turns on with two checkboxes and one column mapping.

**Every command hides rather than fails.** That is the design decision worth
knowing before the first bug report. `context.navigation` and `context.webAPI`
are not present on every host and do not go missing together — canvas has no
Web API at all, and the platform dialogs are a model-driven affordance — so the
control asks what the host can actually do and draws only those buttons. On a
canvas screen you get two commands and no Delete, and that is the finished
behaviour rather than a degraded one. A button that throws when pressed would
be worse in every way that matters.

**The URL is treated as untrusted, because it is data.** The address comes off a
bound column that anybody with write access to the record can set, and
`navigation.openUrl` will follow whatever it is handed. The control accepts
`http` and `https` and nothing else — an allow-list rather than a block-list of
the schemes somebody thought of — so a `javascript:` or `data:` value produces
no button at all. Relative paths are refused too, which is a real cost: there is
no base this control can honestly resolve them against.

**Delete always asks first, and cannot be configured not to.** The confirmation
is `navigation.openConfirmDialog`, and a host without it does not get the delete
command — the confirmation is the safeguard, so a host that cannot show one has
no business deleting. A cancelled confirmation is not an error and is not
reported through the outputs: nothing happened.



## Properties

One dataset with one optional column role:

| Role | Manifest name | Type | Usage | What it is |
| --- | --- | --- | --- | --- |
| URL column | `urlField` | SingleLine.URL | SingleLine.Text | bound, optional | The address the **Open link** command follows. Unmapped, that command does not appear. |

The type group exists because a URL lives in a `SingleLine.URL` column on a
table designed for one and in a plain text column on every table that grew one
later, and restricting to the wrong one does not fail — it empties the column
picker in the configuration pane, which reads as a broken control.

| Property | Type | Usage | Default | What it controls |
| --- | --- | --- | --- | --- |
| `hideOpen` | TwoOptions | input | `false` | Removes the **Open** command from every row |
| `showDelete` | TwoOptions | input | `false` | Adds the **Delete** command, where the host supports it |
| `pageSize` | Whole.None | input | *the host's own* | Rows requested per page; clamped to 1–250. Unset, the control adopts the page size the app or the user already chose |
| `invokedRecordId` | SingleLine.Text | output | — | The row whose command was pressed most recently |
| `invokedCommand` | SingleLine.Text | output | — | `open`, `url` or `delete` |
| `invokeCount` | Whole.None | output | — | Presses so far — see below |

**`hideOpen` is inverted and `showDelete` is not, and that is one rule read two
ways.** `refreshTypes` generates `TwoOptionsProperty` with `raw: boolean` rather
than `boolean | null`, so a maker who never touches a checkbox gets `false` and
`default-value="true"` does not close the gap. Open should be on by default, so
the property is named for the unusual choice. Delete should be off by default,
so `showDelete` reads correctly as it stands.

**`pageSize` has no default, and that is the point.** `dataset.paging.pageSize`
is the size the platform is already retrieving with — the user's own *Rows per
page* on a main grid, the maker's setting on a subgrid. A `default-value` here
would arrive as a real number from somebody who never touched the property, and
the control would call `setPageSize` with it, silently replacing a setting
somebody had deliberately chosen. Left empty it asks for nothing.

**`invokeCount` is the one that looks redundant.** `OnChange` fires on a change,
not on a write, so pressing **Open** twice on the same row sets the same two
values twice and raises one event. The counter is what makes a repeat
observable, and it is the only reason a canvas app can react to the second
press.

Five languages ship: English (1033), German (1031), French (1036), Japanese
(1041) and Spanish (3082). The control bundles no framework — it is a
`standard` control and reads Fluent's design tokens through `var()`.

One permission is requested at install: `<uses-feature name="WebAPI"
required="false" />`, for the delete. `required="false"` is load-bearing —
`true` on a host lacking the feature is component load failure at runtime rather
than a degraded button. Nothing else is declared; `navigation` needs no feature
declaration and neither does `openDatasetItem`.



## On the hub

`demo.fidelity` is **`limited`**, and three separate things put it there — any
one of them alone would have been enough.

The commands are the control, and two of the three cannot run in a sandbox.
Opening a record needs a Dataverse to open it in. Delete needs `context.webAPI`
to remove the row and `openConfirmDialog` to ask first, and the demo harness has
neither — so the button is not drawn there, exactly as it is not drawn in a
canvas app. The third reason is the one every dataset control on the hub shares:
the harness seeds a single page and reports no next or previous page, so the
pager is inert and the page-size property has nothing to demonstrate.

What *is* real there is which commands each row offers and why. The address is
read from the bound column and checked before a button appears, so the record
with no website has no link button — that is the control's actual logic running,
not a rendering of it.

Four presets: the shipped defaults, a links-only configuration, a shorter page,
and one that switches `showDelete` on and visibly changes nothing. The last is
there deliberately — a preset that demonstrates the degradation is worth more
than one that hides it.



## Install

Download the managed solution from the
[latest release](https://github.com/pcfhub/pcf-row-commands/releases/latest), or from
the component's page on the hub, and import it into your environment.

## Develop

```bash
npm install
npm start          # the PCF test harness
npm run build
npm run lint
npm run check      # what CI runs first: placeholders, pcfhub.json, control shape
npm run smoke      # assertions against the built bundle — see dev/
npm run harness    # serves dev/harness.html and opens it
```

`npm start` renders the control; `dev/` is for the states it cannot reach. Build
first, then `npm run smoke` for the assertions, or `npm run harness` for the
switches — field-level security, a failed business rule, a host that publishes
no theme or no column metadata, and for a dataset control, more than one page.
Both read the bundle `npm run build` wrote, and both are described in the header
of `dev/smoke.js`.

`npm run harness` serves the repository over `http://` rather than leaving you to
open the file: over `file://` a dataset fixture cannot be fetched and a module
script is refused, and both arrive as an empty control with a CORS error. It
takes `--port` and `--no-open`, and needs no dependency — `dev/serve.js` is
`node:http`. A React (virtual) control has no harness page, and the script says
so rather than serving a 404.

Run `npm run refreshTypes` after every manifest edit — until you do,
`context.parameters` is typed from the old manifest and `tsc` will accept code that
cannot work.

To pack the solution locally you need msbuild — either Visual Studio or the
Visual Studio Build Tools:

```bash
cd Solution
msbuild /t:build /restore /p:configuration=Release
```

Both zips land in `Solution/bin/Release`. This is the only local step that compiles
in **production** mode, so a green `npm run build` is not evidence the shipping
bundle compiles — and the pack is incremental, so delete `obj/`, `out/`,
`Solution/obj/` and `Solution/bin/` first if you intend to quote a bundle size from
it.

## Release

1. Bump the version in **three** places, in one commit — they are checked
   against each other in CI:
   - `RowCommands/ControlManifest.Input.xml` → `<control version="…">`
   - `Solution/src/Other/Solution.xml` → `<Version>`
   - `package.json` → `"version"`
2. Tag it: `git tag v1.2.3 && git push --tags`

The release workflow builds, packs both solution types, and attaches them to a
GitHub Release. PCFHub picks the release up from its webhook within seconds, or
from the hourly sweep otherwise. A sync imports a draft; a person publishes it.

## Repository layout

| Path | What it is |
| --- | --- |
| `RowCommands/` | The control: manifest, entry point, CSS, localised strings |
| `Solution/` | The Dataverse solution that packages it |
| `dev/` | A stand-in host: `npm run smoke` asserts, `harness.html` shows |
| `SPEC.md` | What building this corrected, and what is verified versus read |
| `docs/` | The pages PCFHub publishes — see the comments in each file |
| `media/` | Images and video referenced from the docs |
| `pcfhub.json` | The hub's manifest: identity, links, docs path, demo |
| `scripts/` | Template setup and the CI guard that keeps it adopted |

## Licence

[MIT](LICENSE)
