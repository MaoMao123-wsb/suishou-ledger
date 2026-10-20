const CACHE = 'suishou-shell-v4';
const FILES = ['./','./index.html','./styles.css','./app.js','./ledger.js','./parser.js','./storage.js','./icon.svg','./icon-180.png','./icon-192.png','./icon-512.png','./manifest.webmanifest'];
self.addEventListener('install', event => {event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)));});
self.addEventListener('activate', event => {event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('suishou-shell-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));});
self.addEventListener('message',event=>{if(event.data === 'ACTIVATE_UPDATE')self.skipWaiting();});
self.addEventListener('fetch',event=>{
  const url = new URL(event.request.url);
  if(event.request.method !== 'GET' || url.origin !== self.location.origin)return;
  const allowed = FILES.map(p=>new URL(p,self.registration.scope).pathname);
  if(!allowed.includes(url.pathname))return;
  // Stale-while-revalidate: cached shell opens instantly on a weak mobile network,
  // while a fresh copy is fetched in the background for the next visit.
  event.respondWith((async()=>{
    const cached = await caches.match(event.request);
    const network = fetch(event.request).then(response=>{
      // Cache only our own successful shell, never an authentication redirect.
      if(response.ok && !response.redirected && response.type !== 'opaque') {
        const copy=response.clone();
        event.waitUntil(caches.open(CACHE).then(c=>c.put(event.request,copy)));
      }
      return response;
    }).catch(()=>cached || Response.error());
    return cached || network;
  })());
});
