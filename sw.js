// Service worker du site des cellulaires (GitHub Pages), sans dépendance.
// La compilation remplace les deux marques de VERSION et FICHIERS ci-dessous
// (chacune n'apparaît qu'une fois) : la version, et le tableau JSON des fichiers
// de l'application, relatifs à ce fichier : ["./", "index.html", "app.js", …].
//
// - Application (navigation et fichiers de la liste) : d'abord le cache de CETTE
//   version. Une nouvelle version (sw.js changé) remplit son propre cache, prend
//   la main, efface l'ancien et le dit aux pages : { type: 'mad-nouvelle-version' }.
// - Données chiffrées (*.enc) et version.json : d'abord le réseau (revalidé), la
//   dernière copie sinon : la carte reste lisible hors ligne. Un .enc nommé par
//   son empreinte (« …-<12 à 64 hex>.enc ») ne change jamais : cache d'abord.
// - Les autres sites (tuiles Esri et OpenTopoMap, api.github.com, ntfy.sh) ne sont
//   PAS interceptés : rien n'en est gardé ici (licence des tuiles Esri).
// Messages reçus : { type: 'mad-version' } → répond la version ;
// { type: 'mad-garder', urls: [...] } → oublie les autres données gardées.

const VERSION = 'mad-9cd5025520baec19';
const FICHIERS = ["./","index.html","app.css","apple-touch-icon.png","chargeur.js","fonts/OFL-Barlow.txt","fonts/barlow-condensed-latin-600-normal.woff2","fonts/barlow-condensed-latin-700-normal.woff2","fonts/barlow-condensed-latin-800-normal.woff2","fonts/barlow-latin-400-normal.woff2","fonts/barlow-latin-500-normal.woff2","fonts/barlow-latin-600-normal.woff2","icon-192.png","icon-512.png","icon-masque-512.png","icon.svg","manifest.webmanifest","maplibre-gl.css"];
const DONNEES = 'mad-donnees'; // gardé d'une version à l'autre
const DELAI_RESEAU = 6000; // réseau faible : la copie répond après 6 s, le réseau finit en arrière-plan
const IMMUABLE = /(^|[/_.-])[0-9a-f]{12,64}\.enc$/i;

const ICI = new URL('./', self.location).href; // dossier de l'application (portée)
const COQUILLE = new Set(FICHIERS.map((f) => new URL(f, ICI).href));
const INDEX = new URL('index.html', ICI).href;
let miseAJour = false; // une autre version était active à l'installation
let derniereVerif = 0;

self.addEventListener('install', (event) => {
  miseAJour = !!self.registration.active;
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // cache: 'reload' : pas de vieille copie du cache HTTP (GitHub Pages : max-age=600)
    await cache.addAll([...COQUILLE].map((u) => new Request(u, { cache: 'reload' })));
    await self.skipWaiting(); // un seul paquet (app.js) : la nouvelle version prend la main tout de suite
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const vieux = (await caches.keys()).filter((n) => n.startsWith('mad-') && n !== VERSION && n !== DONNEES);
    await Promise.all(vieux.map((n) => caches.delete(n)));
    await self.clients.claim();
    if (miseAJour || vieux.length) await annoncer({ type: 'mad-nouvelle-version', version: VERSION });
  })());
});

self.addEventListener('message', (event) => {
  const m = event.data || {};
  if (m.type === 'mad-version' && event.source) event.source.postMessage({ type: 'mad-version', version: VERSION });
  if (m.type === 'mad-garder' && Array.isArray(m.urls)) event.waitUntil(garder(m.urls));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // envois : jamais touchés
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(ICI)) return; // autre site : passe tel quel
  const cle = url.origin + url.pathname; // sans « ?… » : une copie par fichier
  if (url.pathname.endsWith('.enc') || url.pathname.endsWith('/version.json')) {
    event.respondWith(IMMUABLE.test(url.pathname) ? cacheDabord(req, DONNEES, cle) : reseauDabord(event, cle));
  } else if (req.mode === 'navigate') {
    event.respondWith(page(req));
    event.waitUntil(verifierVersion());
  } else if (COQUILLE.has(cle)) {
    event.respondWith(cacheDabord(req, VERSION, cle));
  }
  // le reste du site : réseau normal, rien de gardé
});

// navigation : la page gardée de cette version (application d'une seule page)
async function page(req) {
  const cache = await caches.open(VERSION);
  const copie = (await cache.match(req, { ignoreSearch: true })) || (await cache.match(INDEX)) || (await cache.match(ICI));
  if (copie) return copie.redirected ? new Response(copie.body, { status: copie.status, headers: copie.headers }) : copie;
  try {
    return await fetch(req);
  } catch {
    return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Hors ligne</title>'
      + '<p style="font:16px system-ui;padding:2em">La Mine à Doum n\'est pas encore gardée sur ce cellulaire : ouvrez-la une fois avec du réseau.</p>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

// en arrière-plan, au plus toutes les 10 min : y a-t-il un nouveau sw.js (nouvelle version) ?
function verifierVersion() {
  if (Date.now() - derniereVerif < 600000) return Promise.resolve();
  derniereVerif = Date.now();
  return self.registration.update().catch(() => {});
}

async function cacheDabord(req, nom, cle) {
  const cache = await caches.open(nom);
  const copie = await cache.match(cle);
  if (copie) return copie;
  const rep = await fetch(req);
  if (rep.ok) await cache.put(cle, rep.clone()).catch(() => {});
  return rep;
}

// réseau d'abord (revalidé : « no-cache »), copie gardée si hors ligne, en erreur ou trop lent
function reseauDabord(event, cle) {
  const reseau = fetch(event.request.url, { cache: 'no-cache' }).then(async (rep) => {
    if (rep.ok) await (await caches.open(DONNEES)).put(cle, rep.clone()).catch(() => {});
    return rep;
  });
  event.waitUntil(reseau.catch(() => {})); // le réseau finit même si la copie a déjà répondu
  return (async () => {
    const copie = await (await caches.open(DONNEES)).match(cle);
    if (!copie) return reseau.catch(() => Response.error());
    const frais = reseau.then((rep) => (rep.ok || rep.status === 404 ? rep : copie), () => copie);
    return Promise.race([frais, new Promise((ok) => setTimeout(ok, DELAI_RESEAU, copie))]);
  })();
}

async function garder(urls) {
  const gardes = new Set(urls.map((u) => { const x = new URL(u, ICI); return x.origin + x.pathname; }));
  const cache = await caches.open(DONNEES);
  for (const req of await cache.keys()) if (!gardes.has(req.url)) await cache.delete(req);
}

async function annoncer(message) {
  const pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const c of pages) if (c.url.startsWith(ICI)) c.postMessage(message);
}
