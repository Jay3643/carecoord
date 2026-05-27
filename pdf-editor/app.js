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
  };

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
  function openFile() { fileInput.click(); }

  fileInput.addEventListener('change', e => {
    if (e.target.files[0]) loadPDF(e.target.files[0]);
    fileInput.value = '';
  });

  async function loadPDF(file) {
    S.fileName = file.name || 'document.pdf';
    const buf = await file.arrayBuffer();
    S.pdfBytes = new Uint8Array(buf);
    await initDocument(S.pdfBytes);
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
    pagesContainer.innerHTML = '';
    sidebarThumbs.innerHTML = '';

    S.pdfDoc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    S.totalPages = S.pdfDoc.numPages;

    welcomeEl.style.display = 'none';
    pagesContainer.style.display = 'flex';
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

  function enableUI() {
    $$('#btn-save,#btn-print,#btn-undo,#btn-redo,#search-input,#zoom-select,#btn-zoom-in,#btn-zoom-out,#page-input')
      .forEach(el => el.disabled = false);
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
          S.selected = null;
          renderAnnotationsForPage(i + 1);
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
    const rot = S.pageRotations[idx + 1] || 0;
    const vp = page.getViewport({ scale: S.scale, rotation: rot });
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
    const rot = S.pageRotations[idx + 1] || 0;
    const vp = page.getViewport({ scale: S.scale, rotation: rot });
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
  function buildThumbnails() {
    sidebarThumbs.innerHTML = '';
    const thumbScale = 0.2;

    S.thumbObserver = new IntersectionObserver(entries => {
      entries.forEach(async e => {
        if (!e.isIntersecting) return;
        const idx = parseInt(e.target.dataset.thumbIdx);
        const cvs = e.target.querySelector('canvas');
        if (cvs.dataset.rendered) return;

        const page = await S.pdfDoc.getPage(idx + 1);
        const rot = S.pageRotations[idx + 1] || 0;
        const vp = page.getViewport({ scale: thumbScale, rotation: rot });
        cvs.width = vp.width;
        cvs.height = vp.height;
        await page.render({ canvasContext: cvs.getContext('2d'), viewport: vp }).promise;
        cvs.dataset.rendered = '1';
      });
    }, { root: sidebarEl.querySelector('.sidebar-content'), rootMargin: '100px' });

    for (let i = 0; i < S.totalPages; i++) {
      const item = document.createElement('div');
      item.className = 'thumb-item' + (i === 0 ? ' active' : '');
      item.dataset.thumbIdx = i;

      const cvs = document.createElement('canvas');
      cvs.style.width = '100%';
      item.appendChild(cvs);

      const label = document.createElement('div');
      label.className = 'thumb-label';
      label.textContent = i + 1;
      item.appendChild(label);

      item.addEventListener('click', () => scrollToPage(i));
      sidebarThumbs.appendChild(item);
      S.thumbObserver.observe(item);
    }
  }

  function scrollToPage(idx) {
    if (S.pages[idx]) {
      S.pages[idx].wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
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
  function getAnns(pageNum) {
    if (!S.annotations[pageNum]) S.annotations[pageNum] = [];
    return S.annotations[pageNum];
  }

  function addAnn(pageNum, ann) {
    getAnns(pageNum).push(ann);
    pushUndo({ action: 'add', page: pageNum, ann });
    renderAnnotationsForPage(pageNum);
  }

  function removeAnn(pageNum, ann) {
    const list = getAnns(pageNum);
    const idx = list.indexOf(ann);
    if (idx >= 0) {
      list.splice(idx, 1);
      pushUndo({ action: 'remove', page: pageNum, ann, idx });
      if (S.selected === ann) S.selected = null;
      renderAnnotationsForPage(pageNum);
    }
  }

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
      S.selected = ann;
      renderAnnotationsForPage(pageNum);

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
  // Place an editable text box directly on the page — no modal
  function placeInlineTextBox(x, y, pageNum, fontSize, color, fontFamily, bold) {
    try {
      const idx = pageNum - 1;
      const layer = S.pages[idx]?.annotLayer;
      if (!layer) { console.error('No annotation layer for page', pageNum); return; }

      fontSize = fontSize || 14;
      color = color || '#000000';
      fontFamily = fontFamily || 'Helvetica';

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
      box.style.cursor = 'text';
      box.style.boxShadow = '0 2px 12px rgba(0,0,0,0.2)';
      box.style.borderRadius = '2px';

      layer.appendChild(box);

      // Focus after a tick so the browser registers the element
      requestAnimationFrame(() => box.focus());

      let finalized = false;
      const finalize = () => {
        if (finalized) return;
        finalized = true;
        const text = box.textContent.trim();
        box.remove();
        if (text) {
          addAnn(pageNum, {
            type: 'add-text', x, y, text,
            fontSize, color, fontFamily, bold,
          });
        }
      };

      box.addEventListener('blur', finalize);
      box.addEventListener('keydown', ev => {
        if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); box.blur(); }
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
        return;
      case 'fill-text':
        placeInlineTextBox(x, y, pageNum, getFillSize(), getFillColor(), 'Helvetica', false);
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
    // Check if we already have one
    const existing = mode === 'signature' ? S.signatureData : S.initialsData;
    if (existing) {
      addAnn(pageNum, {
        type: mode, x, y, width: mode === 'initials' ? 80 : 200,
        height: mode === 'initials' ? 40 : 60,
        dataUrl: existing,
      });
      setTool(null);
      return;
    }
    clearSigCanvas();
    $('#sig-text-input').value = '';
    $('#sig-upload-preview').style.display = 'none';
    showModal('modal-signature');
  }

  function clearSigCanvas() {
    const w = sigCanvas.parentElement ? Math.max(400, sigCanvas.parentElement.offsetWidth - 36) : 500;
    sigCanvas.width = w;
    sigCanvas.height = 180;
    sigCtx.fillStyle = 'white';
    sigCtx.fillRect(0, 0, sigCanvas.width, sigCanvas.height);
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

  // Apply signature
  $('#sig-apply').addEventListener('click', () => {
    const activePane = $('.mtab-pane.active', $('#modal-signature'));
    let dataUrl = null;

    if (activePane.id === 'sig-draw') {
      dataUrl = trimSigCanvas(sigCanvas);
    } else if (activePane.id === 'sig-type') {
      const text = $('#sig-text-input').value.trim();
      if (!text) return;
      const font = $('.sig-font-opt.selected')?.dataset.font || "'Great Vibes', cursive";
      dataUrl = textToDataUrl(text, font, $('#sig-color').value);
    } else if (activePane.id === 'sig-upload') {
      const prev = $('#sig-upload-preview');
      if (prev.src && prev.style.display !== 'none') dataUrl = prev.src;
    }

    if (dataUrl) {
      if (sigTarget.mode === 'signature') S.signatureData = dataUrl;
      else S.initialsData = dataUrl;

      addAnn(sigTarget.pageNum, {
        type: sigTarget.mode,
        x: sigTarget.x, y: sigTarget.y,
        width: sigTarget.mode === 'initials' ? 80 : 200,
        height: sigTarget.mode === 'initials' ? 40 : 60,
        dataUrl,
      });
      hideModal('modal-signature');
      setTool(null);
    }
  });

  function trimSigCanvas(src) {
    const w = src.width, h = src.height;
    const px = src.getContext('2d').getImageData(0, 0, w, h).data;
    let top = h, left = w, bot = 0, right = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (px[i] < 250 || px[i + 1] < 250 || px[i + 2] < 250) {
          if (y < top) top = y; if (y > bot) bot = y;
          if (x < left) left = x; if (x > right) right = x;
        }
      }
    }
    if (bot <= top) return src.toDataURL();
    const pad = 8;
    top = Math.max(0, top - pad); left = Math.max(0, left - pad);
    bot = Math.min(h - 1, bot + pad); right = Math.min(w - 1, right + pad);
    const tc = document.createElement('canvas');
    tc.width = right - left; tc.height = bot - top;
    tc.getContext('2d').drawImage(src, left, top, tc.width, tc.height, 0, 0, tc.width, tc.height);
    return tc.toDataURL();
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

        const rot = S.pageRotations[i + 1] || 0;
        const vp = page.getViewport({ scale: S.scale, rotation: rot });
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
      if (['page-insert', 'page-delete', 'page-extract', 'page-rotate-cw', 'page-rotate-ccw', 'page-split', 'page-combine', 'header-footer'].includes(t)) {
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
        if (!confirm(`Delete page ${pageNum}?`)) return;
        await deletePageFromPDF(pageNum);
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

  async function extractPage(pageNum) {
    const doc = await PDFDocument.load(S.pdfBytes);
    const newDoc = await PDFDocument.create();
    const [page] = await newDoc.copyPages(doc, [pageNum - 1]);
    newDoc.addPage(page);
    const bytes = await newDoc.save();
    downloadBytes(bytes, `${S.fileName.replace('.pdf', '')}_page${pageNum}.pdf`);
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
    const files = [...e.target.files];
    if (!files.length) return;
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
    const rot = S.pageRotations[idx + 1] || 0;
    const vp = page.getViewport({ scale: 0.2, rotation: rot });
    cvs.width = vp.width;
    cvs.height = vp.height;
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
  // Flatten all rotations + annotations into the loaded PDF and return the bytes.
  async function buildEditedPdfBytes() {
    const pdfDoc = await PDFDocument.load(S.pdfBytes);
    const pages = pdfDoc.getPages();

    // Apply rotations
    for (const [pnStr, rot] of Object.entries(S.pageRotations)) {
      const pg = pages[parseInt(pnStr) - 1];
      if (pg && rot) pg.setRotation(pdfDegrees(rot));
    }

    // Embed annotations
    for (const [pnStr, anns] of Object.entries(S.annotations)) {
      const idx = parseInt(pnStr) - 1;
      if (idx < 0 || idx >= pages.length) continue;
      const page = pages[idx];
      const { width: pw, height: ph } = page.getSize();
      const pg = S.pages[idx];
      const cvs = pg?.canvas;
      if (!cvs) continue;
      const ratio = pw / cvs.width; // PDF points per canvas pixel — used for sizes
      const vp = pg?.viewport;      // the pdf.js viewport this page was rendered with
      // pdf-lib draws relative to the MediaBox lower-left; convertToPdfPoint returns
      // absolute user-space, so subtract the MediaBox origin (no-op for [0,0,…] pages).
      const mb = (typeof page.getMediaBox === 'function') ? page.getMediaBox() : { x: 0, y: 0 };

      // Map a canvas pixel (top-left origin) to pdf-lib coords (bottom-left origin).
      // Uses pdf.js's exact inverse render transform so flattened annotations land
      // where they were drawn, accounting for rotation / CropBox / MediaBox offsets.
      const toPdfPoint = (x, y) => {
        if (vp && typeof vp.convertToPdfPoint === 'function') {
          const p = vp.convertToPdfPoint(x, y);
          return { x: p[0] - (mb.x || 0), y: p[1] - (mb.y || 0) };
        }
        return { x: x * ratio, y: ph - y * ratio };
      };

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
              const lines = (ann.text || '').split('\n');
              lines.forEach((line, li) => {
                page.drawText(line, { x: ax, y: ay - sz * (li + 1), size: sz, font, color: rgb(c.r, c.g, c.b) });
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
              const iw = (ann.width || 200) * ratio;
              const ih = ann.height ? ann.height * ratio : iw * (img.height / img.width);
              page.drawImage(img, { x: ax, y: ay - ih, width: iw, height: ih });
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
                const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
                page.drawText('\u2713', {
                  x: ax, y: ay - 14 * ratio, size: (ann.fontSize || 18) * ratio,
                  font, color: rgb(0, 0, 0),
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

  async function savePDF() {
    if (!S.pdfBytes) return;
    const savedBytes = await buildEditedPdfBytes();
    downloadBytes(savedBytes, S.fileName.replace(/\.pdf$/i, '') + '_edited.pdf');
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
        case 's': e.preventDefault(); savePDF(); break;
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
      Object.keys(S.annotations).forEach(pn => renderAnnotationsForPage(parseInt(pn)));
      // Close any open modal
      $$('.modal').forEach(m => m.style.display = 'none');
    }
  });

  // =============================================================
  // DRAG & DROP
  // =============================================================
  let dragOverlay = null;

  viewport.addEventListener('dragover', e => {
    e.preventDefault();
    if (!dragOverlay) {
      dragOverlay = document.createElement('div');
      dragOverlay.className = 'drag-overlay';
      dragOverlay.textContent = 'Drop PDF here';
      viewport.appendChild(dragOverlay);
    }
  });

  viewport.addEventListener('dragleave', e => {
    if (dragOverlay && !viewport.contains(e.relatedTarget)) {
      dragOverlay.remove();
      dragOverlay = null;
    }
  });

  viewport.addEventListener('drop', e => {
    e.preventDefault();
    if (dragOverlay) { dragOverlay.remove(); dragOverlay = null; }
    const file = e.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') loadPDF(file);
  });

  document.body.addEventListener('dragover', e => e.preventDefault());
  document.body.addEventListener('drop', e => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file && file.type === 'application/pdf') loadPDF(file);
  });

  // =============================================================
  // PROPS PANEL
  // =============================================================
  $('#props-close').addEventListener('click', () => {
    $('#props-panel').classList.add('props-hidden');
  });

})();
