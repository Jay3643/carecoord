// ============================================================
// PDF Editor Pro — Full Acrobat-style PDF Editor
// ============================================================
(function () {
  'use strict';

  const pdfjsLib = window['pdfjs-dist/build/pdf'] || window.pdfjsLib;
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
  const { PDFDocument, rgb, StandardFonts, degrees: pdfDegrees } = PDFLib;

  // =============================================================
  // STATE
  // =============================================================
  const S = {
    pdfDoc: null,
    pdfBytes: null,
    pages: [],          // [{canvas, wrapper, annotLayer, rendered, viewport}]
    totalPages: 0,
    scale: 1.5,
    activeTool: null,
    activePanel: 'edit',
    annotations: {},    // pageNum -> []
    undoStack: [],
    redoStack: [],
    selected: null,
    signatureData: null,
    initialsData: null,
    fileName: 'document.pdf',
    sidebarOpen: false,
    searchResults: [],
    searchIdx: -1,
    pageRotations: {},
    renderQueue: new Set(),
    rendering: false,
    observer: null,
    thumbObserver: null,
    fileHandle: null,           // FS Access API handle for Save-to-original
    signatureLibrary: [],       // [{ id, dataUrl, label, kind: 'signature'|'initials' }]
    selectedPages: new Set(),   // 0-based indices for multi-select extract/delete
    lastClickedThumb: -1,       // anchor for shift-click range select
    fillHintsByPage: {},        // pageNum -> [{kind, x, y, width, height, source}] cached fill targets
    fillHintsShownFor: null,    // active tool name that hints are currently visible for
  };

  // =============================================================
  // SIGNATURE LIBRARY (persists across sessions via localStorage)
  // =============================================================
  const SIG_STORE_KEY = 'pdfeditor.signatures.v1';
  function loadSignatureLibrary() {
    try {
      const raw = localStorage.getItem(SIG_STORE_KEY);
      S.signatureLibrary = raw ? JSON.parse(raw) : [];
    } catch { S.signatureLibrary = []; }
    // Mirror most-recent into legacy slots for any callers that still read them
    const lastSig = S.signatureLibrary.filter(s => s.kind === 'signature').slice(-1)[0];
    const lastIni = S.signatureLibrary.filter(s => s.kind === 'initials').slice(-1)[0];
    S.signatureData = lastSig ? lastSig.dataUrl : null;
    S.initialsData = lastIni ? lastIni.dataUrl : null;
  }
  function saveSignatureLibrary() {
    try { localStorage.setItem(SIG_STORE_KEY, JSON.stringify(S.signatureLibrary)); }
    catch (e) { console.warn('Could not persist signatures:', e); }
  }
  function addToSignatureLibrary(dataUrl, kind, label) {
    const id = 'sig_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const entry = { id, dataUrl, kind, label: label || (kind === 'initials' ? 'Initials' : 'Signature') };
    // Cap at 12 entries per kind to keep localStorage healthy
    const sameKind = S.signatureLibrary.filter(s => s.kind === kind);
    if (sameKind.length >= 12) {
      const first = S.signatureLibrary.find(s => s.kind === kind);
      const i = S.signatureLibrary.indexOf(first);
      if (i >= 0) S.signatureLibrary.splice(i, 1);
    }
    S.signatureLibrary.push(entry);
    saveSignatureLibrary();
    return entry;
  }
  function removeFromSignatureLibrary(id) {
    const i = S.signatureLibrary.findIndex(s => s.id === id);
    if (i >= 0) { S.signatureLibrary.splice(i, 1); saveSignatureLibrary(); }
  }
  loadSignatureLibrary();

  const $ = (s, p) => (p || document).querySelector(s);
  const $$ = (s, p) => [...(p || document).querySelectorAll(s)];

  // =============================================================
  // DOM REFS
  // =============================================================
  const viewport = $('#viewport');
  const pagesContainer = $('#pages-container');
  const welcomeEl = $('#welcome');
  const fileInput = $('#file-input');
  const imageFileInput = $('#image-file-input');
  const combineFileInput = $('#combine-file-input');
  const insertFileInput = $('#insert-file-input');
  const sidebarEl = $('#sidebar');
  const sidebarThumbs = $('#sidebar-thumbs');

  // Stamps config
  const STAMPS = [
    { text: 'APPROVED', color: '#2ea043', border: '#2ea043' },
    { text: 'REJECTED', color: '#e5322d', border: '#e5322d' },
    { text: 'DRAFT', color: '#888', border: '#888' },
    { text: 'CONFIDENTIAL', color: '#c00', border: '#c00' },
    { text: 'FINAL', color: '#1473e6', border: '#1473e6' },
    { text: 'COPY', color: '#666', border: '#666' },
    { text: 'VOID', color: '#e5322d', border: '#e5322d' },
    { text: 'RECEIVED', color: '#2ea043', border: '#2ea043' },
    { text: 'REVIEWED', color: '#1473e6', border: '#1473e6' },
    { text: 'SIGN HERE', color: '#e5322d', border: '#e5322d' },
  ];

  // Status bar (minimal)
  const statusEl = document.createElement('div');
  statusEl.id = 'status-bar';
  document.body.appendChild(statusEl);
  function showStatus(msg) { statusEl.textContent = msg || 'Ready'; }
  showStatus('');

  // =============================================================
  // FILE OPEN
  // =============================================================
  // Prefer the File System Access API so Save (Ctrl+S) can write back to the
  // original file (issue #6). Falls back to the hidden <input type=file> for
  // browsers that don't expose showOpenFilePicker (Firefox, Safari < 18).
  async function openFile() {
    if (window.showOpenFilePicker && !window.electronAPI) {
      try {
        const [handle] = await window.showOpenFilePicker({
          types: [{ description: 'PDF Document', accept: { 'application/pdf': ['.pdf'] } }],
          multiple: false,
        });
        const file = await handle.getFile();
        S.fileHandle = handle;
        await loadPDF(file);
        showStatus('Opened: ' + file.name + ' — Ctrl+S to save back');
        return;
      } catch (err) {
        if (err.name === 'AbortError') return; // user cancelled
        console.warn('showOpenFilePicker failed, falling back to input:', err);
      }
    }
    S.fileHandle = null;
    fileInput.click();
  }

  fileInput.addEventListener('change', e => {
    if (e.target.files[0]) {
      // Legacy input has no FS handle — clear any prior so Save uses Save As.
      S.fileHandle = null;
      loadPDF(e.target.files[0]);
    }
    fileInput.value = '';
  });

  async function loadPDF(file) {
    S.fileName = file.name || 'document.pdf';
    try {
      const buf = await file.arrayBuffer();
      S.pdfBytes = new Uint8Array(buf);
      await initDocument(S.pdfBytes);
    } catch (err) {
      // Better error messages for the most common load failures (issue #11)
      console.error('PDF load failed:', err);
      const msg = describePdfLoadError(err);
      alert('Could not open "' + S.fileName + '"\n\n' + msg);
      showStatus('Open failed: ' + (err.message || 'unknown error'));
    }
  }

  function describePdfLoadError(err) {
    const m = (err && err.message ? err.message : String(err || '')).toLowerCase();
    if (err && err.name === 'PasswordException') return 'This PDF is password-protected. PDF Editor Pro does not yet support encrypted documents.';
    if (m.includes('invalidpdfexception') || m.includes('invalid pdf')) return 'The file does not look like a valid PDF (it may be corrupted, truncated, or a different file type).';
    if (m.includes('missingpdfexception')) return 'The PDF file is missing or empty.';
    if (m.includes('unexpectedresponseexception') || m.includes('network')) return 'Network error while loading the PDF.';
    if (m.includes('worker')) return 'The PDF rendering worker failed to start. Try reloading the page.';
    return 'Reason: ' + (err && err.message ? err.message : 'unknown');
  }

  async function loadPDFBytes(bytes, name) {
    S.pdfBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    S.fileName = name || S.fileName;
    await initDocument(S.pdfBytes);
  }

  async function initDocument(bytes) {
    // Cleanup
    if (S.observer) S.observer.disconnect();
    if (S.thumbObserver) S.thumbObserver.disconnect();
    S.pages = [];
    S.annotations = {};
    S.undoStack = [];
    S.redoStack = [];
    S.selected = null;
    S.pageRotations = {};
    // Re-arm the "no handle" warning so it fires once per loaded document.
    S._warnedNoHandle = false;
    updateSaveIndicator();
    // Drop any cached form-field hints from the previous document.
    S.fillHintsByPage = {};
    S.fillHintsShownFor = null;
    pagesContainer.innerHTML = '';
    sidebarThumbs.innerHTML = '';

    S.pdfDoc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    S.totalPages = S.pdfDoc.numPages;

    welcomeEl.style.display = 'none';
    pagesContainer.style.display = 'flex';
    // Hide the PWA install button while editing — it overlapped page content
    // and the bottom-corner of forms (clinician report 2026-06-05).
    document.body.classList.add('pdf-open');
    enableUI();
    buildPages();
    buildThumbnails();
    updatePageUI();

    // Lazy rendering via IntersectionObserver
    S.observer = new IntersectionObserver(entries => {
      for (const e of entries) {
        const idx = parseInt(e.target.dataset.pageIndex);
        if (e.isIntersecting && !S.pages[idx].rendered) {
          S.renderQueue.add(idx);
        }
      }
      processRenderQueue();
    }, { root: viewport, rootMargin: '200px' });

    S.pages.forEach((p, i) => S.observer.observe(p.wrapper));
  }

  // Update the Save button label/title so the clinician knows at a glance
  // whether Ctrl+S will overwrite the source file in place or open a
  // Save-As dialog. This directly addresses the "why did Save create a
  // duplicate?" complaint — you can see it coming before you click.
  function updateSaveIndicator() {
    const btn = document.getElementById('btn-save');
    if (!btn) return;
    const willOverwrite = !!(S.fileHandle && (S.fileHandle.createWritable || S.fileHandle.electronPath));
    if (willOverwrite) {
      const name = S.fileHandle.name || S.fileName || '';
      btn.title = 'Save — overwrites ' + name + ' in place (Ctrl+S)';
      btn.classList.add('save-overwrite');
      btn.classList.remove('save-download');
    } else {
      btn.title = 'Save — will open a Save As dialog (this file was opened without write permission; use the Open button next time to save in place)';
      btn.classList.add('save-download');
      btn.classList.remove('save-overwrite');
    }
  }

  function enableUI() {
    $$('#btn-save,#btn-save-as,#btn-print,#btn-undo,#btn-redo,#search-input,#zoom-select,#btn-zoom-in,#btn-zoom-out,#page-input')
      .forEach(el => { if (el) el.disabled = false; });
    $$('.tool-btn').forEach(b => b.disabled = false);
    $('#page-total').textContent = S.totalPages;
    $('#page-input').max = S.totalPages;
  }

  // =============================================================
  // BUILD PAGES (continuous scroll)
  // =============================================================
  function buildPages() {
    for (let i = 0; i < S.totalPages; i++) {
      const wrapper = document.createElement('div');
      wrapper.className = 'page-wrapper';
      wrapper.dataset.pageIndex = i;

      const cvs = document.createElement('canvas');
      const annotLayer = document.createElement('div');
      annotLayer.className = 'annotation-layer';

      wrapper.appendChild(cvs);
      wrapper.appendChild(annotLayer);

      const numLabel = document.createElement('div');
      numLabel.className = 'page-number';
      numLabel.textContent = `Page ${i + 1}`;

      pagesContainer.appendChild(wrapper);
      pagesContainer.appendChild(numLabel);

      S.pages.push({
        canvas: cvs, wrapper, annotLayer,
        rendered: false, rendering: false, viewport: null,
      });

      // Set placeholder size from page info
      setPlaceholderSize(i);

      // Click handlers for annotation placement — mousedown + click fallback
      const handleLayerEvent = (e) => {
        if (e.target.closest('.text-overlay-block') || e.target.closest('.inline-text-box')) return;
        if (e.target.closest('.annot')) return;
        if (!S.activeTool) {
          // Targeted deselect — no full layer rebuild, so clicking blank
          // space doesn't re-decode signatures on the page.
          if (S.selected) {
            clearSelectionOnPage(i + 1);
            S.selected = null;
          }
          return;
        }
        onAnnotLayerDown(e, i);
      };
      annotLayer.addEventListener('mousedown', handleLayerEvent);
      // Fallback: if mousedown doesn't fire (e.g. transparent element issue), use click
      annotLayer.addEventListener('click', (e) => {
        if (e.target.closest('.text-overlay-block') || e.target.closest('.inline-text-box')) return;
        if (e.target.closest('.annot')) return;
        if (!S.activeTool) return;
        // Only handle tools that work on single click (not drag-based)
        const clickTools = ['add-text','edit-text','fill-text','add-image','sign','initials',
          'sticky-note','stamp','callout','fill-check','fill-x','fill-dot','fill-circle',
          'fill-date','form-text','form-checkbox','form-radio','form-dropdown',
          'form-signature','form-date'];
        if (clickTools.includes(S.activeTool)) {
          onAnnotLayerDown(e, i);
        }
      });
    }
  }

  async function setPlaceholderSize(idx) {
    const page = await S.pdfDoc.getPage(idx + 1);
    const vp = viewportFor(page, idx + 1, S.scale);
    S.pages[idx].canvas.width = vp.width;
    S.pages[idx].canvas.height = vp.height;
    S.pages[idx].canvas.style.width = vp.width + 'px';
    S.pages[idx].canvas.style.height = vp.height + 'px';
    S.pages[idx].annotLayer.style.width = vp.width + 'px';
    S.pages[idx].annotLayer.style.height = vp.height + 'px';
    S.pages[idx].wrapper.style.width = vp.width + 'px';
    S.pages[idx].wrapper.style.height = vp.height + 'px';
  }

  // =============================================================
  // LAZY RENDER ENGINE
  // =============================================================
  async function processRenderQueue() {
    if (S.rendering) return;
    S.rendering = true;

    while (S.renderQueue.size > 0) {
      const idx = S.renderQueue.values().next().value;
      S.renderQueue.delete(idx);
      if (S.pages[idx] && !S.pages[idx].rendered) {
        await renderPageAt(idx);
      }
    }

    S.rendering = false;
  }

  async function renderPageAt(idx) {
    const pg = S.pages[idx];
    if (pg.rendering) return;
    pg.rendering = true;

    const page = await S.pdfDoc.getPage(idx + 1);
    const vp = viewportFor(page, idx + 1, S.scale);
    pg.viewport = vp;

    pg.canvas.width = vp.width;
    pg.canvas.height = vp.height;
    pg.canvas.style.width = vp.width + 'px';
    pg.canvas.style.height = vp.height + 'px';
    pg.annotLayer.style.width = vp.width + 'px';
    pg.annotLayer.style.height = vp.height + 'px';
    pg.wrapper.style.width = vp.width + 'px';
    pg.wrapper.style.height = vp.height + 'px';

    const ctx = pg.canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport: vp }).promise;

    pg.rendered = true;
    pg.rendering = false;

    renderAnnotationsForPage(idx + 1);
    // If a fill tool is active, add hints to this newly-rendered page too.
    if (S.fillHintsShownFor) maybeRefreshFillHints();
  }

  function rerenderAll() {
    S.pages.forEach((pg, i) => {
      pg.rendered = false;
      pg.rendering = false;
      setPlaceholderSize(i);
    });
    S.renderQueue.clear();
    // Re-observe
    if (S.observer) S.observer.disconnect();
    S.observer = new IntersectionObserver(entries => {
      for (const e of entries) {
        const idx = parseInt(e.target.dataset.pageIndex);
        if (e.isIntersecting && !S.pages[idx].rendered) {
          S.renderQueue.add(idx);
        }
      }
      processRenderQueue();
    }, { root: viewport, rootMargin: '200px' });
    S.pages.forEach((p) => S.observer.observe(p.wrapper));
  }

  // =============================================================
  // THUMBNAILS
  // =============================================================
  // Pick a render scale that matches the thumb's actual on-screen size times
  // devicePixelRatio, so the bitmap doesn't get upscaled (which is what made
  // the sidebar previews look blurry). Falls back to a sensible default if the
  // thumb hasn't been laid out yet.
  function computeThumbScale(item, pageVpAtScale1) {
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = item.clientWidth || 140;
    const targetBitmapPx = Math.max(cssWidth * dpr, 280);
    return targetBitmapPx / pageVpAtScale1.width;
  }

  function buildThumbnails() {
    sidebarThumbs.innerHTML = '';

    S.thumbObserver = new IntersectionObserver(entries => {
      entries.forEach(async e => {
        if (!e.isIntersecting) return;
        const idx = parseInt(e.target.dataset.thumbIdx);
        const cvs = e.target.querySelector('canvas');
        if (cvs.dataset.rendered) return;

        const page = await S.pdfDoc.getPage(idx + 1);
        const baseVp = viewportFor(page, idx + 1, 1);
        const scale = computeThumbScale(e.target, baseVp);
        const vp = viewportFor(page, idx + 1, scale);
        cvs.width = vp.width;
        cvs.height = vp.height;
        cvs.style.width = '100%';
        cvs.style.height = 'auto';
        await page.render({ canvasContext: cvs.getContext('2d'), viewport: vp }).promise;
        cvs.dataset.rendered = '1';
      });
    }, { root: sidebarEl.querySelector('.sidebar-content'), rootMargin: '100px' });

    for (let i = 0; i < S.totalPages; i++) {
      const item = document.createElement('div');
      item.className = 'thumb-item' + (i === 0 ? ' active' : '');
      item.dataset.thumbIdx = i;
      item.draggable = true;

      const cvs = document.createElement('canvas');
      cvs.style.width = '100%';
      item.appendChild(cvs);

      const label = document.createElement('div');
      label.className = 'thumb-label';
      label.textContent = i + 1;
      item.appendChild(label);

      // Click = jump to page. Ctrl/Cmd-click = toggle in multi-selection.
      // Shift-click = range from last clicked. Multi-selected pages are used
      // by Extract / Delete when present (clinician 2026-06-15 — couldn't
      // select multiple pages for therapy-order extraction).
      item.addEventListener('click', (ev) => {
        if (ev.shiftKey && S.lastClickedThumb >= 0) {
          ev.preventDefault();
          const a = Math.min(S.lastClickedThumb, i);
          const b = Math.max(S.lastClickedThumb, i);
          for (let k = a; k <= b; k++) S.selectedPages.add(k);
          refreshThumbSelectionClasses();
          updateSelectionBadge();
          return;
        }
        if (ev.ctrlKey || ev.metaKey) {
          ev.preventDefault();
          if (S.selectedPages.has(i)) S.selectedPages.delete(i);
          else S.selectedPages.add(i);
          S.lastClickedThumb = i;
          refreshThumbSelectionClasses();
          updateSelectionBadge();
          return;
        }
        // Plain click: clear multi-selection and jump.
        if (S.selectedPages.size) {
          S.selectedPages.clear();
          refreshThumbSelectionClasses();
          updateSelectionBadge();
        }
        S.lastClickedThumb = i;
        scrollToPage(i);
      });

      // Drag-and-drop to reorder pages (issue #10)
      item.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', String(i));
        e.dataTransfer.effectAllowed = 'move';
        item.classList.add('dragging');
      });
      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        $$('.thumb-item', sidebarThumbs).forEach(t => t.classList.remove('drop-before', 'drop-after'));
      });
      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const rect = item.getBoundingClientRect();
        const above = (e.clientY - rect.top) < rect.height / 2;
        item.classList.toggle('drop-before', above);
        item.classList.toggle('drop-after', !above);
      });
      item.addEventListener('dragleave', () => {
        item.classList.remove('drop-before', 'drop-after');
      });
      item.addEventListener('drop', async (e) => {
        e.preventDefault();
        const srcIdx = parseInt(e.dataTransfer.getData('text/plain'));
        if (Number.isNaN(srcIdx)) return;
        const rect = item.getBoundingClientRect();
        const above = (e.clientY - rect.top) < rect.height / 2;
        let destIdx = i + (above ? 0 : 1);
        // Adjust for removing the dragged item before insertion.
        if (srcIdx < destIdx) destIdx -= 1;
        item.classList.remove('drop-before', 'drop-after');
        await reorderPages(srcIdx, destIdx);
      });

      sidebarThumbs.appendChild(item);
      S.thumbObserver.observe(item);
    }
  }

  function scrollToPage(idx) {
    if (S.pages[idx]) {
      S.pages[idx].wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  // Toggle the .multi-selected class to match S.selectedPages — purely visual.
  function refreshThumbSelectionClasses() {
    $$('.thumb-item', sidebarThumbs).forEach((t, i) => {
      t.classList.toggle('multi-selected', S.selectedPages.has(i));
    });
  }

  // Status-bar badge: "3 pages selected — Extract or Delete will use these"
  function updateSelectionBadge() {
    if (!S.selectedPages.size) { showStatus(''); return; }
    const n = S.selectedPages.size;
    showStatus(`${n} page${n === 1 ? '' : 's'} selected — click Extract/Delete to use them, Esc to clear`);
  }

  // Track current page on scroll
  viewport.addEventListener('scroll', () => {
    const scrollTop = viewport.scrollTop + 100;
    let current = 0;
    for (let i = 0; i < S.pages.length; i++) {
      if (S.pages[i].wrapper.offsetTop <= scrollTop) current = i;
    }
    updateCurrentPage(current + 1);
  });

  function updateCurrentPage(num) {
    $('#page-input').value = num;
    // Update thumb highlights
    $$('.thumb-item', sidebarThumbs).forEach((t, i) => {
      t.classList.toggle('active', i === num - 1);
    });
  }

  function updatePageUI() {
    $('#page-total').textContent = S.totalPages;
    $('#page-input').max = S.totalPages;
    $('#page-input').value = 1;
  }

  // =============================================================
  // ANNOTATIONS DATA
  // =============================================================
  // pdf.js getViewport's `rotation` option OVERRIDES the page's intrinsic
  // rotation, it doesn't add to it. Passing rotation:0 means "render this
  // page un-rotated regardless of its Rotate metadata", which made a 195-page
  // Updox doc (intrinsic Rotate=90 on every page) appear sideways in the
  // editor — clinician 2026-06-15. Fix: only pass `rotation` when the user
  // has explicitly rotated, and add it to the intrinsic value.
  function viewportFor(page, pageNum, scale) {
    const userRot = S.pageRotations[pageNum];
    if (userRot) {
      const intrinsic = page.rotate || 0;
      return page.getViewport({ scale, rotation: (intrinsic + userRot) % 360 });
    }
    return page.getViewport({ scale });
  }

  function getAnns(pageNum) {
    if (!S.annotations[pageNum]) S.annotations[pageNum] = [];
    return S.annotations[pageNum];
  }

  function addAnn(pageNum, ann) {
    getAnns(pageNum).push(ann);
    pushUndo({ action: 'add', page: pageNum, ann });
    // Append-only — DO NOT call renderAnnotationsForPage here. Full-layer
    // rebuilds re-decode every signature PNG already on the page, which
    // caused the "very laggy with texts and signatures" report 2026-06-15.
    // Add/remove/undo all use targeted DOM updates instead.
    const idx = pageNum - 1;
    if (S.pages[idx]) {
      S.pages[idx].annotLayer.appendChild(createAnnotEl(ann, pageNum));
    }
  }

  // Targeted helper: clear the .selected class from every annot on a page
  // without rebuilding the layer. Used for plain "click empty area to
  // deselect" interactions, which were previously full rebuilds per click.
  function clearSelectionOnPage(pageNum) {
    const idx = pageNum - 1;
    const layer = S.pages[idx] && S.pages[idx].annotLayer;
    if (!layer) return;
    layer.querySelectorAll('.annot.selected').forEach(n => {
      n.classList.remove('selected');
    });
  }

  function selectAnnot(ann, el, pageNum) {
    if (S.selected === ann) return;
    clearSelectionOnPage(pageNum);
    el.classList.add('selected');
    S.selected = ann;
  }

  function removeAnn(pageNum, ann) {
    const list = getAnns(pageNum);
    const idx = list.indexOf(ann);
    if (idx >= 0) {
      list.splice(idx, 1);
      pushUndo({ action: 'remove', page: pageNum, ann, idx });
      if (S.selected === ann) S.selected = null;
      // Targeted DOM remove — much faster than the previous full-layer
      // rebuild, especially on pages with many signature PNGs.
      const el = annElMap.get(ann);
      if (el && el.parentNode) el.parentNode.removeChild(el);
      annElMap.delete(ann);
    }
  }

  // ann -> DOM element. Lets removeAnn / selection target individual elements
  // instead of rebuilding the whole annotation layer (lag report 2026-06-15).
  const annElMap = new WeakMap();

  function pushUndo(entry) {
    S.undoStack.push(entry);
    S.redoStack = [];
    updateUndoRedoUI();
  }

  function undo() {
    if (!S.undoStack.length) return;
    const e = S.undoStack.pop();
    const list = getAnns(e.page);
    if (e.action === 'add') {
      const i = list.indexOf(e.ann);
      if (i >= 0) list.splice(i, 1);
    } else if (e.action === 'remove') {
      list.splice(e.idx, 0, e.ann);
    } else if (e.action === 'move') {
      e.ann.x = e.oldX; e.ann.y = e.oldY;
    }
    S.redoStack.push(e);
    S.selected = null;
    renderAnnotationsForPage(e.page);
    updateUndoRedoUI();
  }

  function redo() {
    if (!S.redoStack.length) return;
    const e = S.redoStack.pop();
    const list = getAnns(e.page);
    if (e.action === 'add') {
      list.push(e.ann);
    } else if (e.action === 'remove') {
      const i = list.indexOf(e.ann);
      if (i >= 0) list.splice(i, 1);
    } else if (e.action === 'move') {
      e.ann.x = e.newX; e.ann.y = e.newY;
    }
    S.undoStack.push(e);
    S.selected = null;
    renderAnnotationsForPage(e.page);
    updateUndoRedoUI();
  }

  function updateUndoRedoUI() {
    $('#btn-undo').disabled = !S.undoStack.length;
    $('#btn-redo').disabled = !S.redoStack.length;
  }

  // =============================================================
  // RENDER ANNOTATIONS TO DOM
  // =============================================================
  function renderAnnotationsForPage(pageNum) {
    const idx = pageNum - 1;
    if (!S.pages[idx]) return;
    const layer = S.pages[idx].annotLayer;
    layer.innerHTML = '';

    const anns = getAnns(pageNum);
    for (const ann of anns) {
      const el = createAnnotEl(ann, pageNum);
      layer.appendChild(el);
    }
  }

  function createAnnotEl(ann, pageNum) {
    const el = document.createElement('div');
    el.className = `annot annot-${ann.type}`;
    el.style.left = ann.x + 'px';
    el.style.top = ann.y + 'px';
    if (ann.width) el.style.width = ann.width + 'px';
    if (ann.height) el.style.height = ann.height + 'px';
    if (ann === S.selected) el.classList.add('selected');
    annElMap.set(ann, el);

    // Delete button
    const del = document.createElement('button');
    del.className = 'annot-del';
    del.textContent = '\u00d7';
    del.addEventListener('mousedown', e => { e.stopPropagation(); removeAnn(pageNum, ann); });
    el.appendChild(del);

    // Resize handle
    const resize = document.createElement('div');
    resize.className = 'annot-resize';
    el.appendChild(resize);

    // Type content
    buildAnnotContent(el, ann, pageNum);

    // Drag
    el.addEventListener('mousedown', e => {
      if (e.target === del) return;
      e.stopPropagation();
      // Targeted class toggle instead of full layer rebuild — selecting an
      // annotation no longer re-decodes every other signature on the page.
      selectAnnot(ann, el, pageNum);

      if (e.target === resize) {
        startResize(e, ann, el, pageNum);
        return;
      }
      startDrag(e, ann, el, pageNum);
    });

    // Double-click edit for text
    if (ann.type === 'text' || ann.type === 'fill-text') {
      el.addEventListener('dblclick', e => {
        e.stopPropagation();
        inlineEditText(ann, el, pageNum);
      });
    }

    // Checkbox toggle
    if (ann.type === 'fill-check' || ann.type === 'form-checkbox') {
      el.addEventListener('dblclick', e => {
        e.stopPropagation();
        ann.checked = !ann.checked;
        renderAnnotationsForPage(pageNum);
      });
    }

    // Sticky note double-click to edit
    if (ann.type === 'sticky-note') {
      el.addEventListener('dblclick', e => {
        e.stopPropagation();
        editStickyNote(ann, pageNum);
      });
    }

    return el;
  }

  function buildAnnotContent(el, ann) {
    switch (ann.type) {
      case 'text':
      case 'fill-text':
      case 'add-text': {
        const span = document.createElement('div');
        span.className = 'annot-text-content';
        span.textContent = ann.text;
        span.style.fontSize = ann.fontSize + 'px';
        span.style.color = ann.color;
        span.style.fontFamily = ann.fontFamily || 'Helvetica, Arial, sans-serif';
        if (ann.bold) span.style.fontWeight = 'bold';
        if (ann.italic) span.style.fontStyle = 'italic';
        el.appendChild(span);
        break;
      }
      case 'signature':
      case 'initials':
      case 'image':
      case 'add-image': {
        const img = document.createElement('img');
        img.src = ann.dataUrl;
        img.draggable = false;
        el.appendChild(img);
        break;
      }
      case 'freehand': {
        const c = document.createElement('canvas');
        c.width = ann.width || 200;
        c.height = ann.height || 200;
        const cx = c.getContext('2d');
        cx.strokeStyle = ann.color || '#000';
        cx.lineWidth = ann.strokeWidth || 2;
        cx.lineCap = 'round';
        cx.lineJoin = 'round';
        if (ann.points && ann.points.length > 1) {
          cx.beginPath();
          cx.moveTo(ann.points[0].x, ann.points[0].y);
          for (let i = 1; i < ann.points.length; i++) cx.lineTo(ann.points[i].x, ann.points[i].y);
          cx.stroke();
        }
        el.appendChild(c);
        break;
      }
      case 'highlight': break; // CSS handles it
      case 'whiteout':
        el.style.background = 'white';
        break;
      case 'redaction':
        el.classList.add('annot-redaction');
        el.style.background = '#000';
        break;
      case 'underline':
        el.style.borderBottomColor = ann.color || '#e5322d';
        break;
      case 'strikethrough':
        el.style.color = ann.color || '#e5322d';
        break;
      case 'shape-rect':
      case 'shape-ellipse':
      case 'shape-line':
      case 'shape-arrow': {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', ann.width || 100);
        svg.setAttribute('height', ann.height || 100);
        svg.style.overflow = 'visible';
        const stroke = ann.color || '#e5322d';
        const sw = ann.strokeWidth || 2;
        const fill = ann.fill ? ann.color : 'none';
        const opacity = (ann.opacity || 100) / 100;

        if (ann.type === 'shape-rect') {
          const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          r.setAttribute('x', sw); r.setAttribute('y', sw);
          r.setAttribute('width', Math.max(1, (ann.width || 100) - sw * 2));
          r.setAttribute('height', Math.max(1, (ann.height || 100) - sw * 2));
          r.setAttribute('stroke', stroke); r.setAttribute('stroke-width', sw);
          r.setAttribute('fill', fill); r.setAttribute('opacity', opacity);
          svg.appendChild(r);
        } else if (ann.type === 'shape-ellipse') {
          const ell = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
          ell.setAttribute('cx', (ann.width || 100) / 2);
          ell.setAttribute('cy', (ann.height || 100) / 2);
          ell.setAttribute('rx', Math.max(1, (ann.width || 100) / 2 - sw));
          ell.setAttribute('ry', Math.max(1, (ann.height || 100) / 2 - sw));
          ell.setAttribute('stroke', stroke); ell.setAttribute('stroke-width', sw);
          ell.setAttribute('fill', fill); ell.setAttribute('opacity', opacity);
          svg.appendChild(ell);
        } else if (ann.type === 'shape-line') {
          const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          ln.setAttribute('x1', 0); ln.setAttribute('y1', ann.height || 50);
          ln.setAttribute('x2', ann.width || 100); ln.setAttribute('y2', 0);
          ln.setAttribute('stroke', stroke); ln.setAttribute('stroke-width', sw);
          ln.setAttribute('opacity', opacity);
          svg.appendChild(ln);
        } else if (ann.type === 'shape-arrow') {
          const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          ln.setAttribute('x1', 0); ln.setAttribute('y1', (ann.height || 20) / 2);
          ln.setAttribute('x2', (ann.width || 100) - 10); ln.setAttribute('y2', (ann.height || 20) / 2);
          ln.setAttribute('stroke', stroke); ln.setAttribute('stroke-width', sw);
          const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
          const w = ann.width || 100, h = (ann.height || 20) / 2;
          poly.setAttribute('points', `${w},${h} ${w - 12},${h - 6} ${w - 12},${h + 6}`);
          poly.setAttribute('fill', stroke);
          g.setAttribute('opacity', opacity);
          g.appendChild(ln); g.appendChild(poly);
          svg.appendChild(g);
        }
        el.classList.add('annot-shape');
        el.style.pointerEvents = 'auto';
        el.appendChild(svg);
        break;
      }
      case 'sticky-note':
        el.style.background = ann.color || '#FFEB3B';
        el.title = ann.text || '';
        el.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#333" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>';
        // re-append del/resize
        el.appendChild(el.querySelector('.annot-del'));
        el.appendChild(el.querySelector('.annot-resize'));
        break;
      case 'stamp':
        el.textContent = ann.text;
        el.style.color = ann.color;
        el.style.borderColor = ann.color;
        // re-append
        const d2 = el.querySelector('.annot-del');
        const r2 = el.querySelector('.annot-resize');
        if (d2) el.appendChild(d2);
        if (r2) el.appendChild(r2);
        break;
      case 'fill-check':
        el.textContent = ann.checked ? '\u2713' : '\u2713';
        el.style.color = ann.checked ? (ann.color || '#000') : 'transparent';
        el.style.fontSize = (ann.fontSize || 18) + 'px';
        break;
      case 'fill-x':
        el.textContent = '\u2717';
        el.style.color = ann.color || '#000';
        el.style.fontSize = (ann.fontSize || 18) + 'px';
        break;
      case 'fill-dot':
        el.innerHTML = '<svg width="12" height="12"><circle cx="6" cy="6" r="5" fill="' + (ann.color || '#000') + '"/></svg>';
        break;
      case 'fill-circle':
        el.style.border = '2px solid ' + (ann.color || '#000');
        el.style.borderRadius = '50%';
        el.style.width = (ann.width || 24) + 'px';
        el.style.height = (ann.height || 24) + 'px';
        break;
      case 'fill-date': {
        const span = document.createElement('div');
        span.className = 'annot-text-content';
        span.textContent = ann.text;
        span.style.fontSize = (ann.fontSize || 12) + 'px';
        span.style.color = ann.color || '#000';
        el.appendChild(span);
        break;
      }
      case 'callout': {
        const span = document.createElement('div');
        span.className = 'annot-text-content';
        span.textContent = ann.text;
        span.style.fontSize = (ann.fontSize || 12) + 'px';
        span.style.color = ann.color || '#000';
        span.style.background = 'rgba(255,255,200,0.95)';
        span.style.border = '1px solid #cca';
        span.style.borderRadius = '4px';
        span.style.padding = '6px 8px';
        el.appendChild(span);
        break;
      }
      case 'form-text': {
        el.classList.add('annot-form-field');
        el.textContent = ann.placeholder || 'Text Field';
        break;
      }
      case 'form-checkbox': {
        el.classList.add('annot-form-field');
        el.textContent = ann.checked ? '[\u2713]' : '[ ]';
        break;
      }
      case 'form-radio': {
        el.classList.add('annot-form-field');
        el.innerHTML = ann.selected ? '(\u25cf)' : '( )';
        break;
      }
      case 'form-dropdown': {
        el.classList.add('annot-form-field');
        el.textContent = ann.placeholder || 'Dropdown \u25bc';
        break;
      }
      case 'form-signature': {
        el.classList.add('annot-form-field');
        el.textContent = 'Signature';
        el.style.minWidth = '120px';
        el.style.minHeight = '40px';
        el.style.fontStyle = 'italic';
        break;
      }
      case 'form-date': {
        el.classList.add('annot-form-field');
        el.textContent = ann.placeholder || 'MM/DD/YYYY';
        break;
      }
      case 'watermark': {
        el.classList.add('annot-watermark');
        el.textContent = ann.text;
        el.style.fontSize = ann.fontSize + 'px';
        el.style.color = ann.color;
        el.style.opacity = ann.opacity;
        el.style.transform = `rotate(${ann.rotation}deg)`;
        el.style.pointerEvents = 'none';
        el.style.cursor = 'default';
        break;
      }
    }
  }

  // Inline text editing
  function inlineEditText(ann, el, pageNum) {
    const content = el.querySelector('.annot-text-content');
    if (!content) return;
    content.contentEditable = true;
    content.focus();
    content.style.outline = '1px solid var(--accent)';
    content.style.background = 'rgba(255,255,255,0.95)';
    content.style.color = '#000';
    content.style.minWidth = '60px';

    const finish = () => {
      content.contentEditable = false;
      content.style.outline = '';
      content.style.background = '';
      content.style.color = ann.color;
      ann.text = content.textContent;
    };

    content.addEventListener('blur', finish, { once: true });
    content.addEventListener('keydown', e => {
      if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        content.blur();
      }
    });
  }

  function editStickyNote(ann, pageNum) {
    const noteText = $('#note-text');
    const noteColor = $('#note-color');
    noteText.value = ann.text || '';
    noteColor.value = ann.color || '#FFEB3B';
    showModal('modal-note');
    $('#note-apply').onclick = () => {
      ann.text = noteText.value;
      ann.color = noteColor.value;
      hideModal('modal-note');
      renderAnnotationsForPage(pageNum);
    };
  }

  // =============================================================
  // DRAG & RESIZE
  // =============================================================
  function startDrag(e, ann, el, pageNum) {
    const sx = e.clientX, sy = e.clientY;
    const ox = ann.x, oy = ann.y;

    const onMove = ev => {
      ann.x = ox + (ev.clientX - sx);
      ann.y = oy + (ev.clientY - sy);
      el.style.left = ann.x + 'px';
      el.style.top = ann.y + 'px';
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (ann.x !== ox || ann.y !== oy) {
        pushUndo({ action: 'move', page: pageNum, ann, oldX: ox, oldY: oy, newX: ann.x, newY: ann.y });
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function startResize(e, ann, el, pageNum) {
    e.stopPropagation();
    const sx = e.clientX, sy = e.clientY;
    const ow = ann.width || el.offsetWidth;
    const oh = ann.height || el.offsetHeight;

    const onMove = ev => {
      ann.width = Math.max(20, ow + (ev.clientX - sx));
      ann.height = Math.max(14, oh + (ev.clientY - sy));
      el.style.width = ann.width + 'px';
      el.style.height = ann.height + 'px';
      const img = el.querySelector('img');
      if (img) { img.style.width = ann.width + 'px'; img.style.height = ann.height + 'px'; }
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // =============================================================
  // ANNOTATION LAYER CLICK HANDLER
  // =============================================================
  // Place an editable text box directly on the page — no modal.
  // opts.width / opts.height (canvas pixels) let a caller pre-size the box
  // to a specific field (used by the Fill & Sign hint-click flow so the
  // box snaps to the form field instead of floating).
  function placeInlineTextBox(x, y, pageNum, fontSize, color, fontFamily, bold, opts) {
    try {
      const idx = pageNum - 1;
      const layer = S.pages[idx]?.annotLayer;
      if (!layer) { console.error('No annotation layer for page', pageNum); return; }

      fontSize = fontSize || 14;
      color = color || '#000000';
      fontFamily = fontFamily || 'Helvetica';
      opts = opts || {};

      const box = document.createElement('div');
      box.contentEditable = 'true';
      box.className = 'inline-text-box';
      box.style.position = 'absolute';
      box.style.left = x + 'px';
      box.style.top = y + 'px';
      box.style.minWidth = '80px';
      box.style.minHeight = (fontSize * 1.5) + 'px';
      box.style.fontSize = fontSize + 'px';
      box.style.color = color;
      box.style.fontFamily = fontFamily + ', sans-serif';
      box.style.fontWeight = bold ? 'bold' : 'normal';
      box.style.background = 'rgba(255,255,255,0.95)';
      box.style.border = '2px solid #1473e6';
      box.style.padding = '4px 6px';
      box.style.outline = 'none';
      box.style.zIndex = '20';
      box.style.whiteSpace = 'pre-wrap';
      box.style.wordBreak = 'break-word';
      box.style.cursor = 'text';
      box.style.boxShadow = '0 2px 12px rgba(0,0,0,0.2)';
      box.style.borderRadius = '2px';
      // Cap width so pasted long lines wrap instead of running off the page.
      const layerW = layer.offsetWidth || layer.clientWidth || 600;
      box.style.maxWidth = Math.max(120, layerW - x - 16) + 'px';
      // Explicit dimensions from a Fill-hint click override the free-form
      // sizing so the editor exactly fills the target field.
      if (opts.width)  box.style.width  = opts.width  + 'px';
      if (opts.height) box.style.minHeight = Math.max(fontSize * 1.4, opts.height) + 'px';

      layer.appendChild(box);

      // Focus after a tick so the browser registers the element
      requestAnimationFrame(() => box.focus());

      let finalized = false;
      // Read multi-line text from a contenteditable preserving paragraph breaks.
      // contentEditable inserts <div> or <br> on Enter/paste; innerText preserves
      // those as \n; textContent collapses them — so use innerText.
      const readText = () => (box.innerText || box.textContent || '').replace(/ /g, ' ').replace(/\n{3,}/g, '\n\n').trimEnd();
      const finalize = () => {
        if (finalized) return;
        finalized = true;
        const text = readText();
        // Capture the final size so the annotation preserves user-resized width
        const finalWidth = box.offsetWidth;
        const finalHeight = box.offsetHeight;
        box.remove();
        if (text) {
          addAnn(pageNum, {
            type: 'add-text', x, y, text,
            fontSize, color, fontFamily, bold,
            width: finalWidth, height: finalHeight,
          });
        }
      };

      // Paste handler: insert as plain text so we don't drag in Word/HTML
      // formatting that breaks layout. The browser default keeps newlines
      // as \n inside the text node (with pre-wrap they render as line breaks),
      // so users get a usable multi-line block instead of overlapping lines.
      box.addEventListener('paste', (ev) => {
        ev.preventDefault();
        const text = (ev.clipboardData || window.clipboardData).getData('text/plain') || '';
        // Use the Selection API; document.execCommand is deprecated but still
        // works everywhere and gives the right undo/cursor behavior.
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount) {
          box.textContent += text;
        } else {
          const range = sel.getRangeAt(0);
          range.deleteContents();
          range.insertNode(document.createTextNode(text));
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      });

      box.addEventListener('blur', finalize);
      box.addEventListener('keydown', ev => {
        // Enter inserts a newline; only finalize on Ctrl/Cmd+Enter or Escape,
        // or by clicking outside the box. This lets users paste long
        // multi-line content without it being truncated to a single line.
        if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); box.blur(); }
        if (ev.key === 'Escape') { box.textContent = ''; box.blur(); }
      });
    } catch (err) {
      console.error('placeInlineTextBox error:', err);
    }
  }

  let lastAnnotAction = 0;
  function onAnnotLayerDown(e, idx) {
    // Debounce: prevent double-fire from mousedown+click
    const now = Date.now();
    if (now - lastAnnotAction < 200) return;
    lastAnnotAction = now;

    const pageNum = idx + 1;
    const rect = S.pages[idx].annotLayer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const tool = S.activeTool;
    if (!tool) {
      S.selected = null;
      renderAnnotationsForPage(pageNum);
      return;
    }

    switch (tool) {
      case 'edit-text':
        // Handled by text overlay system, ignore raw clicks
        return;
      case 'add-text':
        placeInlineTextBox(x, y, pageNum, parseInt($('#prop-size').value), $('#prop-color').value, $('#prop-font').value, $('#prop-bold').checked);
        showStatus('Type or paste — Enter for new line, Ctrl+Enter or click outside to finish');
        return;
      case 'fill-text':
        placeInlineTextBox(x, y, pageNum, getFillSize(), getFillColor(), 'Helvetica', false);
        showStatus('Type or paste — Enter for new line, Ctrl+Enter or click outside to finish');
        return;
      case 'add-image':
        imageFileInput._pageNum = pageNum;
        imageFileInput._x = x;
        imageFileInput._y = y;
        imageFileInput.click();
        return;
      case 'sign':
        openSignatureModal(x, y, pageNum, 'signature');
        return;
      case 'initials':
        openSignatureModal(x, y, pageNum, 'initials');
        return;
      case 'sticky-note':
        openNoteModal(x, y, pageNum);
        return;
      case 'stamp':
        openStampModal(x, y, pageNum);
        return;
      case 'callout':
        openCalloutModal(x, y, pageNum);
        return;
      case 'watermark':
        openWatermarkModal(pageNum);
        return;

      case 'fill-check':
        addAnn(pageNum, { type: 'fill-check', x, y, checked: true, color: getFillColor(), fontSize: getFillSize() });
        return;
      case 'fill-x':
        addAnn(pageNum, { type: 'fill-x', x, y, color: getFillColor(), fontSize: getFillSize() });
        return;
      case 'fill-dot':
        addAnn(pageNum, { type: 'fill-dot', x, y, color: getFillColor() });
        return;
      case 'fill-circle':
        addAnn(pageNum, { type: 'fill-circle', x, y, width: 24, height: 24, color: getFillColor() });
        return;
      case 'fill-date':
        addAnn(pageNum, {
          type: 'fill-date', x, y,
          text: new Date().toLocaleDateString(),
          fontSize: getFillSize(), color: getFillColor(),
        });
        setTool(null);
        return;

      // Form fields
      case 'form-text':
        addAnn(pageNum, { type: 'form-text', x, y, width: 160, height: 28, placeholder: 'Text Field' });
        return;
      case 'form-checkbox':
        addAnn(pageNum, { type: 'form-checkbox', x, y, width: 28, height: 28, checked: false });
        return;
      case 'form-radio':
        addAnn(pageNum, { type: 'form-radio', x, y, width: 28, height: 28, selected: false });
        return;
      case 'form-dropdown':
        addAnn(pageNum, { type: 'form-dropdown', x, y, width: 160, height: 28, placeholder: 'Dropdown' });
        return;
      case 'form-signature':
        addAnn(pageNum, { type: 'form-signature', x, y, width: 180, height: 50 });
        return;
      case 'form-date':
        addAnn(pageNum, { type: 'form-date', x, y, width: 120, height: 28, placeholder: 'MM/DD/YYYY' });
        return;

      case 'add-link':
        // Simple link rectangle
        startDrawRect(e, rect, (rx, ry, rw, rh) => {
          const url = prompt('Enter URL:');
          if (url) {
            addAnn(pageNum, { type: 'highlight', x: rx, y: ry, width: rw, height: rh, color: 'rgba(20,115,230,0.15)' });
          }
        });
        return;
      case 'crop':
        // Crop is visual-only here
        return;
    }

    // Redaction — drag a box to permanently black out the region on save
    if (tool === 'redact') {
      startDrawRect(e, rect, (rx, ry, rw, rh) => {
        if (rw > 3 || rh > 3) {
          addAnn(pageNum, { type: 'redaction', x: rx, y: ry, width: rw, height: rh });
        }
      });
      return;
    }

    // Drawing tools
    if (tool === 'highlight' || tool === 'underline' || tool === 'strikethrough') {
      startDrawRect(e, rect, (rx, ry, rw, rh) => {
        if (rw > 3 || rh > 3) {
          addAnn(pageNum, {
            type: tool, x: rx, y: ry, width: rw, height: rh,
            color: getCommentColor(),
          });
        }
      });
      return;
    }

    if (tool === 'freehand') {
      startFreehand(e, rect, pageNum);
      return;
    }

    if (tool === 'eraser') {
      // Find annotation under cursor and remove
      const anns = getAnns(pageNum);
      for (let i = anns.length - 1; i >= 0; i--) {
        const a = anns[i];
        const aw = a.width || 50, ah = a.height || 20;
        if (x >= a.x && x <= a.x + aw && y >= a.y && y <= a.y + ah) {
          removeAnn(pageNum, a);
          break;
        }
      }
      return;
    }

    if (['shape-rect', 'shape-ellipse', 'shape-line', 'shape-arrow'].includes(tool)) {
      startDrawRect(e, rect, (rx, ry, rw, rh) => {
        if (rw > 3 || rh > 3) {
          addAnn(pageNum, {
            type: tool, x: rx, y: ry, width: rw, height: rh,
            color: getCommentColor(),
            strokeWidth: getCommentStroke(),
            fill: getCommentFill(),
            opacity: getCommentOpacity(),
          });
        }
      });
      return;
    }
  }

  // =============================================================
  // DRAWING HELPERS
  // =============================================================
  function startDrawRect(e, layerRect, callback) {
    const sx = e.clientX - layerRect.left;
    const sy = e.clientY - layerRect.top;
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:999;cursor:crosshair;';
    document.body.appendChild(overlay);

    const preview = document.createElement('div');
    preview.style.cssText = 'position:fixed;border:2px dashed #1473e6;pointer-events:none;z-index:1000;';
    document.body.appendChild(preview);

    const onMove = ev => {
      const cx = ev.clientX - layerRect.left;
      const cy = ev.clientY - layerRect.top;
      const l = Math.min(sx, cx), t = Math.min(sy, cy);
      const w = Math.abs(cx - sx), h = Math.abs(cy - sy);
      preview.style.left = (layerRect.left + l) + 'px';
      preview.style.top = (layerRect.top + t) + 'px';
      preview.style.width = w + 'px';
      preview.style.height = h + 'px';
    };
    const onUp = ev => {
      overlay.remove();
      preview.remove();
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const cx = ev.clientX - layerRect.left;
      const cy = ev.clientY - layerRect.top;
      callback(Math.min(sx, cx), Math.min(sy, cy), Math.abs(cx - sx), Math.abs(cy - sy));
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function startFreehand(e, layerRect, pageNum) {
    const sx = e.clientX - layerRect.left;
    const sy = e.clientY - layerRect.top;
    const points = [{ x: 0, y: 0 }];

    const overlay = document.createElement('canvas');
    overlay.width = layerRect.width;
    overlay.height = layerRect.height;
    overlay.style.cssText = `position:fixed;left:${layerRect.left}px;top:${layerRect.top}px;z-index:999;pointer-events:none;`;
    document.body.appendChild(overlay);
    const octx = overlay.getContext('2d');
    octx.strokeStyle = getCommentColor();
    octx.lineWidth = getCommentStroke();
    octx.lineCap = 'round';
    octx.lineJoin = 'round';

    const onMove = ev => {
      const cx = ev.clientX - layerRect.left - sx;
      const cy = ev.clientY - layerRect.top - sy;
      points.push({ x: cx, y: cy });
      octx.clearRect(0, 0, overlay.width, overlay.height);
      octx.beginPath();
      octx.moveTo(sx, sy);
      for (const p of points) octx.lineTo(sx + p.x, sy + p.y);
      octx.stroke();
    };
    const onUp = () => {
      overlay.remove();
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (points.length < 2) return;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of points) {
        minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
      }
      const pad = getCommentStroke() + 2;
      const w = maxX - minX + pad * 2, h = maxY - minY + pad * 2;
      const norm = points.map(p => ({ x: p.x - minX + pad, y: p.y - minY + pad }));
      addAnn(pageNum, {
        type: 'freehand', x: sx + minX - pad, y: sy + minY - pad,
        width: w, height: h, points: norm,
        color: getCommentColor(), strokeWidth: getCommentStroke(),
      });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // =============================================================
  // TOOL OPTION GETTERS
  // =============================================================
  function getCommentColor() { return $('#comment-color').value; }
  function getCommentStroke() { return parseInt($('#comment-stroke').value); }
  function getCommentOpacity() { return parseInt($('#comment-opacity').value); }
  function getCommentFill() { return $('#comment-fill').value === 'fill'; }
  function getFillColor() { return $('#fill-color').value; }
  function getFillSize() { return parseInt($('#fill-size').value); }

  // =============================================================
  // MODALS
  // =============================================================
  function showModal(id) { document.getElementById(id).style.display = 'flex'; }
  function hideModal(id) { document.getElementById(id).style.display = 'none'; }

  // Close modal buttons
  $$('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => hideModal(btn.dataset.close));
  });

  // Modal tab switching
  $$('.mtab').forEach(btn => {
    btn.addEventListener('click', () => {
      const parent = btn.closest('.modal-box');
      parent.querySelectorAll('.mtab').forEach(b => b.classList.remove('active'));
      parent.querySelectorAll('.mtab-pane').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.mtab).classList.add('active');
    });
  });

  // --- Text Modal ---
  let textTarget = { x: 0, y: 0, pageNum: 1, isFill: false };

  function openTextModal(x, y, pageNum, isFill) {
    textTarget = { x, y, pageNum, isFill };
    $('#modal-text-input').value = '';
    showModal('modal-text');
    setTimeout(() => $('#modal-text-input').focus(), 80);
  }

  $('#mt-apply').addEventListener('click', () => {
    const text = $('#modal-text-input').value.trim();
    if (!text) return;
    const type = textTarget.isFill ? 'fill-text' : 'add-text';
    addAnn(textTarget.pageNum, {
      type, x: textTarget.x, y: textTarget.y, text,
      fontSize: parseInt($('#mt-size').value),
      color: $('#mt-color').value,
      fontFamily: $('#mt-font').value,
      bold: $('#mt-bold').checked,
    });
    hideModal('modal-text');
    if (textTarget.isFill) { /* keep tool active */ } else { setTool(null); }
  });

  // --- Sticky Note Modal ---
  let noteTarget = { x: 0, y: 0, pageNum: 1 };

  function openNoteModal(x, y, pageNum) {
    noteTarget = { x, y, pageNum };
    $('#note-text').value = '';
    showModal('modal-note');
    setTimeout(() => $('#note-text').focus(), 80);
  }

  $('#note-apply').addEventListener('click', () => {
    addAnn(noteTarget.pageNum, {
      type: 'sticky-note', x: noteTarget.x, y: noteTarget.y,
      text: $('#note-text').value, color: $('#note-color').value,
    });
    hideModal('modal-note');
  });

  // --- Callout Modal ---
  function openCalloutModal(x, y, pageNum) {
    textTarget = { x, y, pageNum };
    $('#modal-text-input').value = '';
    showModal('modal-text');
    // Override apply
    const orig = $('#mt-apply').onclick;
    $('#mt-apply').onclick = () => {
      const text = $('#modal-text-input').value.trim();
      if (!text) return;
      addAnn(pageNum, {
        type: 'callout', x, y, text,
        fontSize: parseInt($('#mt-size').value),
        color: $('#mt-color').value,
      });
      hideModal('modal-text');
      $('#mt-apply').onclick = orig;
    };
  }

  // --- Stamp Modal ---
  let stampTarget = { x: 0, y: 0, pageNum: 1 };

  function openStampModal(x, y, pageNum) {
    stampTarget = { x, y, pageNum };
    const grid = $('#stamp-grid');
    grid.innerHTML = '';
    for (const s of STAMPS) {
      const btn = document.createElement('div');
      btn.className = 'stamp-opt';
      btn.textContent = s.text;
      btn.style.color = s.color;
      btn.style.borderColor = s.border;
      btn.addEventListener('click', () => {
        addAnn(pageNum, {
          type: 'stamp', x, y, text: s.text, color: s.color,
        });
        hideModal('modal-stamp');
      });
      grid.appendChild(btn);
    }
    showModal('modal-stamp');
  }

  // --- Watermark Modal ---
  let wmPageNum = 1;

  function openWatermarkModal(pageNum) {
    wmPageNum = pageNum;
    showModal('modal-watermark');
  }

  $('#wm-opacity').addEventListener('input', () => {
    $('#wm-opacity-val').textContent = $('#wm-opacity').value + '%';
  });

  $('#wm-apply').addEventListener('click', () => {
    const text = $('#wm-text').value.trim();
    if (!text) return;
    const fontSize = parseInt($('#wm-size').value);
    const color = $('#wm-color').value;
    const opacity = parseInt($('#wm-opacity').value) / 100;
    const rotation = parseInt($('#wm-rotation').value);
    const allPages = $('#wm-all').checked;

    const pages = allPages ? Array.from({ length: S.totalPages }, (_, i) => i + 1) : [wmPageNum];
    for (const pn of pages) {
      const pg = S.pages[pn - 1];
      if (!pg) continue;
      const cx = (pg.canvas.width || 600) / 2 - (text.length * fontSize * 0.3);
      const cy = (pg.canvas.height || 800) / 2;
      addAnn(pn, {
        type: 'watermark', x: cx, y: cy, text, fontSize, color, opacity, rotation,
      });
    }
    hideModal('modal-watermark');
    setTool(null);
  });

  // --- Signature Modal ---
  let sigTarget = { x: 0, y: 0, pageNum: 1, mode: 'signature' };
  const sigCanvas = $('#sig-canvas');
  const sigCtx = sigCanvas.getContext('2d');
  let sigDrawing = false;

  function openSignatureModal(x, y, pageNum, mode) {
    sigTarget = { x, y, pageNum, mode };
    renderSignatureLibrary();
    clearSigCanvas();
    $('#sig-text-input').value = '';
    $('#sig-upload-preview').style.display = 'none';
    $('#sig-upload-preview').src = '';
    // Always show modal so users can switch between saved signatures (issue #2)
    // and reuse them across sessions (issue #3). The library tab is shown first
    // when there are saved entries; otherwise default to Draw.
    const hasSaved = S.signatureLibrary.some(s => s.kind === mode);
    selectSigTab(hasSaved ? 'sig-library' : 'sig-draw');
    // Update title to reflect mode
    const titleEl = $('#modal-signature .modal-head h3');
    if (titleEl) titleEl.textContent = mode === 'initials' ? 'Initials' : 'Signature';
    showModal('modal-signature');
  }

  function selectSigTab(id) {
    $$('#modal-signature .mtab').forEach(b => b.classList.toggle('active', b.dataset.mtab === id));
    $$('#modal-signature .mtab-pane').forEach(p => p.classList.toggle('active', p.id === id));
  }

  function renderSignatureLibrary() {
    const grid = $('#sig-library-grid');
    if (!grid) return;
    grid.innerHTML = '';
    const entries = S.signatureLibrary.filter(s => s.kind === sigTarget.mode);
    if (!entries.length) {
      const empty = document.createElement('p');
      empty.className = 'sig-library-empty';
      empty.textContent = 'No saved ' + (sigTarget.mode === 'initials' ? 'initials' : 'signatures') + ' yet. Use Draw, Type, or Upload to create one.';
      grid.appendChild(empty);
      return;
    }
    for (const entry of entries) {
      const card = document.createElement('div');
      card.className = 'sig-library-card';
      card.title = 'Click to insert';
      const img = document.createElement('img');
      img.src = entry.dataUrl;
      card.appendChild(img);
      const del = document.createElement('button');
      del.className = 'sig-library-del';
      del.textContent = '×';
      del.title = 'Delete';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        removeFromSignatureLibrary(entry.id);
        renderSignatureLibrary();
      });
      card.appendChild(del);
      card.addEventListener('click', () => {
        // Library entries were already stripped at add time — skip the
        // redundant strip pass on reuse.
        applySignatureFromDataUrl(entry.dataUrl, /*addToLib*/ false, /*alreadyClean*/ true);
      });
      grid.appendChild(card);
    }
  }

  async function applySignatureFromDataUrl(dataUrl, addToLib, alreadyClean) {
    if (!dataUrl) return;
    // Strip any white background — but skip if the caller already knows the
    // image is transparent (canvas-drawn, typed signatures, or a library
    // entry that was stripped when it was first added). This avoids a costly
    // pixel pass on every reuse, which was a meaningful share of the
    // 2026-06-15 "very laggy" report.
    if (!alreadyClean) dataUrl = await stripWhiteBg(dataUrl);
    if (addToLib) {
      const entry = addToSignatureLibrary(dataUrl, sigTarget.mode);
      if (sigTarget.mode === 'signature') S.signatureData = entry.dataUrl;
      else S.initialsData = entry.dataUrl;
    }
    // Size signature relative to natural aspect so signatures don't look stretched
    const img = new Image();
    img.onload = () => {
      const targetW = sigTarget.mode === 'initials' ? 80 : 180;
      const aspect = img.naturalHeight / img.naturalWidth || 0.35;
      const w = targetW;
      const h = Math.max(20, Math.round(targetW * aspect));
      // Clamp position so signature fits on the page (issue #4)
      const idx = sigTarget.pageNum - 1;
      const pg = S.pages[idx];
      const layerW = pg?.annotLayer.offsetWidth || pg?.canvas.width || 9999;
      const layerH = pg?.annotLayer.offsetHeight || pg?.canvas.height || 9999;
      const x = Math.max(0, Math.min(sigTarget.x, layerW - w));
      const y = Math.max(0, Math.min(sigTarget.y, layerH - h));
      addAnn(sigTarget.pageNum, {
        type: sigTarget.mode, x, y, width: w, height: h, dataUrl,
      });
      hideModal('modal-signature');
      setTool(null);
    };
    img.onerror = () => {
      hideModal('modal-signature');
      setTool(null);
    };
    img.src = dataUrl;
  }

  function clearSigCanvas() {
    const w = sigCanvas.parentElement ? Math.max(400, sigCanvas.parentElement.offsetWidth - 36) : 500;
    sigCanvas.width = w;
    sigCanvas.height = 180;
    // Transparent — never fill with white. White fill bakes a box around the
    // signature when flattened into the PDF (issue #1).
    sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
  }

  sigCanvas.addEventListener('mousedown', e => {
    sigDrawing = true;
    const r = sigCanvas.getBoundingClientRect();
    const sx = sigCanvas.width / r.width, sy = sigCanvas.height / r.height;
    sigCtx.strokeStyle = $('#sig-color').value;
    sigCtx.lineWidth = parseInt($('#sig-width').value);
    sigCtx.lineCap = 'round';
    sigCtx.lineJoin = 'round';
    sigCtx.beginPath();
    sigCtx.moveTo((e.clientX - r.left) * sx, (e.clientY - r.top) * sy);
  });
  sigCanvas.addEventListener('mousemove', e => {
    if (!sigDrawing) return;
    const r = sigCanvas.getBoundingClientRect();
    const sx = sigCanvas.width / r.width, sy = sigCanvas.height / r.height;
    sigCtx.lineTo((e.clientX - r.left) * sx, (e.clientY - r.top) * sy);
    sigCtx.stroke();
    sigCtx.beginPath();
    sigCtx.moveTo((e.clientX - r.left) * sx, (e.clientY - r.top) * sy);
  });
  sigCanvas.addEventListener('mouseup', () => sigDrawing = false);
  sigCanvas.addEventListener('mouseleave', () => sigDrawing = false);

  // Touch support
  sigCanvas.addEventListener('touchstart', e => {
    e.preventDefault();
    const t = e.touches[0];
    sigCanvas.dispatchEvent(new MouseEvent('mousedown', { clientX: t.clientX, clientY: t.clientY }));
  });
  sigCanvas.addEventListener('touchmove', e => {
    e.preventDefault();
    const t = e.touches[0];
    sigCanvas.dispatchEvent(new MouseEvent('mousemove', { clientX: t.clientX, clientY: t.clientY }));
  });
  sigCanvas.addEventListener('touchend', () => sigCanvas.dispatchEvent(new MouseEvent('mouseup')));

  $('#sig-clear').addEventListener('click', clearSigCanvas);

  // Sig font options
  $$('.sig-font-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      $$('.sig-font-opt').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      $('#sig-text-input').style.fontFamily = opt.dataset.font;
    });
  });
  $('#sig-text-input').addEventListener('input', () => {
    const v = $('#sig-text-input').value || 'Preview';
    $$('.sig-font-opt').forEach(o => o.textContent = v);
  });

  // Sig upload
  $('#sig-upload-zone').addEventListener('click', () => $('#sig-upload-file').click());
  $('#sig-upload-file').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      $('#sig-upload-preview').src = ev.target.result;
      $('#sig-upload-preview').style.display = 'block';
    };
    reader.readAsDataURL(file);
  });

  // Apply signature — Draw / Type / Upload tabs create a NEW signature and
  // add it to the library; Library tab inserts an existing one (handled by
  // card click in renderSignatureLibrary). This lets users keep multiple
  // signatures and switch between them in the same document (issue #2)
  // while persisting across sessions (issue #3).
  $('#sig-apply').addEventListener('click', () => {
    const activePane = $('.mtab-pane.active', $('#modal-signature'));
    let dataUrl = null;
    // Draw / Type create on a transparent canvas (clearRect, no fill); upload
    // typically brings white pixels and needs stripping.
    let alreadyClean = false;

    if (activePane.id === 'sig-library') {
      // Nothing to apply from this tab; user clicks a card directly.
      return;
    } else if (activePane.id === 'sig-draw') {
      dataUrl = trimSigCanvas(sigCanvas);
      if (!dataUrl) { showStatus('Draw a signature first'); return; }
      alreadyClean = true;
    } else if (activePane.id === 'sig-type') {
      const text = $('#sig-text-input').value.trim();
      if (!text) return;
      const font = $('.sig-font-opt.selected')?.dataset.font || "'Great Vibes', cursive";
      dataUrl = textToDataUrl(text, font, $('#sig-color').value);
      alreadyClean = true;
    } else if (activePane.id === 'sig-upload') {
      const prev = $('#sig-upload-preview');
      if (prev.src && prev.style.display !== 'none') dataUrl = prev.src;
      alreadyClean = false;
    }

    applySignatureFromDataUrl(dataUrl, /*addToLib*/ true, alreadyClean);
  });

  function trimSigCanvas(src) {
    const w = src.width, h = src.height;
    const px = src.getContext('2d').getImageData(0, 0, w, h).data;
    // Detect strokes by alpha channel — canvas is transparent, only stroke
    // pixels have alpha > 0. Faster (only checks one byte per pixel) and
    // works regardless of stroke color.
    let top = h, left = w, bot = 0, right = 0;
    let found = false;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (px[(y * w + x) * 4 + 3] > 16) {
          if (!found) { top = bot = y; left = right = x; found = true; }
          else {
            if (y < top) top = y; if (y > bot) bot = y;
            if (x < left) left = x; if (x > right) right = x;
          }
        }
      }
    }
    if (!found) return null;
    const pad = 6;
    top = Math.max(0, top - pad); left = Math.max(0, left - pad);
    bot = Math.min(h - 1, bot + pad); right = Math.min(w - 1, right + pad);
    const tc = document.createElement('canvas');
    tc.width = right - left + 1; tc.height = bot - top + 1;
    tc.getContext('2d').drawImage(src, left, top, tc.width, tc.height, 0, 0, tc.width, tc.height);
    return tc.toDataURL('image/png');
  }

  // Strip near-white pixels from a PNG data URL so signatures sit flat on the
  // document, AND downscale oversized uploads to keep dragging snappy.
  // Clinician feedback 2026-06-10: prefers the signature with a "barely grey"
  // background over a fully transparent one — feels more like a real
  // ink-on-paper signature. So we only kill genuinely white pixels and leave
  // the soft anti-aliased halo intact. Uploaded scans (often 1000+px wide)
  // are downscaled to a sensible max so drags/saves don't stutter.
  function stripWhiteBg(dataUrl) {
    const MAX_WIDTH = 800;
    return new Promise((resolve) => {
      if (!dataUrl) return resolve(dataUrl);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          // Downscale first if oversized — cuts pixel work proportionally and
          // keeps the resulting PNG dataURL small.
          let w = img.naturalWidth, h = img.naturalHeight;
          if (w > MAX_WIDTH) {
            const k = MAX_WIDTH / w;
            w = Math.round(w * k);
            h = Math.round(h * k);
          }
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          const ctx = c.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          const data = ctx.getImageData(0, 0, w, h);
          const px = data.data;
          // Only kill pure-white-ish pixels (>= 245 on all channels). Anything
          // darker — including the soft grey halo of an anti-aliased stroke
          // edge — is left untouched, which preserves the clinician's
          // preferred "barely grey" look.
          for (let i = 0; i < px.length; i += 4) {
            if (px[i] >= 245 && px[i + 1] >= 245 && px[i + 2] >= 245) {
              px[i + 3] = 0;
            }
          }
          ctx.putImageData(data, 0, 0);
          resolve(c.toDataURL('image/png'));
        } catch (e) {
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  function textToDataUrl(text, font, color) {
    const tc = document.createElement('canvas');
    const cx = tc.getContext('2d');
    cx.font = `36px ${font}`;
    const m = cx.measureText(text);
    tc.width = Math.ceil(m.width) + 20;
    tc.height = 56;
    cx.font = `36px ${font}`;
    cx.fillStyle = color;
    cx.textBaseline = 'middle';
    cx.fillText(text, 10, 28);
    return tc.toDataURL();
  }

  // Image file
  imageFileInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      addAnn(imageFileInput._pageNum || 1, {
        type: 'add-image',
        x: imageFileInput._x || 50,
        y: imageFileInput._y || 50,
        width: 200, height: 150,
        dataUrl: ev.target.result,
      });
    };
    reader.readAsDataURL(file);
    imageFileInput.value = '';
  });

  // =============================================================
  // TOOL SWITCHING
  // =============================================================
  function setTool(toolName) {
    S.activeTool = toolName;
    $$('.tool-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === toolName));

    // Update cursor on all annotation layers directly
    const cursorClass = toolName
      ? (['freehand','highlight','underline','strikethrough','shape-rect','shape-ellipse','shape-line','shape-arrow','eraser','crop','redact'].includes(toolName) ? 'tool-active'
        : ['add-text','edit-text','fill-text','callout'].includes(toolName) ? 'tool-text'
        : ['sign','initials','stamp'].includes(toolName) ? 'tool-sign'
        : 'tool-active')
      : '';

    S.pages.forEach(pg => {
      pg.annotLayer.classList.remove('tool-active', 'tool-text', 'tool-sign');
      if (cursorClass) pg.annotLayer.classList.add(cursorClass);
    });

    showStatus(toolName || '');

    // edit-text: immediately overlay editable text blocks
    if (toolName === 'edit-text') {
      showEditableTextOverlays();
    } else {
      clearEditableTextOverlays();
    }

    // Fill & Sign tools: overlay clickable blue hints on real AcroForm fields
    // and underscore-style blanks so the clinician gets an Adobe-like snap
    // experience instead of a floating text box (report 2026-07-03).
    const fillTools = ['fill-text','fill-check','fill-x','fill-dot','fill-circle','fill-date','sign','initials'];
    if (toolName && fillTools.includes(toolName)) {
      showFillHints(toolName);
      showStatus('Click a blue field to fill it — or click anywhere else to place manually.');
    } else {
      clearFillHints();
    }
  }

  // =============================================================
  // FILL & SIGN HINTS — highlight fillable fields on hover, click to snap
  // =============================================================
  async function loadFillHintsForPage(pageNum) {
    if (S.fillHintsByPage[pageNum]) return S.fillHintsByPage[pageNum];
    const hints = [];
    try {
      const page = await S.pdfDoc.getPage(pageNum);

      // (1) Real AcroForm widgets from the PDF metadata.
      const annots = await page.getAnnotations();
      for (const a of annots) {
        if (a.subtype !== 'Widget') continue;
        if (!a.rect || a.rect.length !== 4) continue;
        // fieldType: 'Tx' text, 'Btn' button/checkbox, 'Ch' choice/dropdown, 'Sig' signature
        const kind =
          a.fieldType === 'Sig' ? 'signature' :
          a.fieldType === 'Btn' ? 'check' :
          'text';
        hints.push({ rect: a.rect, kind, source: 'acroform' });
      }

      // (2) Cheap visual fallback: underscore-runs in the text stream. Many
      // clinical forms (DME, med lists) don't have real AcroForm fields —
      // they just have "Name: __________" printed on them. Detect a run of
      // 5+ underscores and treat it as a text-fill target.
      const textContent = await page.getTextContent();
      for (const item of textContent.items) {
        if (!item.str) continue;
        const m = item.str.match(/_{5,}/);
        if (!m) continue;
        // Estimate the underscore run's bounding rect in user-space using
        // pdf.js item transform. item.transform is [a,b,c,d,e,f] where
        // (e,f) is the origin and font size is derived from a/d.
        const tf = item.transform;
        const fontHeight = Math.hypot(tf[2], tf[3]) || 10;
        const charWidth = item.width / (item.str.length || 1);
        const startX = tf[4] + charWidth * m.index;
        const runWidth = charWidth * m[0].length;
        // Extend the fill area a bit above the underscore line so text has
        // room to sit on top of it rather than below.
        const bottom = tf[5];
        const top = bottom + fontHeight * 1.2;
        hints.push({
          rect: [startX, bottom, startX + runWidth, top],
          kind: 'text',
          source: 'underscore',
        });
      }
    } catch (e) { console.warn('fill-hint scan failed for page', pageNum, e); }
    S.fillHintsByPage[pageNum] = hints;
    return hints;
  }

  async function showFillHints(toolName) {
    clearFillHints();
    S.fillHintsShownFor = toolName;
    for (let i = 0; i < S.pages.length; i++) {
      const pg = S.pages[i];
      if (!pg.rendered || !pg.viewport) continue;
      const hints = await loadFillHintsForPage(i + 1);
      if (!hints.length) continue;
      for (const hint of hints) {
        // Only show hints relevant to the current tool
        if (toolName === 'sign' || toolName === 'initials') {
          if (hint.kind !== 'signature' && hint.kind !== 'text') continue;
        } else if (toolName === 'fill-check' || toolName === 'fill-x' || toolName === 'fill-dot' || toolName === 'fill-circle') {
          // check-style tools also fit inside text fields (small marks)
        } else {
          // fill-text / fill-date want text/underscore fields
          if (hint.kind !== 'text' && hint.kind !== 'signature') continue;
        }

        const [ux1, uy1, ux2, uy2] = hint.rect;
        const [cx1, cy1] = pg.viewport.convertToViewportPoint(ux1, uy1);
        const [cx2, cy2] = pg.viewport.convertToViewportPoint(ux2, uy2);
        const left = Math.min(cx1, cx2);
        const top = Math.min(cy1, cy2);
        const w = Math.abs(cx2 - cx1);
        const h = Math.abs(cy2 - cy1);
        if (w < 8 || h < 4) continue; // ignore microscopic ones

        const el = document.createElement('div');
        el.className = 'fill-hint fill-hint-' + hint.kind + (hint.source === 'underscore' ? ' fill-hint-under' : '');
        el.style.left = left + 'px';
        el.style.top = top + 'px';
        el.style.width = w + 'px';
        el.style.height = h + 'px';
        el.title = 'Click to fill this field';
        el.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          e.preventDefault();
          onFillHintClick(i + 1, left, top, w, h, hint);
        });
        pg.annotLayer.appendChild(el);
      }
    }
  }

  function clearFillHints() {
    S.fillHintsShownFor = null;
    document.querySelectorAll('.fill-hint').forEach(el => el.remove());
  }

  function onFillHintClick(pageNum, x, y, width, height, hint) {
    const tool = S.activeTool;
    // Pick a font size that fits the field height (with a little breathing room).
    const fontSize = Math.max(8, Math.min(28, Math.floor(height * 0.6)));

    if (tool === 'fill-text') {
      // Pre-sized inline editor snapped to the field.
      placeInlineTextBox(x + 2, y + 1, pageNum, fontSize, getFillColor(), 'Helvetica', false, {
        width: Math.max(60, width - 4),
        height: Math.max(fontSize * 1.4, height - 2),
      });
      // Hide hints while editing so they don't cover the text.
      clearFillHints();
    } else if (tool === 'fill-date') {
      addAnn(pageNum, {
        type: 'fill-date', x: x + 4, y: y + Math.max(0, (height - fontSize) / 2),
        text: new Date().toLocaleDateString(),
        fontSize, color: getFillColor(),
        width: Math.max(60, width - 4),
      });
      clearFillHints();
    } else if (tool === 'fill-check') {
      const sz = Math.max(12, Math.min(28, Math.floor(height * 0.9)));
      addAnn(pageNum, {
        type: 'fill-check',
        x: x + Math.max(0, (width - sz) / 2),
        y: y + Math.max(0, (height - sz) / 2),
        checked: true, color: getFillColor(), fontSize: sz,
      });
      clearFillHints();
    } else if (tool === 'fill-x') {
      const sz = Math.max(12, Math.min(28, Math.floor(height * 0.9)));
      addAnn(pageNum, {
        type: 'fill-x',
        x: x + Math.max(0, (width - sz) / 2),
        y: y + Math.max(0, (height - sz) / 2),
        color: getFillColor(), fontSize: sz,
      });
      clearFillHints();
    } else if (tool === 'fill-dot') {
      addAnn(pageNum, {
        type: 'fill-dot',
        x: x + width / 2 - 6, y: y + height / 2 - 6,
        color: getFillColor(),
      });
      clearFillHints();
    } else if (tool === 'fill-circle') {
      const sz = Math.max(16, Math.min(32, Math.floor(Math.min(width, height) * 0.9)));
      addAnn(pageNum, {
        type: 'fill-circle',
        x: x + (width - sz) / 2, y: y + (height - sz) / 2,
        width: sz, height: sz, color: getFillColor(),
      });
      clearFillHints();
    } else if (tool === 'sign' || tool === 'initials') {
      openSignatureModal(x, y, pageNum, tool === 'initials' ? 'initials' : 'signature');
      clearFillHints();
    }
  }

  // Refresh hints when pages come into view or scroll changes what's rendered.
  function maybeRefreshFillHints() {
    if (S.fillHintsShownFor) {
      showFillHints(S.fillHintsShownFor);
    }
  }

  // =============================================================
  // EDIT TEXT — Extract PDF text and overlay editable elements
  // =============================================================
  let editTextGeneration = 0; // abort counter for async race

  async function showEditableTextOverlays() {
    clearEditableTextOverlays();
    if (!S.pdfDoc) return;

    const gen = ++editTextGeneration;

    for (let i = 0; i < S.pages.length; i++) {
      if (gen !== editTextGeneration) return; // aborted
      const pg = S.pages[i];
      if (!pg.rendered) continue;

      pg.wrapper.classList.add('edit-mode');

      try {
        const page = await S.pdfDoc.getPage(i + 1);
        if (gen !== editTextGeneration) return; // aborted

        const textContent = await page.getTextContent();
        if (gen !== editTextGeneration) return; // aborted

        const vp = viewportFor(page, i + 1, S.scale);
        const lines = groupTextIntoLines(textContent.items, vp);

        for (const line of lines) {
          if (gen !== editTextGeneration) return;
          const el = document.createElement('div');
          el.className = 'text-overlay-block';
          el.contentEditable = false;
          el.textContent = line.text;
          el.style.left = line.x + 'px';
          el.style.top = line.y + 'px';
          el.style.fontSize = line.fontSize + 'px';
          el.style.fontFamily = line.fontFamily || 'sans-serif';
          el.style.width = line.width + 'px';
          el.style.height = line.height + 'px';
          el.dataset.pageIdx = i;
          el.dataset.origText = line.text;
          el.dataset.origX = line.x;
          el.dataset.origY = line.y;
          el.dataset.fontSize = line.fontSize;

          // Mousedown: prevent it from reaching the annotation layer
          el.addEventListener('mousedown', (ev) => {
            ev.stopPropagation();
            // Activate inline editing
            $$('.text-overlay-block.editing').forEach(o => {
              o.classList.remove('editing');
              o.contentEditable = false;
              finalizeTextEdit(o);
            });
            el.classList.add('editing');
            el.contentEditable = true;
            el.style.color = '#000';
            setTimeout(() => {
              el.focus();
              const range = document.createRange();
              range.selectNodeContents(el);
              const sel = window.getSelection();
              sel.removeAllRanges();
              sel.addRange(range);
            }, 0);
          });

          el.addEventListener('blur', () => {
            el.classList.remove('editing');
            el.contentEditable = false;
            finalizeTextEdit(el);
          });

          el.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); el.blur(); }
            if (ev.key === 'Escape') { el.textContent = el.dataset.origText; el.blur(); }
          });

          pg.annotLayer.appendChild(el);
        }
      } catch (err) {
        console.warn('Edit text overlay error on page', i + 1, err);
      }
    }
  }

  function groupTextIntoLines(items, vp) {
    if (!items.length) return [];
    const lines = [];

    // Use viewport transform to convert PDF coords to canvas coords
    const tfm = vp.transform;

    for (const item of items) {
      if (!item.str || !item.str.trim()) continue;

      // Apply transform: [a b c d e f] applied to item.transform
      const it = item.transform;
      // Multiply viewport transform * item transform
      const a = tfm[0] * it[0] + tfm[2] * it[1];
      const b = tfm[1] * it[0] + tfm[3] * it[1];
      const c = tfm[0] * it[2] + tfm[2] * it[3];
      const d = tfm[1] * it[2] + tfm[3] * it[3];
      const tx = tfm[0] * it[4] + tfm[2] * it[5] + tfm[4];
      const ty = tfm[1] * it[4] + tfm[3] * it[5] + tfm[5];

      const fontSize = Math.sqrt(a * a + b * b);
      const x = tx;
      const y = ty - fontSize;
      const width = item.width * S.scale;
      const height = fontSize * 1.3;

      let merged = false;
      for (const line of lines) {
        if (Math.abs(line.y - y) < fontSize * 0.5) {
          const newRight = Math.max(line.x + line.width, x + width);
          const newLeft = Math.min(line.x, x);
          line.text += ' ' + item.str;
          line.x = newLeft;
          line.width = newRight - newLeft;
          line.height = Math.max(line.height, height);
          merged = true;
          break;
        }
      }
      if (!merged) {
        lines.push({
          text: item.str,
          x, y, width: Math.max(width, 40), height,
          fontSize: Math.round(fontSize * 10) / 10,
          fontFamily: item.fontName || 'sans-serif',
        });
      }
    }
    return lines;
  }

  function finalizeTextEdit(el) {
    const newText = el.textContent.trim();
    const origText = el.dataset.origText;
    if (newText && newText !== origText) {
      const pageIdx = parseInt(el.dataset.pageIdx);
      const pageNum = pageIdx + 1;
      addAnn(pageNum, {
        type: 'whiteout',
        x: parseFloat(el.dataset.origX) - 2,
        y: parseFloat(el.dataset.origY) - 2,
        width: el.offsetWidth + 4,
        height: el.offsetHeight + 4,
      });
      addAnn(pageNum, {
        type: 'add-text',
        x: parseFloat(el.dataset.origX),
        y: parseFloat(el.dataset.origY),
        text: newText,
        fontSize: parseFloat(el.dataset.fontSize),
        color: '#000000',
        fontFamily: 'Helvetica',
        bold: false,
      });
    }
    el.style.color = 'transparent';
  }

  function clearEditableTextOverlays() {
    editTextGeneration++; // abort any in-progress async work
    $$('.text-overlay-block').forEach(el => el.remove());
    $$('.inline-text-box').forEach(el => el.remove());
    S.pages.forEach(pg => pg.wrapper.classList.remove('edit-mode'));
  }

  $$('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = btn.dataset.tool;
      if (!t) return;
      if (!S.pdfDoc) { alert('Please open a PDF first.'); return; }

      // Special actions (not toggle tools)
      if (['page-insert', 'page-delete', 'page-extract', 'page-rotate-cw', 'page-rotate-ccw', 'page-split', 'page-combine', 'header-footer', 'page-move-up', 'page-move-down'].includes(t)) {
        handlePageAction(t);
        return;
      }
      if (t === 'watermark') {
        openWatermarkModal(getCurrentPageNum());
        return;
      }

      // Toggle tool on/off
      setTool(S.activeTool === t ? null : t);
    });
  });

  function getCurrentPageNum() {
    return parseInt($('#page-input').value) || 1;
  }

  // =============================================================
  // TOOL TABS
  // =============================================================
  $$('#tool-tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const panel = btn.dataset.panel;
      $$('#tool-tabs .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      $$('.tool-panel').forEach(p => p.classList.remove('active'));
      $(`#panel-${panel}`).classList.add('active');
      S.activePanel = panel;
      setTool(null);
    });
  });

  // =============================================================
  // SIDEBAR
  // =============================================================
  $$('.sidebar-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.sidebar-tab').forEach(b => b.classList.remove('active'));
      $$('.sidebar-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      $(`#sidebar-${btn.dataset.sidebar}`).classList.add('active');
    });
  });

  $('#sidebar-toggle').addEventListener('click', () => {
    S.sidebarOpen = !S.sidebarOpen;
    sidebarEl.classList.toggle('sidebar-hidden', !S.sidebarOpen);
  });

  // Drag-to-resize the sidebar so users can show many more page thumbnails
  // at once (clinician 2026-06-30 wanted Acrobat-like density). Width is
  // persisted in localStorage and restored on next visit.
  (function initSidebarResize() {
    const handle = $('#sidebar-resize');
    if (!handle) return;
    const KEY = 'pdfeditor.sidebarWidth.v1';
    try {
      const saved = parseInt(localStorage.getItem(KEY), 10);
      if (saved && saved >= 160 && saved <= 800) {
        sidebarEl.style.width = saved + 'px';
      }
    } catch {}

    let startX = 0, startW = 0;
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startX = e.clientX;
      startW = sidebarEl.getBoundingClientRect().width;
      handle.classList.add('dragging');
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';

      const onMove = (ev) => {
        const w = Math.max(160, Math.min(window.innerWidth * 0.6, startW + (ev.clientX - startX)));
        sidebarEl.style.width = w + 'px';
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        handle.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        try { localStorage.setItem(KEY, String(sidebarEl.getBoundingClientRect().width | 0)); } catch {}
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  })();

  // =============================================================
  // PAGE ACTIONS (Organize)
  // =============================================================
  async function handlePageAction(action) {
    const pageNum = getCurrentPageNum();

    switch (action) {
      case 'page-rotate-cw':
        S.pageRotations[pageNum] = ((S.pageRotations[pageNum] || 0) + 90) % 360;
        S.pages[pageNum - 1].rendered = false;
        S.renderQueue.add(pageNum - 1);
        processRenderQueue();
        refreshThumb(pageNum - 1);
        break;

      case 'page-rotate-ccw':
        S.pageRotations[pageNum] = ((S.pageRotations[pageNum] || 0) - 90 + 360) % 360;
        S.pages[pageNum - 1].rendered = false;
        S.renderQueue.add(pageNum - 1);
        processRenderQueue();
        refreshThumb(pageNum - 1);
        break;

      case 'page-delete':
        if (S.totalPages <= 1) { alert('Cannot delete the only page.'); return; }
        if (S.selectedPages.size) {
          const indices = [...S.selectedPages].sort((a, b) => a - b);
          if (indices.length >= S.totalPages) { alert('Cannot delete every page.'); return; }
          if (!confirm(`Delete ${indices.length} selected pages?`)) return;
          await deletePagesFromPDF(indices);
        } else {
          if (!confirm(`Delete page ${pageNum}?`)) return;
          await deletePageFromPDF(pageNum);
        }
        break;

      case 'page-extract':
        await extractPage(pageNum);
        break;

      case 'page-split':
        await splitDocument();
        break;

      case 'page-combine':
        combineFileInput.click();
        break;

      case 'page-insert':
        insertFileInput._afterPage = pageNum;
        insertFileInput.click();
        break;

      case 'page-move-up':
        if (pageNum > 1) await reorderPages(pageNum - 1, pageNum - 2);
        break;

      case 'page-move-down':
        if (pageNum < S.totalPages) await reorderPages(pageNum - 1, pageNum);
        break;

      case 'header-footer': {
        const hf = prompt('Enter header text (appears on all pages):');
        if (!hf) return;
        for (let p = 1; p <= S.totalPages; p++) {
          addAnn(p, {
            type: 'add-text', x: 20, y: 15,
            text: hf, fontSize: 10, color: '#666',
            fontFamily: 'Helvetica', bold: false,
          });
        }
        break;
      }
    }
  }

  async function deletePageFromPDF(pageNum) {
    const doc = await PDFDocument.load(S.pdfBytes);
    doc.removePage(pageNum - 1);
    const bytes = await doc.save();
    await loadPDFBytes(bytes, S.fileName);
  }

  // Delete several pages at once. Pass 0-based indices.
  async function deletePagesFromPDF(indices) {
    const sorted = [...indices].sort((a, b) => b - a); // delete high-to-low so lower indices stay valid
    const doc = await PDFDocument.load(S.pdfBytes);
    for (const idx of sorted) doc.removePage(idx);
    const bytes = await doc.save();
    S.selectedPages.clear();
    await loadPDFBytes(bytes, S.fileName);
    showStatus(`Deleted ${indices.length} pages`);
  }

  // Reorder a page: move srcIdx → destIdx (0-based). Rebuilds the PDF via
  // copyPages so the in-memory bytes match the new on-screen order
  // (issue #10).
  async function reorderPages(srcIdx, destIdx) {
    if (srcIdx === destIdx) return;
    if (srcIdx < 0 || destIdx < 0 || srcIdx >= S.totalPages || destIdx >= S.totalPages) return;
    showStatus('Reordering pages…');
    try {
      const src = await PDFDocument.load(S.pdfBytes);
      const order = src.getPageIndices().slice();
      const [moved] = order.splice(srcIdx, 1);
      order.splice(destIdx, 0, moved);

      const out = await PDFDocument.create();
      const copied = await out.copyPages(src, order);
      copied.forEach(p => out.addPage(p));
      const bytes = await out.save();

      // Map per-page state (annotations, rotations) to follow pages.
      const newAnnotations = {};
      const newRotations = {};
      order.forEach((origIdx, newIdx) => {
        if (S.annotations[origIdx + 1]) newAnnotations[newIdx + 1] = S.annotations[origIdx + 1];
        if (S.pageRotations[origIdx + 1]) newRotations[newIdx + 1] = S.pageRotations[origIdx + 1];
      });
      S.annotations = newAnnotations;
      S.pageRotations = newRotations;

      await loadPDFBytes(bytes, S.fileName);
      // Jump to where the moved page now lives.
      scrollToPage(destIdx);
      showStatus('Moved page ' + (srcIdx + 1) + ' → position ' + (destIdx + 1));
    } catch (err) {
      console.error('Reorder failed:', err);
      showStatus('Reorder failed: ' + err.message);
    }
  }

  // Parse a page-range string like "1-3, 5, 7-9" into a sorted, de-duplicated
  // array of 0-based page indices. Out-of-bounds and malformed segments are
  // ignored. Returns [] if nothing valid found.
  function parsePageRange(input, total) {
    if (!input) return [];
    const out = new Set();
    const parts = String(input).split(/[,\s]+/).filter(Boolean);
    for (const p of parts) {
      const m = /^(\d+)\s*(?:-\s*(\d+))?$/.exec(p);
      if (!m) continue;
      let a = parseInt(m[1], 10);
      let b = m[2] != null ? parseInt(m[2], 10) : a;
      if (!a || !b) continue;
      if (b < a) { const t = a; a = b; b = t; }
      a = Math.max(1, Math.min(total, a));
      b = Math.max(1, Math.min(total, b));
      for (let i = a; i <= b; i++) out.add(i - 1);
    }
    return [...out].sort((x, y) => x - y);
  }

  async function extractPage(currentPageNum) {
    // Three ways to choose pages, in priority order:
    //   1. Pages multi-selected in the thumbnail sidebar (ctrl/shift+click)
    //   2. Range typed into the prompt
    //   3. Current page (the prompt default)
    let indices;
    let suffixHint = '';
    if (S.selectedPages.size) {
      indices = [...S.selectedPages].sort((a, b) => a - b);
      suffixHint = indices.map(i => i + 1).join(',');
    } else {
      const ans = prompt(
        `Extract which pages?\n\nTip: ctrl-click or shift-click thumbnails in the sidebar to multi-select.\n\nExamples:\n  ${currentPageNum}   (just this page)\n  4-7\n  1-3, 5, 8-10\n\nDocument has ${S.totalPages} pages.`,
        String(currentPageNum)
      );
      if (ans == null) return; // cancelled
      indices = parsePageRange(ans, S.totalPages);
      if (!indices.length) {
        alert('Could not parse "' + ans + '". Use a single page number, a range like 4-7, or a list like 1-3, 5, 8-10.');
        return;
      }
      suffixHint = ans.replace(/\s+/g, '');
    }
    showStatus('Extracting ' + indices.length + ' page' + (indices.length === 1 ? '' : 's') + '…');
    const doc = await PDFDocument.load(S.pdfBytes);
    const newDoc = await PDFDocument.create();
    const copied = await newDoc.copyPages(doc, indices);
    copied.forEach(p => newDoc.addPage(p));
    const bytes = await newDoc.save();
    // Build a friendly suffix: "_pages4-7" or "_pages1-3_5_8-10" capped in length
    const suffix = indices.length === 1
      ? `_page${indices[0] + 1}`
      : `_pages_${suffixHint.replace(/[^0-9,-]/g, '').slice(0, 40)}`;
    downloadBytes(bytes, `${S.fileName.replace(/\.pdf$/i, '')}${suffix}.pdf`);
  }

  async function splitDocument() {
    const doc = await PDFDocument.load(S.pdfBytes);
    for (let i = 0; i < doc.getPageCount(); i++) {
      const newDoc = await PDFDocument.create();
      const [page] = await newDoc.copyPages(doc, [i]);
      newDoc.addPage(page);
      const bytes = await newDoc.save();
      downloadBytes(bytes, `${S.fileName.replace('.pdf', '')}_page${i + 1}.pdf`);
    }
  }

  combineFileInput.addEventListener('change', async e => {
    // Browsers don't guarantee the file picker returns files in any
    // particular order — Chrome on Windows returns them in selection order,
    // which means "fax_1, fax_10, fax_2" stays jumbled and the combined
    // PDF has pages out of order (clinician 2026-06-15). Natural-sort by
    // name so "fax_2.pdf" comes before "fax_10.pdf" predictably.
    const files = [...e.target.files].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    );
    if (!files.length) return;
    showStatus(`Combining ${files.length} files (sorted by name)…`);
    const doc = await PDFDocument.load(S.pdfBytes);
    for (const file of files) {
      const buf = await file.arrayBuffer();
      const srcDoc = await PDFDocument.load(buf);
      const pages = await doc.copyPages(srcDoc, srcDoc.getPageIndices());
      pages.forEach(p => doc.addPage(p));
    }
    const bytes = await doc.save();
    await loadPDFBytes(bytes, S.fileName);
    combineFileInput.value = '';
    showStatus('Combined ' + files.length + ' files: ' + files.map(f => f.name).join(', '));
  });

  insertFileInput.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    const afterPage = insertFileInput._afterPage || S.totalPages;
    const doc = await PDFDocument.load(S.pdfBytes);
    const srcDoc = await PDFDocument.load(await file.arrayBuffer());
    const pages = await doc.copyPages(srcDoc, srcDoc.getPageIndices());
    pages.forEach((p, i) => doc.insertPage(afterPage + i, p));
    const bytes = await doc.save();
    await loadPDFBytes(bytes, S.fileName);
    insertFileInput.value = '';
  });

  async function refreshThumb(idx) {
    const item = sidebarThumbs.children[idx];
    if (!item) return;
    const cvs = item.querySelector('canvas');
    cvs.dataset.rendered = '';
    const page = await S.pdfDoc.getPage(idx + 1);
    const baseVp = viewportFor(page, idx + 1, 1);
    const scale = computeThumbScale(item, baseVp);
    const vp = viewportFor(page, idx + 1, scale);
    cvs.width = vp.width;
    cvs.height = vp.height;
    cvs.style.width = '100%';
    cvs.style.height = 'auto';
    await page.render({ canvasContext: cvs.getContext('2d'), viewport: vp }).promise;
    cvs.dataset.rendered = '1';
  }

  // =============================================================
  // SEARCH
  // =============================================================
  const searchInput = $('#search-input');
  let searchTimeout = null;

  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => performSearch(searchInput.value), 300);
  });

  async function performSearch(query) {
    S.searchResults = [];
    S.searchIdx = -1;
    $('#search-count').textContent = '';
    if (!query || !S.pdfDoc) return;

    const q = query.toLowerCase();
    for (let i = 1; i <= S.totalPages; i++) {
      const page = await S.pdfDoc.getPage(i);
      const tc = await page.getTextContent();
      const text = tc.items.map(it => it.str).join(' ').toLowerCase();
      if (text.includes(q)) {
        S.searchResults.push(i);
      }
    }

    if (S.searchResults.length) {
      S.searchIdx = 0;
      scrollToPage(S.searchResults[0] - 1);
    }
    $('#search-count').textContent = S.searchResults.length ? `${S.searchIdx + 1}/${S.searchResults.length}` : 'No results';
    $('#search-prev').disabled = !S.searchResults.length;
    $('#search-next').disabled = !S.searchResults.length;
  }

  $('#search-prev').addEventListener('click', () => {
    if (!S.searchResults.length) return;
    S.searchIdx = (S.searchIdx - 1 + S.searchResults.length) % S.searchResults.length;
    scrollToPage(S.searchResults[S.searchIdx] - 1);
    $('#search-count').textContent = `${S.searchIdx + 1}/${S.searchResults.length}`;
  });

  $('#search-next').addEventListener('click', () => {
    if (!S.searchResults.length) return;
    S.searchIdx = (S.searchIdx + 1) % S.searchResults.length;
    scrollToPage(S.searchResults[S.searchIdx] - 1);
    $('#search-count').textContent = `${S.searchIdx + 1}/${S.searchResults.length}`;
  });

  // =============================================================
  // ZOOM
  // =============================================================
  const zoomSelect = $('#zoom-select');

  function applyZoom(val) {
    if (val === 'fit-width') {
      const vw = viewport.clientWidth - 48;
      S.scale = vw / (S.pages[0]?.canvas.width / S.scale || 612);
    } else if (val === 'fit-page') {
      const vw = viewport.clientWidth - 48;
      const vh = viewport.clientHeight - 48;
      const pw = S.pages[0]?.canvas.width / S.scale || 612;
      const ph = S.pages[0]?.canvas.height / S.scale || 792;
      S.scale = Math.min(vw / pw, vh / ph);
    } else {
      S.scale = parseFloat(val);
    }
    rerenderAll();
    // Sync select
    const opt = [...zoomSelect.options].find(o => parseFloat(o.value) === S.scale);
    if (opt) zoomSelect.value = opt.value;
  }

  zoomSelect.addEventListener('change', () => applyZoom(zoomSelect.value));
  $('#btn-zoom-in').addEventListener('click', () => {
    S.scale = Math.min(5, S.scale + 0.25);
    zoomSelect.value = S.scale;
    rerenderAll();
  });
  $('#btn-zoom-out').addEventListener('click', () => {
    S.scale = Math.max(0.25, S.scale - 0.25);
    zoomSelect.value = S.scale;
    rerenderAll();
  });

  // Page input
  $('#page-input').addEventListener('change', () => {
    const num = parseInt($('#page-input').value);
    if (num >= 1 && num <= S.totalPages) scrollToPage(num - 1);
  });

  // =============================================================
  // SAVE PDF
  // =============================================================
  // Wrap text to a target width using pdf-lib font metrics. The contenteditable
  // box wraps text visually via CSS, but the underlying string has no
  // newlines, so without this the saved PDF draws each paragraph as one long
  // line that runs off the page (clinician report 2026-06-15).
  function wrapTextToWidth(text, font, fontSize, maxWidth) {
    if (!text) return [''];
    const measure = (s) => {
      try { return font.widthOfTextAtSize(s, fontSize); }
      catch { return s.length * fontSize * 0.5; }
    };
    const out = [];
    for (const para of String(text).split('\n')) {
      if (!para) { out.push(''); continue; }
      const tokens = para.match(/\S+|\s+/g) || [para];
      let line = '';
      for (const tok of tokens) {
        const test = line + tok;
        if (measure(test) > maxWidth && line) {
          out.push(line.replace(/\s+$/, ''));
          line = /\S/.test(tok) ? tok : '';
        } else {
          line = test;
        }
      }
      if (line || out.length === 0) out.push(line.replace(/\s+$/, ''));
    }
    return out;
  }

  // Build a fresh destination document from the source. For pages WITHOUT
  // annotations, we just copyPages — preserves all content (text, forms,
  // images, intrinsic rotation) reliably even for 500+ page files. For
  // pages WITH annotations and a non-zero display rotation, we embed the
  // source page and draw it rotated onto a new dst page so annotations
  // drawn axis-aligned in user-space don't come out sideways under the
  // viewer's display rotation. For pages with annotations but no rotation,
  // we just copy and draw annotations on the copy.
  //
  // This replaces an earlier approach that did removePage+insertPage in a
  // loop on the loaded source document — which apparently corrupted the
  // page content references on very large rotated docs (clinician
  // 2026-06-30: 577-page document saved with all pages blank).
  //
  // Returns { dstDoc, dstPages: PDFPage[] } where dstPages[i] is the
  // destination page corresponding to source page i.
  async function buildOutputDocument(srcDoc) {
    const dstDoc = await PDFDocument.create();
    const total = srcDoc.getPageCount();
    const annotatedPages = new Set();
    for (const k of Object.keys(S.annotations)) {
      const pn = parseInt(k);
      if (S.annotations[pn] && S.annotations[pn].length) annotatedPages.add(pn - 1);
    }

    const dstPages = new Array(total);
    for (let i = 0; i < total; i++) {
      const srcPage = srcDoc.getPage(i);
      const intrinsic = ((srcPage.getRotation && srcPage.getRotation().angle) || 0) % 360;
      const user = (S.pageRotations[i + 1] || 0) % 360;
      const angle = ((intrinsic + user) % 360 + 360) % 360;
      const hasAnns = annotatedPages.has(i);

      if (!hasAnns) {
        // Pages without annotations: straight copy. Preserves intrinsic
        // rotation; viewer will display correctly. No bake needed.
        const [copied] = await dstDoc.copyPages(srcDoc, [i]);
        // Re-apply user rotation, if any, via metadata (no annotation
        // alignment risk since there are none).
        if (user) {
          const total = (intrinsic + user) % 360;
          copied.setRotation(pdfDegrees(total));
        }
        dstPages[i] = dstDoc.addPage(copied);
        continue;
      }

      if (angle === 0) {
        // Annotations but no rotation: copy and draw annotations on the copy.
        const [copied] = await dstDoc.copyPages(srcDoc, [i]);
        dstPages[i] = dstDoc.addPage(copied);
        continue;
      }

      // Annotations + rotation: bake rotation into content on a fresh page
      // sized to the rotated display, so annotations drawn axis-aligned
      // stay axis-aligned for the viewer.
      const embedded = await dstDoc.embedPage(srcPage);
      const size = srcPage.getSize();
      const pw = size.width, ph = size.height;
      const displayW = (angle === 90 || angle === 270) ? ph : pw;
      const displayH = (angle === 90 || angle === 270) ? pw : ph;
      const newPage = dstDoc.addPage([displayW, displayH]);

      const opts = { width: pw, height: ph, rotate: pdfDegrees(-angle) };
      if (angle === 90)       { opts.x = displayW; opts.y = 0;        }
      else if (angle === 180) { opts.x = displayW; opts.y = displayH; }
      else if (angle === 270) { opts.x = 0;        opts.y = displayH; }
      else                    { opts.x = 0;        opts.y = 0;        }

      newPage.drawPage(embedded, opts);
      dstPages[i] = newPage;
    }

    return { dstDoc, dstPages };
  }

  // DEPRECATED — kept only because nothing else calls it; the in-place
  // remove+insert pattern below caused data loss on large rotated docs.
  // buildOutputDocument() replaces it. Will be removed in a follow-up.
  async function bakePageRotations(pdfDoc) {
    const originalPages = pdfDoc.getPages();
    const baked = new Set();
    const work = [];
    for (let i = 0; i < originalPages.length; i++) {
      const p = originalPages[i];
      const intrinsic = ((p.getRotation && p.getRotation().angle) || 0) % 360;
      const user = (S.pageRotations[i + 1] || 0) % 360;
      const angle = ((intrinsic + user) % 360 + 360) % 360;
      if (angle === 0) continue;
      const size = p.getSize();
      work.push({ idx: i, page: p, angle, w: size.width, h: size.height });
    }
    if (!work.length) return baked;

    // Embed all rotated pages first (embedPage works against the original page object)
    const embeds = [];
    for (const w of work) {
      embeds.push(await pdfDoc.embedPage(w.page));
    }

    // Replace each rotated page with a fresh page at "display" dimensions
    // (swap w/h for 90/270) and rotation 0, then draw the form with rotation.
    for (let k = 0; k < work.length; k++) {
      const { idx, angle, w: pw, h: ph } = work[k];
      const embedded = embeds[k];
      const displayW = (angle === 90 || angle === 270) ? ph : pw;
      const displayH = (angle === 90 || angle === 270) ? pw : ph;

      pdfDoc.removePage(idx);
      const newPage = pdfDoc.insertPage(idx, [displayW, displayH]);

      // pdf-lib's drawPage with `rotate` rotates around (x, y) in user-space.
      // For each PDF Rotate value, compute the anchor that lands the rotated
      // form's bottom-left at the new page's bottom-left so the content fills
      // the page upright (matching what the viewer was showing pre-bake).
      const opts = { width: pw, height: ph, rotate: pdfDegrees(-angle) };
      if (angle === 90)       { opts.x = displayW; opts.y = 0;        }
      else if (angle === 180) { opts.x = displayW; opts.y = displayH; }
      else if (angle === 270) { opts.x = 0;        opts.y = displayH; }
      else                    { opts.x = 0;        opts.y = 0;        }

      newPage.drawPage(embedded, opts);
      baked.add(idx);
    }
    return baked;
  }

  // Build the saved PDF: copy all source pages (and annotations) into a
  // fresh destination document. Bake rotation only for pages that have BOTH
  // a non-zero display rotation AND user annotations, so large unmodified
  // documents pass straight through copyPages — no remove/insert mutation
  // on the loaded source, which was corrupting 500+ page rotated docs.
  async function buildEditedPdfBytes() {
    const srcDoc = await PDFDocument.load(S.pdfBytes);
    const { dstDoc, dstPages } = await buildOutputDocument(srcDoc);

    const pdfDoc = dstDoc; // annotation drawing below uses pdfDoc.embedFont/embedPng
    const pages = dstPages;

    // Embed annotations
    for (const [pnStr, anns] of Object.entries(S.annotations)) {
      const idx = parseInt(pnStr) - 1;
      if (idx < 0 || idx >= pages.length) continue;
      const page = pages[idx];
      if (!page) continue;
      const { width: pw, height: ph } = page.getSize();
      const pg = S.pages[idx];
      const cvs = pg?.canvas;
      if (!cvs) continue;
      const ratio = pw / cvs.width; // PDF points per canvas pixel — used for sizes

      // Canvas pixel (top-left origin) → pdf-lib coord (bottom-left origin).
      // bakePageRotations() above made every page upright at display
      // dimensions that match the editor canvas, so this is a straight
      // scale + y-flip. (We used to defer to vp.convertToPdfPoint for
      // "accuracy", but that returned coords for the PRE-bake page and
      // landed annotations in the wrong place on intrinsically-rotated
      // pages like the Updox 195-page doc — fix 2026-06-16.)
      const toPdfPoint = (x, y) => ({ x: x * ratio, y: ph - y * ratio });

      for (const ann of anns) {
        const pt = toPdfPoint(ann.x, ann.y);
        const ax = pt.x;
        const ay = pt.y;

        try {
          switch (ann.type) {
            case 'text':
            case 'add-text':
            case 'fill-text':
            case 'fill-date':
            case 'callout': {
              const fontKey = ann.bold
                ? (ann.fontFamily === 'Courier' ? StandardFonts.CourierBold :
                   ann.fontFamily === 'Times-Roman' ? StandardFonts.TimesRomanBold :
                   StandardFonts.HelveticaBold)
                : (ann.fontFamily === 'Courier' ? StandardFonts.Courier :
                   ann.fontFamily === 'Times-Roman' ? StandardFonts.TimesRoman :
                   StandardFonts.Helvetica);
              const font = await pdfDoc.embedFont(fontKey);
              const sz = (ann.fontSize || 12) * ratio;
              const c = hexRgb(ann.color);
              // Match the editor's visual wrapping: the contenteditable box
              // wraps long lines at ann.width via CSS, but textContent has no
              // newlines. Without wrapping here, lines run off the page on
              // save/print. Allow a small horizontal padding to match the
              // .annot-text-content style.
              const padPx = 6; // ~ inline box padding (4-6px each side)
              const maxW = ann.width
                ? Math.max(20, (ann.width - padPx * 2) * ratio)
                : Math.max(20, pw - ax - 4);
              const lineHeight = sz * 1.25; // match CSS line-height: 1.3 (close enough at PDF baseline)
              const lines = wrapTextToWidth(ann.text || '', font, sz, maxW);
              lines.forEach((line, li) => {
                page.drawText(line, {
                  x: ax,
                  y: ay - lineHeight * (li + 1) + (lineHeight - sz) * 0.4,
                  size: sz, font, color: rgb(c.r, c.g, c.b),
                });
              });
              break;
            }
            case 'signature':
            case 'initials':
            case 'image':
            case 'add-image': {
              let img;
              if (ann.dataUrl.includes('image/png') || ann.dataUrl.includes('image/svg')) {
                img = await pdfDoc.embedPng(ann.dataUrl);
              } else {
                try { img = await pdfDoc.embedJpg(ann.dataUrl); }
                catch { img = await pdfDoc.embedPng(ann.dataUrl); }
              }
              let iw = (ann.width || 200) * ratio;
              let ih = ann.height ? ann.height * ratio : iw * (img.height / img.width);
              // Clamp to page bounds so signatures placed near edges don't
              // get clipped off the page on save (issue #4). Shrink first
              // if image is wider/taller than page, then nudge position.
              if (iw > pw) { ih = ih * (pw / iw); iw = pw; }
              if (ih > ph) { iw = iw * (ph / ih); ih = ph; }
              let dx = ax, dy = ay - ih;
              if (dx < 0) dx = 0;
              if (dx + iw > pw) dx = pw - iw;
              if (dy < 0) dy = 0;
              if (dy + ih > ph) dy = ph - ih;
              page.drawImage(img, { x: dx, y: dy, width: iw, height: ih });
              break;
            }
            case 'freehand': {
              if (!ann.points || ann.points.length < 2) break;
              const c = hexRgb(ann.color);
              const sw = (ann.strokeWidth || 2) * ratio;
              for (let i = 1; i < ann.points.length; i++) {
                page.drawLine({
                  start: { x: ax + ann.points[i - 1].x * ratio, y: ay - ann.points[i - 1].y * ratio },
                  end: { x: ax + ann.points[i].x * ratio, y: ay - ann.points[i].y * ratio },
                  thickness: sw, color: rgb(c.r, c.g, c.b),
                });
              }
              break;
            }
            case 'whiteout': {
              const ww = (ann.width || 100) * ratio;
              const wh = (ann.height || 20) * ratio;
              page.drawRectangle({
                x: ax, y: ay - wh, width: ww, height: wh,
                color: rgb(1, 1, 1),
              });
              break;
            }
            case 'redaction': {
              const rw = (ann.width || 100) * ratio;
              const rh = (ann.height || 20) * ratio;
              page.drawRectangle({
                x: ax, y: ay - rh, width: rw, height: rh,
                color: rgb(0, 0, 0), opacity: 1,
              });
              break;
            }
            case 'highlight': {
              const hw = (ann.width || 100) * ratio;
              const hh = (ann.height || 20) * ratio;
              page.drawRectangle({
                x: ax, y: ay - hh, width: hw, height: hh,
                color: rgb(1, 0.92, 0.23), opacity: 0.35,
              });
              break;
            }
            case 'underline': {
              const uw = (ann.width || 100) * ratio;
              const c = hexRgb(ann.color || '#e5322d');
              page.drawLine({
                start: { x: ax, y: ay }, end: { x: ax + uw, y: ay },
                thickness: 2 * ratio, color: rgb(c.r, c.g, c.b),
              });
              break;
            }
            case 'strikethrough': {
              const sw = (ann.width || 100) * ratio;
              const sh = (ann.height || 12) * ratio;
              const c = hexRgb(ann.color || '#e5322d');
              page.drawLine({
                start: { x: ax, y: ay - sh / 2 }, end: { x: ax + sw, y: ay - sh / 2 },
                thickness: 2 * ratio, color: rgb(c.r, c.g, c.b),
              });
              break;
            }
            case 'shape-rect': {
              const c = hexRgb(ann.color);
              const sw = (ann.strokeWidth || 2) * ratio;
              const rw = (ann.width || 100) * ratio;
              const rh = (ann.height || 100) * ratio;
              page.drawRectangle({
                x: ax, y: ay - rh, width: rw, height: rh,
                borderColor: rgb(c.r, c.g, c.b), borderWidth: sw,
                color: ann.fill ? rgb(c.r, c.g, c.b) : undefined,
                opacity: (ann.opacity || 100) / 100,
              });
              break;
            }
            case 'shape-ellipse': {
              const c = hexRgb(ann.color);
              const sw = (ann.strokeWidth || 2) * ratio;
              const ew = (ann.width || 100) * ratio;
              const eh = (ann.height || 100) * ratio;
              page.drawEllipse({
                x: ax + ew / 2, y: ay - eh / 2,
                xScale: ew / 2, yScale: eh / 2,
                borderColor: rgb(c.r, c.g, c.b), borderWidth: sw,
                color: ann.fill ? rgb(c.r, c.g, c.b) : undefined,
                opacity: (ann.opacity || 100) / 100,
              });
              break;
            }
            case 'shape-line':
            case 'shape-arrow': {
              const c = hexRgb(ann.color);
              const sw = (ann.strokeWidth || 2) * ratio;
              const lw = (ann.width || 100) * ratio;
              const lh = (ann.height || 20) * ratio;
              page.drawLine({
                start: { x: ax, y: ay - lh },
                end: { x: ax + lw, y: ay },
                thickness: sw, color: rgb(c.r, c.g, c.b),
                opacity: (ann.opacity || 100) / 100,
              });
              break;
            }
            case 'stamp': {
              const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
              const c = hexRgb(ann.color);
              const sz = 18 * ratio;
              page.drawText(ann.text, {
                x: ax, y: ay - sz, size: sz, font,
                color: rgb(c.r, c.g, c.b), opacity: 0.8,
                rotate: pdfDegrees(-15),
              });
              break;
            }
            case 'sticky-note': {
              const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
              if (ann.text) {
                page.drawText(ann.text, {
                  x: ax + 2, y: ay - 14, size: 8 * ratio, font,
                  color: rgb(0, 0, 0),
                });
              }
              break;
            }
            case 'fill-check': {
              if (ann.checked) {
                // U+2713 (\u2713 CHECK MARK) isn't in WinAnsi, which is the
                // default encoding for pdf-lib StandardFonts.Helvetica.
                // drawText silently dropped it inside a try/catch and the
                // check vanished on save (clinician 2026-06-16). Draw it
                // as two line segments instead \u2014 no font dependency.
                const c = hexRgb(ann.color || '#000');
                const sz = (ann.fontSize || 18) * ratio;
                const thickness = Math.max(1.5, sz * 0.12);
                page.drawLine({
                  start: { x: ax + sz * 0.10, y: ay - sz * 0.55 },
                  end:   { x: ax + sz * 0.40, y: ay - sz * 0.85 },
                  thickness, color: rgb(c.r, c.g, c.b),
                });
                page.drawLine({
                  start: { x: ax + sz * 0.40, y: ay - sz * 0.85 },
                  end:   { x: ax + sz * 0.95, y: ay - sz * 0.15 },
                  thickness, color: rgb(c.r, c.g, c.b),
                });
              }
              break;
            }
            case 'fill-x': {
              const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
              page.drawText('X', {
                x: ax, y: ay - 14 * ratio, size: (ann.fontSize || 18) * ratio,
                font, color: rgb(0, 0, 0),
              });
              break;
            }
            case 'fill-dot': {
              const c = hexRgb(ann.color);
              page.drawCircle({
                x: ax + 5, y: ay - 5, size: 4,
                color: rgb(c.r, c.g, c.b),
              });
              break;
            }
            case 'fill-circle': {
              const c = hexRgb(ann.color);
              const cr = ((ann.width || 24) / 2) * ratio;
              page.drawCircle({
                x: ax + cr, y: ay - cr, size: cr,
                borderColor: rgb(c.r, c.g, c.b), borderWidth: 2 * ratio,
              });
              break;
            }
            case 'watermark': {
              const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
              const c = hexRgb(ann.color);
              page.drawText(ann.text, {
                x: ax, y: ay,
                size: ann.fontSize * ratio,
                font, color: rgb(c.r, c.g, c.b),
                opacity: ann.opacity,
                rotate: pdfDegrees(ann.rotation),
              });
              break;
            }
            case 'form-text':
            case 'form-checkbox':
            case 'form-radio':
            case 'form-dropdown':
            case 'form-signature':
            case 'form-date': {
              const fw = (ann.width || 120) * ratio;
              const fh = (ann.height || 28) * ratio;
              page.drawRectangle({
                x: ax, y: ay - fh, width: fw, height: fh,
                borderColor: rgb(0.08, 0.45, 0.9), borderWidth: 1,
                color: rgb(0.95, 0.97, 1),
              });
              break;
            }
          }
        } catch (e) {
          console.warn('Save annotation error:', ann.type, e);
        }
      }
    }

    return await pdfDoc.save();
  }

  // Save = write back to the original file when we have a handle (issue #6),
  // matching how Adobe Acrobat's Save behaves. Falls back to Save As when
  // there's no handle (e.g. file opened via drag-drop or legacy input).
  // After a successful save, reload the editor from the newly-saved bytes
  // so the canvas re-renders with the flattened content. Previously we only
  // cleared S.annotations and re-rendered the (now empty) annotation
  // layers — the user's edits appeared to vanish because the canvas below
  // was still showing content rendered from the pre-save bytes. Preserve
  // the current page so the reload doesn't jerk them to the top.
  // Clinician 2026-07-03: "When I save the changes disappear unless I
  // refresh and reopen."
  async function reloadAfterSave(newBytes) {
    S.pdfBytes = newBytes;
    S.annotations = {};
    S.undoStack = [];
    S.redoStack = [];
    S.selected = null;
    S.selectedPages && S.selectedPages.clear && S.selectedPages.clear();
    S.pageRotations = {};
    updateUndoRedoUI();

    const currentPage = getCurrentPageNum() - 1;

    // Rebuild the pdf.js document, page wrappers, and thumbnails from the
    // fresh bytes. initDocument is the same path used after delete/reorder
    // so it's well-exercised. Scroll position is restored afterwards.
    await initDocument(S.pdfBytes);

    // Restore roughly where the user was reading.
    if (currentPage >= 0 && S.pages[currentPage]) {
      // Wait a tick so the page wrapper's layout is settled before scrolling.
      setTimeout(() => scrollToPage(currentPage), 40);
    }
  }

  // Sanity check: if the save output is dramatically smaller than the
  // source, refuse to write. This catches the "577 pages went blank"
  // failure mode (bake-rotation stripped content) before the corrupt
  // bytes reach disk — much better to fail with a message than to
  // silently overwrite a good file with an empty one.
  function assertSaveBytesLookSane(savedBytes) {
    const srcSize = S.pdfBytes ? S.pdfBytes.byteLength : 0;
    const outSize = savedBytes ? savedBytes.byteLength : 0;
    // Threshold: allow shrinkage up to 60% (some overhead + annotations
    // can add or trim), but a > 60% collapse on a doc with actual content
    // is almost certainly the bake bug.
    if (srcSize > 100 * 1024 && outSize > 0 && outSize < srcSize * 0.4) {
      throw new Error(
        'Save aborted — the generated file is ' +
        Math.round(outSize / 1024) + ' KB but the original was ' +
        Math.round(srcSize / 1024) + ' KB. This usually means page ' +
        'content was lost during flattening. Please report this file to ' +
        'the developer; your edits are still in the editor.'
      );
    }
  }

  async function savePDF() {
    if (!S.pdfBytes) return;
    showStatus('Saving…');
    const savedBytes = await buildEditedPdfBytes();
    try { assertSaveBytesLookSane(savedBytes); }
    catch (err) { alert(err.message); showStatus('Save aborted (safety check)'); return; }

    if (S.fileHandle && S.fileHandle.createWritable) {
      try {
        // Make sure we still have write permission; request it if not.
        if (S.fileHandle.queryPermission) {
          const p = await S.fileHandle.queryPermission({ mode: 'readwrite' });
          if (p !== 'granted') {
            const r = await S.fileHandle.requestPermission({ mode: 'readwrite' });
            if (r !== 'granted') throw new Error('Write permission denied');
          }
        }
        const writable = await S.fileHandle.createWritable();
        await writable.write(new Blob([savedBytes], { type: 'application/pdf' }));
        await writable.close();
        const savedName = S.fileHandle.name;
        // Reload the editor from the fresh bytes so the canvas shows the
        // flattened content. Without this, the canvas keeps rendering
        // pre-save bytes and the user's edits appear to disappear until
        // they refresh (clinician 2026-07-03).
        await reloadAfterSave(savedBytes);
        showStatus('Saved to ' + savedName);
        return;
      } catch (err) {
        // Don't silently fall through to a Save-As dialog — that's what
        // produced duplicate files on the desktop (clinician 2026-06-30).
        // Tell the user what happened and let them choose.
        console.warn('Write to original handle failed:', err);
        const why = err && err.name === 'NotAllowedError'
          ? 'Browser blocked the write (permission denied).'
          : (err && err.message) || 'Unknown error.';
        const useSaveAs = confirm(
          'Could not save back to "' + S.fileHandle.name + '".\n\n' +
          why + '\n\n' +
          'Click OK to open Save As and choose a destination, or Cancel to keep your edits in the editor and try again.'
        );
        if (useSaveAs) await saveAsPDF();
        else showStatus('Save cancelled — your edits are still in the editor.');
        return;
      }
    }

    // No handle at all — show a one-time prompt explaining that this open
    // path doesn't support save-in-place, then route to Save As.
    if (!S._warnedNoHandle) {
      S._warnedNoHandle = true;
      const proceed = confirm(
        'This document was opened in a way that does not allow saving back to the original file.\n\n' +
        'Tip: use the Open button (folder icon) to open the file — that grants this app permission to overwrite it on save.\n\n' +
        'Click OK to choose a save location now, or Cancel to keep editing.'
      );
      if (!proceed) { showStatus('Save cancelled — your edits are still in the editor.'); return; }
    }
    await downloadBytes(savedBytes, S.fileName.replace(/\.pdf$/i, '') + '.pdf');
  }

  async function saveAsPDF() {
    if (!S.pdfBytes) return;
    showStatus('Saving as…');
    const savedBytes = await buildEditedPdfBytes();
    try { assertSaveBytesLookSane(savedBytes); }
    catch (err) { alert(err.message); showStatus('Save aborted (safety check)'); return; }

    if (window.showSaveFilePicker && !window.electronAPI) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: S.fileName.replace(/\.pdf$/i, '') + '.pdf',
          types: [{ description: 'PDF Document', accept: { 'application/pdf': ['.pdf'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(new Blob([savedBytes], { type: 'application/pdf' }));
        await writable.close();
        // Adopt the new handle so subsequent Ctrl+S writes here.
        S.fileHandle = handle;
        S.fileName = handle.name;
        await reloadAfterSave(savedBytes);
        updateSaveIndicator();
        showStatus('Saved: ' + handle.name);
        return;
      } catch (err) {
        if (err.name === 'AbortError') { showStatus('Save cancelled'); return; }
        console.warn('Save As failed, falling back to download:', err);
      }
    }

    await downloadBytes(savedBytes, S.fileName.replace(/\.pdf$/i, '') + '.pdf');
  }

  async function downloadBytes(bytes, name) {
    // Electron native save dialog
    if (window.electronAPI) {
      try {
        const result = await window.electronAPI.showSaveDialog(name);
        if (!result.canceled && result.filePath) {
          window.electronAPI.writeFile(result.filePath, bytes);
          showStatus('Saved: ' + result.filePath.split(/[\\/]/).pop());
        }
        return;
      } catch (err) {
        console.warn('Electron save failed:', err);
      }
    }

    const blob = new Blob([bytes], { type: 'application/pdf' });

    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: name,
          types: [{
            description: 'PDF Document',
            accept: { 'application/pdf': ['.pdf'] },
          }],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        showStatus('Saved: ' + handle.name);
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
        console.warn('Save dialog failed, falling back to download:', err);
      }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  function hexRgb(hex) {
    if (!hex || hex.charAt(0) !== '#') return { r: 0, g: 0, b: 0 };
    const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return r ? {
      r: parseInt(r[1], 16) / 255,
      g: parseInt(r[2], 16) / 255,
      b: parseInt(r[3], 16) / 255,
    } : { r: 0, g: 0, b: 0 };
  }

  // =============================================================
  // TOOLBAR ACTIONS
  // =============================================================
  $('#btn-open').addEventListener('click', openFile);
  $('#btn-welcome-open').addEventListener('click', openFile);
  $('#btn-save').addEventListener('click', savePDF);
  const btnSaveAs = $('#btn-save-as');
  if (btnSaveAs) btnSaveAs.addEventListener('click', saveAsPDF);
  $('#btn-print').addEventListener('click', () => window.print());
  $('#btn-undo').addEventListener('click', undo);
  $('#btn-redo').addEventListener('click', redo);

  // =============================================================
  // KEYBOARD SHORTCUTS
  // =============================================================
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;

    if (e.ctrlKey || e.metaKey) {
      switch (e.key.toLowerCase()) {
        case 'o': e.preventDefault(); openFile(); break;
        case 's': e.preventDefault(); e.shiftKey ? saveAsPDF() : savePDF(); break;
        case 'z': e.preventDefault(); e.shiftKey ? redo() : undo(); break;
        case 'y': e.preventDefault(); redo(); break;
        case 'p': e.preventDefault(); window.print(); break;
        case 'f': e.preventDefault(); searchInput.focus(); break;
      }
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (S.selected) {
        e.preventDefault();
        // Find which page
        for (const [pn, list] of Object.entries(S.annotations)) {
          if (list.includes(S.selected)) { removeAnn(parseInt(pn), S.selected); break; }
        }
      }
    }

    if (e.key === 'Escape') {
      setTool(null);
      S.selected = null;
      // Clear multi-page selection too.
      if (S.selectedPages.size) {
        S.selectedPages.clear();
        refreshThumbSelectionClasses();
        showStatus('');
      }
      Object.keys(S.annotations).forEach(pn => renderAnnotationsForPage(parseInt(pn)));
      // Close any open modal
      $$('.modal').forEach(m => m.style.display = 'none');
    }
  });

  // =============================================================
  // DRAG & DROP
  // =============================================================
  let dragOverlay = null;

  // Find the first PDF in a DataTransfer. Many sources (File Explorer on
  // Windows, Outlook/Gmail attachments, browser drag-out, cloud-sync folders)
  // hand us files with an empty or non-standard MIME type, so we also accept
  // anything with a .pdf extension. Returns { file, handle? } if found,
  // otherwise { rejected: 'name.ext' } if files were dropped but none looked
  // like a PDF. When the browser supports it (Chrome/Edge), we grab a
  // FileSystemFileHandle from the drop event so Ctrl+S can overwrite the
  // original file instead of creating a duplicate (clinician 2026-06-15).
  const isPdfFile = (f) => f && (
    f.type === 'application/pdf' ||
    f.type === 'application/x-pdf' ||
    /\.pdf$/i.test(f.name || '')
  );

  async function extractPdfFromDrop(dt) {
    if (!dt) return { rejected: null };

    // Preferred path: DataTransferItem.getAsFileSystemHandle() (Chromium).
    // Gives us a writable handle, so Save can overwrite in place.
    if (dt.items && dt.items.length && typeof dt.items[0].getAsFileSystemHandle === 'function') {
      for (let i = 0; i < dt.items.length; i++) {
        const item = dt.items[i];
        if (item.kind !== 'file') continue;
        try {
          const handle = await item.getAsFileSystemHandle();
          if (handle && handle.kind === 'file') {
            const file = await handle.getFile();
            if (isPdfFile(file)) return { file, handle };
          }
        } catch (_e) { /* fall through to file-only */ }
      }
    }

    // Fallback: file-only (Firefox, Safari < 18, older Edge).
    const files = dt.files ? Array.from(dt.files) : [];
    if (!files.length) return { rejected: null };
    const match = files.find(isPdfFile);
    if (match) return { file: match };
    return { rejected: files[0].name || 'file' };
  }

  function removeDragOverlay() {
    if (dragOverlay) { dragOverlay.remove(); dragOverlay = null; }
  }

  // dragenter + dragover must both preventDefault to mark this as a drop zone
  // in every browser (Firefox in particular needs the dragenter).
  function showDragOverlay(e) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    if (!dragOverlay) {
      dragOverlay = document.createElement('div');
      dragOverlay.className = 'drag-overlay';
      dragOverlay.textContent = 'Drop PDF here';
      viewport.appendChild(dragOverlay);
    }
  }

  viewport.addEventListener('dragenter', showDragOverlay);
  viewport.addEventListener('dragover', showDragOverlay);

  viewport.addEventListener('dragleave', e => {
    // Only remove when the pointer actually leaves the viewport (not when it
    // moves between child elements — relatedTarget would still be inside).
    if (dragOverlay && !viewport.contains(e.relatedTarget)) removeDragOverlay();
  });

  viewport.addEventListener('drop', async e => {
    e.preventDefault();
    e.stopPropagation(); // prevent the body-level fallback from double-loading
    removeDragOverlay();
    const { file, handle, rejected } = await extractPdfFromDrop(e.dataTransfer);
    if (file) {
      S.fileHandle = handle || null;
      await loadPDF(file);
      if (handle) showStatus('Opened: ' + file.name + ' — Ctrl+S to save back');
    } else if (rejected) showStatus('Only PDF files can be opened (got: ' + rejected + ')');
  });

  // Whole-window fallback so a drop slightly outside #viewport still works,
  // and so the page never navigates away to the dropped file by default.
  document.body.addEventListener('dragenter', e => e.preventDefault());
  document.body.addEventListener('dragover', e => e.preventDefault());
  document.body.addEventListener('drop', async e => {
    e.preventDefault();
    removeDragOverlay();
    const { file, handle, rejected } = await extractPdfFromDrop(e.dataTransfer);
    if (file) {
      S.fileHandle = handle || null;
      await loadPDF(file);
      if (handle) showStatus('Opened: ' + file.name + ' — Ctrl+S to save back');
    } else if (rejected) showStatus('Only PDF files can be opened (got: ' + rejected + ')');
  });

  // =============================================================
  // PROPS PANEL
  // =============================================================
  $('#props-close').addEventListener('click', () => {
    $('#props-panel').classList.add('props-hidden');
  });

})();
