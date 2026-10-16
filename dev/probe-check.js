/*
 * THROWAWAY, with probe.ts: drive the 0.3.4 probe against the rig once, so the
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

const echo = { parameters: { Text: { type: 'Edm.String' } }, response: ['Echo'], answer: (params, id) => ({ Echo: `${id}: ${params.Text}` }) };

(async () => {
    const handle = host.createHost(Object.assign({}, fixture, {
        actions: {
            pcfhub_ProbeRowBoundAccount: Object.assign({ boundTo: 'account' }, echo),
            pcfhub_ProbeRowUnbound: { parameters: { RowId: { type: 'Edm.Guid' }, Target: { type: 'mscrm.crmbaseentity' } }, response: [] },
        },
    }), { inputs: { hideOpen: 'false', showDelete: 'false', showSelection: 'false', lockColumnWidths: 'false' } });
    const container = document.createElement('div');
    const control = new registration.ctor();

    control.init(handle.context, () => undefined, {}, container);
    control.updateView(handle.nextContext());

    const probe = global.__pcfRowCommandsProbe;
    const answers = {
        all: await probe.all(),
        bound: await probe.bound(0, 'hi'),
        boundLower: await probe.bound(0, 'hi', 'pcfhub_proberowboundaccount'),
        unboundOk: await probe.unbound(0, 'ok'),
        unboundNotGuid: await probe.unbound(0, 'notGuid'),
        refuse: await probe.refuse(0),
        gone: await probe.gone(),
        sequence: await probe.sequence(3),
        passes: probe.passes().length,
    };

    console.log(JSON.stringify(answers, null, 2));
    control.destroy();
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
