# EduHungry Browser

A full tabbed **web browser inside a web page** — open `browser/` on the site and you get
tabs, an address bar, back/forward history, search, bookmarks-style quick links, session
restore, and per-tab favicons. Everything runs client-side; no server of your own is needed.

## How it works

```
 you type a URL
      │
      ▼
 proxy engine (engine.js)          failover chain, health-ranked:
   1. AllOrigins (raw)                public CORS fetch services
   2. AllOrigins (json)
   3. CodeTabs
   4. cors.lol
   5. cors.eu.org
   6. CF Workers demo
      │  all fail? ▼
 reader mode (r.jina.ai)           clean text fallback
      │  fails? ▼
 error page with one-click Retry
      │
      ▼
 HTML rewriter (engine.js)
   · resolves + rewrites every img/script/link/srcset/style url() to the proxy
   · inlines + rewrites external stylesheets (fonts, backgrounds keep working)
   · strips CSP metas, integrity hashes, meta-refresh, preload hints
   · injects <base> + a navigation hook
      │
      ▼
 sandboxed iframe (app.js)
   · clicks / form GETs / window.open are intercepted and re-proxied
   · target=_blank, Ctrl+click, middle-click open a new tab in the shell
```

## What works well

Wikipedia, DuckDuckGo (HTML), Hacker News, BBC, MDN, Project Gutenberg, old.reddit,
Stack Overflow, docs sites, blogs — anything mostly server-rendered.

## Known limits (honest ones)

- **Logins / POST forms** don't work — there's no server to hold sessions/cookies.
- **Heavy JS apps** (Google, YouTube, Instagram, Discord…) degrade or break — their
  runtime expects a real origin and their APIs block proxies.
- **JS-added resources** resolve against the real site (`<base>`), so on locked-down
  networks they may not load even though proxied content does.
- Public CORS proxies **rate-limit**; the engine cools them down and fails over, and
  Reader mode keeps text reachable when they all sulk.

## Upgrading to full-site compatibility later

Static hosting can't run the server-side fetcher that "works with every website"
(Ultraviolet, Scramjet, Rammerhead all need one). If you ever want 100% coverage,
deploy a small Node backend (e.g. Ultraviolet + wisp on Railway/Render/a VPS), then
swap `engine.js` for the UV client — the tab UI in `app.js` stays as-is.

*Please use respectfully and in line with your network's policies.*
