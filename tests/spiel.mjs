// Prüfungen im echten Browser: Edge headless über das DevTools-Protokoll (Muster werkzeuge/foto.mjs).
//
//   node tests/spiel.mjs [fotoordner]
//
// Braucht die Vorschau auf Port 8644 (oder BASIS=… auf eine andere Adresse, auch file://).
// Startet genau ein Edge mit eigenem Profil im Temp-Ordner und beendet es am Ende sicher.
// Geprüft wird: Seite lädt ohne Konsolenfehler, Menü mit Tasten bedienbar, Startampel ohne Blinken,
// Gegner im Bild, ?bot=1 fährt ein ganzes Rennen bis zum Ergebnis (Zeitraffer), Ergebnistabelle vollständig,
// Zeitfahren speichert die Bestzeit, Pause hält die Zeit an.
// Fotos (Startampel, Pulk, Ergebnis, Menü, Pause, Zeitfahren) landen im Fotoordner (Vorgabe fotos/spiel).
// Ausgabe endet mit „SPIEL: BESTANDEN“ und Exit 0, sonst „SPIEL: DURCHGEFALLEN“ und Exit 1.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9338;
const BASIS = process.env.BASIS || "http://127.0.0.1:8644/index.html";
const ziel = process.argv[2] || "fotos/spiel";
fs.mkdirSync(ziel, { recursive: true });
const profil = path.join(os.tmpdir(), "streckenblitz-edge-spiel");
fs.rmSync(profil, { recursive: true, force: true });

const fehler = [];
let gesamt = 0;
function pruefe(bedingung, text) {
  gesamt++;
  console.log((bedingung ? "  ok    " : "  FEHLER ") + text);
  if (!bedingung) fehler.push(text);
}

const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const edge = spawn(EDGE, ["--headless=new", "--remote-debugging-port=" + PORT, "--user-data-dir=" + profil,
  "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--force-color-profile=srgb",
  "--window-size=1440,900", "about:blank"], { stdio: "ignore" });

