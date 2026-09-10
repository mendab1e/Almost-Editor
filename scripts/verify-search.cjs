// Run with node_modules/.bin/electron scripts/verify-search.cjs.
const { app, BrowserWindow, dialog, Menu } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'almost-editor-search-'));
const documentPath = path.join(temporary, 'search.md');
fs.writeFileSync(documentPath, 'Hello photography.\nPhotography is tactile.');
app.setPath('userData', temporary);
dialog.showOpenDialogSync = () => [documentPath];
require('../main');

const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
setTimeout(() => { console.error('Search checks timed out'); app.exit(1); }, 15000).unref();

app.whenReady().then(async () => {
  try {
    const window = BrowserWindow.getAllWindows()[0];
    if (window.webContents.isLoading()) {
      await new Promise(resolve => window.webContents.once('did-finish-load', resolve));
    }
    const js = source => window.webContents.executeJavaScript(source);
    const applicationMenu = Menu.getApplicationMenu();
    applicationMenu.items.find(item => item.label === 'File')
      .submenu.items.find(item => item.label === 'Open…').click();
    await pause(100);

    const findMenu = applicationMenu.items.find(item => item.label === 'Edit')
      .submenu.items.find(item => item.label === 'Find').submenu;
    findMenu.items.find(item => item.label === 'Find…').click();
    await pause(50);

    assert.equal(await js(`document.activeElement.getAttribute('name')`), 'search');
    assert.equal(await js(`document.querySelector('.search-replacement').hidden`), true);
    await js(`document.querySelector('[name=toggleReplace]').click()`);
    assert.equal(await js(`document.activeElement.name`), 'replace');
    assert.equal(await js(`['replace', 'replaceAll', 'case', 're', 'word'].every(name => document.querySelector('.cm-panel.cm-search [name=' + name + ']'))`), true);
    await js(`(() => { const field = document.querySelector('.cm-panel.cm-search [name=search]'); field.value = 'photography'; field.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await pause(50);
    assert(await js(`document.querySelectorAll('.cm-searchMatch').length > 0`));
    assert.equal(await js(`document.querySelector('.search-count').textContent`), '2 matches');
    await js(`document.querySelector('[name=case]').click()`);
    assert.equal(await js(`document.querySelector('.search-count').textContent`), '1 match');
    await js(`document.querySelector('[name=case]').click()`);
    for (const width of [280, 520]) {
      await js(`document.getElementById('editor-pane').style.flex = '0 0 ${width}px'`);
      await pause(60);
      assert(await js(`(() => { const p = document.querySelector('.editor-search'); return p.scrollWidth <= p.clientWidth; })()`));
    }
    fs.writeFileSync('/tmp/almost-editor-search-redesign.png', (await window.webContents.capturePage()).toPNG());

    await js(`(() => { const field = document.querySelector('.cm-panel.cm-search [name=replace]'); field.value = 'film'; field.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('.cm-panel.cm-search [name=replaceAll]').click(); })()`);
    assert.equal(await js(`[...document.querySelectorAll('.cm-line')].map(line => line.textContent).join('\\n')`), 'Hello film.\nfilm is tactile.');
    assert.equal(await js(`document.getElementById('dirty-status').classList.contains('hidden')`), false);

    await js(`(() => { const field = document.querySelector('.cm-panel.cm-search [name=search]'); field.value = 'film'; field.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    findMenu.items.find(item => item.label === 'Find Next').click();
    assert.match(await js(`document.querySelector('.search-count').textContent`), /^[12] of 2$/);
    findMenu.items.find(item => item.label === 'Find Previous').click();
    assert.match(await js(`document.querySelector('.search-count').textContent`), /^[12] of 2$/);

    await js(`(() => { const field = document.querySelector('.cm-panel.cm-search input[name=replace]'); field.value = 'analog'; field.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('.cm-panel.cm-search button[name=replace]').click(); })()`);
    assert.equal(await js(`[...document.querySelectorAll('.cm-line')].filter(line => line.textContent.includes('analog')).length`), 1);
    assert.equal(await js(`[...document.querySelectorAll('.cm-line')].filter(line => line.textContent.includes('film')).length`), 1);

    await js(`document.querySelector('.cm-panel.cm-search [name=close]').click()`);
    assert.equal(await js(`Boolean(document.querySelector('.cm-panel.cm-search'))`), false);
    console.log('Search checks passed: menu commands, highlighting, navigation, replace one/all, dirty state, and dismissal.');
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
