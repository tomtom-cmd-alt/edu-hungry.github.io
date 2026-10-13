/* ============================================================
 * EduHungry Browser — proxy engine
 * ------------------------------------------------------------
 * Fetches pages through a failover chain of public CORS proxies,
 * rewrites HTML/CSS so that links, images, styles and scripts all
 * route back through the chain, and renders the result inside a
 * locked-down sandboxed iframe.
 *
 * Graceful degradation:
 *   HTML engines (6, health-ordered) → Reader mode (r.jina.ai) → error page
 * ============================================================ */
'use strict';

const EHB = (function () {

  /* ---------------------------------------------------------
   * Engine chain
   * --------------------------------------------------------- */

  const RAW_ALLORIGINS = function (u) {
    return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u);
  };

  const PROXIES = [
    { id: 'allorigins-raw', label: 'AllOrigins',  build: function (u) { return RAW_ALLORIGINS(u); } },
    { id: 'allorigins-get', label: 'AllOrigins2', unwrapJSON: true,
      build: function (u) { return 'https://api.allorigins.win/get?url=' + encodeURIComponent(u); } },
    { id: 'codetabs',       label: 'CodeTabs',    build: function (u) { return 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u); } },
    { id: 'cors-lol',       label: 'cors.lol',    build: function (u) { return 'https://api.cors.lol/?url=' + encodeURIComponent(u); } },
    { id: 'cors-eu',        label: 'cors.eu.org', build: function (u) { return 'https://cors.eu.org/' + u; } },
    { id: 'cf-workers',     label: 'CF Workers',  build: function (u) { return 'https://test.cors.workers.dev/?' + u; } }
  ];

  /* Reader mode — returns markdown-ish text, last resort before failing */
  const READER = { id: 'reader', label: 'Reader', build: function (u) { return 'https://r.jina.ai/' + u; } };

  const PROXY_HOSTS = /(^|\.)((api\.allorigins\.win)|(api\.codetabs\.com)|(api\.cors\.lol)|(cors\.eu\.org)|(test\.cors\.workers\.dev)|(r\.jina\.ai))$/i;

  let preferredId = 'auto';

  /* ---------------------------------------------------------
   * Health tracking: healthy engines first, failures cool down
   * --------------------------------------------------------- */

  const health = new Map();

  function hrec(id) {
    let h = health.get(id);
    if (!h) { h = { fails: 0, ok: 0, totalMs: 0, cooldownUntil: 0, lastUsed: 0 }; health.set(id, h); }
    return h;
  }
  function markOk(id, ms) {
    const h = hrec(id);
    h.ok++; h.totalMs += ms; h.fails = Math.max(0, h.fails - 1); h.cooldownUntil = 0; h.lastUsed = Date.now();
  }
  function markFail(id) {
    const h = hrec(id);
    h.fails++;
    h.cooldownUntil = Date.now() + Math.min(45000 * h.fails, 240000);
  }
  function isHealthy(p) { return hrec(p.id).cooldownUntil < Date.now(); }
  function score(p) {
    const h = hrec(p.id);
    const avg = h.ok ? h.totalMs / h.ok : 4000;
    return h.fails * 1000 + avg / 1000;
  }
  function chain() {
    const healthyList = PROXIES.filter(function (p) { return isHealthy(p); });
    const coolingList = PROXIES.filter(function (p) { return !isHealthy(p); });
    healthyList.sort(function (a, b) { return score(a) - score(b); });
    coolingList.sort(function (a, b) { return score(a) - score(b); });
    if (preferredId !== 'auto') {
      const pref = PROXIES.find(function (p) { return p.id === preferredId; });
      if (pref) {
        return [pref].concat(healthyList.filter(function (p) { return p.id !== pref.id; }),
                             coolingList.filter(function (p) { return p.id !== pref.id; }));
      }
    }
    return healthyList.concat(coolingList);
  }

  function configure(opts) {
    if (opts && opts.preferred) preferredId = opts.preferred;
  }

  function healthReport() {
    return PROXIES.map(function (p) {
      const h = hrec(p.id);
      return {
        id: p.id, label: p.label, ok: h.ok, fails: h.fails,
        avgMs: h.ok ? Math.round(h.totalMs / h.ok) : null,
        cooling: !isHealthy(p), preferred: preferredId === p.id
      };
    });
  }

  /* ---------------------------------------------------------
   * Fetch helpers
   * --------------------------------------------------------- */

  function fetchWithTimeout(url, ms) {
    const ctrl = new AbortController();
    const timer = setTimeout(function () { ctrl.abort(); }, ms || 16000);
    return fetch(url, { signal: ctrl.signal, redirect: 'follow', credentials: 'omit', referrerPolicy: 'no-referrer' })
      .then(function (r) { clearTimeout(timer); return r; })
      .catch(function (e) { clearTimeout(timer); throw e; });
  }

  function sniffCharset(buf, ct) {
    let m = (ct || '').match(/charset=["']?([\w-]+)/i);
    if (m) return m[1];
    const head = new TextDecoder('utf-8').decode(buf.slice(0, 4096));
    m = head.match(/<meta[^>]+charset=["']?([\w-]+)/i) || head.match(/<\?xml[^>]+encoding=["']?([\w-]+)/i);
    return m ? m[1] : null;
  }

  function decodeBest(buf, ct) {
    const label = sniffCharset(buf, ct) || 'utf-8';
    try { return new TextDecoder(label).decode(buf); }
    catch (_) { /* unknown label */ }
    try { return new TextDecoder('utf-8').decode(buf); }
    catch (_) { return ''; }
  }

  function isProxyUrl(u) {
    try { return PROXY_HOSTS.test(new URL(u).hostname); }
    catch (_) { return false; }
  }

  /* Resource builder bound to the engine that won the page fetch */
  function resourceUrl(p, u) {
    if (!u || isProxyUrl(u)) return u;
    if (p && p.unwrapJSON) return RAW_ALLORIGINS(u); /* binary-safe for images */
    return (p || PROXIES[0]).build(u);
  }

  /* ---------------------------------------------------------
   * Core: fetch a URL through the chain (with reader fallback)
   * --------------------------------------------------------- */

  async function fetchPage(targetUrl, opts) {
    opts = opts || {};
    const timeout = opts.timeout || 15000;          /* first engine: generous */
    const followupTimeout = opts.followupTimeout || 8000; /* later engines: snappier */
    const deadline = opts.deadline || 35000;        /* total engine budget before reader */
    const noReader = !!opts.noReader;
    const onAttempt = opts.onAttempt || function () {};
    const startedAt = Date.now();
    let lastErr = new Error('No engine available');

    const list = chain();
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (i > 0 && (Date.now() - startedAt) > deadline) break; /* switch to reader */
      onAttempt(p.label, i + 1, list.length);
      const t0 = performance.now();
      try {
        const res = await fetchWithTimeout(p.build(targetUrl), i === 0 ? timeout : followupTimeout);
        if (!res.ok) throw new Error(p.label + ' answered HTTP ' + res.status);
        const buf = await res.arrayBuffer();
        if (buf.byteLength === 0) throw new Error(p.label + ' returned an empty body');
        let text, ct = (res.headers.get('content-type') || '').toLowerCase();
        if (p.unwrapJSON) {
          const j = JSON.parse(new TextDecoder('utf-8').decode(buf));
          if (!j || typeof j.contents !== 'string' || !j.contents) throw new Error(p.label + ' payload invalid');
          const st = j.status || {};
          if (st.http_code && st.http_code >= 400) throw new Error('target site answered HTTP ' + st.http_code);
          text = j.contents;
          ct = (st.content_type || 'text/html').toLowerCase();
        } else {
          text = decodeBest(buf, ct);
        }
        const ms = Math.round(performance.now() - t0);
        markOk(p.id, ms);
        return { text: text, ct: ct, bytes: buf.byteLength, via: p, ms: ms, reader: false,
                 res: function (u) { return resourceUrl(p, u); } };
      } catch (err) {
        markFail(p.id);
        lastErr = err;
      }
    }

    if (!noReader) {
      onAttempt(READER.label, list.length + 1, list.length + 1);
      try {
        const res = await fetchWithTimeout(READER.build(targetUrl), 12000);
        if (res.ok) {
          const text = await res.text();
          if (text && text.length > 40) {
            return { text: text, ct: 'text/plain', bytes: text.length, via: READER, ms: 0, reader: true,
                     res: function (u) { return resourceUrl(PROXIES[0], u); } };
          }
        }
      } catch (_) { /* fall through to error page */ }
    }

    throw lastErr;
  }

  /* ---------------------------------------------------------
   * CSS rewriting
   * --------------------------------------------------------- */

  function resolve(v, base) {
    try { return new URL(v, base).href; } catch (_) { return null; }
  }

  function rewriteCSS(css, base, res) {
    if (!css) return css;
    return css
      .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, function (m, q, u) {
        u = u.trim();
        if (!u || /^(data:|blob:|about:|#)/i.test(u)) return m;
        const a = resolve(u, base);
        return a ? 'url("' + res(a) + '")' : m;
      })
      .replace(/@import\s+(?!url\()(['"])([^'"]+)\1/gi, function (m, q, u) {
        const a = resolve(u, base);
        return a ? '@import url("' + res(a) + '")' : m;
      });
  }

  async function fetchStylesheet(cssUrl, res) {
    const page = await fetchPage(cssUrl, { noReader: true, timeout: 12000 });
    return rewriteCSS(page.text, cssUrl, res);
  }

  /* ---------------------------------------------------------
   * srcset
   * --------------------------------------------------------- */

  function rewriteSrcset(v, base, res) {
    if (!v || v.indexOf('data:') !== -1) return v;
    return v.split(',').map(function (part) {
      part = part.trim();
      if (!part) return '';
      const sp = part.indexOf(' ');
      const u = sp === -1 ? part : part.slice(0, sp);
      const d = sp === -1 ? '' : part.slice(sp);
      const a = resolve(u, base);
      return (a ? res(a) : u) + d;
    }).filter(Boolean).join(', ');
  }

  /* ---------------------------------------------------------
   * In-iframe hook: intercepts navigation and reports back
   * --------------------------------------------------------- */

  const IFRAME_HOOK =
    '(function(){' +
    'function post(m){try{parent.postMessage(Object.assign({__ehb:1,__tab:"__TAB__"},m),"*")}catch(e){}}' +
    'function sendTitle(){var t=document.title;if(t)post({type:"title",title:t})}' +
    'sendTitle();' +
    'document.addEventListener("click",function(e){' +
      'var el=e.target;if(!el||!el.closest)return;' +
      'var a=el.closest("a[href]");if(!a)return;' +
      'var href=a.getAttribute("href")||"";' +
      'if(href.charAt(0)==="#")return;' +
      'if(/^(javascript|mailto|tel|sms):/i.test(href))return;' +
      'e.preventDefault();e.stopPropagation();' +
      'post({type:"navigate",url:a.href,newTab:(a.target==="_blank"||e.ctrlKey||e.metaKey)});' +
    '},true);' +
    'document.addEventListener("auxclick",function(e){' +
      'if(e.button!==1)return;' +
      'var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;' +
      'if(a&&(a.getAttribute("href")||"").charAt(0)!=="#"){e.preventDefault();post({type:"navigate",url:a.href,newTab:true})}' +
    '},true);' +
    'document.addEventListener("submit",function(e){' +
      'var f=e.target;if(!f||f.tagName!=="FORM")return;' +
      'var method=(f.getAttribute("method")||"get").toUpperCase();' +
      'e.preventDefault();e.stopPropagation();' +
      'if(method==="GET"){' +
        'var u;try{u=new URL(f.getAttribute("action")||document.baseURI,document.baseURI)}catch(err){return}' +
        'try{var fd=new FormData(f);fd.forEach(function(v,k){if(typeof v==="string")u.searchParams.append(k,v)})}catch(err){}' +
        'post({type:"navigate",url:u.href})' +
      '}else{post({type:"notify",text:"POST forms (logins, uploads) are limited in proxy mode."})}' +
    '},true);' +
    'try{window.open=function(u){if(u){try{post({type:"navigate",url:new URL(u,document.baseURI).href,newTab:true})}catch(err){}}return null}}catch(e){}' +
    'document.addEventListener("mouseover",function(e){' +
      'var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;' +
      'post({type:"hover",url:a?a.href:""})' +
    '},true);' +
    'document.addEventListener("click",function(e){' +
      'var el=e.target;if(el&&(el.id==="ehb-retry"||(el.closest&&el.closest("#ehb-retry"))))post({type:"retry"})' +
    '},true);' +
    'window.addEventListener("load",sendTitle);' +
    'document.addEventListener("readystatechange",sendTitle);' +
    'setInterval(function(){var t=document.title;if(t)post({type:"title",title:t})},4000);' +
    '})();';

  /* ---------------------------------------------------------
   * HTML rewriting — the main event
   * --------------------------------------------------------- */

  async function rewriteHTML(html, pageUrl, res, tabId) {
    const doc = new DOMParser().parseFromString(html, 'text/html');

    /* strip things that would break the proxied render */
    doc.querySelectorAll('meta[http-equiv="content-security-policy" i]').forEach(function (m) { m.remove(); });
    doc.querySelectorAll('meta[http-equiv="refresh" i]').forEach(function (m) { m.remove(); });
    doc.querySelectorAll('[integrity]').forEach(function (el) { el.removeAttribute('integrity'); });
    doc.querySelectorAll('base').forEach(function (el) { el.remove(); });
    doc.querySelectorAll('link[rel="preconnect" i],link[rel="dns-prefetch" i],link[rel="prefetch" i],link[rel="preload" i],link[rel="manifest" i]').forEach(function (el) { el.remove(); });

    /* external stylesheets: fetch + rewrite + inline (fixes relative url() inside them) */
    const sheets = Array.prototype.slice.call(doc.querySelectorAll('link[rel~="stylesheet" i][href]'));
    await Promise.all(sheets.map(async function (link) {
      const absu = resolve(link.getAttribute('href'), pageUrl);
      if (!absu) { link.remove(); return; }
      try {
        const css = await fetchStylesheet(absu, res);
        const st = doc.createElement('style');
        st.setAttribute('data-ehb-css', absu);
        st.textContent = css;
        link.replaceWith(st);
      } catch (_) {
        link.setAttribute('href', res(absu));
      }
    }));

    /* media + embeddable resources */
    doc.querySelectorAll('img,iframe,embed,source,video,audio,track,input[type="image" i]').forEach(function (el) {
      ['src', 'poster', 'data-src'].forEach(function (at) {
        if (!el.hasAttribute(at)) return;
        const v = el.getAttribute(at);
        if (!v || /^(data:|blob:|about:)/i.test(v)) return;
        const a = resolve(v, pageUrl);
        if (a) el.setAttribute(at, res(a));
      });
      if (el.hasAttribute('srcset')) el.setAttribute('srcset', rewriteSrcset(el.getAttribute('srcset'), pageUrl, res));
    });
    doc.querySelectorAll('object[data]').forEach(function (el) {
      const a = resolve(el.getAttribute('data'), pageUrl);
      if (a) el.setAttribute('data', res(a));
    });

    /* scripts */
    doc.querySelectorAll('script[src]').forEach(function (el) {
      const v = el.getAttribute('src');
      if (!v || /^(data:|blob:)/i.test(v)) return;
      const a = resolve(v, pageUrl);
      if (a) el.setAttribute('src', res(a));
    });

    /* links + forms: keep absolute target URLs; the hook intercepts usage */
    doc.querySelectorAll('a[href],area[href]').forEach(function (el) {
      const v = el.getAttribute('href') || '';
      if (v.charAt(0) === '#') return;
      const a = resolve(v, pageUrl);
      if (!a) return;
      if (/^(javascript|mailto|tel|sms|blob|data):/i.test(a)) return;
      el.setAttribute('href', a);
    });
    doc.querySelectorAll('form[action]').forEach(function (el) {
      const a = resolve(el.getAttribute('action'), pageUrl);
      if (a) el.setAttribute('action', a);
    });

    /* inline styles and <style> blocks */
    doc.querySelectorAll('[style]').forEach(function (el) {
      el.setAttribute('style', rewriteCSS(el.getAttribute('style'), pageUrl, res));
    });
    doc.querySelectorAll('style').forEach(function (el) {
      if (el.hasAttribute('data-ehb-css')) return; /* already rewritten during fetch */
      el.textContent = rewriteCSS(el.textContent || '', pageUrl, res);
    });

    /* inject <base> (resolves dynamically-added relative URLs) + navigation hook */
    const base = doc.createElement('base');
    base.setAttribute('href', pageUrl);
    doc.head.insertBefore(base, doc.head.firstChild);

    const hook = doc.createElement('script');
    hook.textContent = IFRAME_HOOK.replace('__TAB__', tabId);
    doc.head.insertBefore(hook, base.nextSibling);

    return '<!doctype html>\n' + doc.documentElement.outerHTML;
  }

  /* ---------------------------------------------------------
   * Reader-mode markdown → simple HTML
   * --------------------------------------------------------- */

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderReaderMarkdown(md) {
    const lines = String(md).split(/\r?\n/);
    const out = [];
    let inList = false;
    function closeList() { if (inList) { out.push('</ul>'); inList = false; } }
    function inline(s) {
      return esc(s)
        .replace(/!\[[^\]]*\]\(([^)\s]+)[^)]*\)/g, '')
        .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, '<a href="$2">$1</a>')
        .replace(/(^|[\s(])((https?:\/\/)[^\s<)]{4,})/g, '$1<a href="$2">$2</a>');
    }
    for (let i = 0; i < lines.length; i++) {
      const L = lines[i];
      let m;
      if (/^\s*$/.test(L)) { closeList(); continue; }
      if ((m = L.match(/^(#{1,4})\s+(.*)$/))) {
        closeList();
        const lv = Math.min(m[1].length + 1, 5);
        out.push('<h' + lv + '>' + inline(m[2]) + '</h' + lv + '>');
      } else if (/^\s*[-*]\s+/.test(L)) {
        if (!inList) { out.push('<ul>'); inList = true; }
        out.push('<li>' + inline(L.replace(/^\s*[-*]\s+/, '')) + '</li>');
      } else if (/^```/.test(L)) {
        closeList();
        out.push('<div class="code-break"></div>');
      } else if (/^\s{4,}\S/.test(L)) {
        out.push('<pre class="code">' + esc(L) + '</pre>');
      } else {
        closeList();
        out.push('<p>' + inline(L) + '</p>');
      }
    }
    closeList();
    return out.join('\n');
  }

  return {
    fetchPage: fetchPage,
    rewriteHTML: rewriteHTML,
    renderReaderMarkdown: renderReaderMarkdown,
    resourceUrl: resourceUrl,
    resolve: resolve,
    isProxyUrl: isProxyUrl,
    configure: configure,
    healthReport: healthReport,
    esc: esc,
    PROXIES: PROXIES
  };
})();
