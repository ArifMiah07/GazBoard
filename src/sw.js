// Root-level service-worker entry point.
//
// GitHub Pages (and any plain static host with no rewrite rules) resolves
// ./sw.js from index.html to this file. The real worker is src/web/sw.js;
// importScripts keeps a single source of truth while the service worker still
// reports its scope from this root URL.
importScripts('./web/sw.js');