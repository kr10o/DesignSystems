/*! BGGds Service Worker — v5.0.0 | MIT
 *  https://cdn.jsdelivr.net/gh/kr10o/DesignSystems@main/service-worker.js
 *
 *  Dual-mode:
 *    · Page  — exposes window.BGGdsSW and auto-registers the SW
 *    · Worker— install / activate / fetch / message
 */
(function (scope) {
  'use strict';

  const VERSION = '5.0.0';
  const V = 'v5';

  const CACHE = {
    APP: 'bggds-app-' + V,
    CDN: 'bggds-cdn-' + V,
    FONT: 'bggds-font-' + V,
    FRAME: 'bggds-frame-' + V,
    XML: 'bggds-xml-' + V
  };

  const PRECACHE = ['./', './index.html', './manifest.json'];
  const FRAME_MARKER = '/__iframe__/';
  const FRAME_KEY_PREFIX = './__iframe__/';

  const CDN_HOSTS = [
    'cdn.jsdelivr.net',
    'cdnjs.cloudflare.com',
    'unpkg.com'
  ];
  const FONT_HOSTS = [
    'fonts.bunny.net',
    'fonts.googleapis.com',
    'fonts.gstatic.com'
  ];

  const FRAME_MAX = 200;
  const FRAME_TTL = 7 * 24 * 60 * 60 * 1000;

  /* =====================================================================
     MODE A — page
     ===================================================================== */
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    if (window.BGGdsSW && window.BGGdsSW.__version) return;

    function ask(type, payload) {
      return new Promise(function (resolve) {
        const reg = navigator.serviceWorker && navigator.serviceWorker.controller;
        if (!reg) { resolve({ ok: false, reason: 'no-controller' }); return; }

        const ch = new MessageChannel();
        let done = false;
        const timer = setTimeout(function () {
          if (done) return;
          done = true;
          resolve({ ok: false, reason: 'timeout' });
        }, 6000);

        ch.port1.onmessage = function (e) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(e.data || { ok: false, reason: 'empty' });
        };

        try {
          reg.postMessage(Object.assign({ type: type }, payload || {}), [ch.port2]);
        } catch (err) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve({ ok: false, reason: 'post-failed', error: String(err) });
        }
      });
    }

    const api = {
      __version: VERSION,

      async register() {
        if (!('serviceWorker' in navigator)) return { ok: false, reason: 'unsupported' };
        const candidates = ['./service-worker.js', './1service-worker.js'];
        for (let i = 0; i < candidates.length; i++) {
          try {
            const reg = await navigator.serviceWorker.register(
              candidates[i] + '?v=' + VERSION,
              { scope: './', updateViaCache: 'none' }
            );
            await navigator.serviceWorker.ready;
            return { ok: true, scope: reg.scope, url: candidates[i] };
          } catch (err) {
            /* try next candidate */
          }
        }
        return { ok: false, reason: 'all-candidates-failed' };
      },

      cacheXml: function (url, key) { return ask('BGGDS_CACHE_XML', { url: url, key: key || url }); },
      registerIframeDocument: function (fileName, html) {
        return ask('BGGDS_REGISTER_FRAME', { fileName: fileName, html: html });
      },
      precacheArtifacts: function (artifacts) { return ask('BGGDS_PRECACHE_FRAMES', { artifacts: artifacts }); },
      getCachedArtifacts: function () { return ask('BGGDS_GET_FRAMES', {}); },
      clearCachedArtifacts: function () { return ask('BGGDS_CLEAR_FRAMES', {}); },
      ping: function () { return ask('BGGDS_PING', {}); },
      stats: function () { return ask('BGGDS_STATS', {}); },
      hardReset: function () { return ask('BGGDS_HARD_RESET', {}); },

      get isActive() {
        return !!(navigator.serviceWorker && navigator.serviceWorker.controller);
      }
    };

    window.BGGdsSW = api;

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', function (ev) {
        const d = ev.data || {};
        if (d.type === 'BGGDS_SW_ACTIVATED') {
          console.info('[BGGdsSW] active v' + d.version);
        }
      });
    }

    api.register().then(function (r) {
      if (!r.ok) {
        console.info('[BGGdsSW] not registered (' + r.reason + '). Offline cache disabled.');
      }
    });

    return;
  }

  /* =====================================================================
     MODE B — service worker
     ===================================================================== */
  const frames = new Map();   // fileName -> { html, at }

  /* ---------- install ---------- */
  self.addEventListener('install', function (event) {
    self.skipWaiting();
    event.waitUntil((async function () {
      const cache = await caches.open(CACHE.APP);
      await Promise.all(PRECACHE.map(async function (url) {
        try { await cache.add(new Request(url, { cache: 'reload' })); } catch (_) {}
      }));
      if (event.addRoutes && typeof URLPattern !== 'undefined') {
        try {
          await event.addRoutes([{
            condition: { urlPattern: new URLPattern({ hostname: 'generativelanguage.googleapis.com' }) },
            source: 'network'
          }]);
        } catch (_) {}
      }
    })());
  });

  /* ---------- activate ---------- */
  self.addEventListener('activate', function (event) {
    event.waitUntil((async function () {
      const keep = Object.keys(CACHE).map(function (k) { return CACHE[k]; });
      const names = await caches.keys();
      await Promise.all(names.map(function (n) {
        return (n.indexOf('bggds-') === 0 && keep.indexOf(n) === -1)
          ? caches.delete(n)
          : Promise.resolve();
      }));

      if (self.registration.navigationPreload) {
        try { await self.registration.navigationPreload.enable(); } catch (_) {}
      }

      await self.clients.claim();

      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach(function (c) {
        c.postMessage({ type: 'BGGDS_SW_ACTIVATED', version: VERSION });
      });
    })());
  });

  /* ---------- messages ---------- */
  self.addEventListener('message', function (event) {
    const data = event.data || {};
    const port = event.ports && event.ports[0];

    function reply(obj) {
      if (port) port.postMessage(obj);
      else if (event.source) event.source.postMessage(obj);
    }

    if (!data.type) { reply({ ok: false, reason: 'no-type' }); return; }

    event.waitUntil((async function () {
      try {
        switch (data.type) {
          case 'BGGDS_PING':
            return reply({ ok: true, version: VERSION, ts: Date.now() });

          case 'BGGDS_STATS': {
            const out = {};
            for (const k of Object.keys(CACHE)) {
              const c = await caches.open(CACHE[k]);
              out[k] = (await c.keys()).length;
            }
            let quota = null;
            if (self.navigator && self.navigator.storage && self.navigator.storage.estimate) {
              try {
                const est = await self.navigator.storage.estimate();
                quota = { usageMb: +(est.usage / 1048576).toFixed(2), quotaMb: +(est.quota / 1048576).toFixed(2) };
              } catch (_) {}
            }
            return reply({ ok: true, version: VERSION, caches: out, frames: frames.size, quota: quota });
          }

          case 'BGGDS_CACHE_XML': {
            if (!data.url) return reply({ ok: false, reason: 'no-url' });
            const cache = await caches.open(CACHE.XML);
            const res = await fetch(data.url, { credentials: 'omit' });
            if (!res.ok) return reply({ ok: false, reason: 'http-' + res.status });
            await cache.put(new Request(data.key || data.url), res.clone());
            return reply({ ok: true, key: data.key || data.url });
          }

          case 'BGGDS_REGISTER_FRAME': {
            if (!data.fileName || typeof data.html !== 'string') {
              return reply({ ok: false, reason: 'bad-payload' });
            }
            frames.set(data.fileName, { html: data.html, at: Date.now() });
            await storeFrame(data.fileName, data.html);
            await evictFrames();
            return reply({ ok: true, fileName: data.fileName, size: data.html.length });
          }

          case 'BGGDS_PRECACHE_FRAMES': {
            const list = Array.isArray(data.artifacts) ? data.artifacts : [];
            let n = 0;
            for (const item of list) {
              if (!item || !item.fileName || typeof item.html !== 'string') continue;
              frames.set(item.fileName, { html: item.html, at: Date.now() });
              await storeFrame(item.fileName, item.html);
              n++;
            }
            await evictFrames();
            return reply({ ok: true, count: n });
          }

          case 'BGGDS_GET_FRAMES': {
            const cache = await caches.open(CACHE.FRAME);
            const reqs = await cache.keys();
            const artifacts = {};
            for (const req of reqs) {
              const u = new URL(req.url);
              const i = u.pathname.lastIndexOf(FRAME_MARKER);
              if (i === -1) continue;
              const name = u.pathname.slice(i + FRAME_MARKER.length);
              const res = await cache.match(req);
              if (res) artifacts[name] = await res.text();
            }
            return reply({ ok: true, artifacts: artifacts, count: Object.keys(artifacts).length });
          }

          case 'BGGDS_CLEAR_FRAMES': {
            frames.clear();
            await caches.delete(CACHE.FRAME);
            await caches.delete(CACHE.XML);
            return reply({ ok: true });
          }

          case 'BGGDS_HARD_RESET': {
            frames.clear();
            const names = await caches.keys();
            await Promise.all(names.map(function (n) { return caches.delete(n); }));
            return reply({ ok: true });
          }

          default:
            return reply({ ok: false, reason: 'unknown-type' });
        }
      } catch (err) {
        reply({ ok: false, error: String(err && err.message || err) });
      }
    })());
  });

  /* ---------- fetch ---------- */
  self.addEventListener('fetch', function (event) {
    const req = event.request;
    let url;
    try { url = new URL(req.url); } catch (_) { return; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    if (req.method !== 'GET') return;

    /* Gemini — never cache */
    if (url.hostname === 'generativelanguage.googleapis.com') return;

    /* iframe documents */
    const idx = url.pathname.lastIndexOf(FRAME_MARKER);
    if (idx !== -1) {
      event.respondWith(serveFrame(url.pathname.slice(idx + FRAME_MARKER.length)));
      return;
    }

    /* XML */
    if (/\.xml$/i.test(url.pathname) || (req.headers.get('accept') || '').indexOf('application/xml') !== -1) {
      event.respondWith(staleWhileRevalidate(CACHE.XML, req));
      return;
    }

    /* fonts */
    if (FONT_HOSTS.indexOf(url.hostname) !== -1) {
      event.respondWith(cacheFirst(CACHE.FONT, req));
      return;
    }

    /* CDN libs */
    if (CDN_HOSTS.indexOf(url.hostname) !== -1) {
      event.respondWith(staleWhileRevalidate(CACHE.CDN, req));
      return;
    }

    /* navigation */
    if (req.mode === 'navigate') {
      event.respondWith(navigationHandler(event, req));
      return;
    }

    event.respondWith(cacheFirst(CACHE.APP, req));
  });

  /* ---------- strategies ---------- */
  async function storeFrame(fileName, html) {
    const cache = await caches.open(CACHE.FRAME);
    await cache.put(
      new Request(FRAME_KEY_PREFIX + fileName),
      new Response(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'X-BGGds-Registered': new Date().toISOString()
        }
      })
    );
  }

  async function serveFrame(fileName) {
    if (!fileName) return notFound('');

    const mem = frames.get(fileName);
    if (mem) {
      return new Response(mem.html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    const cache = await caches.open(CACHE.FRAME);
    const hit = await cache.match(FRAME_KEY_PREFIX + fileName);
    if (hit) {
      try {
        const html = await hit.clone().text();
        frames.set(fileName, { html: html, at: Date.now() });
      } catch (_) {}
      return hit;
    }

    return notFound(fileName);
  }

  function notFound(fileName) {
    const safe = String(fileName).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c];
    });
    return new Response(
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Not found</title></head>' +
      '<body style="font-family:system-ui;padding:24px;background:#f8fafc;color:#0f172a">' +
      '<h2>Iframe document not found</h2><p><code>' + safe + '</code></p>' +
      '<p style="color:#64748b">Run the compile pipeline or call ' +
      '<code>BGGdsSW.registerIframeDocument()</code>.</p></body></html>',
      { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }

  async function evictFrames() {
    const now = Date.now();

    for (const entry of Array.from(frames.entries())) {
      if (now - entry[1].at > FRAME_TTL) frames.delete(entry[0]);
    }

    if (frames.size > FRAME_MAX) {
      const sorted = Array.from(frames.entries()).sort(function (a, b) { return a[1].at - b[1].at; });
      const excess = frames.size - FRAME_MAX;
      for (let i = 0; i < excess; i++) frames.delete(sorted[i][0]);
    }

    const keep = new Set(Array.from(frames.keys()).map(function (n) { return FRAME_KEY_PREFIX + n; }));
    const cache = await caches.open(CACHE.FRAME);
    const reqs = await cache.keys();
    for (const req of reqs) {
      const u = new URL(req.url);
      const i = u.pathname.lastIndexOf(FRAME_MARKER);
      if (i === -1) continue;
      const key = FRAME_KEY_PREFIX + u.pathname.slice(i + FRAME_MARKER.length);
      if (!keep.has(key)) await cache.delete(req);
    }
  }

  async function cacheFirst(cacheName, req) {
    const cache = await caches.open(cacheName);
    const hit = await cache.match(req, { ignoreSearch: false });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res && (res.ok || res.type === 'opaque')) await cache.put(req, res.clone());
      return res;
    } catch (err) {
      return new Response('', { status: 503, statusText: 'Offline' });
    }
  }

  async function staleWhileRevalidate(cacheName, req) {
    const cache = await caches.open(cacheName);
    const hit = await cache.match(req);
    const network = fetch(req).then(function (res) {
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()).catch(function () {});
      return res;
    }).catch(function () { return null; });

    if (hit) return hit;
    const res = await network;
    return res || new Response('', { status: 503, statusText: 'Offline' });
  }

  async function navigationHandler(event, req) {
    try {
      if (event.preloadResponse) {
        const pre = await event.preloadResponse;
        if (pre) return pre;
      }
      const res = await fetch(req);
      if (res && res.ok) {
        const cache = await caches.open(CACHE.APP);
        cache.put(req, res.clone()).catch(function () {});
      }
      return res;
    } catch (err) {
      const direct = await caches.match(req);
      if (direct) return direct;
      const shell = await caches.match('./index.html') || await caches.match('./');
      if (shell) return shell;
      return new Response(
        '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Offline</title></head>' +
        '<body style="font-family:system-ui;padding:24px"><h2>Offline</h2>' +
        '<p>Reconnect and reload once to prime the cache.</p></body></html>',
        { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      );
    }
  }

  /* ---------- background sync ---------- */
  self.addEventListener('sync', function (event) {
    if (event.tag !== 'bggds-sync-workspace') return;
    event.waitUntil((async function () {
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach(function (c) { c.postMessage({ type: 'BGGDS_BG_SYNC' }); });
    })());
  });

  if ('periodicSync' in self.registration) {
    self.addEventListener('periodicsync', function (event) {
      if (event.tag !== 'bggds-cleanup') return;
      event.waitUntil(evictFrames());
    });
  }
})(typeof self !== 'undefined' ? self : this);