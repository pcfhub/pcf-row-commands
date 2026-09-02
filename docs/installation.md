---
title: Installation
description: Importing the solution and adding the control to an app.
order: 2
---

# Installation

:::steps
1. Download `PCFHubRowCommandsSolution_managed.zip` from the
   [latest release](https://github.com/pcfhub/pcf-row-commands/releases/latest),
   or from this component's page on PCFHub.
2. In the [Power Platform admin experience](https://make.powerapps.com), choose
   your environment and go to **Solutions → Import solution**.
3. Select the zip and follow the wizard through. Nothing needs configuring
   during the import.
4. Publish all customisations.
:::

## The permission you will be asked for

The solution declares one feature — **WebAPI** — and the import will say so.
It is used by the **Delete** command and by nothing else, and it is declared as
optional: on a host without it the delete command is not drawn and the rest of
the control works normally.

## For canvas apps

Code components are off by default in a canvas app. In the app, go to
**Settings → General** and switch on **Code components**. You need this once per
app; the environment-level setting is separate and is usually already on.

:::callout{type=warning}
Import the same solution version everywhere. Dataverse will not replace a
component that is already installed at the same version number — the import
reports success and the old bundle keeps running, which reads as a fix that did
not take.
:::

Once imported, the control appears as **Row Commands** — on a model-driven form
under the subgrid's **Controls** tab, and in canvas under **Insert → Code
components**.
