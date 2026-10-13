/* ============================================================
 * EduHungry Browser — app shell: tabs, address bar, history,
 * new-tab page, settings, session persistence.
 * ============================================================ */
'use strict';

(function () {

  /* ---------------- state ---------------- */

  const LS_SESSION = 'ehb:session';
  const LS_RECENTS = 'ehb:recents';
  const LS_SETTINGS = 'ehb:settings';

  const state = {
    tabs: [],
    activeId: null,
    counter: 0
  };

  const settings = Object.assign(
    { preferred: 'auto', search: 'ddg' },
    load(LS_SETTINGS) || {}
  );

  const recents = load(LS_RECENTS) || [];

  function load(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} }

  /* ---------------- dom ---------------- */

  const $ = function (sel) { return document.querySelector(sel); };
  const tabsEl = $('#tabs');
  const viewsEl = $('#views');
  const urlbar = $('#urlbar');
  const hoverEl = $('#hover-url');
  const engineEl = $('#engine-status');
  const progressBar = $('#progress-bar');
  const progress = $('#progress');
  let loadingCount = 0;

  const ICONS = {
    back: '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    fwd: '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    reload: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.34 6.34M20 5v6h-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    home: '<svg viewBox="0 0 24 24"><path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55h.01a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3z" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>'
  };

  const SEARCH_ENGINES = {
    ddg: { name: 'DuckDuckGo', url: 'https://html.duckduckgo.com/html/?q=' },
    mojeek: { name: 'Mojeek', url: 'https://www.mojeek.com/search?q=' },
    wikipedia: { name: 'Wikipedia', url: 'https://en.wikipedia.org/w/index.php?search=' }
  };

  const QUICK_LINKS = [
    { name: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Main_Page', tag: 'encyclopedia' },
    { name: 'DuckDuckGo', url: 'https://html.duckduckgo.com/html/?q=welcome', tag: 'search' },
    { name: 'Hacker News', url: 'https://news.ycombinator.com/', tag: 'tech news' },
    { name: 'MDN Docs', url: 'https://developer.mozilla.org/en-US/', tag: 'web docs' },
    { name: 'BBC News', url: 'https://www.bbc.com/news', tag: 'world news' },
    { name: 'Gutenberg', url: 'https://www.gutenberg.org/ebooks/', tag: 'free books' },
    { name: 'Stack Overflow', url: 'https://stackoverflow.com/questions', tag: 'coding Q&A' },
    { name: 'Old Reddit', url: 'https://old.reddit.com/', tag: 'communities' }
  ];

  /* ---------------- helpers ---------------- */

  function activeTab() { return state.tabs.find(function (t) { return t.id === state.activeId; }) || null; }

  function normalizeInput(input) {
    const s = String(input || '').trim();
    if (!s) return null;
    if (/^https?:\/\//i.test(s)) return s;
    if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^(localhost)/i.test(s)) return null; /* unsupported scheme */
    const looksDomain = /^([\w-]+\.)+[a-z]{2,}(:\d+)?([\/?#].*)?$/i.test(s);
    if (looksDomain) return 'https://' + s;
    if (/^localhost(:\d+)?([\/?#].*)?$/i.test(s)) return 'http://' + s;
    const eng = SEARCH_ENGINES[settings.search] || SEARCH_ENGINES.ddg;
    return eng.url + encodeURIComponent(s);
  }

  function hostOf(u) { try { return new URL(u).hostname; } catch (_) { return ''; } }

  function faviconFor(u) {
    const h = hostOf(u);
    return h ? 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(h) + '&sz=32' : '';
  }

  function prettyUrl(u) {
    try { const x = new URL(u); return x.hostname + (x.pathname !== '/' ? x.pathname : '') + x.search; }
    catch (_) { return u; }
  }

  function toast(text) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    $('#toasts').appendChild(t);
    setTimeout(function () { t.classList.add('show'); }, 10);
    setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.remove(); }, 400); }, 4200);
  }

  function progressStart() { loadingCount++; progress.classList.add('on'); }
  function progressStop() { loadingCount = Math.max(0, loadingCount - 1); if (!loadingCount) progress.classList.remove('on'); }

  /* ---------------- tabs ---------------- */

  function newTab(url, activate) {
    state.counter++;
    const tab = {
      id: 't' + state.counter + '_' + Math.random().toString(36).slice(2, 7),
      title: 'New Tab',
      url: null,
      history: [],
      hi: -1,
      status: 'new',
      via: null, ms: null, reader: false,
      view: null, iframe: null, ntpEl: null, error: null
    };
    state.tabs.push(tab);
    const view = document.createElement('div');
    view.className = 'view';
    view.dataset.tab = tab.id;
    tab.view = view;
    viewsEl.appendChild(view);
    showNTP(tab);
    renderTabStrip();
    if (activate !== false) activateTab(tab.id);
    return tab;
  }

  function closeTab(id) {
    const idx = state.tabs.findIndex(function (t) { return t.id === id; });
    if (idx === -1) return;
    const tab = state.tabs[idx];
    tab.view.remove();
    state.tabs.splice(idx, 1);
    if (!state.tabs.length) { newTab(null, true); return; }
    if (state.activeId === id) {
      const next = state.tabs[Math.min(idx, state.tabs.length - 1)];
      activateTab(next.id);
    }
    renderTabStrip();
    persistSession();
  }

  function activateTab(id) {
    state.activeId = id;
    state.tabs.forEach(function (t) { t.view.classList.toggle('active', t.id === id); });
    renderTabStrip();
    const tab = activeTab();
    updateChrome(tab);
    urlbar.blur();
  }

  function tabLabel(tab) { return tab.status === 'new' ? 'New Tab' : (tab.title || prettyUrl(tab.url) || '…'); }

  function renderTabStrip() {
    tabsEl.innerHTML = '';
    state.tabs.forEach(function (tab) {
      const el = document.createElement('div');
      el.className = 'tab' + (tab.id === state.activeId ? ' active' : '') + (tab.status === 'loading' ? ' loading' : '');
      el.dataset.id = tab.id;
      const fav = tab.url
        ? '<img class="fav" alt="" src="' + EHB.esc(faviconFor(tab.url)) + '" onerror="this.style.display=\'none\'">'
        : '<span class="fav-ph">' + ICONS.globe + '</span>';
      el.innerHTML =
        '<span class="spinner"></span>' +
        fav +
        '<span class="tab-title">' + EHB.esc(tabLabel(tab)) + '</span>' +
        '<button class="tab-close" title="Close tab">' + ICONS.close + '</button>';
      el.addEventListener('click', function (e) {
        if (e.target.closest('.tab-close')) { closeTab(tab.id); }
        else { activateTab(tab.id); }
      });
      tabsEl.appendChild(el);
    });
  }

  /* ---------------- views ---------------- */

  function showNTP(tab) {
    tab.url = null; tab.iframe = null; tab.status = 'new'; tab.via = null; tab.reader = false;
    tab.view.innerHTML = '';
    const ntp = document.createElement('div');
    ntp.className = 'ntp';
    const quick = QUICK_LINKS.map(function (q) {
      return '<a class="ql" data-url="' + EHB.esc(q.url) + '" href="' + EHB.esc(q.url) + '">' +
               '<span class="ql-name">' + EHB.esc(q.name) + '</span>' +
               '<span class="ql-tag">' + EHB.esc(q.tag) + '</span>' +
             '</a>';
    }).join('');
    const recentItems = recents.slice(0, 8).map(function (u) {
      return '<a class="recent" data-url="' + EHB.esc(u) + '" href="' + EHB.esc(u) + '">' + EHB.esc(prettyUrl(u)) + '</a>';
    }).join('');
    ntp.innerHTML =
      '<div class="ntp-inner">' +
        '<div class="ntp-logo"><span class="ntp-icon">' + ICONS.globe + '</span><h1>EduHungry <em>Browser</em></h1></div>' +
        '<p class="ntp-tag">Browse the web inside this page — tabs, history &amp; search included.</p>' +
        '<form class="ntp-search" id="ntp-search">' +
          '<input type="text" placeholder="Search the web or type a URL…" autocomplete="off" spellcheck="false">' +
          '<button type="submit">Go</button>' +
        '</form>' +
        '<div class="ql-grid">' + quick + '</div>' +
        (recentItems ? '<div class="ntp-recent"><h3>Recently visited</h3><div class="recent-row">' + recentItems + '</div></div>' : '') +
        '<p class="ntp-note">Proxy mode runs fully client-side. Article, docs, wiki and forum sites work best; logins, uploads and heavy JS apps (Google, YouTube, Instagram…) are limited. Engines fail over automatically, and Reader mode keeps text sites reachable.</p>' +
      '</div>';
    tab.view.appendChild(ntp);
    tab.ntpEl = ntp;
    const form = ntp.querySelector('#ntp-search');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      const v = form.querySelector('input').value;
      const url = normalizeInput(v);
      if (url) navigate(tab, url);
    });
    ntp.addEventListener('click', function (e) {
      const a = e.target.closest('[data-url]');
      if (a) { e.preventDefault(); navigate(tab, a.dataset.url); }
    });
    updateChrome(tab);
  }

  function mountIframe(tab) {
    if (tab.iframe && tab.iframe.tagName === 'IFRAME') return tab.iframe;
    tab.view.innerHTML = '';
    tab.ntpEl = null;
    const f = document.createElement('iframe');
    f.className = 'page';
    f.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads');
    f.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen');
    tab.view.appendChild(f);
    tab.iframe = f;
    return f;
  }

  const LOADING_HTML =
    '<!doctype html><html><head><meta charset="utf-8"><style>' +
    'body{margin:0;height:100vh;display:grid;place-items:center;background:#0d1117;color:#8b949e;font-family:system-ui,sans-serif}' +
    '.ring{width:44px;height:44px;border-radius:50%;border:3px solid #21262d;border-top-color:#58a6ff;animation:sp 1s linear infinite}' +
    '@keyframes sp{to{transform:rotate(360deg)}}' +
    '</style></head><body><div><div class="ring"></div><p style="text-align:center;margin-top:16px">Fetching through the proxy chain…</p></div></body></html>';

  function errorPageHtml(url, msg) {
    return '<!doctype html><html><head><meta charset="utf-8"><style>' +
      'body{margin:0;height:100vh;display:grid;place-items:center;background:#0d1117;color:#e6edf3;font-family:system-ui,sans-serif}' +
      '.card{max-width:520px;text-align:center;padding:36px;border:1px solid #30363d;border-radius:16px;background:#161b22}' +
      'h1{font-size:20px;margin:0 0 8px}code{color:#8b949e;font-size:13px;word-break:break-all}' +
      'p{color:#8b949e;font-size:14px;line-height:1.6}' +
      'button{margin-top:14px;padding:10px 22px;border-radius:10px;border:0;background:#1f6feb;color:#fff;font-weight:600;font-size:14px;cursor:pointer}' +
      'button:hover{background:#388bfd}' +
      '</style></head><body><div class="card">' +
      '<h1>😕 Can\u2019t reach this page</h1>' +
      '<p><code>' + EHB.esc(url) + '</code></p>' +
      '<p>' + EHB.esc(msg) + '</p>' +
      '<p>All proxy engines failed. Public proxies rate-limit aggressively — wait a few seconds, then retry. You can also pin a different engine in Settings.</p>' +
      '<button id="ehb-retry" type="button">Retry</button>' +
      '</div></body></html>';
  }

  function readerPageHtml(tab, markdown) {
    return '<!doctype html><html><head><meta charset="utf-8"><style>' +
      'body{margin:0;background:#0d1117;color:#e6edf3;font:16px/1.7 Georgia,serif}' +
      'main{max-width:760px;margin:0 auto;padding:40px 24px}' +
      '.badge{position:fixed;top:12px;right:14px;background:#30363d;color:#8b949e;font:600 12px system-ui,sans-serif;padding:6px 12px;border-radius:999px}' +
      'h1,h2,h3,h4,h5{font-family:system-ui,sans-serif;line-height:1.3}' +
      'a{color:#58a6ff}ul{padding-left:22px}pre.code{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:10px 14px;font:13px ui-monospace,monospace;overflow:auto}' +
      '</style></head><body><span class="badge">Reader Mode</span><main>' +
      EHB.renderReaderMarkdown(markdown) +
      '</main></body></html>';
  }

  /* ---------------- navigation ---------------- */

  async function navigate(tab, rawUrl, opts) {
    opts = opts || {};
    const push = opts.push !== false;
    let url;
    if (rawUrl === '__reload__') url = tab.url;
    else { url = normalizeInput(rawUrl); if (!url) { toast('Unsupported address'); return; } }
    if (!url) return;

    tab.status = 'loading'; tab.error = null; tab.reader = false; tab.statusText = '';
    renderTabStrip(); updateChrome(tab); progressStart();
    const f = mountIframe(tab);
    f.srcdoc = LOADING_HTML;

    const t0 = performance.now();
    try {
      const page = await EHB.fetchPage(url, {
        onAttempt: function (label, idx, total) {
          if (tab.id === state.activeId) {
            tab.statusText = 'trying ' + label + ' (' + idx + '/' + total + ')…';
            engineEl.textContent = tab.statusText;
            engineEl.className = '';
          }
        }
      });
      if (page.reader) {
        tab.reader = true;
        f.srcdoc = readerPageHtml(tab, page.text);
      } else {
        const html = await EHB.rewriteHTML(page.text, url, page.res, tab.id);
        f.srcdoc = html;
      }
      tab.url = url;
      tab.via = page.via.label;
      tab.ms = page.ms || Math.round(performance.now() - t0);
      tab.status = 'ok';
      tab.statusText = '';
      tab.title = tab.reader ? 'Reader — ' + hostOf(url) : (hostOf(url) || 'Page');
      if (push) {
        tab.history = tab.history.slice(0, tab.hi + 1);
        tab.history.push(url);
        tab.hi = tab.history.length - 1;
      }
      pushRecent(url);
    } catch (err) {
      tab.status = 'error';
      tab.error = (err && err.message) || String(err);
      tab.statusText = 'all engines failed';
      tab.title = hostOf(url) || 'Failed';
      f.srcdoc = errorPageHtml(url, tab.error);
      if (push && tab.history[tab.hi] !== url) {
        tab.history = tab.history.slice(0, tab.hi + 1);
        tab.history.push(url);
        tab.hi = tab.history.length - 1;
      }
    }
    progressStop();
    renderTabStrip();
    if (tab.id === state.activeId) updateChrome(tab);
    persistSession();
  }

  function pushRecent(url) {
    const i = recents.indexOf(url);
    if (i !== -1) recents.splice(i, 1);
    recents.unshift(url);
    if (recents.length > 30) recents.length = 30;
    save(LS_RECENTS, recents);
  }

  function goBack(tab) { if (tab && tab.hi > 0) { tab.hi--; navigate(tab, tab.history[tab.hi], { push: false }); } }
  function goFwd(tab) { if (tab && tab.hi < tab.history.length - 1) { tab.hi++; navigate(tab, tab.history[tab.hi], { push: false }); } }
  function reload(tab) { if (tab && tab.url) navigate(tab, '__reload__', { push: false }); }

  /* ---------------- chrome updates ---------------- */

  function updateChrome(tab) {
    if (!tab) { urlbar.value = ''; return; }
    if (document.activeElement !== urlbar) {
      urlbar.value = tab.status === 'new' ? '' : (tab.url || '');
      urlbar.placeholder = 'Search ' + ((SEARCH_ENGINES[settings.search] || SEARCH_ENGINES.ddg).name) + ' or type a URL';
    }
    $('#btn-back').disabled = !(tab.hi > 0);
    $('#btn-fwd').disabled = !(tab.hi < tab.history.length - 1);
    $('#btn-reload').disabled = tab.status === 'new';
    const healthTxt = tab.via
      ? 'via ' + tab.via + (tab.reader ? ' · reader' : '') + ' · ' + (tab.ms ? (tab.ms >= 1000 ? (tab.ms / 1000).toFixed(1) + 's' : tab.ms + 'ms') : '')
      : (tab.statusText || (tab.status === 'loading' ? 'connecting…' : ''));
    engineEl.textContent = healthTxt;
    engineEl.className = tab.status === 'error' ? 'bad' : '';
  }

  /* ---------------- session persistence ---------------- */

  function persistSession() {
    const data = {
      active: state.activeId,
      tabs: state.tabs.map(function (t) {
        return { url: t.url, history: t.history.slice(-25), hi: t.hi, title: t.title };
      })
    };
    save(LS_SESSION, data);
  }

  function restoreSession() {
    const s = load(LS_SESSION);
    if (s && s.tabs && s.tabs.length) {
      let restored = 0;
      s.tabs.forEach(function (d) {
        if (!d.url) return;
        const tab = newTab(null, false);
        tab.history = d.history || [d.url];
        tab.hi = Math.min(d.hi >= 0 ? d.hi : tab.history.length - 1, tab.history.length - 1);
        tab.title = d.title || prettyUrl(d.url);
        restored++;
        navigate(tab, d.url, { push: false });
      });
      if (restored) {
        activateTab(state.tabs[0].id);
        return;
      }
    }
    newTab(null, true);
  }

  /* ---------------- toolbar wiring ---------------- */

  $('#btn-back').addEventListener('click', function () { goBack(activeTab()); });
  $('#btn-fwd').addEventListener('click', function () { goFwd(activeTab()); });
  $('#btn-reload').addEventListener('click', function () { reload(activeTab()); });
  $('#btn-home').addEventListener('click', function () { const t = activeTab(); if (t) showNTP(t); renderTabStrip(); persistSession(); });
  $('#newtab').addEventListener('click', function () { newTab(null, true); persistSession(); });

  urlbar.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      const tab = activeTab();
      if (tab) { navigate(tab, urlbar.value); urlbar.blur(); }
    } else if (e.key === 'Escape') {
      urlbar.blur();
      updateChrome(activeTab());
    }
  });
  urlbar.addEventListener('focus', function () { urlbar.select(); });

  document.addEventListener('keydown', function (e) {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 't') { e.preventDefault(); newTab(null, true); }
    else if (mod && e.key.toLowerCase() === 'w') { e.preventDefault(); if (state.activeId) closeTab(state.activeId); }
    else if (mod && e.key.toLowerCase() === 'l') { e.preventDefault(); urlbar.focus(); }
    else if (mod && e.key.toLowerCase() === 'r') { e.preventDefault(); reload(activeTab()); }
    else if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); goBack(activeTab()); }
    else if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); goFwd(activeTab()); }
  });

  /* ---------------- messages from pages ---------------- */

  window.addEventListener('message', function (ev) {
    const d = ev.data;
    if (!d || d.__ehb !== 1) return;
    const tab = state.tabs.find(function (t) { return t.id === d.__tab; });
    if (!tab) return;
    switch (d.type) {
      case 'navigate':
        if (d.newTab) { const nt = newTab(null, true); navigate(nt, d.url); persistSession(); }
        else navigate(tab, d.url);
        break;
      case 'title':
        if (d.title) { tab.title = String(d.title).slice(0, 80); renderTabStrip(); }
        break;
      case 'hover':
        hoverEl.textContent = d.url || '';
        break;
      case 'notify':
        toast(d.text || 'Notice');
        break;
      case 'retry':
        navigate(tab, '__reload__', { push: false });
        break;
    }
  });

  /* ---------------- settings modal ---------------- */

  const backdrop = $('#modal-backdrop');

  function openSettings() {
    const engines = [{ id: 'auto', label: 'Auto (recommended)' }].concat(EHB.PROXIES.map(function (p) { return { id: p.id, label: p.label }; }));
    $('#set-engine').innerHTML = engines.map(function (e) {
      return '<option value="' + e.id + '"' + (settings.preferred === e.id ? ' selected' : '') + '>' + EHB.esc(e.label) + '</option>';
    }).join('');
    $('#set-search').innerHTML = Object.keys(SEARCH_ENGINES).map(function (k) {
      return '<option value="' + k + '"' + (settings.search === k ? ' selected' : '') + '>' + EHB.esc(SEARCH_ENGINES[k].name) + '</option>';
    }).join('');
    const rep = EHB.healthReport().map(function (h) {
      return '<li><b>' + EHB.esc(h.label) + '</b> — ' + (h.ok ? h.ok + ' ok' : 'unused') +
        (h.fails ? ', ' + h.fails + ' fails' : '') +
        (h.avgMs != null ? ', avg ' + h.avgMs + 'ms' : '') +
        (h.cooling ? ' · <span class="cooling">cooling down</span>' : '') + '</li>';
    }).join('');
    $('#engine-report').innerHTML = '<ul>' + rep + '</ul>';
    backdrop.hidden = false;
  }
  function closeSettings() { backdrop.hidden = true; }

  $('#btn-settings').addEventListener('click', openSettings);
  $('#modal-close').addEventListener('click', closeSettings);
  backdrop.addEventListener('click', function (e) { if (e.target === backdrop) closeSettings(); });

  $('#set-engine').addEventListener('change', function (e) {
    settings.preferred = e.target.value;
    save(LS_SETTINGS, settings);
    EHB.configure(settings);
    toast('Engine set to ' + e.target.selectedOptions[0].textContent);
  });
  $('#set-search').addEventListener('change', function (e) {
    settings.search = e.target.value;
    save(LS_SETTINGS, settings);
    updateChrome(activeTab());
  });
  $('#set-clear').addEventListener('click', function () {
    try { localStorage.removeItem(LS_SESSION); localStorage.removeItem(LS_RECENTS); } catch (_) {}
    recents.length = 0;
    toast('Saved tabs and history cleared');
    closeSettings();
  });

  /* ---------------- boot ---------------- */

  $('#btn-back').innerHTML = ICONS.back;
  $('#btn-fwd').innerHTML = ICONS.fwd;
  $('#btn-reload').innerHTML = ICONS.reload;
  $('#btn-home').innerHTML = ICONS.home;
  $('#btn-settings').innerHTML = ICONS.gear;
  $('#newtab').innerHTML = ICONS.plus;

  EHB.configure(settings);
  restoreSession();
  renderTabStrip();

})();
