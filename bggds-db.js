/*! BGGds Persistence Engine — v5.0.0 | MIT
 *  https://cdn.jsdelivr.net/gh/kr10o/DesignSystems@main/bggds-db.js
 *  UMD-style global: window.BGGdsDB. Requires Dexie (global).
 */
(function (global) {
  'use strict';

  if (!global.Dexie) {
    console.error('[BGGdsDB] Dexie must be loaded before bggds-db.js');
    return;
  }
  if (global.BGGdsDB && global.BGGdsDB.__version) return;

  const VERSION = '5.0.0';
  const DB_NAME = 'BGGdsReactiveDB';
  const IFRAME_CHANNEL = 'bggds-iframe';
  const DEFAULT_CSS = 'https://cdn.jsdelivr.net/gh/kr10o/DesignSystems@main/bggds.css';

  const db = new global.Dexie(DB_NAME);

  db.version(1).stores({
    studioState: 'key',
    compiledModules: 'moduleId, canvasId, title, fileName, updatedAt',
    llmsStore: 'key',
    sitemapStore: 'key',
    scripts: '++id, name, version, status, updatedAt'
  });

  /* =====================================================================
     XML helpers
     ===================================================================== */
  const XML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

  function escapeXml(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return XML_ESC[c]; });
  }

  const MODULE_FIELDS = [
    ['id', 'id'],
    ['canvas-id', 'canvasId'],
    ['canvas-title', 'canvasTitle'],
    ['canvas-dim', 'canvasDim'],
    ['title', 'title'],
    ['category', 'category'],
    ['style', 'style'],
    ['fileName', 'fileName'],
    ['pct', 'pct'],
    ['md', 'md'],
    ['rendered-html', 'renderedHtml'],
    ['ai-note', 'aiNote']
  ];

  function moduleToXml(mod) {
    const out = ['<bggds-module>'];
    for (let i = 0; i < MODULE_FIELDS.length; i++) {
      const tag = MODULE_FIELDS[i][0];
      const val = mod[MODULE_FIELDS[i][1]];
      if (val !== undefined && val !== null && val !== '') {
        out.push('  <' + tag + '>' + escapeXml(val) + '</' + tag + '>');
      }
    }
    out.push('</bggds-module>');
    return out.join('\n');
  }

  function parseModuleXml(xmlString) {
    const doc = new DOMParser().parseFromString(xmlString, 'application/xml');
    const err = doc.querySelector('parsererror');
    if (err) throw new Error('[BGGdsDB] Invalid module XML: ' + err.textContent);

    const root = doc.documentElement;
    const mod = {};
    for (let i = 0; i < MODULE_FIELDS.length; i++) {
      const tag = MODULE_FIELDS[i][0];
      const key = MODULE_FIELDS[i][1];
      const el = root.getElementsByTagName(tag)[0];
      mod[key] = el ? el.textContent : '';
    }
    return mod;
  }

  function prepareModuleXmlForXslt(modOrXml) {
    const xml = typeof modOrXml === 'string' ? modOrXml : moduleToXml(modOrXml);
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const err = doc.querySelector('parsererror');
    if (err) throw new Error('[BGGdsDB] Invalid module XML: ' + err.textContent);
    return doc;
  }

  /* =====================================================================
     Iframe bridge
     ===================================================================== */
  const iframes = new Map();

  function registerIframe(id, el) {
    if (!(el instanceof HTMLIFrameElement)) {
      throw new Error('[BGGdsDB] registerIframe expects an <iframe>');
    }
    if (iframes.has(id)) {
      const prev = iframes.get(id);
      if (prev.el === el) return el;
      if (prev.listener) global.removeEventListener('message', prev.listener);
    }
    const listener = function (ev) {
      const d = ev.data;
      if (!d || d.channel !== IFRAME_CHANNEL) return;
      if (ev.source !== el.contentWindow) return;
      if (typeof el.__bggdsHandler === 'function') el.__bggdsHandler(d);
    };
    global.addEventListener('message', listener);
    iframes.set(id, { el: el, listener: listener });
    return el;
  }

  function unregisterIframe(id) {
    const rec = iframes.get(id);
    if (!rec) return;
    if (rec.listener) global.removeEventListener('message', rec.listener);
    iframes.delete(id);
  }

  function postXmlToIframe(id, modOrXml, extra) {
    const rec = iframes.get(id);
    if (!rec || !rec.el.contentWindow) return false;
    const xml = typeof modOrXml === 'string' ? modOrXml : moduleToXml(modOrXml);
    const payload = { channel: IFRAME_CHANNEL, type: 'xml', xml: xml };
    if (extra) Object.assign(payload, extra);
    rec.el.contentWindow.postMessage(payload, '*');
    return true;
  }

  /**
   * Build a fully self-contained HTML document for <iframe srcdoc>.
   * No XSLT, no disable-output-escaping: rendered HTML is sanitised upstream
   * and injected directly. The module XML travels alongside for round-trips.
   */
  function buildIframeHtml(mod, cssUrl) {
    const css = cssUrl || DEFAULT_CSS;
    const m = typeof mod === 'string' ? parseModuleXml(mod) : mod;
    const xml = typeof mod === 'string' ? mod : moduleToXml(mod);
    const style = m.style || 'prompt';
    const cat = m.category || 'MD';
    const title = escapeXml(m.title || 'Module');
    const canvasTitle = escapeXml(m.canvasTitle || '');
    const canvasDim = escapeXml(m.canvasDim || '');
    const bodyHtml = String(m.renderedHtml || '');
    const note = m.aiNote ? '<footer class="bgg-page-footer"><span><strong>AI:</strong> ' +
      escapeXml(m.aiNote) + '</span></footer>' : '';

    return '<!DOCTYPE html>\n<html lang="hr" data-theme="light">\n<head>\n' +
      '<meta charset="UTF-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
      '<title>' + title + (canvasTitle ? ' | ' + canvasTitle : '') + '</title>\n' +
      '<link rel="stylesheet" href="' + css + '">\n' +
      '<style>body{background:var(--bgg-sheet);padding:20px;overflow:auto}' +
      '.bgg-card{max-width:860px;margin:0 auto}</style>\n' +
      '</head>\n<body class="bgg-unified">\n' +
      '<article class="bgg-card bgg-card-' + escapeXml(style) + '">\n' +
      '  <header class="bgg-card-header">\n' +
      '    <div style="display:flex;align-items:center;gap:6px;min-width:0">\n' +
      '      <span class="bgg-pill-icon bgg-pill-' + escapeXml(style) + '">' + escapeXml(cat) + '</span>\n' +
      '      <h1 class="bgg-card-title">' + title + '</h1>\n' +
      '    </div>\n' +
      (canvasTitle ? '    <span class="bgg-badge">' + canvasTitle +
        (canvasDim ? ' (' + canvasDim + ')' : '') + '</span>\n' : '') +
      '  </header>\n' +
      '  <section class="bgg-card-body bgg-md-rendered">' + bodyHtml + '</section>\n' +
      '  ' + note + '\n' +
      '</article>\n' +
      '<script type="application/xml" id="bggds-source">' + escapeXml(xml) + '<\/script>\n' +
      '<script>\n' +
      '(function(){\n' +
      '  var CH = ' + JSON.stringify(IFRAME_CHANNEL) + ';\n' +
      '  function post(t, extra){ try{ parent.postMessage(Object.assign({channel:CH,type:t}, extra||{}),"*"); }catch(e){} }\n' +
      '  post("ready");\n' +
      '  addEventListener("message", function(ev){\n' +
      '    var d = ev.data;\n' +
      '    if(!d || d.channel !== CH || d.type !== "xml") return;\n' +
      '    try { location.replace(URL.createObjectURL(new Blob([""],{type:"text/plain"}))); } catch(e){}\n' +
      '    post("ack", { ok:false, reason:"reload-required" });\n' +
      '  });\n' +
      '})();\n' +
      '<\/script>\n' +
      '</body>\n</html>';
  }

  /* =====================================================================
     Serialisation helpers
     ===================================================================== */
  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  function toXmlNode(name, value, indent) {
    const pad = indent || '';
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) {
      return value.map(function (v) { return toXmlNode(name, v, pad); }).join('\n');
    }
    if (typeof value === 'object') {
      const inner = Object.keys(value).map(function (k) {
        return toXmlNode(k, value[k], pad + '  ');
      }).join('\n');
      return pad + '<' + name + '>\n' + inner + '\n' + pad + '</' + name + '>';
    }
    return pad + '<' + name + '>' + escapeXml(value) + '</' + name + '>';
  }

  function xmlToObj(node) {
    const kids = node.children;
    if (!kids.length) return node.textContent;
    const obj = {};
    for (let i = 0; i < kids.length; i++) {
      const c = kids[i];
      const v = xmlToObj(c);
      if (Object.prototype.hasOwnProperty.call(obj, c.tagName)) {
        if (!Array.isArray(obj[c.tagName])) obj[c.tagName] = [obj[c.tagName]];
        obj[c.tagName].push(v);
      } else {
        obj[c.tagName] = v;
      }
    }
    return obj;
  }

  function toArray(v) {
    if (v === undefined || v === null) return [];
    return Array.isArray(v) ? v : [v];
  }

  /* =====================================================================
     Public API
     ===================================================================== */
  const api = {
    __version: VERSION,
    db: db,

    /* --- XML --- */
    moduleToXml: moduleToXml,
    parseModuleXml: parseModuleXml,
    prepareModuleXmlForXslt: prepareModuleXmlForXslt,
    buildIframeHtml: buildIframeHtml,

    /* --- iframe bridge --- */
    registerIframe: registerIframe,
    unregisterIframe: unregisterIframe,
    postXmlToIframe: postXmlToIframe,

    /* --- bootstrap --- */
    async initDefaultScripts() {
      try {
        const n = await db.scripts.count();
        if (n > 0) return;
        await db.scripts.bulkAdd([
          { name: 'SPA DOM Observer Hook', version: '1.0.2', status: 'Aktivno', updatedAt: new Date().toISOString().slice(0, 10) },
          { name: 'CORS Proxy Fetcher', version: '2.1.0', status: 'Aktivno', updatedAt: new Date().toISOString().slice(0, 10) }
        ]);
      } catch (e) {
        console.warn('[BGGdsDB] initDefaultScripts:', e);
      }
    },

    /* --- workspace --- */
    async saveWorkspace(canvases) {
      try {
        const data = canvases.map(function (c) {
          return {
            id: c.id,
            title: c.title,
            wMm: c.wMm,
            hMm: c.hMm,
            manualW: c.manualPx ? c.manualPx.w : null,
            manualH: c.manualPx ? c.manualPx.h : null,
            cards: Array.isArray(c.cards) ? c.cards : []
          };
        });
        await db.studioState.put({ key: 'workspace', data: data, updatedAt: new Date().toISOString() });
        return data;
      } catch (e) {
        console.error('[BGGdsDB] saveWorkspace:', e);
        return null;
      }
    },

    async loadWorkspace() {
      try {
        const rec = await db.studioState.get('workspace');
        return rec && Array.isArray(rec.data) ? rec.data : null;
      } catch (e) {
        console.warn('[BGGdsDB] loadWorkspace:', e);
        return null;
      }
    },

    /* --- artifacts --- */
    async saveArtifacts(payload) {
      const map = payload && payload.compiledMap ? payload.compiledMap : {};
      const rows = Object.keys(map).map(function (k) { return map[k]; });
      try {
        await db.transaction('rw', db.compiledModules, db.llmsStore, db.sitemapStore, async function () {
          await db.compiledModules.clear();
          if (rows.length) await db.compiledModules.bulkPut(rows);
          if (typeof payload.llmsTxt === 'string') {
            await db.llmsStore.put({
              key: 'cumulativeLlms',
              text: payload.llmsTxt,
              updatedAt: payload.timestamp || new Date().toISOString()
            });
          }
          if (typeof payload.sitemapXml === 'string') {
            await db.sitemapStore.put({
              key: 'latestSitemap',
              xml: payload.sitemapXml,
              updatedAt: payload.timestamp || new Date().toISOString()
            });
          }
        });
      } catch (e) {
        console.error('[BGGdsDB] saveArtifacts:', e);
      }
    },

    async loadArtifacts() {
      try {
        const rows = await db.compiledModules.toArray();
        const llms = await db.llmsStore.get('cumulativeLlms');
        const sitemap = await db.sitemapStore.get('latestSitemap');
        const modules = {};
        rows.forEach(function (r) { modules[r.moduleId] = r; });
        return {
          modules: modules,
          llmsTxt: llms ? llms.text : '',
          sitemapXml: sitemap ? sitemap.xml : '',
          lastUpdated: llms ? llms.updatedAt : ''
        };
      } catch (e) {
        console.warn('[BGGdsDB] loadArtifacts:', e);
        return { modules: {}, llmsTxt: '', sitemapXml: '', lastUpdated: '' };
      }
    },

    async resetAll() {
      try {
        await Promise.all([
          db.studioState.clear(),
          db.compiledModules.clear(),
          db.llmsStore.clear(),
          db.sitemapStore.clear(),
          db.scripts.clear()
        ]);
      } catch (e) {
        console.error('[BGGdsDB] resetAll:', e);
      }
    },

    /* --- export / import --- */
    async exportAll() {
      const res = await Promise.all([
        db.studioState.toArray(),
        db.compiledModules.toArray(),
        db.llmsStore.toArray(),
        db.sitemapStore.toArray(),
        db.scripts.toArray()
      ]);
      return {
        version: 2,
        exportedAt: new Date().toISOString(),
        studioState: res[0],
        compiledModules: res[1],
        llmsStore: res[2],
        sitemapStore: res[3],
        scripts: res[4]
      };
    },

    async exportJson() {
      return JSON.stringify(await api.exportAll(), null, 2);
    },

    async exportXml() {
      const d = await api.exportAll();
      const body = Object.keys(d).map(function (k) { return toXmlNode(k, d[k], '  '); }).join('\n');
      return '<?xml version="1.0" encoding="UTF-8"?>\n<bggds-db>\n' + body + '\n</bggds-db>';
    },

    async exportTxt() {
      const llms = await db.llmsStore.get('cumulativeLlms');
      const scripts = await db.scripts.toArray();
      const lines = [
        '# BGGds TXT export ' + new Date().toISOString(),
        '',
        '# === LLMS.TXT ===',
        llms ? llms.text : '',
        '',
        '# === SCRIPTS (name | version | status | updatedAt) ==='
      ];
      scripts.forEach(function (s) {
        lines.push([s.name, s.version, s.status, s.updatedAt].join(' | '));
      });
      return lines.join('\n');
    },

    async importAll(payload, opts) {
      if (!payload || typeof payload !== 'object') throw new Error('importAll: invalid payload');
      if (opts && opts.clearBefore) await api.resetAll();
      try {
        if (Array.isArray(payload.studioState) && payload.studioState.length) {
          await db.studioState.bulkPut(payload.studioState);
        }
        if (Array.isArray(payload.compiledModules) && payload.compiledModules.length) {
          await db.compiledModules.bulkPut(payload.compiledModules);
        }
        if (Array.isArray(payload.llmsStore) && payload.llmsStore.length) {
          await db.llmsStore.bulkPut(payload.llmsStore);
        }
        if (Array.isArray(payload.sitemapStore) && payload.sitemapStore.length) {
          await db.sitemapStore.bulkPut(payload.sitemapStore);
        }
        if (Array.isArray(payload.scripts) && payload.scripts.length) {
          const clean = payload.scripts.map(function (s) {
            const copy = Object.assign({}, s);
            delete copy.id;
            return copy;
          });
          await db.scripts.bulkAdd(clean);
        }
        return true;
      } catch (e) {
        console.error('[BGGdsDB] importAll:', e);
        throw e;
      }
    },

    async importJson(text) {
      return api.importAll(typeof text === 'string' ? JSON.parse(text) : text);
    },

    async importXml(text) {
      const doc = new DOMParser().parseFromString(text, 'application/xml');
      const err = doc.querySelector('parsererror');
      if (err) throw new Error('Invalid XML: ' + err.textContent);
      const d = xmlToObj(doc.documentElement);
      return api.importAll({
        studioState: toArray(d.studioState),
        compiledModules: toArray(d.compiledModules),
        llmsStore: toArray(d.llmsStore),
        sitemapStore: toArray(d.sitemapStore),
        scripts: toArray(d.scripts)
      });
    },

    async importTxt(text) {
      const parts = text.split('# === SCRIPTS');
      const llmsBody = parts[0]
        .replace(/^# BGGds TXT export[^\n]*\n?/, '')
        .replace('# === LLMS.TXT ===', '')
        .trim();
      if (llmsBody) {
        await db.llmsStore.put({
          key: 'cumulativeLlms',
          text: llmsBody,
          updatedAt: new Date().toISOString()
        });
      }
      if (parts[1]) {
        const rows = parts[1].split('\n').slice(1)
          .map(function (l) { return l.split('|').map(function (s) { return s.trim(); }); })
          .filter(function (a) { return a.length === 4 && a[0]; })
          .map(function (a) {
            return { name: a[0], version: a[1], status: a[2], updatedAt: a[3] };
          });
        if (rows.length) await db.scripts.bulkAdd(rows);
      }
      return true;
    },

    async importFile(file) {
      const text = await file.text();
      if (/\.json$/i.test(file.name)) return api.importJson(text);
      if (/\.xml$/i.test(file.name)) return api.importXml(text);
      if (/\.txt$/i.test(file.name)) return api.importTxt(text);
      throw new Error('Unsupported file: ' + file.name);
    },

    async downloadJson(name) { download(name || 'bggds-db.json', await api.exportJson(), 'application/json'); },
    async downloadXml(name) { download(name || 'bggds-db.xml', await api.exportXml(), 'application/xml'); },
    async downloadTxt(name) { download(name || 'bggds-llms.txt', await api.exportTxt(), 'text/plain'); },

    /* --- granular --- */
    async addScript(input) {
      const o = typeof input === 'string' ? JSON.parse(input) : input;
      return db.scripts.add({
        name: o.name,
        version: o.version || '1.0.0',
        status: o.status || 'Aktivno',
        updatedAt: o.updatedAt || new Date().toISOString().slice(0, 10)
      });
    },

    async addCompiledModule(input) {
      const o = typeof input === 'string' ? JSON.parse(input) : input;
      if (!o.moduleId) throw new Error('moduleId is required');
      if (!o.xml && o.md !== undefined) o.xml = moduleToXml(o);
      return db.compiledModules.put(o);
    },

    async addLlms(text) {
      return db.llmsStore.put({
        key: 'cumulativeLlms',
        text: typeof text === 'string' ? text : String(text && text.text || ''),
        updatedAt: new Date().toISOString()
      });
    },

    async addSitemap(xml) {
      return db.sitemapStore.put({
        key: 'latestSitemap',
        xml: typeof xml === 'string' ? xml : String(xml && xml.xml || ''),
        updatedAt: new Date().toISOString()
      });
    },

    async seedFromUrl(url) {
      const res = await fetch(url, { credentials: 'omit' });
      if (!res.ok) throw new Error('seedFromUrl HTTP ' + res.status);
      const text = await res.text();
      if (/\.json(\?|$)/i.test(url)) return api.importJson(text);
      if (/\.xml(\?|$)/i.test(url)) return api.importXml(text);
      return api.importTxt(text);
    }
  };

  global.BGGdsDB = api;
})(typeof window !== 'undefined' ? window : self);