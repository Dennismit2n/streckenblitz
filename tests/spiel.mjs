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
const VK = { Escape: 27, KeyP: 80, KeyZ: 90, KeyR: 82, KeyT: 84, Enter: 13, Digit5: 53, ArrowRight: 39, ArrowLeft: 37 };
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
    k.setze({ aktiv: false, anteil: 0.8, gas: 1, rutschen: 1, stoesse: 0, gegner: [] }, 0);
    const d = (await ac.startRendering()).getChannelData(0);
    let m = 0; for (let i = 11025; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
    return m; })()`);
  pruefe(stille < 0.002, "nicht aktiv (Menü, Pause, Ziel): stumm (Spitze " + stille.toFixed(4) + ")");

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
    pruefe(andere === "noch keiner", "Bestzeit gilt je Strecke: Mondsenke hat noch keine");
    pruefe(await js(`document.querySelector('[data-strecke="moewenkap"] .karten-rekord').textContent`) === await js(`(() => { const t = Number(localStorage.getItem("streckenblitz.rekord.moewenkap")); const h = Math.round(t * 100); return Math.floor(h / 6000) + ":" + String(Math.floor(h / 100) % 60).padStart(2, "0") + "." + String(h % 100).padStart(2, "0"); })()`), "Menü zeigt den gespeicherten Rekord");
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
  const MESSUNG = `(gr, st, startSeg) => {
    const P = window.Physik, B = 427, H = 240, N = 120;
    const lin = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const v = i / 255; lin[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    const a = P.neuesAuto(startSeg * 200, 0);
    a.tempo = P.KONST.HOECHST;
    const reihen = Array.from({ length: 13 }, () => new Float64Array(N));
    const lese = document.createElement("canvas");
    lese.width = B; lese.height = H;
    const ctx = lese.getContext("2d", { willReadFrequently: true });
    let tempoMin = Infinity;
    for (let f = 0; f < N; f++) {
      P.schritt(a, { gas: 1, bremse: 0, lenken: P.botEingabe(a, st, 1).lenken }, st);
      tempoMin = Math.min(tempoMin, a.tempo);
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
    return { kmh: Math.round(tempoMin * 0.026), mittel: +mittel(reihen[12]).toFixed(4), ganzAmp: +ganz.amp.toFixed(5), ganzHz: ganz.hz,
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
