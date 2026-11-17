/*
 * Streckenblitz: Service Worker. Hält das Spiel für den Start ohne Netz bereit (Muster Kugelblitz).
 *
 * Streckenblitz fragt nie fremde Server an; der Worker legt nur die eigenen Dateien in den Cache und liefert sie von dort
 * (Cache-first). Neue Fassungen kommen über die Versionsnummer unten: Steigt sie, lädt der neue Worker alle Dateien
 * frisch aus dem Netz und räumt danach nur die eigenen alten Caches weg.
 *
 * Unter file:// (Doppelklick auf index.html) meldet sich kein Worker an, das Spiel läuft trotzdem.
 * Auf 127.0.0.1 und localhost (Vorschau beim Bauen) fragt der Worker zuerst das Netz: Sonst sähe man nach jeder
 * Änderung die alte Fassung aus dem Cache. Ohne Server greift auch dort der Cache.
 */
"use strict";

// Bei jeder Änderung an einer der Dateien unten um 1 erhöhen
const CACHE = "streckenblitz-v1";

// Genau die Dateien, die index.html und das Manifest laden. Eine Datei, die es nicht gibt, ließe die ganze
// Installation scheitern.
const DATEIEN = [
  "./",
  "./index.html",
  "./sprachen.js",
  "./strecke.js",
  "./physik.js",
  "./rennen.js",
  "./deko.js",
  "./grafik.js",
  "./ton.js",
  "./manifest.webmanifest",
  "./favicon.svg",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./schrift/fraunces-latin-wght-normal.woff2",
];

const ENTWICKLUNG = ["localhost", "127.0.0.1", "[::1]"].includes(self.location.hostname);

// Am HTTP-Cache des Browsers vorbei laden, sonst landete womöglich eine ältere Fassung im neuen Cache
function fuellen(cache) {
  return cache.addAll(DATEIEN.map((u) => new Request(u, { cache: "reload" })));
}

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then(fuellen).then(() => self.skipWaiting()));
});

// Nur eigene alte Caches löschen. Der Cache-Speicher gehört dem ganzen Origin; liegt Streckenblitz neben anderen
// Werkzeugen (etwa auf dennismit2n.github.io), gehören deren Caches ihnen.
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((namen) => Promise.all(namen.filter((n) => n.startsWith("streckenblitz-") && n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

async function antwort(e) {
  const anfrage = e.request;
  const seite = anfrage.mode === "navigate";
  const cache = await caches.open(CACHE);
  // Seitenaufrufe ohne Abfrage suchen: index.html?strecke=mondsenke ist dieselbe Datei
  const ausCache = () => cache.match(anfrage, { ignoreSearch: seite }).then((r) => r || (seite ? cache.match("./index.html") : undefined));
  const ausNetz = async () => {
    const r = await fetch(anfrage);
    if (r.ok && r.type === "basic") {
      let schluessel = anfrage;
      if (seite) { const u = new URL(anfrage.url); u.search = ""; schluessel = u.href; }
      e.waitUntil(cache.put(schluessel, r.clone()).catch(() => {}));
    }
    return r;
  };

  if (ENTWICKLUNG) {
    try { return await ausNetz(); } catch (fehler) {
      const r = await ausCache();
      if (r) return r;
      throw fehler;
    }
  }
  const treffer = await ausCache();
  if (treffer) return treffer;
  return ausNetz();
}

self.addEventListener("fetch", (e) => {
  const anfrage = e.request;
  if (anfrage.method !== "GET") return;
  const url = new URL(anfrage.url);
  if (url.origin !== self.location.origin) return;
  // Nur Anfragen unterhalb des eigenen Ordners; Nachbarn auf demselben Origin haben eigene Worker
  if (!url.pathname.startsWith(new URL("./", self.location).pathname)) return;
  e.respondWith(antwort(e));
});
