#!/usr/bin/env node
/*
 * sync-editor.js — copy the canonical PDF Editor Pro source into this repo.
 *
 * The editor's source of truth lives OUTSIDE this repo (the Electron project's
 * app/ folder). This repo ships a static copy at ./pdf-editor that Render serves
 * at /pdf-editor/. Run this after editing the canonical source so the two can't drift.
 *
 *   npm run sync-editor
 *
 * Override the source location if your checkout lives elsewhere:
 *   PDF_EDITOR_SRC="D:/path/to/pdf-editor-app/app" npm run sync-editor
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_SRC = 'C:/Users/drhop/OneDrive/Desktop/pdf-editor-app/app';
const src = path.resolve(process.env.PDF_EDITOR_SRC || DEFAULT_SRC);
const dest = path.resolve(__dirname, '..', 'pdf-editor');

function fail(msg) {
  console.error('\n  ✖ sync-editor: ' + msg + '\n');
  process.exit(1);
}

if (!fs.existsSync(src)) {
  fail('source not found: ' + src +
    '\n    Set PDF_EDITOR_SRC to the editor app/ folder, e.g.' +
    '\n    PDF_EDITOR_SRC="D:/code/pdf-editor-app/app" npm run sync-editor');
}
// Sanity-check it's actually the editor, not some random folder.
if (!fs.existsSync(path.join(src, 'index.html')) || !fs.existsSync(path.join(src, 'app.js'))) {
  fail('source does not look like the PDF editor (missing index.html/app.js): ' + src);
}

console.log('\n  Syncing PDF editor');
console.log('    from: ' + src);
console.log('    to:   ' + dest);

// Replace dest wholesale so deletions in the source propagate.
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });

// Report what landed.
let count = 0;
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else count++;
  }
})(dest);

console.log('  ✓ copied ' + count + ' files');
console.log('\n  Next: rebuild the client only if you changed nav/UI, then commit:');
console.log('    git add pdf-editor && git commit -m "Sync PDF editor" && git push\n');