let ws;
let nr = 0;
const offen = new Map();
const meldungen = [];
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
          if (d.method === "Runtime.consoleAPICalled" && (d.params.type === "error" || d.params.type === "warning")) {
            meldungen.push(d.params.type + ": " + d.params.args.map((a) => a.value ?? a.description).join(" "));
          }
          if (d.method === "Runtime.exceptionThrown") meldungen.push("Ausnahme: " + JSON.stringify(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
          if (d.method === "Log.entryAdded" && (d.params.entry.level === "error" || d.params.entry.level === "warning")) meldungen.push("log " + d.params.entry.level + ": " + d.params.entry.text + " " + (d.params.entry.url || ""));
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
async function laden(suche) {
  await cdp("Page.navigate", { url: BASIS + suche });
  await warte(1200);
}
async function foto(datei) {
  const r = await cdp("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(ziel, datei), Buffer.from(r.data, "base64"));
  console.log("  Foto  " + path.join(ziel, datei));
}
// wartet, bis ein Ausdruck im Spiel wahr ist (höchstens ms)
async function bis(ausdruck, ms) {
  const ende = Date.now() + ms;
  while (Date.now() < ende) {
    if (await js(ausdruck)) return true;
    await warte(60);
  }
  return false;
}
const VK = { Escape: 27, KeyP: 80, KeyZ: 90, KeyR: 82, Enter: 13, Digit5: 53 };
async function taste(code) {
  const key = code === "Escape" ? "Escape" : code === "Enter" ? "Enter" : code.replace(/^Key|^Digit/, "").toLowerCase();
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", code, key, windowsVirtualKeyCode: VK[code] });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", code, key, windowsVirtualKeyCode: VK[code] });
  await warte(120);
}
const SB = "window.streckenblitz";

try {
  await verbinden();
  await cdp("Page.enable");
  await cdp("Runtime.enable");
  await cdp("Log.enable");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  console.log("Menü");
  await laden("");
  pruefe(await js(`${SB}.zustand === "menue" && !document.getElementById("menue").hidden`), "ohne Parameter erscheint das Menü");
  await foto("menue-1440.png");
  await taste("KeyZ");
  await taste("Digit5");
  pruefe(await js(`document.querySelector('[data-modus="zeitfahren"]').getAttribute("aria-pressed") === "true" && document.querySelector('[data-runden="5"]').getAttribute("aria-pressed") === "true"`), "Taste Z wählt Zeitfahren, Taste 5 fünf Runden");
  await taste("KeyR");
  await js(`document.activeElement.blur()`);
  await taste("Enter");
  pruefe(await js(`${SB}.zustand === "fahrt" && ${SB}.rennen.modus === "rennen" && ${SB}.rennen.runden === 5 && ${SB}.rennen.autos.length === 8`), "Taste R und Enter starten ein Rennen über 5 Runden mit 8 Autos");

  console.log("Startampel");
  await laden("?bot=1&samen=3");
  // Lichter im Takt der Seite mitschreiben: Zahl der leuchtenden Lampen im DOM und Stand des Rennens
  const ampel = await js(`(async () => {
    const folge = []; const t0 = performance.now();
    while (performance.now() - t0 < 9000) {
      const an = document.querySelectorAll("#ampel i.an").length;
      const r = ${SB}.rennen;
      if (!folge.length || folge[folge.length - 1].an !== an || folge[folge.length - 1].phase !== r.phase) folge.push({ an, phase: r.phase, t: +(r.zeit.toFixed(2)), bewegt: r.autos.some((a) => a.tempo > 0) });
      if (r.phase === "rennen" && r.zeit > 8) break;
      await new Promise((ok) => requestAnimationFrame(ok));
    }
    return folge; })()`);
  console.log("  Folge: " + ampel.map((f) => f.an + "@" + f.t + (f.phase === "rennen" ? "R" : "")).join(" "));
  const anFolge = ampel.map((f) => f.an);
  const steigt = anFolge.slice(0, anFolge.indexOf(5) + 1).every((n, i, l) => i === 0 || n === l[i - 1] + 1);
  pruefe(steigt && anFolge.indexOf(5) >= 0, "Lichter gehen einzeln nacheinander an bis 5");
  pruefe(anFolge.slice(anFolge.indexOf(5) + 1).every((n) => n === 0) && anFolge.at(-1) === 0, "danach gehen alle zusammen aus, kein Wiederaufleuchten (kein Blinken)");
  pruefe(ampel.filter((f) => f.phase === "ampel").every((f) => !f.bewegt), "während der Ampel steht jedes Auto");
  pruefe(ampel.some((f) => f.phase === "rennen" && f.an === 0), "mit dem Erlöschen beginnt das Rennen");
  // Foto der Ampel mit drei Lichtern (neu laden, damit der Zeitpunkt passt)
  await laden("?bot=1&samen=3");
  await bis(`${SB}.rennen.ampel.an === 3`, 6000);
  await foto("ampel-1440.png");

  console.log("Pulk");
  await bis(`${SB}.rennen.phase === "rennen" && ${SB}.rennen.spieler.zeit > 3.2`, 12000);
  const sichtbar = await js(`(() => { const r = ${SB}.rennen, s = r.strecke; return r.autos.slice(1).filter((a) => { const d = ((a.z - r.spieler.z) % s.laenge + s.laenge) % s.laenge; return d < 40000; }).length; })()`);
  pruefe(sichtbar >= 4, "kurz nach dem Start liegen mindestens 4 Gegner vor dir in Sichtweite (" + sichtbar + ")");
  await foto("pulk-1440.png");
  await bis(`${SB}.rennen.spieler.zeit > 9`, 12000);
  await foto("pulk-2-1440.png");

  console.log("Ganzes Rennen mit Zeitraffer");
  await laden("?bot=1&zeitraffer=12&samen=3");
  const fertig = await bis(`${SB}.zustand === "ergebnis"`, 90000);
  pruefe(fertig, "der Bot fährt ein ganzes Rennen bis zum Ergebnisschirm");
  if (fertig) {
    const tab = await js(`[...document.querySelectorAll("#ergebnis-zeilen tr")].map((tr) => [...tr.children].map((td) => td.textContent))`);
    for (const z of tab) console.log("  " + z.join(" | "));
    pruefe(tab.length === 8, "Ergebnistabelle mit 8 Zeilen (" + tab.length + ")");
    pruefe(tab.map((z) => z[0]).join(",") === "1.,2.,3.,4.,5.,6.,7.,8.", "Plätze 1 bis 8 eindeutig");
    pruefe(/^\d:\d\d\.\d\d$/.test(tab[0][3]) && tab.slice(1).every((z) => /^\+\d+,\d\d s$|^\+\d:\d\d\.\d\d$/.test(z[3])), "Sieger mit Gesamtzeit, alle anderen mit Rückstand");
    pruefe(tab.every((z) => /^\d:\d\d\.\d\d$/.test(z[4])), "jede Zeile mit bester Runde");
    pruefe(new Set(tab.map((z) => z[2])).size === 8 && tab.some((z) => z[2] === "Du"), "acht verschiedene Fahrer, darunter du");
    pruefe(await js(`[...document.querySelectorAll("#ergebnis-zeilen .nummer")].filter((n) => /^\\d+$/.test(n.textContent)).length === 7`), "jeder Gegner hat seine Startnummer in der Tabelle");
    await warte(600); // Anzeigen fertig ausgeblendet
    await foto("ergebnis-1440.png");
  }

  console.log("Zeitfahren und Bestzeit");
  await laden("");
  await js(`(() => { try { Object.keys(localStorage).filter((k) => k.startsWith("streckenblitz.")).forEach((k) => localStorage.removeItem(k)); } catch {} })()`);
  await laden("?bot=1&modus=zeitfahren&zeitraffer=12&samen=1");
  pruefe(await js(`${SB}.rennen.autos.length === 1`), "Zeitfahren: allein auf der Strecke");
  const zf = await bis(`${SB}.zustand === "ergebnis"`, 60000);
  pruefe(zf, "Zeitfahren endet mit dem Ergebnis");
  if (zf) {
    const hinweis = await js(`document.getElementById("ergebnis-hinweis").textContent`);
    const gespeichert = await js(`(() => { try { return localStorage.getItem("streckenblitz.rekord.moewenkap"); } catch { return null; } })()`);
    console.log("  " + hinweis + " | gespeichert " + gespeichert);
    pruefe(/Neue Bestzeit/.test(hinweis) && await js(`document.getElementById("ergebnis-hinweis").classList.contains("neu")`), "erste Fahrt: neue Bestzeit ruhig hervorgehoben");
    pruefe(Number(gespeichert) > 30 && Number(gespeichert) < 80, "Bestzeit in localStorage unter streckenblitz.rekord.moewenkap");
    const blinkt = await js(`(() => { const s = getComputedStyle(document.getElementById("ergebnis-hinweis")); return s.animationName !== "none"; })()`);
    pruefe(!blinkt, "Hervorhebung ohne Animation");
    await warte(600);
    await foto("zeitfahren-1440.png");
    await laden("");
    pruefe(await js(`document.getElementById("menue-rekord").textContent`) === await js(`(() => { const t = Number(localStorage.getItem("streckenblitz.rekord.moewenkap")); const h = Math.round(t * 100); return Math.floor(h / 6000) + ":" + String(Math.floor(h / 100) % 60).padStart(2, "0") + "." + String(h % 100).padStart(2, "0"); })()`), "Menü zeigt den gespeicherten Rekord");
  }

  console.log("Pause");
  await laden("?modus=rennen&samen=1");
  await bis(`${SB}.rennen.zeit > 2`, 5000);
  await taste("Escape");
  const z1 = await js(`${SB}.rennen.zeit`);
  await warte(1000);
  const z2 = await js(`${SB}.rennen.zeit`);
  pruefe(await js(`${SB}.zustand === "pause"`) && z1 === z2, "Esc hält an, die Zeit steht (" + z1.toFixed(2) + " und " + z2.toFixed(2) + ")");
  await foto("pause-1440.png");
  await taste("KeyP");
  await warte(500);
  pruefe(await js(`${SB}.zustand === "fahrt" && ${SB}.rennen.zeit > ${z2}`), "P fährt weiter");

  console.log("Freie Fahrt");
  await laden("?bot=1&start=1500");
  pruefe(await js(`${SB}.rennen.modus === "frei" && getComputedStyle(document.getElementById("ampel")).display === "none" && getComputedStyle(document.getElementById("block-platz")).display === "none"`), "freie Fahrt (?start): ohne Ampel und ohne Platz");
  pruefe(await js(`${SB}.rennen.spieler.tempo > 0`), "freie Fahrt beginnt sofort");

  console.log("Konsole");
  pruefe(meldungen.length === 0, "keine Fehler und Warnungen in der Konsole" + (meldungen.length ? ":\n    " + meldungen.join("\n    ") : ""));
} catch (e) {
  fehler.push("Abbruch: " + e.message);
  console.error("Abbruch:", e.message);
} finally {
  try { await cdp("Browser.close"); } catch { /* schon zu */ }
  await warte(800);
  try { edge.kill(); } catch { /* egal */ }
}

console.log(`\nSUMME: ${gesamt} Prüfungen, ${fehler.length} Fehler`);
console.log(fehler.length ? "SPIEL: DURCHGEFALLEN\n  " + fehler.join("\n  ") : "SPIEL: BESTANDEN");
process.exitCode = fehler.length ? 1 : 0;
