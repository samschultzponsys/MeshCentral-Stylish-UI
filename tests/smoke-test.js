// Smoke test for Stylish UI on a running MeshCentral server.
//
// Logs in to the Modern UI (the UI Stylish UI is made for), in light and dark mode, and checks that Stylish UI loads, that the page has no script
// errors and that the parts of the classic UI it restyles still work: the remote desktop settings
// dialog (including the Remote Printing setting when the server has it) and the notifications.
//
// Usage: node tests/smoke-test.js
// Environment: MESHCENTRAL_URL (default https://localhost:4430), MESHCENTRAL_USER, MESHCENTRAL_PASS,
//              SCREENSHOT_DIR (default ./screenshots)

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const url = process.env.MESHCENTRAL_URL || 'https://localhost:4430';
const user = process.env.MESHCENTRAL_USER || 'admin';
const pass = process.env.MESHCENTRAL_PASS;
const screenshotDir = process.env.SCREENSHOT_DIR || 'screenshots';

const failures = [];
function check(name, ok, detail) {
    console.log((ok ? 'PASS ' : 'FAIL ') + name + ((!ok && detail) ? ' (' + detail + ')' : ''));
    if (!ok) { failures.push(name); }
}

async function testScheme(browser, scheme) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 860 }, colorScheme: scheme });
    const page = await context.newPage();
    const pageErrors = [];
    const badResponses = [];
    page.on('pageerror', function (e) { pageErrors.push(e.message); });
    page.on('response', function (r) { if (/\/(styles\/custom\.css|scripts\/custom\.js)$/.test(r.url()) && (r.status() >= 400)) { badResponses.push(r.status() + ' ' + r.url()); } });

    await page.goto(url + '/');
    await page.fill('#username', user);
    await page.fill('#password', pass);
    await page.click('#loginButton');
    await page.waitForFunction(function () { return (typeof meshserver != 'undefined'); }, null, { timeout: 30000 });

    // Switch to the Modern UI, unless the server already forces it with "siteStyle": 3
    await page.goto(url + '/?sitestyle=3');
    await page.waitForFunction(function () { return (typeof meshserver != 'undefined') && (typeof showDesktopSettings == 'function'); }, null, { timeout: 30000 });
    await page.waitForTimeout(2000);
    check(scheme + ': Modern UI is shown', await page.locator('.masthead-right').count() > 0);

    check(scheme + ': custom.css and custom.js are served', badResponses.length == 0, badResponses.join(', '));
    check(scheme + ': Stylish UI script ran (theme toggle present)', await page.locator('#theme-toggle').count() == 1);
    await page.screenshot({ path: path.join(screenshotDir, scheme + '-main.png') });

    // Open the remote desktop settings dialog. There are no devices on the test server, so give the page a placeholder device.
    await page.evaluate(function () {
        currentNode = { _id: 'node//smoketest', meshid: 'mesh//smoketest', name: 'smoketest', agent: { id: 3, caps: 15 }, conn: 1, pwr: 1, mtype: 2 };
        showDesktopSettings();
    });
    await page.waitForTimeout(500);
    const dialog = await page.evaluate(function () { var d = Q('d7encoding').closest('.modal-content') || Q('dialog'), r = d.getBoundingClientRect(); return { visible: (r.width > 0) && (r.height > 0), left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });
    check(scheme + ': remote desktop settings dialog opens', dialog.visible);

    // The Remote Printing setting, when this MeshCentral version has it
    const hasRemotePrint = await page.locator('#d7deskRemotePrint').count() == 1;
    console.log('INFO ' + scheme + ': Remote Printing setting ' + (hasRemotePrint ? 'present' : 'not in this MeshCentral version'));
    if (hasRemotePrint) {
        const rp = await page.evaluate(function () {
            var s = Q('d7deskRemotePrint'), e = Q('d7encoding'), r = s.getBoundingClientRect();
            return { visible: (r.width > 0) && (r.height > 0), left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height, encodingHeight: e.getBoundingClientRect().height, options: Array.prototype.map.call(s.options, function (o) { return o.value; }) };
        });
        check(scheme + ': Remote Printing setting is visible', rp.visible);
        check(scheme + ': Remote Printing setting is inside the dialog', (rp.left >= dialog.left) && (rp.right <= dialog.right) && (rp.top >= dialog.top) && (rp.bottom <= dialog.bottom), JSON.stringify({ setting: rp, dialog: dialog }));
        check(scheme + ': Remote Printing setting is styled like the other settings', Math.abs(rp.height - rp.encodingHeight) <= 4, rp.height + 'px vs ' + rp.encodingHeight + 'px');
        check(scheme + ': Remote Printing setting offers PDF', rp.options.indexOf('pdf') >= 0, rp.options.join(','));
        await page.selectOption('#d7deskRemotePrint', 'pdf');
    }
    await page.screenshot({ path: path.join(screenshotDir, scheme + '-desktop-settings.png') });
    await page.evaluate(function () { setDialogMode(0); });

    // Notifications, restyled by Stylish UI
    await page.evaluate(function () { addNotification({ text: 'Smoke test notification', title: 'Stylish UI' }); });
    await page.waitForTimeout(500);
    const notification = await page.evaluate(function () { var b = Q('notifiyBox'); return (b != null) && (b.getBoundingClientRect().height > 0) && (b.textContent.indexOf('Smoke test notification') >= 0); });
    check(scheme + ': notifications are shown', notification);
    await page.screenshot({ path: path.join(screenshotDir, scheme + '-notifications.png') });

    check(scheme + ': no script errors', pageErrors.length == 0, pageErrors.join(' | '));
    await context.close();
}

(async function () {
    if (!pass) { console.log('MESHCENTRAL_PASS is not set'); process.exit(2); }
    fs.mkdirSync(screenshotDir, { recursive: true });
    const browser = await chromium.launch();
    try {
        await testScheme(browser, 'light');
        await testScheme(browser, 'dark');
    } catch (ex) {
        check('test ran to completion', false, ex.message);
    }
    await browser.close();
    console.log(failures.length == 0 ? 'All checks passed' : (failures.length + ' check(s) failed'));
    process.exit(failures.length == 0 ? 0 : 1);
})();
