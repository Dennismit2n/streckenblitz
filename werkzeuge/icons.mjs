// Rendert die App-Icons von Streckenblitz aus den SVG-Vorlagen über Edge headless (Muster Kugelblitz, wie foto.mjs).
//   node werkzeuge/icons.mjs [vorschau.png]
// Liest icons/icon.svg, icons/icon-maskable.svg und favicon.svg und schreibt:
//   icons/icon-192.png, icons/icon-512.png (Zweck „any“, durchsichtige Ecken)
//   icons/icon-maskable-512.png (Zweck „maskable“, randlos)
//   icons/apple-touch-icon.png (180 px, randlos; iOS rundet selbst ab und kennt keine Durchsicht)
// Mit Pfad dazu ein Vorschaubild aller Größen auf dunklem und auf einem runden Masken-Ausschnitt.
// Edge ruft dabei nichts aus dem Netz ab: Die Seite ist eine data:-Adresse, die Bilder sind eingebettet.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9339;
const hier = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"));
const wurzel = path.join(hier, "..");
const vorschau = process.argv[2] || "";
const profil = path.join(os.tmpdir(), "streckenblitz-edge-icons");
fs.rmSync(profil, { recursive: true, force: true });
const warte = (ms) => new Promise((r) => setTimeout(r, ms));

const edge = spawn(EDGE, ["--headless=new", "--remote-debugging-port=" + PORT, "--user-data-dir=" + profil,
  "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--force-color-profile=srgb",
  "--window-size=800,800", "about:blank"], { stdio: "ignore" });

let ws;
let nr = 0;
const offen = new Map();
async function verbinden() {
  for (let i = 0; i < 60; i++) {
    try {
      const liste = await (await fetch("http://127.0.0.1:" + PORT + "/json/list")).json();
      const seite = liste.find((t) => t.type === "page");
      if (seite) {
        ws = new WebSocket(seite.webSocketDebuggerUrl);
        await new Promise((r, f) => { ws.onopen = r; ws.onerror = f; });
        ws.onmessage = (m) => {
          const d = JSON.parse(m.data);
          if (d.id && offen.has(d.id)) { offen.get(d.id)(d); offen.delete(d.id); }
        };
        return;
      }
    } catch { /* noch nicht da */ }
    await warte(250);
  }
  throw new Error("Edge antwortet nicht");
}
const cdp = (method, params = {}) => new Promise((res, rej) => {
  const i = ++nr;
  offen.set(i, (d) => (d.error ? rej(new Error(method + ": " + d.error.message)) : res(d.result)));
  ws.send(JSON.stringify({ id: i, method, params }));
});
async function js(code) {
  const r = await cdp("Runtime.evaluate", { expression: code, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}
const svgUrl = (datei) => "data:image/svg+xml;base64," + fs.readFileSync(path.join(wurzel, datei)).toString("base64");

// Ein Bild in Größe n×n zeichnen und als PNG abfotografieren (durchsichtiger Grund)
async function render(datei, n, ziel) {
  await js(`new Promise((fertig) => {
    document.body.innerHTML = "";
    const img = new Image();
    img.onload = () => requestAnimationFrame(() => requestAnimationFrame(fertig));
    img.style.cssText = "position:absolute;left:0;top:0;width:${n}px;height:${n}px";
    img.src = ${JSON.stringify(svgUrl(datei))};
    document.body.appendChild(img);
  })`);
  const r = await cdp("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: n, height: n, scale: 1 }, captureBeyondViewport: false });
  fs.writeFileSync(path.join(wurzel, ziel), Buffer.from(r.data, "base64"));
  console.log("geschrieben", ziel, n + "×" + n);
}

try {
  await verbinden();
  await cdp("Page.enable");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 800, height: 800, deviceScaleFactor: 1, mobile: false });
  await cdp("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
  await cdp("Page.navigate", { url: "data:text/html,<!doctype html><html><body style='margin:0;background:transparent'></body></html>" });
  await warte(500);
  fs.mkdirSync(path.join(wurzel, "icons"), { recursive: true });
  await render("icons/icon.svg", 192, "icons/icon-192.png");
  await render("icons/icon.svg", 512, "icons/icon-512.png");
  await render("icons/icon-maskable.svg", 512, "icons/icon-maskable-512.png");
  await render("icons/icon-maskable.svg", 180, "icons/apple-touch-icon.png");
  if (vorschau) {
    // Vorschau: alle Größen nebeneinander auf dem Grund der Seite, dazu die Maske als Kreis und als iOS-Rundung
    const bilder = { any: svgUrl("icons/icon.svg"), mask: svgUrl("icons/icon-maskable.svg"), fav: svgUrl("favicon.svg") };
    await cdp("Emulation.setDefaultBackgroundColorOverride", { color: { r: 10, g: 13, b: 21, a: 1 } });
    await js(`new Promise((fertig) => {
      const b = ${JSON.stringify(bilder)};
      document.body.style.cssText = "margin:0;background:#0A0D15;font:12px system-ui;color:#A3AABD";
      document.body.innerHTML = '<div style="display:flex;gap:18px;align-items:flex-end;padding:18px;flex-wrap:wrap;width:760px">' +
        [[b.any, 192, ""], [b.any, 96, ""], [b.any, 48, ""], [b.fav, 32, ""], [b.fav, 16, ""],
         [b.mask, 192, "border-radius:50%"], [b.mask, 180, "border-radius:22%"], [b.mask, 96, "border-radius:28%"]]
        .map(([s, n, st]) => '<figure style="margin:0;text-align:center"><img src="' + s + '" width="' + n + '" height="' + n + '" style="display:block;' + st + '"><figcaption>' + n + '</figcaption></figure>').join("") + '</div>';
      Promise.all([...document.images].map((i) => i.decode().catch(() => {}))).then(() => requestAnimationFrame(() => fertig()));
    })`);
    const r = await cdp("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 800, height: 520, scale: 1 } });
    fs.writeFileSync(vorschau, Buffer.from(r.data, "base64"));
    console.log("Vorschau", vorschau);
  }
} catch (e) {
  console.error("Fehler:", e.message);
  process.exitCode = 1;
} finally {
  try { await cdp("Browser.close"); } catch { /* schon zu */ }
  await warte(500);
  try { edge.kill(); } catch { /* egal */ }
}
