/*
 * THROWAWAY, with probe.ts: drive the 0.2.5 probe against the rig once, so the
 * console calls in SPEC.md are known to run before anybody types them on a
 * form. Not part of `npm run smoke`. Delete with probe.ts.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const dom = require('./dom.js');
const host = require('./host.js');
const fixture = require('./fixture.js');

dom.install(global);

const registration = host.captureRegistration(global);

vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'out', 'controls', 'RowCommands', 'bundle.js'), 'utf8'), { filename: 'bundle.js' });

(async () => {
    const heard = [];
    const handle = host.createHost(Object.assign({}, fixture, { webResources: { 'cll_/commands.json': '{"commands":[]}' } }), {
        inputs: { hideOpen: 'false', showDelete: 'false', showSelection: 'false', lockColumnWidths: 'false' },
        events: {
            onRowCommand: (payload) => {
                heard.push(payload.command);
                payload.ping('from the rig handler');
            },
        },
    });
    const container = document.createElement('div');
    const outputs = [];
    const control = new registration.ctor();

    control.init(handle.context, () => outputs.push(control.getOutputs()), {}, container);
    control.updateView(handle.nextContext());

    const probe = global.__pcfRowCommandsProbe;
    const all = probe.all();
    const raised = probe.raise();

    const answers = {
        all: all.P2_host.onRowCommand === 'function' && Array.isArray(all.P2_host.eventsBag),
        raise: raised.raised === 'returned' && heard[0] === 'probe' && raised.heardSynchronously.length === 1,
        outputs: outputs.length === 1 && outputs[0].invokedCommand === 'probe',
        // The rig's webAPI has no webresource table, so name one.
        resource: await probe.resource('cll_/commands.json'),
        states: await probe.states(),
    };

    console.log(JSON.stringify(answers, null, 2));
    control.destroy();
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
