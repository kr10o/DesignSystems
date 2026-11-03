/*! BGGds Interaction Controller — v5.0.0 | MIT
 *  https://cdn.jsdelivr.net/gh/kr10o/DesignSystems@main/bggds-interaction.js
 *  Wheel axis rebinding + canvas sheet resize.
 *  Exposes window.BGGdsInteraction. Idempotent. No dependencies.
 */
(function (global) {
  'use strict';

  if (global.BGGdsInteraction && global.BGGdsInteraction.__version) return;

  const CFG = {
    workspaceSel: '#canvases-workspace',
    sheetSel: '.proportional-sheet',
    resizerSel: '.edge-resizer-r, .edge-resizer-b, .edge-resizer-br',
    modalSel: '.bgg-modal-backdrop',
    inputSel: 'input, textarea, select, [contenteditable="true"], [contenteditable=""]',
    minW: 320,
    minH: 240,
    lineHeightPx: 16,
    pageHeightPx: 800
  };

  const listeners = [];
  let active = false;

  function on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    listeners.push([target, type, fn, opts]);
  }

  function workspace() {
    return document.querySelector(CFG.workspaceSel);
  }

  function scrollDelta(e) {
    let d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (e.deltaMode === 1) d *= CFG.lineHeightPx;
    else if (e.deltaMode === 2) d *= CFG.pageHeightPx;
    return d;
  }

  function nearestVerticalScroller(node) {
    let el = node instanceof Element ? node : null;
    while (el && el !== document.body && el !== document.documentElement) {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1) return el;
      el = el.parentElement;
    }
    return null;
  }

  function maxSheetHeight(sheet) {
    const ws = workspace();
    if (ws) {
      const s = getComputedStyle(ws);
      const pad = (parseFloat(s.paddingTop) || 0) + (parseFloat(s.paddingBottom) || 0);
      return Math.max(CFG.minH, ws.clientHeight - pad);
    }
    return Math.max(CFG.minH, global.innerHeight - sheet.getBoundingClientRect().top - 20);
  }

  /* ---------------- wheel ---------------- */
  function onWheel(e) {
    if (e.ctrlKey || e.metaKey || e.defaultPrevented) return;

    const delta = scrollDelta(e);
    if (!delta) return;

    const inModal = e.target instanceof Element && e.target.closest(CFG.modalSel);
    const inInput = e.target instanceof Element && e.target.closest(CFG.inputSel);

    if (e.shiftKey) {
      if (inModal || inInput) return;             // native behaviour inside editors
      const v = nearestVerticalScroller(e.target);
      if (!v) return;                             // nothing vertically scrollable — let it be
      e.preventDefault();
      v.scrollTop += delta;
      return;
    }

    if (inModal) return;
    const ws = workspace();
    if (!ws) return;
    if (!(e.target instanceof Node) || !ws.contains(e.target)) return;
    if (ws.scrollWidth <= ws.clientWidth + 1) return;

    e.preventDefault();
    ws.scrollLeft += delta;
  }

  /* ---------------- canvas sheet resize ---------------- */
  function onPointerDown(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const handle = e.target instanceof Element ? e.target.closest(CFG.resizerSel) : null;
    if (!handle) return;

    const sheet = handle.closest(CFG.sheetSel);
    if (!sheet || handle.parentElement !== sheet) return;   // card/window handles belong to the app

    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startY = e.clientY;
    const startW = sheet.offsetWidth;
    const startH = sheet.offsetHeight;
    const doW = handle.classList.contains('edge-resizer-r') || handle.classList.contains('edge-resizer-br');
    const doH = handle.classList.contains('edge-resizer-b') || handle.classList.contains('edge-resizer-br');

    const ws = workspace();
    const prevSnap = ws ? ws.style.scrollSnapType : '';
    if (ws) ws.style.scrollSnapType = 'none';

    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = doW && doH ? 'nwse-resize' : doW ? 'ew-resize' : 'ns-resize';
    sheet.classList.add('is-resizing');

    try { handle.setPointerCapture(e.pointerId); } catch (_) { /* non-fatal */ }

    function move(ev) {
      if (doW) {
        const w = Math.max(CFG.minW, Math.round(startW + (ev.clientX - startX)));
        sheet.style.width = w + 'px';
        sheet.style.minWidth = w + 'px';
        sheet.style.maxWidth = 'none';
      }
      if (doH) {
        const cap = maxSheetHeight(sheet);
        const h = Math.min(cap, Math.max(CFG.minH, Math.round(startH + (ev.clientY - startY))));
        sheet.style.height = h + 'px';
        sheet.style.minHeight = h + 'px';
        sheet.style.maxHeight = cap + 'px';
      }
    }

    function finish(ev) {
      global.removeEventListener('pointermove', move);
      global.removeEventListener('pointerup', finish);
      global.removeEventListener('pointercancel', finish);
      if (ws) ws.style.scrollSnapType = prevSnap;
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
      sheet.classList.remove('is-resizing');
      sheet.setAttribute('data-manual-size', 'true');
      try {
        if (handle.hasPointerCapture(ev.pointerId)) handle.releasePointerCapture(ev.pointerId);
      } catch (_) { /* non-fatal */ }

      sheet.dispatchEvent(new CustomEvent('bggds-canvas-resized', {
        bubbles: true,
        detail: {
          sheet: sheet,
          canvasId: sheet.closest('.bgg-canvas-track')?.dataset.canvasId || null,
          width: sheet.offsetWidth,
          height: sheet.offsetHeight
        }
      }));
    }

    global.addEventListener('pointermove', move);
    global.addEventListener('pointerup', finish);
    global.addEventListener('pointercancel', finish);
  }

  /* ---------------- height clamp on viewport change ---------------- */
  function clampHeights() {
    document.querySelectorAll(CFG.sheetSel).forEach(function (sheet) {
      const cap = maxSheetHeight(sheet);
      if (sheet.offsetHeight > cap) {
        sheet.style.height = cap + 'px';
        sheet.style.minHeight = cap + 'px';
      }
      sheet.style.maxHeight = cap + 'px';
    });
  }

  /* ---------------- public API ---------------- */
  const api = {
    __version: '5.0.0',

    init: function () {
      if (active) return api;
      active = true;
      on(global, 'wheel', onWheel, { passive: false });
      on(document, 'pointerdown', onPointerDown, true);
      on(global, 'resize', clampHeights);
      on(global, 'orientationchange', clampHeights);
      if (document.readyState === 'loading') {
        on(document, 'DOMContentLoaded', clampHeights, { once: true });
      } else {
        clampHeights();
      }
      return api;
    },

    destroy: function () {
      listeners.forEach(function (l) {
        try { l[0].removeEventListener(l[1], l[2], l[3]); } catch (_) {}
      });
      listeners.length = 0;
      active = false;
    },

    isActive: function () { return active; },
    clamp: clampHeights,
    maxSheetHeight: maxSheetHeight
  };

  global.BGGdsInteraction = api;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { api.init(); }, { once: true });
  } else {
    api.init();
  }
})(typeof window !== 'undefined' ? window : self);