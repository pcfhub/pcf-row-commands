/*
 * Retake every screenshot in `media/` from the harness.
 *
 *     npm run harness -- --no-open --port 8103     # in one shell
 *     npm run shots                                # in another
 *
 * **The recipes live here, not in a person's shell history.** A stale
 * screenshot is a documented claim about a version that no longer exists, and
 * the only defence is a retake cheap enough to run on every release.
 *
 * Headless Chrome, driven over the DevTools protocol with Node's own
 * `WebSocket` — no dependency. The protocol rather than `--screenshot` on the
 * command line because these states are reached by *doing* something: ticking
 * rows, dragging a column edge and holding it, pressing Delete. Each recipe
 * sets the harness's switches, acts on the mounted control, and the picture is
 * clipped to the control itself.
 *
 * It exists because the desktop app's preview pane screenshots come back blank
 * while the pane is hidden, and because pictures taken by hand drift.
 */

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const media = path.join(root, 'media');

const CHROME = process.env.CHROME || [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((candidate) => fs.existsSync(candidate));

const PORT = process.env.PORT || 8103;
const PAGE = `http://localhost:${PORT}/dev/harness.html`;
const DEBUG_PORT = 9337;

/*
 * Run in the page. `set` drives a harness switch the way a person would, so
 * the harness remounts; `boxes`, `handle` and `pointer` act on the control.
 */
const HELPERS = `
    window.__shot = {
        set(id, value) {
            const el = document.getElementById(id);
            if (el.type === 'checkbox') { el.checked = value; } else { el.value = value; }
            el.dispatchEvent(new Event(el.tagName === 'TEXTAREA' ? 'input' : 'change', { bubbles: true }));
        },
        inputs(bag) { this.set('harness-inputs', JSON.stringify(bag)); },
        control() { return document.querySelector('.RowCommands'); },
        boxes() { return this.control().querySelectorAll('.RowCommands-select'); },
        handle(index) { return this.control().querySelectorAll('.RowCommands-resizer')[index]; },
        pointer(el, type, dx) {
            const box = el.getBoundingClientRect();
            el.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, clientX: box.left + 4 + dx, clientY: box.top + 4 }));
        },
    };
`;

const DEFAULTS = { hideOpen: 'false', showDelete: 'false', showSelection: 'false', lockColumnWidths: 'false' };

/** name, width, what it is for, and the script that puts the control there. */
const SHOTS = [
    ['screenshot.png', 1060, 'the shipped layout with selection on: two rows ticked, the bar over the table',
        `__shot.inputs({ ...${JSON.stringify(DEFAULTS)}, showDelete: 'true', showSelection: 'true' });
         __shot.boxes()[1].click(); __shot.boxes()[3].click();`],
    ['screenshot-resize.png', 1060, 'a column edge held mid-drag: the line, and the column following the pointer',
        `__shot.inputs(${JSON.stringify(DEFAULTS)});
         const h = __shot.handle(0);
         __shot.pointer(h, 'pointerdown', 0);
         __shot.pointer(h, 'pointermove', 90);`],
    ['screenshot-delete.png', 1060, 'a row deleted: the confirmation answered, the row gone, the message said',
        `__shot.inputs({ ...${JSON.stringify(DEFAULTS)}, showDelete: 'true' });
         __shot.control().querySelector('.RowCommands-command--delete').click();`],
    ['screenshot-mobile.png', 360, 'a phone-width subgrid: icon-only commands, sideways scroll, the selection bar wrapping',
        `__shot.set('harness-width', '360');
         __shot.inputs({ ...${JSON.stringify(DEFAULTS)}, showSelection: 'true', showDelete: 'true' });
         __shot.boxes()[2].click();`],
    ['screenshot-dark.png', 1060, 'the dark fallbacks, with a row selected',
        `__shot.set('harness-dark', true);
         __shot.inputs({ ...${JSON.stringify(DEFAULTS)}, showSelection: 'true', showDelete: 'true' });
         __shot.boxes()[1].click();`],
];

if (!CHROME) {
    console.error('\n  No Chrome found. Set CHROME to its path.\n');
    process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function json(url) {
    for (let attempt = 0; attempt < 50; attempt += 1) {
        try {
            const response = await fetch(url);

            if (response.ok) {
                return await response.json();
            }
        } catch {
            // Not listening yet.
        }

        await sleep(200);
    }

    throw new Error(`Nothing answered at ${url}.`);
}

function connect(url) {
    const socket = new WebSocket(url);
    const waiting = new Map();
    let next = 0;

    socket.addEventListener('message', (event) => {
        const message = JSON.parse(event.data);
        const pending = waiting.get(message.id);

        if (pending) {
            waiting.delete(message.id);
            message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
        }
    });

    return new Promise((resolve, reject) => {
        socket.addEventListener('error', reject);
        socket.addEventListener('open', () =>
            resolve({
                send(method, params = {}) {
                    next += 1;
                    socket.send(JSON.stringify({ id: next, method, params }));

                    return new Promise((ok, fail) => waiting.set(next, { resolve: ok, reject: fail }));
                },
                close() {
                    socket.close();
                },
            }),
        );
    });
}

async function evaluate(cdp, expression) {
    const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
    });

    if (exceptionDetails) {
        throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    }

    return result.value;
}

(async () => {
    try {
        await fetch(PAGE);
    } catch {
        console.error(`\n  The harness is not being served at ${PAGE}.\n  Run npm run harness -- --no-open --port ${PORT} first.\n`);
        process.exit(1);
    }

    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pcf-shots-'));
    const browser = spawn(CHROME, [
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        '--force-device-scale-factor=1',
        `--remote-debugging-port=${DEBUG_PORT}`,
        `--user-data-dir=${profile}`,
        'about:blank',
    ], { stdio: 'ignore' });

    try {
        const targets = await json(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
        const page = targets.find((target) => target.type === 'page');
        const cdp = await connect(page.webSocketDebuggerUrl);

        await cdp.send('Page.enable');
        await cdp.send('Runtime.enable');

        for (const [name, width, purpose, recipe] of SHOTS) {
            await cdp.send('Emulation.setDeviceMetricsOverride', { width: width + 120, height: 1400, deviceScaleFactor: 1, mobile: false });
            await cdp.send('Page.navigate', { url: PAGE });
            await sleep(800);

            // Widths are remembered per browser; every shot starts from none.
            await evaluate(cdp, 'localStorage.clear()');
            await evaluate(cdp, HELPERS);
            await evaluate(cdp, `__shot.set('harness-width', '${width}')`);
            await evaluate(cdp, `(async () => { ${recipe} })()`);
            await sleep(400);

            const clip = await evaluate(cdp, `(() => {
                const box = __shot.control().getBoundingClientRect();
                return { x: Math.max(0, box.left - 12), y: Math.max(0, box.top + window.scrollY - 12), width: Math.ceil(box.width + 24), height: Math.ceil(box.height + 24), scale: 1 };
            })()`);
            const shot = await cdp.send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: true });

            fs.writeFileSync(path.join(media, name), Buffer.from(shot.data, 'base64'));
            console.log(`  ${name.padEnd(24)} ${clip.width}×${clip.height}  ${purpose}`);
        }

        cdp.close();
    } finally {
        browser.kill();
    }
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
