// Run with: node_modules/.bin/electron scripts/verify-saving.cjs
const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('node:assert/strict');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-saving-'));
app.setPath('userData', temporary);
setTimeout(() => { console.error('Saving checks timed out'); app.exit(1); }, 30000).unref();
const first = path.join(temporary, 'a.md');
const second = path.join(temporary, 'b.md');
const copy = path.join(temporary, 'copy.md');
fs.writeFileSync(first, 'A original');
fs.writeFileSync(second, 'B original');
let chosenFile = first;
let savePath = copy;
let conflictChoice = 1;
dialog.showOpenDialogSync = () => [chosenFile];
dialog.showSaveDialogSync = () => savePath;
dialog.showMessageBoxSync = () => conflictChoice;
dialog.showMessageBox = async () => ({ response: 1 });
// Capture the real handler so only response delivery, not disk I/O, is delayed.
const register = ipcMain.handle.bind(ipcMain);
let originalSave;
ipcMain.handle = (channel, callback) => {
  if (channel === 'save-file') originalSave = callback;
  register(channel, callback);
};
require('../main');
ipcMain.handle = register;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let window;
const js = source => window.webContents.executeJavaScript(source);
const action = label => Menu.getApplicationMenu().items.find(item => item.label === 'File').submenu.items.find(item => item.label === label).click();
const ready = async () => {
  window = BrowserWindow.getAllWindows()[0];
  if (window.webContents.isLoading()) await new Promise(resolve => window.webContents.once('did-finish-load', resolve));
  await pause(100);
};
const open = async file => { chosenFile = file; action('Open…'); await pause(100); };
const edit = async text => {
  await js(`document.querySelector('.cm-content').focus(); document.execCommand('selectAll'); document.execCommand('insertText', false, ${JSON.stringify(text)});`);
  await pause(80);
};
const content = () => js(`document.querySelector('.cm-content').textContent`);
const documentItems = () => Menu.getApplicationMenu().getMenuItemById('open-documents').submenu.items;
const activeKey = () => documentItems().find(item => item.checked).id.slice('document:'.length);
const select = async key => {
  documentItems().find(item => item.id === `document:${key}`).click();
  await pause(80);
};
const snapshot = () => JSON.parse(fs.readFileSync(path.join(temporary, 'draft-recovery.json'), 'utf8'));
app.whenReady().then(async () => {
  try {
    await ready();
    assert.equal(await js(`document.querySelector('#document-picker')`), null);
    await open(first);
    await edit('A draft');
    let release;
    ipcMain.removeHandler('save-file');
    register('save-file', async (...args) => {
      const result = originalSave(...args);
      return new Promise(resolve => { release = () => resolve(result); });
    });
    action('Save');
    for (let i = 0; !release && i < 30; i++) await pause(20);
    assert.equal(typeof release, 'function');
    assert.equal(fs.readFileSync(first, 'utf8'), 'A draft');
    await edit('A newer draft');
    await open(second);
    release();
    await pause(100);
    assert.equal(await content(), 'B original');
    assert.equal(activeKey(), second);
    await select(first);
    assert.equal(await content(), 'A newer draft');
    assert.equal(await js(`document.querySelector('#dirty-status').classList.contains('hidden')`), false);
    ipcMain.removeHandler('save-file');
    register('save-file', originalSave);
    fs.writeFileSync(first, 'External edit');
    action('Save');
    await pause(150);
    assert.equal(fs.readFileSync(first, 'utf8'), 'External edit');
    assert.equal(await content(), 'A newer draft');
    conflictChoice = 0;
    action('Save');
    await pause(180);
    assert.equal(fs.readFileSync(copy, 'utf8'), 'A newer draft');
    assert.equal(fs.readFileSync(first, 'utf8'), 'External edit');
    savePath = second;
    await edit('copy changed');
    action('Save As…');
    await pause(150);
    assert.equal(fs.readFileSync(second, 'utf8'), 'B original');
    action('New');
    await pause(80);
    await edit('Untitled one');
    const keyOne = activeKey();
    action('New');
    await pause(80);
    assert.equal(await content(), '');
    await edit('Untitled two');
    const keyTwo = activeKey();
    assert.notEqual(keyOne, keyTwo);
    await select(keyOne);
    assert.equal(await content(), 'Untitled one');
    await select(keyTwo);
    await pause(450);
    assert(snapshot().documents.some(draft => draft.content === 'Untitled one'));
    assert(snapshot().documents.some(draft => draft.content === 'Untitled two'));
    // Destroy without running the normal save/discard close handshake.
    window.destroy();
    app.emit('activate');
    await ready();
    assert.equal(await content(), 'Untitled two');
    await select(keyOne);
    assert.equal(await content(), 'Untitled one');
    assert.equal(await js(`document.querySelector('#dirty-status').classList.contains('hidden')`), false);
    // Explicit discard clears recovery, unlike an abrupt window destruction.
    window.close();
    await pause(200);
    assert.equal(snapshot().documents.length, 0);
    console.log('Saving checks passed: delayed responses, newer edits, external conflicts, save-copy, protected drafts, multiple untitled drafts, recovery, explicit discard.');
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
  finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});
