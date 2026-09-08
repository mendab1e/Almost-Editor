// Run with: npm run build && node_modules/.bin/electron scripts/verify-electron.cjs
const { app, BrowserWindow, dialog, Menu, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('node:assert/strict');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'almost-editor-regression-'));
app.setPath('userData', temporary);
setTimeout(() => { console.error('Electron regression checks timed out'); app.exit(1); }, 30000).unref();
const first = path.join(temporary, 'a.md');
const second = path.join(temporary, 'b.md');
fs.writeFileSync(first, 'Post A');
fs.writeFileSync(second, 'Post B');
let selection = first;
dialog.showOpenDialogSync = () => [selection];
let external;
shell.openExternal = async url => { external = url; };
require('../main');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  try {
    const window = BrowserWindow.getAllWindows()[0];
    if (window.webContents.isLoading()) await new Promise(resolve => window.webContents.once('did-finish-load', resolve));
    const js = source => window.webContents.executeJavaScript(source);
    const open = async file => {
      selection = file;
      Menu.getApplicationMenu().items.find(item => item.label === 'File').submenu.items.find(item => item.label === 'Open…').click();
      await pause(100);
    };
    await open(first);
    await open(second);
    await js(`document.querySelector('.cm-content').focus()`);
    window.webContents.undo();
    await pause(50);
    assert.equal(await js(`document.querySelector('.cm-content').textContent`), 'Post B');
    const clean = await js(`import('./editor.bundle.js').then(({sanitizePreview}) => sanitizePreview('<img src="missing" onerror="window.compromised=true"><iframe srcdoc="bad"></iframe><a href="javascript:alert(1)">bad</a><a href="hugo-ref:posts/a">good</a>'))`);
    assert(!clean.includes('onerror') && !clean.includes('iframe') && !clean.includes('javascript:'));
    assert(clean.includes('hugo-ref:posts/a'));
    assert.equal((await js(`window.api.saveFile({filePath:${JSON.stringify(path.join(temporary, 'unauthorized.md'))},content:'bad',expectedContent:''})`)).ok, false);
    fs.writeFileSync(second, '[external](https://example.com)');
    await open(second);
    const before = window.webContents.getURL();
    await js(`document.querySelector('#preview a').click()`);
    await pause(50);
    assert.equal(external, 'https://example.com/');
    assert.equal(window.webContents.getURL(), before);
    assert.equal((await js(`window.api.openExternal('file:///tmp/test')`)).ok, false);
    const imagePath = path.join(temporary, 'photo.png');
    const magick = ['/opt/homebrew/bin/magick', '/usr/local/bin/magick'].find(fs.existsSync) || 'magick';
    require('child_process').execFileSync(magick, ['-size', '2x2', 'xc:red', imagePath]);
    const imageOne = await js(`window.api.processImage({sourcePath:${JSON.stringify(imagePath)}, alt:'A \"red\" square & light'})`);
    assert.equal(imageOne.ok, true, imageOne.error);
    assert(imageOne.tag.includes('alt="A &quot;red&quot; square &amp; light"'));
    assert.equal((await js(`window.api.processImage({sourcePath:${JSON.stringify(imagePath)}, filePath:'/tmp/unauthorized.md'})`)).ok, false);
    const originalImage = fs.readFileSync(path.join(temporary, 'images', 'photo.jpg'));
    const imageTwo = await js(`window.api.processImage({sourcePath:${JSON.stringify(imagePath)}})`);
    assert.equal(imageTwo.ok, true, imageTwo.error);
    assert(imageTwo.tag.includes('photo-1.jpg'));
    assert.deepEqual(fs.readFileSync(path.join(temporary, 'images', 'photo.jpg')), originalImage);
    // Give the renderer a delayed conversion and switch while it awaits IPC.
    // Real conversion is exercised separately; this test controls completion timing.
    const { ipcMain } = require('electron');
    ipcMain.removeHandler('process-image');
    let finish;
    ipcMain.handle('process-image', () => new Promise(resolve => { finish = resolve; }));
    await open(first);
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [imagePath] });
    await js(`document.getElementById('insert-image').click()`);
    await pause(50);
    await js(`document.getElementById('insert-image-form').requestSubmit()`);
    await pause(50);
    assert.equal(typeof finish, 'function');
    await open(second);
    finish({ok:true,tag:'IMAGE_RESULT'});
    await pause(100);
    assert(!(await js(`document.querySelector('.cm-content').textContent`)).includes('IMAGE_RESULT'));
    await open(first);
    assert((await js(`document.querySelector('.cm-content').textContent`)).includes('IMAGE_RESULT'));
    console.log('Electron regressions passed: sanitizer, save authorization, undo isolation, external navigation, real image conversion with collisions, delayed image insertion.');
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  } finally { fs.rmSync(temporary, { recursive:true, force:true }); }
});
