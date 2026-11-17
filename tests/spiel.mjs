// Prüfungen im echten Browser: Edge headless über das DevTools-Protokoll (Muster werkzeuge/foto.mjs).
//
//   node tests/spiel.mjs [fotoordner]
//
// Braucht die Vorschau auf Port 8644 (oder BASIS=… auf eine andere Adresse, auch file://).
// Startet genau ein Edge mit eigenem Profil im Temp-Ordner und beendet es am Ende sicher.
// Geprüft wird: Seite lädt ohne Konsolenfehler, Menü mit Tasten bedienbar, Startampel ohne Blinken,
// Gegner im Bild, ?bot=1 fährt ein ganzes Rennen bis zum Ergebnis (Zeitraffer), Ergebnistabelle vollständig,
// Zeitfahren speichert die Bestzeit je Strecke, Pause hält die Zeit an, Streckenwahl im Menü,
// Ton erst nach einer Geste und gespeichert, Motorklang mit hörbarem Schalten (OfflineAudioContext),
// Bot fährt auf allen drei Strecken ein Rennen, Flimmer-Messung auf allen drei Strecken bei Höchsttempo.
// Fotos (Startampel, Pulk, Ergebnis, Menü, Pause, Zeitfahren) landen im Fotoordner (Vorgabe fotos/spiel).
// Die Fotos der drei Strecken macht werkzeuge/foto.mjs (Szene strecken).
// Hülle (M4): Service Worker und Manifest, Sprachen de, en, ja (alle Texte), Auswahlfeld, Sehhilfen mit Kontrast der
// Menüschriften, Hoher Kontrast und Farbenblind im Spielbild, Darstellung höchstens alle 1,5 s, Gamepad (untergeschoben),
// Touch auf dem Handy quer, Hinweis hochkant. Fotos in <fotoordner>/m4: Menü, Einstellungen, Rennen, Pause, Ergebnis bei
// 1440 × 900, 844 × 390 quer und 390 × 844 hochkant; Englisch und Japanisch; jede Sehhilfe mit Menü und Rennen.
// E-Turbo (M5): Taste E zündet im Spiel, Schimmer an der Platte blendet ruhig ein und aus, Leuchtdichte springt nicht,
// Zahlen weiter höchstens alle 0,5 s, Flimmern mit Turbo, Surren im OfflineAudioContext, Gamepad RB und Touch-Knopf.
// Fotos in <fotoordner>/m5.
// Streckenkarte (M5b): Minikarte unten links scharf in Gerätepixeln, dreht sich mit (du zeigst nach oben, die Strecke voraus
// liegt über dir), ohne Zittern, Karten in der Streckenwahl (still, Norden oben), Handy quer ohne Überdeckung, Sehhilfen.
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
// Ohne eigene Angabe läuft jede Seite auf Deutsch (?sprache=de gilt nur für den Aufruf und wird nicht gespeichert)
const mitSprache = (suche) => (/sprache=/.test(suche) ? suche : (suche ? suche + "&" : "?") + "sprache=de");
async function laden(suche) {
  await cdp("Page.navigate", { url: BASIS + mitSprache(suche) });
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
const VK = { Escape: 27, KeyP: 80, KeyZ: 90, KeyR: 82, KeyT: 84, Enter: 13, Digit5: 53, ArrowRight: 39, ArrowLeft: 37, KeyW: 87, KeyE: 69 };
async function taste(code) {
  const key = code === "Escape" ? "Escape" : code === "Enter" ? "Enter" : code.startsWith("Arrow") ? code : code.replace(/^Key|^Digit/, "").toLowerCase();
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

  console.log("Streckenwahl");
  await laden("?strecke=moewenkap");
  pruefe(await js(`document.querySelectorAll("#streckenwahl [data-strecke]").length === 3 && ${SB}.strecke.id === "moewenkap"`), "drei Strecken zur Wahl, Möwenkap gewählt");
  await taste("ArrowRight");
  const wahl1 = await js(`[${SB}.strecke.id, document.getElementById("menue-unterzeile").textContent, document.querySelector('[data-strecke="mondsenke"]').getAttribute("aria-pressed"), ${SB}.rennen.strecke.id]`);
  pruefe(wahl1[0] === "mondsenke" && /Mondsenke/.test(wahl1[1]) && wahl1[2] === "true" && wahl1[3] === "mondsenke", "Pfeil rechts wählt Mondsenke (" + wahl1[1] + "), Aufstellung auf der neuen Strecke");
  await js(`document.querySelector('[data-strecke="tannenjoch"]').click()`);
  pruefe(await js(`${SB}.strecke.id === "tannenjoch" && /Tannenjoch/.test(document.getElementById("menue-unterzeile").textContent)`), "Klick auf die Karte wählt Tannenjoch");
  await foto("menue-tannenjoch-1440.png");
  await laden("");
  pruefe(await js(`${SB}.strecke.id`) === "tannenjoch", "die Wahl bleibt nach dem Neuladen erhalten");
  await taste("ArrowRight");
  pruefe(await js(`${SB}.strecke.id`) === "moewenkap", "Pfeil rechts nach der letzten Strecke springt zur ersten");

  console.log("Ton");
  await laden("");
  await js(`(() => { try { localStorage.removeItem("streckenblitz.ton"); } catch {} })()`);
  await laden("");
  pruefe(await js(`${SB}.ton.kontext === null && document.getElementById("ton").getAttribute("aria-pressed") === "false" && document.getElementById("ton").textContent === "Ton aus"`), "beim Start stumm: kein AudioContext, Schalter zeigt Ton aus");
  await taste("KeyT");
  const tonAn = await js(`[${SB}.ton.kontext ? ${SB}.ton.kontext.state : null, localStorage.getItem("streckenblitz.ton"), document.getElementById("ton").textContent]`);
  pruefe(tonAn[0] === "running" && tonAn[1] === "an" && tonAn[2] === "Ton an", "Taste T schaltet den Ton an (AudioContext " + tonAn[0] + "), Wahl gespeichert");
  await laden("");
  pruefe(await js(`${SB}.ton.kontext === null && document.getElementById("ton").textContent === "Ton an"`), "nach dem Neuladen: Schalter an, aber noch kein AudioContext vor einer Geste");
  await taste("KeyR");
  pruefe(await js(`${SB}.ton.kontext !== null && ${SB}.ton.kontext.state === "running"`), "die erste Taste startet den Ton");
  await js(`document.getElementById("ton").click()`);
  await warte(300);
  pruefe(await js(`localStorage.getItem("streckenblitz.ton") === "aus" && ${SB}.ton.kontext.state !== "running"`), "Klick schaltet wieder aus, gespeichert");
  // Klang ohne Lautsprecher prüfen: 4 s Motor mit Tempo von 0 auf Höchsttempo, im OfflineAudioContext gerechnet,
  // einmal ohne und einmal mit Rutschen ab 3,6 s (sonst gleich, der Unterschied ist also nur das Reifenquietschen)
  const klang = await js(`(async () => {
    const rate = 22050, sek = 4;
    async function rendern(rutschen) {
      const ac = new OfflineAudioContext(1, rate * sek, rate), k = Ton.klangBauen(ac);
      for (let i = 0; i <= sek * 60; i++) {
        const t = i / 60;
        k.setze({ aktiv: true, anteil: Math.min(1, t / 3.4), gas: 1, rutschen: rutschen && t > 3.6 ? 1 : 0, stoesse: 0, gegner: [] }, t);
      }
      return (await ac.startRendering()).getChannelData(0);
    }
    const d = await rendern(false), r = await rendern(true);
    // Periode je 50 ms über die Autokorrelation (15 bis 200 Hz); der tiefe Rechteckton gibt die Periode vor
    const hz = [];
    for (let s0 = 0; s0 + 2600 < rate * 3.5; s0 += 1102) {
      let best = 0, bestLag = 0;
      for (let lag = 110; lag <= 1470; lag++) {
        let summe = 0;
        for (let i = 0; i < 1024; i++) summe += d[s0 + i] * d[s0 + i + lag];
        if (summe > best) { best = summe; bestLag = lag; }
      }
      hz.push(bestLag ? Math.round(rate / bestLag) : 0);
    }
    // Gangwechsel: die Tonhöhe fällt um mindestens 8 % unter das Höchste der letzten drei Fenster
    let faelle = 0, zuletzt = false;
    for (let i = 6; i < hz.length; i++) { // die ersten 0,3 s (Leerlauf, Tonhöhe unter 25 Hz) zählen nicht
      const fall = hz[i] > 25 && hz[i] < 0.92 * Math.max(hz[i - 1], hz[i - 2], hz[i - 3]);
      if (fall && !zuletzt) faelle++;
      zuletzt = fall;
    }
    const rms = (x, a, b) => { let q = 0; for (let i = a; i < b; i++) q += x[i] * x[i]; return Math.sqrt(q / (b - a)); };
    let diff = 0, vorher = 0;
    for (let i = rate * 3.7; i < rate * 3.95; i++) diff += (r[i] - d[i]) ** 2;
    for (let i = rate * 3.3; i < rate * 3.55; i++) vorher += (r[i] - d[i]) ** 2;
    return { rms: +rms(d, rate, rate * 3).toFixed(4), faelle, verlauf: hz.filter((h) => h > 25).join(" "),
      reifen: +Math.sqrt(diff / (rate * 0.25)).toFixed(4), reifenVorher: +Math.sqrt(vorher / (rate * 0.25)).toFixed(5) };
  })()`);
  console.log("  Klang: " + JSON.stringify(klang));
  pruefe(klang.rms > 0.01 && klang.rms < 0.5, "Motor erzeugt Klang, nicht übersteuert (RMS " + klang.rms + ")");
  pruefe(klang.faelle >= 5 && klang.faelle <= 6, "beim Beschleunigen fällt die Tonhöhe hörbar ab: Gangwechsel (" + klang.faelle + " von 6)");
  pruefe(klang.reifenVorher < 0.0005 && klang.reifen > 0.005 && klang.reifen < klang.rms, "Rutschen fügt ein Reifenquietschen hinzu, leiser als der Motor (" + klang.reifen + ", vorher " + klang.reifenVorher + ")");
  const stille = await js(`(async () => {
    const ac = new OfflineAudioContext(1, 22050, 22050), k = Ton.klangBauen(ac);
    k.setze({ aktiv: false, anteil: 0.8, gas: 1, rutschen: 1, stoesse: 0, turbo: true, gegner: [] }, 0);
    const d = (await ac.startRendering()).getChannelData(0);
    let m = 0; for (let i = 11025; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
    return m; })()`);
  pruefe(stille < 0.002, "nicht aktiv (Menü, Pause, Ziel): stumm (Spitze " + stille.toFixed(4) + ")");
  // E-Turbo: dieselbe Fahrt mit und ohne Turbo ab 1 s bis 2,5 s; der Unterschied ist das Surren
  const surren = await js(`(async () => {
    const rate = 22050, sek = 4;
    async function rendern(turbo) {
      const ac = new OfflineAudioContext(1, rate * sek, rate), k = Ton.klangBauen(ac);
      for (let i = 0; i <= sek * 60; i++) { const t = i / 60; k.setze({ aktiv: true, anteil: 0.9, gas: 1, rutschen: 0, stoesse: 0, turbo: turbo && t >= 1 && t < 2.5, gegner: [] }, t); }
      return (await ac.startRendering()).getChannelData(0);
    }
    const ohne = await rendern(false), mit = await rendern(true);
    const diff = (a, b) => { let q = 0; for (let i = Math.round(a * rate); i < Math.round(b * rate); i++) q += (mit[i] - ohne[i]) ** 2; return +Math.sqrt(q / ((b - a) * rate)).toFixed(5); };
    let m = 0; for (let i = rate; i < 3 * rate; i++) m += ohne[i] * ohne[i];
    return { vorher: diff(0.5, 0.95), anfang: diff(1.0, 1.08), voll: diff(1.8, 2.4), danach: diff(3.5, 3.9), motor: +Math.sqrt(m / (2 * rate)).toFixed(4) }; })()`);
  console.log("  Surren: " + JSON.stringify(surren));
  pruefe(surren.vorher < 0.0005 && surren.voll > 0.003 && surren.voll < surren.motor * 0.5, "E-Turbo: leises Surren, deutlich leiser als der Motor (" + surren.voll + " gegen " + surren.motor + ")");
  pruefe(surren.anfang < surren.voll * 0.6 && surren.danach < surren.voll * 0.1, "E-Turbo: Surren blendet weich ein (" + surren.anfang + " in den ersten 80 ms) und wieder aus (" + surren.danach + ")");

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
    pruefe(/^\d:\d\d,\d\d$/.test(tab[0][3]) && tab.slice(1).every((z) => /^\+\d+,\d\d s$|^\+\d:\d\d,\d\d$/.test(z[3])), "Sieger mit Gesamtzeit, alle anderen mit Rückstand (deutsches Dezimalkomma)");
    pruefe(tab.every((z) => /^\d:\d\d,\d\d$/.test(z[4])), "jede Zeile mit bester Runde");
    pruefe(new Set(tab.map((z) => z[2])).size === 8 && tab.some((z) => z[2] === "Du"), "acht verschiedene Fahrer, darunter du");
    pruefe(await js(`[...document.querySelectorAll("#ergebnis-zeilen .nummer")].filter((n) => /^\\d+$/.test(n.textContent)).length === 7`), "jeder Gegner hat seine Startnummer in der Tabelle");
    await warte(600); // Anzeigen fertig ausgeblendet
    await foto("ergebnis-1440.png");
  }

  console.log("Zeitfahren und Bestzeit");
  await laden("");
  await js(`(() => { try { Object.keys(localStorage).filter((k) => k.startsWith("streckenblitz.")).forEach((k) => localStorage.removeItem(k)); } catch {} })()`);
  await laden("?bot=1&modus=zeitfahren&zeitraffer=12&samen=1&strecke=moewenkap");
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
    await laden("?strecke=moewenkap");
    const andere = await js(`document.querySelector('[data-strecke="mondsenke"] .karten-rekord').textContent`);
    pruefe(andere === "Rekord: noch keiner", "Bestzeit gilt je Strecke: Mondsenke hat noch keine");
    pruefe(await js(`document.querySelector('[data-strecke="moewenkap"] .karten-rekord').textContent`) === await js(`(() => { const t = Number(localStorage.getItem("streckenblitz.rekord.moewenkap")); const h = Math.round(t * 100); return "Rekord " + Math.floor(h / 6000) + ":" + String(Math.floor(h / 100) % 60).padStart(2, "0") + "," + String(h % 100).padStart(2, "0"); })()`), "Menü zeigt den gespeicherten Rekord");
  }

  console.log("Rennen auf den anderen Strecken");
  for (const id of ["mondsenke", "tannenjoch"]) {
    await laden("?strecke=" + id + "&bot=1&zeitraffer=20&samen=5");
    const ok = await bis(`${SB}.zustand === "ergebnis"`, 90000);
    const tab = ok ? await js(`[...document.querySelectorAll("#ergebnis-zeilen tr")].map((tr) => [...tr.children].map((td) => td.textContent))`) : [];
    pruefe(ok && tab.length === 8 && tab.map((z) => z[0]).join(",") === "1.,2.,3.,4.,5.,6.,7.,8.", id + ": der Bot fährt ein ganzes Rennen, Ergebnis mit 8 Plätzen" + (ok ? " (du: " + tab.find((z) => z[2] === "Du")[0] + ", Sieger " + tab[0][3] + ")" : ""));
  }

  console.log("Flimmer-Messung");
  // Je Strecke zwei Fahrten über 2 s mit Höchsttempo (120 Bilder bei 60 Hz): die Zielgerade mit Brücke, Tribünen
  // und Laternen und die längste Gerade. Gemessen wird die mittlere relative Leuchtdichte des Spielbilds,
  // im Ganzen und in 4 × 3 Feldern. Fehler: eine Schwankung über 3 Hz mit Amplitude 0,01 oder mehr in einem Feld
  // (ein Zehntel der Schwelle für Blitze nach WCAG, die bei 0,1 liegt).
  const MESSUNG = `(gr, st, startSeg, turbo) => {
    const P = window.Physik, B = 427, H = 240, N = 120;
    const lin = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const v = i / 255; lin[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    const a = P.neuesAuto(startSeg * 200, 0);
    a.tempo = P.KONST.HOECHST;
    a.akku = 1;
    let tempoMax = 0;
    const reihen = Array.from({ length: 13 }, () => new Float64Array(N));
    const lese = document.createElement("canvas");
    lese.width = B; lese.height = H;
    const ctx = lese.getContext("2d", { willReadFrequently: true });
    let tempoMin = Infinity;
    for (let f = 0; f < N; f++) {
      P.schritt(a, { gas: 1, bremse: 0, lenken: P.botEingabe(a, st, 1).lenken, turbo: !!turbo && f === 0 }, st);
      tempoMin = Math.min(tempoMin, a.tempo);
      tempoMax = Math.max(tempoMax, a.tempo);
      gr.zeichne({ z: a.z, x: a.x, lenk: a.lenk, untergrund: a.untergrund, gegner: [] });
      ctx.drawImage(gr.bild, 0, 0);
      const d = ctx.getImageData(0, 0, B, H).data;
      const summen = new Float64Array(13);
      for (let y = 0; y < H; y++) {
        const by = Math.floor(y / 80);
        for (let x = 0; x < B; x++) {
          const i = (y * B + x) * 4;
          const l = 0.2126 * lin[d[i]] + 0.7152 * lin[d[i + 1]] + 0.0722 * lin[d[i + 2]];
          summen[by * 4 + Math.min(3, Math.floor(x / 107))] += l;
          summen[12] += l;
        }
      }
      for (let k = 0; k < 12; k++) reihen[k][f] = summen[k] / ((B * H) / 12);
      reihen[12][f] = summen[12] / (B * H);
    }
    // Schwankung über 3 Hz: linearer Trend weg, Hann-Fenster, Fourier, größte Amplitude ab 3,5 Hz
    function hoch(x) {
      const n = x.length; let sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (let i = 0; i < n; i++) { sx += i; sy += x[i]; sxx += i * i; sxy += i * x[i]; }
      const m = (n * sxy - sx * sy) / (n * sxx - sx * sx), c = (sy - m * sx) / n;
      let best = 0, bestHz = 0;
      for (let k = 7; k <= n / 2; k++) {
        let re = 0, im = 0;
        for (let i = 0; i < n; i++) {
          const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
          const v = (x[i] - (m * i + c)) * w;
          re += v * Math.cos((2 * Math.PI * k * i) / n); im -= v * Math.sin((2 * Math.PI * k * i) / n);
        }
        const amp = (4 / n) * Math.hypot(re, im); // Hann: Faktor 2 auf die übliche 2/n
        if (amp > best) { best = amp; bestHz = (k * 60) / n; }
      }
      return { amp: best, hz: bestHz };
    }
    const mittel = (x) => x.reduce((s, v) => s + v, 0) / x.length;
    const felder = reihen.slice(0, 12).map((r) => Object.assign(hoch(r), { mittel: mittel(r) }));
    const schlimm = felder.reduce((b, f) => (f.amp > b.amp ? f : b));
    let sprung = 0;
    for (let f = 1; f < N; f++) sprung = Math.max(sprung, Math.abs(reihen[12][f] - reihen[12][f - 1]));
    const ganz = hoch(reihen[12]);
    return { kmh: Math.round(tempoMin * 0.026), kmhMax: Math.round(tempoMax * 0.026), mittel: +mittel(reihen[12]).toFixed(4), ganzAmp: +ganz.amp.toFixed(5), ganzHz: ganz.hz,
      feldAmp: +schlimm.amp.toFixed(5), feldHz: schlimm.hz, feldMittel: +schlimm.mittel.toFixed(4), sprung: +sprung.toFixed(5) };
  }`;
  const flimmer = [];
  for (const id of ["moewenkap", "mondsenke", "tannenjoch"]) {
    await laden("?strecke=" + id);
    const stellen = await js(`(() => { const s = ${SB}.strecke;
      const ziel = s.stuecke.find((x) => x.name === "Zielgerade, erste Hälfte").von;
      let best = null, lauf = 0;
      for (let i = 0; i < s.anzahl; i++) { if (s.segmente[i].kurve === 0) { lauf++; if (!best || lauf > best.n) best = { n: lauf, ende: i }; } else lauf = 0; }
      return [ziel, best.ende - best.n + 1]; })()`);
    for (const [name, startSeg] of [["Zielgerade", stellen[0]], ["lange Gerade", stellen[1]]]) {
      const m = await js(`(${MESSUNG})(${SB}.grafik, ${SB}.strecke, ${startSeg})`);
      flimmer.push(m.feldAmp);
      console.log("  " + id + ", " + name + " ab Segment " + startSeg + ": " + JSON.stringify(m));
      pruefe(m.kmh >= 300 && m.feldAmp < 0.01 && m.ganzAmp < 0.01, id + ", " + name + ": bei " + m.kmh + " km/h kein Flimmern über 3 Hz (größte Schwankung in einem Feld " + m.feldAmp + " bei " + m.feldHz + " Hz, mittlere Leuchtdichte " + m.mittel + ")");
    }
    // Dieselbe lange Gerade mit gezündetem Turbo (schneller, die Streifen wechseln öfter)
    const mt = await js(`(${MESSUNG})(${SB}.grafik, ${SB}.strecke, ${stellen[1]}, true)`);
    console.log("  " + id + ", lange Gerade mit Turbo: " + JSON.stringify(mt));
    pruefe(mt.kmhMax >= 355 && mt.feldAmp < 0.01 && mt.ganzAmp < 0.01 && mt.sprung < 0.01, id + ", lange Gerade mit Turbo bis " + mt.kmhMax + " km/h: kein Flimmern über 3 Hz (" + mt.feldAmp + " bei " + mt.feldHz + " Hz), mittlere Leuchtdichte springt höchstens um " + mt.sprung);
  }
  // Gegenprobe: dieselbe Messung mit hart gestreiften Randsteinen muss anschlagen
  const gegen = await js(`(() => { const s = ${SB}.strecke;
    const hart = Object.assign({}, s, { farben: Object.assign({}, s.farben, { randstein: ["#e0e0e0", "#101010"], gras: ["#b0b0b0", "#101010"] }) });
    const leinwand = (b, h) => Object.assign(document.createElement("canvas"), { width: b, height: h });
    const g = Grafik.erzeuge(hart, leinwand, Rennen.FAHRER);
    return (${MESSUNG})(g, s, s.stuecke.find((x) => x.name === "Zielgerade, erste Hälfte").von); })()`);
  console.log("  Gegenprobe hart gestreift: " + JSON.stringify(gegen));
  pruefe(gegen.feldAmp >= 0.01, "Gegenprobe: hart gestreifte Randsteine und Gras werden als Flimmern erkannt (" + gegen.feldAmp + " bei " + gegen.feldHz + " Hz)");

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

  console.log("E-Turbo im Spiel");
  // Freie Fahrt auf der langen Geraden von Möwenkap: W hält Gas, gelenkt wird über die Bot-Logik, dann E.
  // Mitgeschrieben wird je Bild die Deckkraft des Schimmers, dazu Zahlenwechsel und Bildschirmfotos zur Leuchtdichte.
  await laden("?modus=frei&strecke=moewenkap&start=1602");
  await js(`(() => { const sb = ${SB}; (function f() { if (sb.zustand === "fahrt") sb.beruehrung.lenken = Physik.botEingabe(sb.auto, sb.strecke, 1).lenken; requestAnimationFrame(f); })(); return true; })()`);
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", code: "KeyW", key: "w", windowsVirtualKeyCode: 87 });
  await warte(3000);
  const vorTurbo = await js(`[${SB}.auto.akku, ${SB}.auto.zuendungen, ${SB}.auto.tempo * 0.026]`);
  await js(`(() => { const s = document.querySelector("#platte-tempo .schimmer"), t0 = performance.now(), log = [], zahl = { tempo: [], zeit: [] }, mo = [];
    for (const id of Object.keys(zahl)) { const o = new MutationObserver(() => zahl[id].push(performance.now())); o.observe(document.getElementById(id), { childList: true, characterData: true, subtree: true }); mo.push(o); }
    window.__turboLog = new Promise((fertig) => { (function f() { const t = performance.now() - t0; log.push([Math.round(t), +getComputedStyle(s).opacity, ${SB}.auto.akku, ${SB}.auto.turbo > 0]);
      if (t < 4200) requestAnimationFrame(f); else { mo.forEach((o) => o.disconnect()); fertig({ log, zahl }); } })(); });
    return true; })()`);
  await warte(200);
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", code: "KeyE", key: "e", windowsVirtualKeyCode: 69 });
  // Leuchtdichte: Platte (scharf) und ganzes Fenster (verkleinert) etwa alle 100 ms
  const PLATTE = await js(`(() => { const r = document.getElementById("platte-tempo").getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height, scale: 1 }; })()`);
  const LEUCHT = `async (b64) => { const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
    const c = Object.assign(document.createElement("canvas"), { width: img.width, height: img.height }), x = c.getContext("2d", { willReadFrequently: true });
    x.drawImage(img, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data; let s = 0;
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    for (let i = 0; i < d.length; i += 4) s += 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
    return s / (d.length / 4); }`;
  const leucht = { platte: [], ganz: [] };
  let turboFoto = false;
  const tFoto0 = Date.now();
  while (Date.now() - tFoto0 < 3600) {
    const pl = await cdp("Page.captureScreenshot", { format: "png", clip: PLATTE });
    const gz = await cdp("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 1440, height: 900, scale: 0.25 } });
    leucht.platte.push(await js(`(${LEUCHT})("${pl.data}")`));
    leucht.ganz.push(await js(`(${LEUCHT})("${gz.data}")`));
    if (!turboFoto && Date.now() - tFoto0 > 900) {
      turboFoto = true;
      await fotoAls("m5/turbo-1440-de.png");
      const z = await cdp("Page.captureScreenshot", { format: "png", clip: { x: PLATTE.x - 14, y: PLATTE.y - 14, width: PLATTE.width + 28, height: PLATTE.height + 28, scale: 3 } });
      fs.writeFileSync(path.join(ziel, "m5/turbo-platte-1440-de.png"), Buffer.from(z.data, "base64"));
      console.log("  Foto  " + path.join(ziel, "m5/turbo-platte-1440-de.png"));
    }
  }
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", code: "KeyE", key: "e", windowsVirtualKeyCode: 69 });
  const tlog = await js(`window.__turboLog`);
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", code: "KeyW", key: "w", windowsVirtualKeyCode: 87 });
  const nachTurbo = await js(`[${SB}.auto.akku, ${SB}.auto.zuendungen]`);
  const op = tlog.log.map((z) => z[1]);
  const anIdx = op.findIndex((o) => o > 0.02), vollIdx = op.findIndex((o) => o > 0.98);
  const ausIdx = vollIdx >= 0 ? op.findIndex((o, i) => i > vollIdx && o < 0.98) : -1, wegIdx = ausIdx >= 0 ? op.findIndex((o, i) => i > ausIdx && o < 0.02) : -1;
  // steilste Änderung je Sekunde, gemessen über Fenster von mindestens 100 ms (die Bilder kommen headless
  // unregelmäßig und ihre Zeitstempel zittern, von Bild zu Bild wäre das Rauschen größer als die Rampe)
  let schritt = 0;
  for (let i = 0; i < op.length; i++) {
    const j = tlog.log.findIndex((z, k) => k > i && z[0] - tlog.log[i][0] >= 100);
    if (j > 0) schritt = Math.max(schritt, Math.abs(op[j] - op[i]) / ((tlog.log[j][0] - tlog.log[i][0]) / 1000));
  }
  const ein = anIdx >= 0 && vollIdx >= 0 ? tlog.log[vollIdx][0] - tlog.log[anIdx][0] : 0, aus = ausIdx >= 0 && wegIdx >= 0 ? tlog.log[wegIdx][0] - tlog.log[ausIdx][0] : 0;
  const akkuSinkt = tlog.log.filter((z) => z[3]).map((z) => z[2]);
  console.log("  Turbo: Akku " + vorTurbo[0].toFixed(2) + " auf " + nachTurbo[0].toFixed(2) + ", Zündungen " + vorTurbo[1] + " auf " + nachTurbo[1] + ", Schimmer ein " + ein + " ms, aus " + aus + " ms, steilste Änderung " + schritt.toFixed(2) + " je Sekunde");
  pruefe(nachTurbo[1] === vorTurbo[1] + 1 && nachTurbo[0] < vorTurbo[0] - 0.2 && vorTurbo[2] > 150, "Taste E zündet den Turbo im Spiel, der Akku sinkt (" + vorTurbo[0].toFixed(2) + " auf " + nachTurbo[0].toFixed(2) + ")");
  pruefe(akkuSinkt.length > 30 && akkuSinkt.every((v, i) => i === 0 || v <= akkuSinkt[i - 1]), "der Akku leert sich sichtbar und stetig, solange der Turbo läuft (" + akkuSinkt.length + " Bilder)");
  pruefe(ein >= 300 && aus >= 300 && schritt <= 4, "Schimmer an der Platte blendet ruhig ein (" + ein + " ms) und aus (" + aus + " ms), kein Sprung (steilste Änderung " + schritt.toFixed(2) + " je Sekunde, Grenze 4: ein Sprung von 0 auf 1 wären unendlich viel)");
  const stufe = (r) => { let m = 0; for (let i = 1; i < r.length; i++) m = Math.max(m, Math.abs(r[i] - r[i - 1])); return m; };
  const spanne = (r) => Math.max(...r) - Math.min(...r);
  console.log("  Leuchtdichte Platte " + leucht.platte.map((v) => v.toFixed(4)).join(" ") + " | ganz " + leucht.ganz.map((v) => v.toFixed(4)).join(" "));
  pruefe(leucht.platte.length >= 8 && stufe(leucht.platte) < 0.02 && stufe(leucht.ganz) < 0.01 && spanne(leucht.ganz) < 0.02, "Leuchtdichte springt beim Zünden nicht: Platte höchstens " + stufe(leucht.platte).toFixed(4) + " je Messung, ganzes Bild " + stufe(leucht.ganz).toFixed(4) + " (Spanne " + spanne(leucht.ganz).toFixed(4) + ", Blitzschwelle 0,1)");
  const takt = Object.entries(tlog.zahl).map(([id, t]) => { let min = Infinity; for (let i = 1; i < t.length; i++) min = Math.min(min, t[i] - t[i - 1]); return [id, t.length, Math.round(min)]; });
  pruefe(takt.every(([, n, min]) => n >= 4 && min >= 499), "Zahlen wechseln auch im Turbo höchstens alle 0,5 s (" + takt.map(([id, n, min]) => id + " " + n + " Wechsel, kleinster Abstand " + min + " ms").join(", ") + ")");

  // ---------------------------------------------------------------------------------------------
  // Meilenstein 4, Hülle: PWA, Sprachen, Sehhilfen, Kontrast, Gamepad, Touch, Hochkant und die Fotomatrix
  // ---------------------------------------------------------------------------------------------
  const ANSICHTEN = {
    desktop: { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false },
    quer: { width: 844, height: 390, deviceScaleFactor: 3, mobile: true, screenOrientation: { type: "landscapePrimary", angle: 90 } },
    hoch: { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenOrientation: { type: "portraitPrimary", angle: 0 } },
  };
  async function ansicht(name) {
    const a = ANSICHTEN[name];
    await cdp("Emulation.setDeviceMetricsOverride", a);
    await cdp("Emulation.setTouchEmulationEnabled", a.mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
    await cdp("Emulation.setEmulatedMedia", { features: [{ name: "pointer", value: a.mobile ? "coarse" : "fine" }, { name: "hover", value: a.mobile ? "none" : "hover" }] });
  }
  // Fährt mit der Logik des Bots über die Eingabe der Bedienflächen (die Flächen bleiben sichtbar, anders als bei ?bot=1)
  const SELBST_FAHREN = `(() => { const sb = ${SB}; (function f() { if (sb.zustand === "fahrt") { const e = Physik.botEingabe(sb.auto, sb.strecke, 0.9);
    sb.beruehrung.gas = e.gas; sb.beruehrung.bremse = e.bremse; sb.beruehrung.lenken = e.lenken; } requestAnimationFrame(f); })(); return true; })()`;
  // Hochkant: der Hinweis „quer halten“ steht da, „Trotzdem spielen“ blendet ihn aus
  async function trotzdem() { await js(`(() => { const q = document.getElementById("quer"); if (!q.hidden) document.getElementById("quer-trotzdem").click(); return true; })()`); await warte(250); }
  const lokal = /^https?:/.test(BASIS);
  async function fotoAls(datei) {
    fs.mkdirSync(path.dirname(path.join(ziel, datei)), { recursive: true });
    await foto(datei);
  }

  console.log("PWA");
  await ansicht("desktop");
  await laden("");
  if (lokal) {
    const sw = await js(`(async () => {
      const bereit = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 8000))]);
      const namen = await caches.keys();
      const schluessel = namen.includes("streckenblitz-v3") ? (await (await caches.open("streckenblitz-v3")).keys()).map((r) => r.url) : [];
      return { aktiv: !!(bereit && bereit.active), bereich: bereit ? bereit.scope : "", caches: namen, inhalt: schluessel.length, karte: schluessel.some((u) => u.endsWith("/karte.js")) }; })()`);
    console.log("  Service Worker: " + JSON.stringify(sw));
    pruefe(sw.aktiv && /127\.0\.0\.1:8644\/$/.test(sw.bereich), "Service Worker registriert und aktiv (Bereich " + sw.bereich + ")");
    // 18 Dateien seit M5b (karte.js dazu); die Liste in sw.js muss alles enthalten, was index.html lädt
    const swListe = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8"), seite = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
    const geladen = [...seite.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
    pruefe(sw.caches.includes("streckenblitz-v3") && sw.inhalt >= 18 && sw.karte && geladen.every((d) => swListe.includes('"./' + d + '"')), "Cache streckenblitz-v3 mit allen Dateien (" + sw.inhalt + " Einträge, karte.js dabei, alle " + geladen.length + " Skripte der Seite in der Liste)");
    const mf = await js(`(async () => { const l = document.querySelector('link[rel="manifest"]'); const m = await (await fetch(l.href)).json();
      const icons = await Promise.all(m.icons.map(async (i) => (await fetch(i.src)).status));
      return { orientation: m.orientation, display: m.display, name: m.name, icons, start: m.start_url }; })()`);
    console.log("  Manifest: " + JSON.stringify(mf));
    pruefe(mf.orientation === "landscape" && mf.display === "fullscreen" && mf.name === "Streckenblitz" && mf.icons.length === 4 && mf.icons.every((s) => s === 200), "Manifest quer, Vollbild, vier Icons erreichbar");
    pruefe(await js(`!!document.querySelector('link[rel="apple-touch-icon"]') && !!document.querySelector('link[rel="icon"][type="image/svg+xml"]')`), "favicon.svg und apple-touch-icon eingebunden");
  } else {
    pruefe(await js(`!document.querySelector('link[rel="manifest"]')`), "file://: kein Manifest, kein Service Worker (sonst Fehler in der Konsole)");
  }

  console.log("Sprachen");
  for (const code of ["de", "en", "ja"]) {
    await laden("?sprache=" + code + "&strecke=moewenkap");
    const s = await js(`(() => { const SP = window.Sprachen, c = ${JSON.stringify(code)};
      const falsch = [...document.querySelectorAll("[data-i]")].filter((e) => e.textContent !== SP.text(c, e.dataset.i)).map((e) => e.dataset.i);
      const aria = [...document.querySelectorAll("[data-i-aria]")].filter((e) => e.getAttribute("aria-label") !== SP.text(c, e.dataset.iAria)).map((e) => e.dataset.iAria);
      return { lang: document.documentElement.lang, titel: document.title === SP.text(c, "titel"), falsch, aria, los: document.getElementById("los").textContent,
        ton: document.getElementById("ton").textContent === SP.text(c, "ton_aus") || document.getElementById("ton").textContent === SP.text(c, "ton_an"),
        unter: document.getElementById("menue-unterzeile").textContent, zeit: document.getElementById("letzte").textContent }; })()`);
    pruefe(s.lang === code && s.titel && !s.falsch.length && !s.aria.length && s.ton, code + ": Seite, Titel und alle " + "Texte übersetzt (Los: " + s.los + ", " + s.unter + ", Platzhalter " + s.zeit + ")" + (s.falsch.length ? " falsch: " + s.falsch.join(",") : ""));
  }
  pruefe(await js(`document.getElementById("letzte").textContent`) === "-:--.--", "ja: Zeiten mit Punkt als Dezimalzeichen");
  // Auswahlfeld: Französisch wählen, alles wechselt sofort, die Wahl wird gespeichert
  await laden("?sprache=de");
  await js(`(() => { const a = document.getElementById("sprache"); a.value = "fr"; a.dispatchEvent(new Event("change")); return true; })()`);
  const fr = await js(`[document.documentElement.lang, document.getElementById("los").textContent, localStorage.getItem("streckenblitz.lang"), document.title]`);
  pruefe(fr[0] === "fr" && fr[1] === "Départ" && fr[2] === "fr", "Auswahlfeld wechselt sofort auf Französisch und speichert (" + fr[1] + ", " + fr[3] + ")");
  await js(`localStorage.removeItem("streckenblitz.lang")`);
  const erkannt = await js(`Sprachen.erkenne(null, ["pt-BR", "de"]) + " " + Sprachen.erkenne(null, ["sv-SE"]) + " " + Sprachen.erkenne("ko", ["de"])`);
  pruefe(erkannt === "pt en ko", "Erkennung: pt-BR wird pt, Unbekanntes wird en, gespeicherte Wahl gewinnt (" + erkannt + ")");

  console.log("Sehhilfen und Kontrast");
  const MODI = [["normal", "system"], ["hc-dunkel", "hc-dark"], ["hc-hell", "hc-light"], ["farbenblind", "cvd-dark"], ["umkehr", "invert"]];
  // Kontrast aller festen Schriften der Menüplatte gegen ihren Grund (Durchsicht der Platte vernachlässigt)
  const KONTRAST = `(() => {
    const zahl = (c) => { const m = c.match(/[\\d.]+/g).map(Number); return c.startsWith("color(") ? m.slice(0, 3).map((v) => v * 255) : m.slice(0, 3); };
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; const [r, g, b] = zahl(c); return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const verh = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const grund = getComputedStyle(document.querySelector(".menue-tafel")).backgroundColor;
    const feld = getComputedStyle(document.querySelector('[data-modus="zeitfahren"]')).backgroundColor;
    const liste = [[".wahl-titel", grund], [".karte:not([aria-pressed=true]) small", grund], [".unterzeile", grund], [".tasten", grund],
      ['[data-modus="zeitfahren"]', feld], ['[data-modus="rennen"]', getComputedStyle(document.querySelector('[data-modus="rennen"]')).backgroundColor]];
    return liste.map(([sel, bg]) => [sel, +verh(getComputedStyle(document.querySelector(sel)).color, bg).toFixed(2)]); })()`;
  for (const [modus, wert] of MODI) {
    await laden("?strecke=moewenkap");
    await js(`localStorage.setItem("werkstatt.darstellung", ${JSON.stringify(wert)})`);
    await laden("?strecke=moewenkap");
    const z = await js(`[${SB}.darstellung, ${SB}.grafik.modus, document.documentElement.getAttribute("data-vision"), document.getElementById("darstellung").value]`);
    pruefe(z[0] === modus && z[1] === modus, modus + ": Seite und Spielbild in derselben Darstellung (" + z.join(", ") + ")");
    if (modus !== "umkehr") {
      const k = await js(KONTRAST);
      const schwach = k.filter(([, v]) => v < 4.5);
      pruefe(!schwach.length, modus + ": alle Menüschriften mindestens 4,5:1 (kleinster Wert " + Math.min(...k.map(([, v]) => v)) + ")" + (schwach.length ? " zu schwach: " + JSON.stringify(schwach) : ""));
    }
  }
  // Im Spielbild: Hoher Kontrast macht die Randlinie hell und breit, die Randsteine einfarbig; Farbenblind tauscht die Gegnerfarben
  const bild = await js(`(() => {
    const s = ${SB}.strecke, g = Grafik.erzeuge(s, (b, h) => Object.assign(document.createElement("canvas"), { width: b, height: h }), Rennen.FAHRER);
    const lese = Object.assign(document.createElement("canvas"), { width: 427, height: 240 }).getContext("2d", { willReadFrequently: true });
    function zaehle(modus) {
      g.setzeModus(modus);
      g.zeichne({ z: 3000, x: 0, lenk: 0, untergrund: "strasse", gegner: [] });
      lese.drawImage(g.bild, 0, 0);
      const d = lese.getImageData(0, 150, 427, 60).data; let hell = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 600) hell++;
      return hell; }
    const farbe = (modus) => { g.setzeModus(modus); const c = g.gegnerBild(0, 0, 30); const x = c.getContext("2d").getImageData(Math.floor(c.width / 2) - 2, Math.floor(c.height * 0.55), 1, 1).data; return [x[0], x[1], x[2]].join(","); };
    return { normal: zaehle("normal"), hc: zaehle("hc-dunkel"), farbeNormal: farbe("normal"), farbeCvd: farbe("farbenblind"), randHc: (g.setzeModus("hc-dunkel"), g.gegnerBild(0, 0, 30).width - (g.setzeModus("normal"), g.gegnerBild(0, 0, 30).width)) }; })()`);
  console.log("  Spielbild: " + JSON.stringify(bild));
  pruefe(bild.hc > bild.normal * 2 && bild.hc > 150, "Hoher Kontrast: deutlich mehr helle Randlinie im unteren Bild (" + bild.hc + " statt " + bild.normal + " Pixel)");
  pruefe(bild.randHc === 2, "Hoher Kontrast: Autos mit einem Pixel Kontur ringsum");
  pruefe(bild.farbeNormal !== bild.farbeCvd, "Farbenblind: andere Gegnerfarbe (" + bild.farbeNormal + " wird " + bild.farbeCvd + "), Startnummern bleiben");
  // Flimmern im Hohen Kontrast (die Randlinie ist hell): dieselbe Messung wie oben auf der Zielgerade von Möwenkap
  {
    const m = await js(`(() => { const s = ${SB}.strecke; const g = Grafik.erzeuge(s, (b, h) => Object.assign(document.createElement("canvas"), { width: b, height: h }), Rennen.FAHRER); g.setzeModus("hc-dunkel");
      return (${MESSUNG})(g, s, s.stuecke.find((x) => x.name === "Zielgerade, erste Hälfte").von); })()`);
    pruefe(m.feldAmp < 0.01 && m.ganzAmp < 0.01, "Hoher Kontrast: kein Flimmern über 3 Hz (größte Schwankung " + m.feldAmp + " bei " + m.feldHz + " Hz)");
  }
  // Auswahlfeld: zwei Wechsel kurz hintereinander, der zweite kommt frühestens 1,5 s nach dem ersten
  await js(`localStorage.setItem("werkstatt.darstellung", "system")`);
  await laden("");
  const wechsel = await js(`(async () => { const f = document.getElementById("darstellung"), t0 = performance.now(), log = [];
    const mo = new MutationObserver(() => log.push([Math.round(performance.now() - t0), document.documentElement.getAttribute("data-vision")]));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-vision"] });
    f.value = "hc-dark"; f.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 200));
    f.value = "cvd"; f.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 2200)); mo.disconnect();
    const aenderungen = log.filter((x, i) => i === 0 || x[1] !== log[i - 1][1]);
    return { log: aenderungen, gespeichert: localStorage.getItem("werkstatt.darstellung") }; })()`);
  const zeiten = wechsel.log.filter(([, v]) => v).map(([t]) => t);
  pruefe(wechsel.log.at(-1)[1] === "cvd" && zeiten.length >= 2 && zeiten[zeiten.length - 1] - zeiten[0] >= 1450, "Darstellung wechselt höchstens alle 1,5 s, der neueste Wunsch gilt (" + JSON.stringify(wechsel.log) + ", gespeichert " + wechsel.gespeichert + ")");
  await js(`localStorage.setItem("werkstatt.darstellung", "system")`);

  console.log("Gamepad");
  const padSkript = await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
    const knoepfe = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
    window.__pad = { id: "Testpad", index: 0, connected: true, mapping: "standard", axes: [0, 0, 0, 0], buttons: knoepfe, timestamp: 0 };
    Object.defineProperty(navigator, "getGamepads", { value: () => [window.__pad, null, null, null] }); })()` });
  await laden("?modus=frei&strecke=moewenkap");
  await js(`(() => { __pad.axes[0] = 0.1; return true; })()`);
  await warte(200);
  const totzone = await js(`${SB}.pad.lenken`);
  await js(`(() => { __pad.axes[0] = 0.8; __pad.buttons[7].value = 1; __pad.buttons[7].pressed = true; return true; })()`);
  await warte(1500);
  const p1 = await js(`[${SB}.auto.tempo * 0.026, ${SB}.auto.lenk, ${SB}.pad.lenken]`);
  pruefe(totzone === 0, "Gamepad: Stick 0,1 liegt in der Totzone (lenken " + totzone + ")");
  pruefe(p1[0] > 60 && p1[1] > 0.2 && p1[2] > 0.7 && p1[2] < 0.8, "Gamepad: rechter Trigger gibt Gas (" + p1[0].toFixed(0) + " km/h), Stick lenkt analog (" + p1[2].toFixed(3) + ")");
  await js(`(() => { __pad.axes[0] = 0; __pad.buttons[7].value = 0; __pad.buttons[7].pressed = false; __pad.buttons[6].value = 1; __pad.buttons[6].pressed = true; return true; })()`);
  await warte(600);
  const p2 = await js(`${SB}.auto.tempo * 0.026`);
  pruefe(p2 < p1[0] - 20, "Gamepad: linker Trigger bremst (" + p2.toFixed(0) + " km/h)");
  const rb0 = await js(`${SB}.auto.zuendungen`);
  await js(`(() => { __pad.buttons[5].value = 1; __pad.buttons[5].pressed = true; return true; })()`);
  await warte(300);
  await js(`(() => { __pad.buttons[5].value = 0; __pad.buttons[5].pressed = false; return true; })()`);
  pruefe(await js(`${SB}.auto.zuendungen`) === rb0 + 1 && await js(`${SB}.auto.turbo > 0`), "Gamepad: RB zündet den Turbo");
  await js(`(() => { __pad.buttons[6].value = 0; __pad.buttons[6].pressed = false; __pad.buttons[9].pressed = true; return true; })()`);
  await warte(200);
  await js(`(() => { __pad.buttons[9].pressed = false; return true; })()`);
  await warte(200);
  const p3 = await js(`${SB}.zustand`);
  await js(`(() => { __pad.buttons[9].pressed = true; return true; })()`);
  await warte(200);
  await js(`(() => { __pad.buttons[9].pressed = false; return true; })()`);
  await warte(200);
  pruefe(p3 === "pause" && await js(`${SB}.zustand`) === "fahrt", "Gamepad: Start hält an und fährt weiter");
  // Was in der Pause gedrückt wurde, zündet nach dem Weiterfahren nicht, erst ein neuer Druck (RB gehalten; E gehalten mit Wiederholungen)
  const TURBO_BEREIT = `(() => { const a = ${SB}.auto; a.akku = 1; a.turbo = 0; a.turboPause = 0; return a.zuendungen; })()`;
  const rbDruck = (an) => js(`(() => { __pad.buttons[5].value = ${an ? 1 : 0}; __pad.buttons[5].pressed = ${an}; return true; })()`);
  const pz0 = await js(TURBO_BEREIT);
  await taste("KeyP");
  await rbDruck(true);
  await warte(300);
  await taste("KeyP");
  await warte(400);
  const pz1 = await js(`${SB}.auto.zuendungen`);
  await rbDruck(false);
  await warte(200);
  await rbDruck(true);
  await warte(300);
  await rbDruck(false);
  const pz2 = await js(`${SB}.auto.zuendungen`);
  pruefe(pz1 === pz0 && pz2 === pz0 + 1, "Gamepad: RB in der Pause gedrückt zündet nach dem Weiterfahren nicht, erst ein neuer Druck (Zündungen " + pz0 + ", " + pz1 + ", " + pz2 + ")");
  const kz0 = await js(TURBO_BEREIT);
  const e = (art, mehr) => cdp("Input.dispatchKeyEvent", Object.assign({ type: art, code: "KeyE", key: "e", windowsVirtualKeyCode: 69 }, mehr));
  await taste("KeyP");
  await e("keyDown");
  await warte(200);
  await taste("KeyP");
  for (let i = 0; i < 6; i++) { await e("keyDown", { autoRepeat: true }); await warte(50); }
  await warte(200);
  const kz1 = await js(`${SB}.auto.zuendungen`);
  await e("keyUp");
  await warte(150);
  await e("keyDown");
  await warte(200);
  await e("keyUp");
  const kz2 = await js(`${SB}.auto.zuendungen`);
  pruefe(kz1 === kz0 && kz2 === kz0 + 1, "Tastatur: E in der Pause gedrückt und gehalten zündet nach dem Weiterfahren nicht, erst ein neuer Druck (Zündungen " + kz0 + ", " + kz1 + ", " + kz2 + ")");
  await cdp("Page.removeScriptToEvaluateOnNewDocument", { identifier: padSkript.identifier });

  console.log("Touch");
  await ansicht("quer");
  await laden("?modus=frei&strecke=moewenkap");
  const t0 = await js(`[!document.getElementById("touch").hidden, document.documentElement.classList.contains("beruehrung"), getComputedStyle(document.querySelector(".hilfe")).display]`);
  pruefe(t0[0] && t0[1] && t0[2] === "none", "Handy quer: Bedienflächen sichtbar, Tastenhilfe ausgeblendet");
  const mitte = (id) => js(`(() => { const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, r.width]; })()`);
  const gas = await mitte("touch-gas"), lenk = await mitte("lenkzone");
  await cdp("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: gas[0], y: gas[1], id: 1 }] });
  await warte(1500);
  const tg = await js(`${SB}.auto.tempo * 0.026`);
  await cdp("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: gas[0], y: gas[1], id: 1 }, { x: lenk[0] + lenk[2] * 0.3, y: lenk[1], id: 2 }] });
  await warte(300);
  const tl = await js(`[${SB}.beruehrung.lenken, ${SB}.auto.lenk, ${SB}.beruehrung.gas]`);
  await cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await warte(200);
  const tw = await js(`[${SB}.beruehrung.gas, ${SB}.beruehrung.lenken]`);
  pruefe(tg > 60, "Touch: Gas halten beschleunigt (" + tg.toFixed(0) + " km/h nach 1,5 s)");
  pruefe(tl[0] > 0.6 && tl[1] > 0.2 && tl[2] === 1, "Touch: zweiter Finger rechts in der Lenkzone lenkt nach rechts (" + tl[0].toFixed(2) + "), Gas bleibt");
  pruefe(tw[0] === 0 && tw[1] === 0, "Touch: Finger weg, Gas und Lenkung los");
  const tb = await mitte("touch-turbo"), tz0 = await js(`${SB}.auto.zuendungen`);
  await cdp("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: gas[0], y: gas[1], id: 1 }, { x: tb[0], y: tb[1], id: 4 }] });
  await warte(700);
  const tzw = await js(`[${SB}.auto.zuendungen, ${SB}.auto.turbo > 0, document.getElementById("platte-tempo").classList.contains("turbo")]`);
  await fotoAls("m5/turbo-844x390-de.png");
  await cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await warte(200);
  pruefe(tzw[0] === tz0 + 1 && tzw[1] && tzw[2], "Touch: der Knopf Turbo rechts über dem Gas zündet, die Platte schimmert");
  const pz = await mitte("touch-pause");
  await cdp("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: pz[0], y: pz[1], id: 3 }] });
  await cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await warte(300);
  pruefe(await js(`${SB}.zustand === "pause" && document.getElementById("touch").hidden`), "Touch: Pause-Fläche hält an, die Bedienflächen verschwinden");

  console.log("Hochkant");
  await ansicht("hoch");
  await laden("");
  pruefe(await js(`!document.getElementById("quer").hidden`), "Handy hochkant: Hinweis „Bitte quer halten“");
  await fotoAls("m4/hochkant-hinweis-390-de.png");
  await trotzdem();
  pruefe(await js(`document.getElementById("quer").hidden && !document.getElementById("menue").hidden`), "„Trotzdem spielen“ führt ins Menü");
  await laden("?modus=frei");
  pruefe(await js(`${SB}.zustand === "pause" && !document.getElementById("quer").hidden`), "Fahrt beginnt hochkant angehalten, solange der Hinweis steht");
  await trotzdem();
  await js(`document.getElementById("weiter").click()`);
  const hochBild = await js(`(() => { const r = document.getElementById("leinwand").getBoundingClientRect(); return [Math.round(r.top), Math.round(r.width), !document.getElementById("touch").hidden]; })()`);
  pruefe(hochBild[1] >= 380 && hochBild[0] < 60 && hochBild[2], "Trotzdem hochkant: Bild oben in voller Breite (" + hochBild[1] + " px), Bedienflächen darunter");

  console.log("Fotos");
  // Je Ansicht Menü, Rennen und Ergebnis auf Deutsch; Englisch und Japanisch am Desktop dazu Menü quer;
  // jede Sehhilfe einmal mit Menü und Rennen am Desktop; Einstellungen und Pause.
  async function rennFoto(suche, datei, hoch) {
    await laden((suche ? suche + "&" : "?") + "modus=rennen&samen=3&strecke=moewenkap");
    if (hoch) { await trotzdem(); await js(`document.getElementById("weiter").click()`); }
    await js(SELBST_FAHREN);
    await bis(`${SB}.rennen.phase === "rennen" && ${SB}.rennen.spieler.zeit > 3.4`, 15000);
    await fotoAls(datei);
  }
  async function ergebnisFoto(suche, datei, hoch) {
    await laden((suche ? suche + "&" : "?") + "bot=1&zeitraffer=20&samen=5&strecke=moewenkap");
    if (hoch) { await trotzdem(); await js(`document.getElementById("weiter").click()`); }
    const ok = await bis(`${SB}.zustand === "ergebnis"`, 90000);
    await warte(500);
    if (ok) await fotoAls(datei);
    return ok;
  }
  for (const name of ["desktop", "quer", "hoch"]) {
    await ansicht(name);
    const b = name === "desktop" ? "1440" : name === "quer" ? "844x390" : "390x844";
    const hoch = name === "hoch";
    await laden("?strecke=moewenkap");
    if (hoch) await trotzdem();
    await fotoAls("m4/menue-" + b + "-de.png");
    const passt = await js(`(() => { const t = document.querySelector("#menue .innen").getBoundingClientRect(); return t.top >= 0 && t.bottom <= innerHeight + 1 && t.left >= 0 && t.right <= innerWidth + 1; })()`);
    pruefe(passt || hoch, name + ": Menü passt ganz ins Fenster ohne Rollen");
    await js(`document.getElementById("zu-einstellungen").click()`);
    await warte(200);
    await fotoAls("m4/einstellungen-" + b + "-de.png");
    await rennFoto("", "m4/rennen-" + b + "-de.png", hoch);
    if (name !== "desktop") pruefe(await js(`!document.getElementById("touch").hidden`), name + ": Bedienflächen im Rennen sichtbar");
    await js(`document.activeElement && document.activeElement.blur()`);
    await taste("Escape");
    await fotoAls("m4/pause-" + b + "-de.png");
    const ok = await ergebnisFoto("", "m4/ergebnis-" + b + "-de.png", hoch);
    const passtE = ok && await js(`(() => { const t = document.querySelector("#ergebnis .innen").getBoundingClientRect(); return t.top >= 0 && t.bottom <= innerHeight + 1; })()`);
    pruefe(ok && passtE, name + ": Ergebnis erreicht und ganz im Fenster");
  }
  await ansicht("desktop");
  for (const code of ["en", "ja"]) {
    await laden("?sprache=" + code + "&strecke=mondsenke");
    await fotoAls("m4/menue-1440-" + code + ".png");
    await rennFoto("?sprache=" + code, "m4/rennen-1440-" + code + ".png", false);
    const ok = await ergebnisFoto("?sprache=" + code, "m4/ergebnis-1440-" + code + ".png", false);
    const du = ok ? await js(`[...document.querySelectorAll("#ergebnis-zeilen tr.du td")].map((t) => t.textContent).join(" | ")`) : "";
    pruefe(ok && du.includes(await js(`Sprachen.text(${JSON.stringify(code)}, "du")`)), code + ": Ergebnis übersetzt (" + du + ")");
  }
  await ansicht("quer");
  for (const code of ["en", "ja"]) { await laden("?sprache=" + code + "&strecke=tannenjoch"); await fotoAls("m4/menue-844x390-" + code + ".png"); }
  await ansicht("desktop");
  for (const [modus, wert] of MODI) {
    await js(`localStorage.setItem("werkstatt.darstellung", ${JSON.stringify(wert)})`);
    await laden("?strecke=tannenjoch");
    await fotoAls("m4/menue-1440-" + modus + ".png");
    await rennFoto("", "m4/rennen-1440-" + modus + ".png", false);
  }
  await js(`localStorage.setItem("werkstatt.darstellung", "system")`);
  await laden("");

  // ---------------------------------------------------------------------------------------------
  // Meilenstein 5b, Streckenkarte
  // ---------------------------------------------------------------------------------------------
  console.log("Streckenkarte");
  await ansicht("desktop");
  await js(`localStorage.setItem("werkstatt.darstellung", "system")`);
  // Lage der Platten zueinander: überlappen sie, liegt die Karte im Bild, wie groß ist die Leinwand der Karte
  const LAGE = `(() => { const r = (e) => { const b = (typeof e === "string" ? document.getElementById(e) : e).getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; };
    const sichtbar = (e) => !e.hidden && getComputedStyle(e).display !== "none" && e.getBoundingClientRect().width > 0;
    const k = r("platte-karte"), bild = r("leinwand"), c = document.getElementById("karte");
    const andere = ["platte-stand", "platte-zeit", "platte-tempo", "ampel", "platte-bot"].map((id) => document.getElementById(id)).concat([...document.querySelectorAll("#touch .beruehr")]).filter(sichtbar);
    const ueber = andere.filter((e) => { const a = r(e); return a[0] < k[2] && a[2] > k[0] && a[1] < k[3] && a[3] > k[1]; }).map((e) => e.id);
    return { k, bild, ueber, breite: c.width, css: c.getBoundingClientRect().width, dpr: devicePixelRatio, zeiger: getComputedStyle(document.getElementById("platte-karte")).pointerEvents,
      aria: document.getElementById("platte-karte").getAttribute("aria-label") }; })()`;
  // Pixel einer Leinwand lesen, über eine Kopie mit willReadFrequently (sonst warnt der Browser beim wiederholten Lesen)
  const LIES = `((c) => { const k = window.__kopie || (window.__kopie = document.createElement("canvas")); k.width = c.width; k.height = c.height;
    const g = k.getContext("2d", { willReadFrequently: true }); g.drawImage(c, 0, 0); return g.getImageData(0, 0, k.width, k.height); })`;
  // Pixel der Karte: Pfeil an der festen Stelle, Linie der Strecke voraus. Der Pfeil verdeckt die ersten Pixel vor dir, darum wird die
  // Strecke von deinem Wagen aus nach vorn abgebildet, bis sie 9 Pixel vom Pfeil entfernt ist; dort muss die Linie gezeichnet sein (Farbe der
  // Linie in 3 × 3 Pixeln), und 3000 Einheiten voraus müssen oberhalb von dir liegen.
  const KARTE_PIXEL = `(() => { const c = document.getElementById("karte"), x = ${LIES}(c), st = ${SB}.karte, d = devicePixelRatio, k = ${SB}.kartenDaten, a = ${SB}.auto;
    const px = (u, v) => { const i = (Math.round(v) * x.width + Math.round(u)) * 4; return [x.data[i], x.data[i + 1], x.data[i + 2], x.data[i + 3]]; };
    const f = ${SB}.kartenFarben.mini.linie, soll = f.startsWith("#") ? [1, 3, 5].map((i) => parseInt(f.slice(i, i + 2), 16)) : f.match(/[0-9]+/g).slice(0, 3).map(Number);
    const bild = Karte.abbildung(k.punkt(a.z, a.x), st.winkel, Karte.massstabMini(k, c.width), st.cx, st.cy);
    let stelle = null; for (let dz = 500; dz < 90000 && !stelle; dz += 250) { const p = bild(k.punkt(a.z + dz, a.x)); if (Math.hypot(p[0] - st.cx, p[1] - st.cy) >= 9 * d) stelle = p; }
    let voraus = null; for (let v = -1; v <= 1; v++) for (let u = -1; u <= 1; u++) { const p = px(stelle[0] + u * d, stelle[1] + v * d);
      if (p[3] > 200 && Math.abs(p[0] - soll[0]) + Math.abs(p[1] - soll[1]) + Math.abs(p[2] - soll[2]) < 40) voraus = p; }
    const oben = bild(k.punkt(a.z + 3000, a.x))[1] < st.cy;
    return { winkel: st.winkel, cx: st.cx, cy: st.cy, pfeil: px(st.cx, st.cy), voraus: oben ? voraus : null, linie: soll, z: a.z, soll: Karte.winkelBei(k, a.z) }; })()`;
  const winkelAbstand = (a, b) => { const d = (b - a) % (2 * Math.PI); return d > Math.PI ? d - 2 * Math.PI : d < -Math.PI ? d + 2 * Math.PI : d; };
  for (const id of ["moewenkap", "mondsenke", "tannenjoch"]) {
    await laden("?modus=rennen&samen=3&zeitraffer=3&strecke=" + id);
    const lage = await js(LAGE);
    const imBild = lage.k[0] >= lage.bild[0] && lage.k[3] <= lage.bild[3] + 1 && lage.k[2] < (lage.bild[0] + lage.bild[2]) / 2 && lage.k[1] > (lage.bild[1] + lage.bild[3]) / 2;
    pruefe(imBild && !lage.ueber.length && lage.zeiger === "none", id + ": Karte unten links im Bild, überdeckt keine andere Platte, fängt keine Klicks (" + lage.k.map(Math.round).join(", ") + ")");
    pruefe(lage.breite === Math.round(lage.css * lage.dpr) && lage.css >= 120, id + ": Karte scharf in Gerätepixeln (" + lage.breite + " Pixel für " + lage.css.toFixed(1) + " CSS-Pixel)");
    // Foto im Rennen mit den Gegnern als Punkten
    await js(SELBST_FAHREN);
    await bis(`${SB}.rennen.phase === "rennen" && ${SB}.rennen.spieler.zeit > 10`, 20000);
    await fotoAls("m5/karte-" + id + "-1440-de.png");
    const r = await js(`(() => { const b = document.getElementById("platte-karte").getBoundingClientRect(); return { x: b.left - 16, y: b.top - 16, width: b.width + 32, height: b.height + 32, scale: 3 }; })()`);
    const nah = await cdp("Page.captureScreenshot", { format: "png", clip: r });
    fs.writeFileSync(path.join(ziel, "m5/karte-" + id + "-nah.png"), Buffer.from(nah.data, "base64"));
    // Über einige Sekunden im Zeitfahren (kein Gegner verdeckt die Linie): Winkel der Karte gleich der Richtung der Strecke an
    // deinem Wagen, du bleibst an derselben Stelle, die Strecke liegt voraus über dir
    await laden("?modus=zeitfahren&zeitraffer=3&strecke=" + id);
    await js(SELBST_FAHREN);
    const proben = [];
    for (let i = 0; i < 9; i++) { await warte(i ? 900 : 4000); proben.push(await js(KARTE_PIXEL)); }
    const stelle = proben.every((p) => p.cx === proben[0].cx && p.cy === proben[0].cy && p.cy > p.cx);
    const passt = proben.every((p) => Math.abs(winkelAbstand(p.winkel, p.soll)) < 0.12);
    const winkel = proben.map((p) => p.winkel), spanne = Math.max(...winkel.map((w) => Math.abs(winkelAbstand(winkel[0], w))));
    const voraus = proben.filter((p) => p.voraus).length;
    const pfeil = proben.filter((p) => p.pfeil[3] > 200 && p.pfeil[2] > p.pfeil[0]).length;
    pruefe(stelle && pfeil === proben.length, id + ": dein Pfeil steht immer an derselben Stelle etwas unter der Mitte (" + proben[0].cx + ", " + proben[0].cy.toFixed(1) + ")");
    pruefe(passt && spanne > 0.6, id + ": die Karte dreht sich mit der Fahrtrichtung (Winkel " + winkel.map((w) => w.toFixed(2)).join(" ") + ", größte Drehung " + (spanne * 180 / Math.PI).toFixed(0) + " Grad)");
    pruefe(voraus === proben.length, id + ": die Strecke voraus liegt über deinem Pfeil (" + voraus + " von " + proben.length + " Proben)");
  }
  // Ein Gegner dicht vor dir liegt im Umriss deines Pfeils und bleibt trotzdem als Punkt sichtbar (Punkte liegen über dem Pfeil)
  const dichtVorn = await js(`(() => { const c = Object.assign(document.createElement("canvas"), { width: 132, height: 132 }), x = c.getContext("2d", { willReadFrequently: true });
    const k = ${SB}.kartenDaten, a = ${SB}.auto, farbe = "rgb(230, 40, 40)";
    const st = Karte.zeichneMini(x, k, { breite: 132, hoehe: 132, d: 1, z: a.z, x: a.x, gegner: [{ z: a.z + 3000, x: a.x, farbe, nummer: 4 }], farben: ${SB}.kartenFarben.mini, nummern: false });
    const [gx, gy] = Karte.abbildung(k.punkt(a.z, a.x), st.winkel, Karte.massstabMini(k, 132), st.cx, st.cy)(k.punkt(a.z + 3000, a.x));
    const p = x.getImageData(Math.round(gx), Math.round(gy), 1, 1).data;
    return { abstand: Math.hypot(gx - st.cx, gy - st.cy), farbe: [p[0], p[1], p[2]] }; })()`);
  pruefe(dichtVorn.abstand < 5 && dichtVorn.farbe[0] > 180 && dichtVorn.farbe[1] < 90, "Gegner 3000 Einheiten vor dir liegt im Pfeil (" + dichtVorn.abstand.toFixed(1) + " Pixel von der Mitte) und bleibt als Punkt sichtbar (Farbe " + dichtVorn.farbe.join(",") + ")");
  // Ruhe: Winkel je Bild bei voller Fahrt ohne Zeitraffer durch das Hafen-S von Möwenkap, kein Zittern (kein Hin und Her
  // von Bild zu Bild; das S selbst dreht einmal um), höchstens wenige Grad je Bild
  await laden("?modus=frei&strecke=moewenkap&start=1820");
  await js(SELBST_FAHREN);
  await warte(2500);
  const ruhe = await js(`new Promise((fertig) => { const w = [], t0 = performance.now(); (function f() { w.push(${SB}.karte.winkel); if (performance.now() - t0 < 3000) requestAnimationFrame(f); else fertig(w); })(); })`);
  const schritte = ruhe.slice(1).map((w, i) => winkelAbstand(ruhe[i], w));
  const groesster = Math.max(...schritte.map(Math.abs));
  // Zittern hieße: die Drehung kehrt oft die Richtung um, obwohl sie sich deutlich bewegt
  let umkehr = 0;
  for (let i = 1; i < schritte.length; i++) if (Math.abs(schritte[i]) > 0.002 && Math.abs(schritte[i - 1]) > 0.002 && Math.sign(schritte[i]) !== Math.sign(schritte[i - 1])) umkehr++;
  const gesamt = schritte.reduce((s, x) => s + Math.abs(x), 0);
  pruefe(ruhe.length > 100 && groesster < 0.07 && umkehr <= 2 && gesamt > 0.3, "Drehung ruhig: " + ruhe.length + " Bilder in 3 s über die Hafenmole ins Hafen-S (links, dann rechts), gesamt " + (gesamt * 180 / Math.PI).toFixed(0) + " Grad, höchstens " + (groesster * 180 / Math.PI).toFixed(2) + " Grad je Bild, " + umkehr + " Richtungswechsel");
  // Über die Ziellinie: kein Sprung des Winkels (er wird nie aufaddiert)
  await laden("?modus=frei&strecke=mondsenke");
  await laden("?modus=frei&strecke=mondsenke&start=" + (await js(`${SB}.strecke.anzahl`) - 40));
  await js(SELBST_FAHREN);
  const naht = await js(`new Promise((fertig) => { const w = [], t0 = performance.now(); (function f() { w.push([${SB}.karte.winkel, ${SB}.auto.z]); if (performance.now() - t0 < 4000) requestAnimationFrame(f); else fertig(w); })(); })`);
  const ueberNaht = naht.some((p, i) => i && p[1] < naht[i - 1][1] - 1000);
  console.log("  Naht: z von " + Math.round(naht[0][1]) + " bis " + Math.round(naht.at(-1)[1]) + ", " + naht.length + " Bilder");
  const nahtSprung = Math.max(...naht.slice(1).map((p, i) => Math.abs(winkelAbstand(naht[i][0], p[0]))));
  pruefe(ueberNaht && nahtSprung < 0.05, "über die Ziellinie gedreht ohne Ruck (größter Schritt " + (nahtSprung * 180 / Math.PI).toFixed(2) + " Grad)");

  // Flimmer- und Zahlentakt mit Karte: Zahlen weiter nie unter 500 ms, die Karte ändert die Leuchtdichte der Platte nur langsam
  {
    await laden("?modus=frei&strecke=moewenkap&start=1602");
    await js(SELBST_FAHREN);
    await warte(1500);
    const m = await js(`new Promise((fertig) => { const zahl = [], mo = new MutationObserver(() => zahl.push(performance.now())); mo.observe(document.getElementById("tempo"), { childList: true, characterData: true, subtree: true });
      const c = document.getElementById("karte"), hell = [], t0 = performance.now();
      (function f() { const d = ${LIES}(c).data; let s = 0; for (let i = 0; i < d.length; i += 16) s += (d[i] + d[i + 1] + d[i + 2]) * d[i + 3] / 255; hell.push(s / (d.length / 16) / 765);
        if (performance.now() - t0 < 3000) requestAnimationFrame(f); else { mo.disconnect(); fertig({ zahl, hell }); } })(); })`);
    let min = Infinity; for (let i = 1; i < m.zahl.length; i++) min = Math.min(min, m.zahl[i] - m.zahl[i - 1]);
    let stufe = 0; for (let i = 1; i < m.hell.length; i++) stufe = Math.max(stufe, Math.abs(m.hell[i] - m.hell[i - 1]));
    pruefe(m.zahl.length >= 4 && min >= 499, "mit Karte: Tempo wechselt höchstens alle 0,5 s (" + m.zahl.length + " Wechsel, kleinster Abstand " + Math.round(min) + " ms)");
    pruefe(stufe < 0.01, "Karte flimmert nicht: mittlere Helligkeit ändert sich je Bild höchstens um " + stufe.toFixed(4) + " (Grenze 0,01)");
  }

  // Streckenwahl: drei Karten, still, Norden oben (der Start liegt auf einer senkrechten Geraden), je Strecke verschieden
  await laden("?strecke=moewenkap");
  const wahlK = await js(`(() => [...document.querySelectorAll("#streckenwahl canvas")].map((c) => { const d = ${LIES}(c).data; let n = 0, h = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && d[i] + d[i + 1] + d[i + 2] > 300) { n++; h = (h * 31 + i) % 1000003; }
    return { id: c.dataset.karte, breite: c.width, css: c.getBoundingClientRect().width, hell: n, h }; }))()`);
  await warte(1500);
  const wahlK2 = await js(`(() => [...document.querySelectorAll("#streckenwahl canvas")].map((c) => { const d = ${LIES}(c).data; let h = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && d[i] + d[i + 1] + d[i + 2] > 300) h = (h * 31 + i) % 1000003; return h; }))()`);
  pruefe(wahlK.length === 3 && wahlK.map((k) => k.id).join() === "moewenkap,mondsenke,tannenjoch" && wahlK.every((k) => k.hell > 300 && k.breite === Math.round(k.css)) && new Set(wahlK.map((k) => k.h)).size === 3,
    "Streckenwahl: drei Karten, jede mit eigener Linie (" + wahlK.map((k) => k.id + " " + k.hell + " helle Pixel").join(", ") + ")");
  pruefe(wahlK2.every((h, i) => h === wahlK[i].h), "Streckenwahl: die Karten stehen still (nach 1,5 s Pixel für Pixel gleich)");
  const norden = await js(`(() => { const k = Karte.erzeuge(${SB}.strecke), a = k.punkt(0), b = k.punkt(3000); return Math.abs(Math.atan2(b.x - a.x, b.y - a.y)); })()`);
  pruefe(norden < 0.01, "Streckenwahl: Norden oben, die Zielgerade zeigt dort genau nach oben (Abweichung " + norden.toFixed(4) + ")");
  await fotoAls("m5/streckenwahl-1440-de.png");

  // Handy quer: Karte rechts unter der Zeit, keine Überdeckung mit Bedienflächen oder Platten, Lenkzone frei
  await ansicht("quer");
  for (const modus of ["rennen", "zeitfahren"]) {
    await laden("?modus=" + modus + "&samen=3&strecke=moewenkap");
    await js(SELBST_FAHREN);
    await bis(`${SB}.rennen.phase === "rennen" && ${SB}.rennen.spieler.zeit > 5`, 20000);
    const lq = await js(LAGE);
    const rechts = lq.k[0] > (lq.bild[0] + lq.bild[2]) / 2 && lq.k[3] <= lq.bild[3] + 1 && lq.k[1] >= lq.bild[1];
    pruefe(rechts && !lq.ueber.length && lq.breite === Math.round(lq.css * lq.dpr) && lq.css > 70, "Handy quer, " + modus + ": Karte rechts unter der Zeit im Bild, überdeckt weder Lenkzone noch Knöpfe noch Platten (" + lq.css.toFixed(0) + " CSS-Pixel, " + lq.breite + " Gerätepixel" + (lq.ueber.length ? ", überdeckt " + lq.ueber.join(",") : "") + ", Lage " + lq.k.map(Math.round).join(",") + ")");
    if (modus === "rennen") await fotoAls("m5/karte-844x390-de.png");
  }
  await ansicht("hoch");
  await laden("?modus=frei&strecke=moewenkap");
  await trotzdem();
  await js(`document.getElementById("weiter").click()`);
  await warte(500);
  const lh = await js(LAGE);
  pruefe(!lh.ueber.length && lh.k[3] <= lh.bild[3] + 1, "Handy hochkant (trotzdem): Karte im Bild ohne Überdeckung");
  await ansicht("desktop");

  // Sehhilfen: Linie der Karte in der Schrift der Darstellung, Farbenblind mit Startnummern
  for (const [modus, wert] of [["hc-dunkel", "hc-dark"], ["hc-hell", "hc-light"], ["farbenblind", "cvd-dark"], ["umkehr", "invert"]]) {
    await js(`localStorage.setItem("werkstatt.darstellung", ${JSON.stringify(wert)})`);
    // Foto im Rennen (Farbenblind und Hoher Kontrast mit Startnummern), Linie im Zeitfahren gemessen (kein Gegner davor)
    await laden("?modus=rennen&samen=3&zeitraffer=3&strecke=mondsenke");
    await js(SELBST_FAHREN);
    await bis(`${SB}.rennen.phase === "rennen" && ${SB}.rennen.spieler.zeit > 9`, 20000);
    await fotoAls("m5/karte-1440-" + modus + ".png");
    await laden("?modus=zeitfahren&zeitraffer=3&strecke=mondsenke");
    await js(SELBST_FAHREN);
    await bis(`${SB}.rennen.phase === "rennen" && ${SB}.rennen.spieler.zeit > 9`, 20000);
    const p = await js(KARTE_PIXEL);
    const v = p.voraus || [0, 0, 0, 0], summe = v[0] + v[1] + v[2];
    // Hoher Kontrast dunkel: Linie in der hellen Schrift (#E0E0E0) auf Schwarz; hell: schwarze Linie auf weißer Platte; sonst helle Linie auf dunkler Platte
    const grund = await js(`getComputedStyle(document.getElementById("platte-karte")).backgroundColor`);
    const ok = !!p.voraus && (modus === "hc-dunkel" ? summe > 600 && grund === "rgb(0, 0, 0)" : modus === "hc-hell" ? summe < 60 && grund === "rgb(255, 255, 255)" : summe > 330);
    pruefe(ok, modus + ": Karte mit deutlicher Linie voraus (Linie " + p.linie.join(",") + ", gefunden " + (p.voraus ? v.slice(0, 3).join(",") : "nichts") + " auf " + grund + ")");
  }
  await js(`localStorage.setItem("werkstatt.darstellung", "system")`);

  // Sprachen: Beschriftung der Karte für Vorleseprogramme
  for (const code of ["de", "en", "ja"]) {
    await laden("?sprache=" + code + "&modus=frei&strecke=tannenjoch");
    const a = await js(`[document.getElementById("platte-karte").getAttribute("aria-label"), Sprachen.text(${JSON.stringify(code)}, "aria_karte")]`);
    pruefe(a[0] === a[1] && a[0].length > 20, code + ": Karte beschriftet (" + a[0] + ")");
  }

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
