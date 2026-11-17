// Prüfungen der Streckenlogik, der Fahrphysik und des Rennens, ohne Browser.
//
//   node tests/strecke.mjs
//
// Ausgabe: je Abschnitt die Zahl der Prüfungen, am Ende SUMME und Exit 0 (alles gut) oder 1.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.join(hier, "..");
const require = createRequire(import.meta.url);
const S = require(path.join(wurzel, "strecke.js"));
const P = require(path.join(wurzel, "physik.js"));
const R0 = require(path.join(wurzel, "rennen.js"));

const fehler = [];
let gesamt = 0;
let abschnittZaehler = 0;
let abschnittName = "";
const ausgabe = [];
function abschnitt(name) {
  if (abschnittName) ausgabe.push(`  ${abschnittName.padEnd(44)} ${abschnittZaehler} Prüfungen`);
  abschnittName = name;
  abschnittZaehler = 0;
}
function pruefe(bedingung, text) {
  gesamt++;
  abschnittZaehler++;
  if (!bedingung) fehler.push(`[${abschnittName}] ${text}`);
}

const L = S.KONST.SEGMENT_LAENGE;
const strecke = S.baue(S.PLAENE.moewenkap);
const seg = strecke.segmente;
// Für reine Gras-Prüfungen: dieselbe Strecke ohne Deko-Hindernisse
const ohneDeko = Object.assign({}, strecke, { hindernisse: null });

// --- Strecke --------------------------------------------------------------------
abschnitt("Strecke geschlossen");
pruefe(strecke.anzahl > 1000, "mehr als 1000 Segmente (" + strecke.anzahl + ")");
pruefe(strecke.laenge === strecke.anzahl * L, "Länge = Segmente mal Segmentlänge");
pruefe(seg[0].y1 === 0, "Start auf Höhe 0");
pruefe(Math.abs(seg[seg.length - 1].y2 - seg[0].y1) < 1e-9, "Ende auf derselben Höhe wie der Anfang (" + seg[seg.length - 1].y2 + ")");
let hoeheStetig = true, kurveSanft = true, groessterSprung = 0;
for (let i = 0; i < seg.length; i++) {
  const n = seg[(i + 1) % seg.length];
  if (Math.abs(seg[i].y2 - n.y1) > 1e-9) hoeheStetig = false;
  const sprung = Math.abs(n.kurve - seg[i].kurve);
  groessterSprung = Math.max(groessterSprung, sprung);
  if (sprung > 1.2) kurveSanft = false;
}
pruefe(hoeheStetig, "Höhe stetig von Segment zu Segment, auch über die Ziellinie");
pruefe(kurveSanft, "Kurven laufen sanft ein und aus (größter Sprung " + groessterSprung.toFixed(2) + ")");
pruefe(Math.abs(seg[0].kurve) < 1e-9 && Math.abs(seg[seg.length - 1].kurve) < 1e-9, "Ziellinie auf gerader Strecke");
const ende = strecke.karte.ende;
pruefe(Math.hypot(ende.x, ende.y) < L, "Karte: Ende fällt mit dem Anfang zusammen (Abstand " + Math.hypot(ende.x, ende.y).toFixed(1) + ")");
pruefe(Math.abs(ende.richtung - 2 * Math.PI) < 1e-9, "Karte: genau eine Umdrehung im Uhrzeigersinn");
pruefe(Math.abs(strecke.hoeheBei(strecke.laenge - 1) - strecke.hoeheBei(0)) < 50, "Höhe kurz vor und auf der Linie fast gleich");
pruefe(strecke.segment(-1).nr === strecke.anzahl - 1 && strecke.segment(strecke.laenge).nr === 0, "Segmentsuche läuft über die Runde hinaus");

abschnitt("Strecke enthält");
const stueckWinkel = (st) => {
  let s = 0;
  for (let i = st.von; i < st.bis; i++) s += seg[i].kurve;
  return (s * strecke.karte.proKurve * 180) / Math.PI;
};
const haarnadel = strecke.stuecke.find((st) => Math.abs(st.kurve) >= 7 && Math.abs(stueckWinkel(st)) >= 150);
pruefe(!!haarnadel, "eine Haarnadel (enge Kurve über mindestens 150 Grad)" + (haarnadel ? ": " + haarnadel.name + " " + stueckWinkel(haarnadel).toFixed(0) + " Grad" : ""));
let laengsteGerade = 0, lauf = 0;
for (let i = 0; i < seg.length * 2; i++) {
  if (Math.abs(seg[i % seg.length].kurve) < 1e-9) { lauf++; laengsteGerade = Math.max(laengsteGerade, lauf); } else lauf = 0;
}
pruefe(laengsteGerade >= 300, "eine lange Gerade, mindestens 300 Segmente (" + laengsteGerade + ")");
let schikane = false;
for (let i = 0; i < strecke.stuecke.length - 1; i++) {
  const a = strecke.stuecke[i], b = strecke.stuecke[i + 1];
  if (Math.abs(a.kurve) >= 4 && Math.abs(b.kurve) >= 4 && a.kurve * b.kurve < 0 && b.bis - a.von <= 60) schikane = true;
}
pruefe(schikane, "eine Schikane (zwei enge Gegenkurven direkt hintereinander)");
// Kuppen: Hochpunkte, hinter denen es mindestens 1500 Einheiten bergab geht und die man von unten anfährt
let kuppen = 0;
for (let i = 1; i < seg.length - 1; i++) {
  const y = seg[i].y2;
  if (y >= seg[i - 1].y2 && y > seg[i + 1].y2) {
    let vorMin = y, nachMin = y;
    for (let k = 1; k <= 120; k++) { vorMin = Math.min(vorMin, seg[(i - k + seg.length) % seg.length].y2); nachMin = Math.min(nachMin, seg[(i + k) % seg.length].y2); }
    if (y - nachMin >= 1500 && y - vorMin >= 1500) kuppen++;
  }
}
pruefe(kuppen >= 2, "mindestens zwei Kuppen (" + kuppen + ")");

abschnitt("Flimmerschutz der Wechselfarben");
function leuchtdichte(hex) {
  const n = parseInt(hex.slice(1), 16);
  const k = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * k[0] + 0.7152 * k[1] + 0.0722 * k[2];
}
function kontrast(a, b) {
  const la = leuchtdichte(a), lb = leuchtdichte(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
for (const name of ["gras", "randstein", "strasse"]) {
  const [a, b] = strecke.farben[name];
  const k = kontrast(a, b);
  pruefe(k < 1.25, name + ": Kontrast der Wechselfarben unter 1,25 (" + k.toFixed(3) + ")");
}
pruefe(strecke.streifen >= 3, "Farbfelder mindestens 3 Segmente lang (" + strecke.streifen + ")");

// --- Physik ----------------------------------------------------------------------
abschnitt("Physik deterministisch");
function fahrt(schritte) {
  const a = P.neuesAuto();
  for (let i = 0; i < schritte; i++) {
    // feste, aber abwechslungsreiche Eingaben: Gas, Lenken in Wellen, ab und zu Bremse
    const e = { gas: i % 400 < 330 ? 1 : 0, bremse: i % 400 >= 360 ? 1 : 0, lenken: Math.sin(i / 47) * (i % 3 === 0 ? 1 : 0.6) };
    P.schritt(a, e, strecke);
  }
  return JSON.stringify(a);
}
const lauf1 = fahrt(4000), lauf2 = fahrt(4000);
pruefe(lauf1 === lauf2, "zweimal gleiche Eingaben, gleicher Zustand nach 4000 Takten");
pruefe(JSON.parse(lauf1).z > 0, "das Auto ist dabei vorangekommen");
{
  const a = P.neuesAuto(), b = P.neuesAuto();
  const ua = { konto: 0 }, ub = { konto: 0 };
  let ta = 0, tb = 0;
  for (let i = 0; i < 144 * 3; i++) P.takt(ua, 1 / 144, () => { ta++; P.schritt(a, { gas: 1 }, strecke); });
  for (let i = 0; i < 60 * 3; i++) P.takt(ub, 1 / 60, () => { tb++; P.schritt(b, { gas: 1 }, strecke); });
  pruefe(ta === tb, "144 Hz und 60 Hz ergeben gleich viele Takte in 3 s (" + ta + " und " + tb + ")");
  pruefe(ta === tb && Math.abs(a.z - b.z) < 1e-6, "und dieselbe Strecke (" + a.z.toFixed(1) + " und " + b.z.toFixed(1) + ")");
  const uc = { konto: 0 };
  let tc = 0;
  P.takt(uc, 5, () => tc++);
  pruefe(tc === Math.floor(P.KONST.MAX_NACHHOLZEIT / P.KONST.TAKT + 1e-9), "Sprung von 5 s (Tab im Hintergrund) wird gedeckelt (" + tc + " Takte)");
}

abschnitt("Physik Fahrgefühl");
{
  const kurvenSeg = seg.find((g) => Math.abs(g.kurve - 8) < 1e-9);
  const messeFlieh = (anteil) => {
    const a = P.neuesAuto(kurvenSeg.z1 + 10, 0);
    a.tempo = anteil * P.KONST.HOECHST;
    P.schritt(a, { gas: 1 }, strecke);
    return a.flieh;
  };
  const voll = messeFlieh(1), halb = messeFlieh(0.5);
  pruefe(voll > 0 && Math.abs(voll / halb - 4) < 0.15, "Fliehkraft wächst mit dem Quadrat des Tempos (Verhältnis " + (voll / halb).toFixed(2) + ")");
  const a = P.neuesAuto(kurvenSeg.z1 + 10, 0);
  a.tempo = P.KONST.HOECHST;
  P.schritt(a, { gas: 1 }, strecke);
  pruefe(a.x < 0, "in der Rechtskurve trägt die Fliehkraft nach links außen");
  pruefe(P.grenzAnteil(8) < 0.5 && P.grenzAnteil(2) > 1, "Haarnadel nur langsam, flache Kurve voll fahrbar (" + P.grenzAnteil(8).toFixed(2) + ", " + P.grenzAnteil(2).toFixed(2) + ")");
}
{
  const a = P.neuesAuto(1000, 2);
  a.tempo = P.KONST.HOECHST;
  let tempo1s = 0;
  for (let i = 0; i < 180; i++) { P.schritt(a, { gas: 1 }, ohneDeko); if (i === 59) tempo1s = a.tempo; }
  const deckel = P.KONST.GRAS_HOECHST * P.KONST.HOECHST;
  pruefe(a.untergrund === "gras", "x = 2 liegt im Gras");
  pruefe(tempo1s < 0.5 * P.KONST.HOECHST, "Gras bremst stark: nach 1 s unter halbem Höchsttempo (" + Math.round(P.kmh(tempo1s)) + " km/h)");
  pruefe(a.tempo <= deckel + 1e-6, "Gras begrenzt das Höchsttempo (" + Math.round(P.kmh(a.tempo)) + " km/h)");
  const b = P.neuesAuto(1000, 2);
  for (let i = 0; i < 600; i++) P.schritt(b, { gas: 1 }, ohneDeko);
  pruefe(b.tempo <= deckel + 1e-6 && b.tempo > deckel * 0.9, "aus dem Stand im Gras nicht über das Grastempo");
}
{
  const strasse = P.neuesAuto(1000, 0), rand = P.neuesAuto(1000, 1.07);
  strasse.tempo = rand.tempo = 0.7 * P.KONST.HOECHST;
  for (let i = 0; i < 60; i++) { P.schritt(strasse, { gas: 1 }, strecke); P.schritt(rand, { gas: 1 }, strecke); }
  pruefe(rand.untergrund === "randstein", "x = 1,07 liegt auf dem Randstein");
  const verlust = (strasse.tempo - rand.tempo) / strasse.tempo;
  pruefe(verlust > 0 && verlust < 0.15, "Randstein bremst nur leicht (" + (verlust * 100).toFixed(1) + " % weniger nach 1 s)");
}
{
  const a = P.neuesAuto(1000, 0);
  for (let i = 0; i < 1200; i++) P.schritt(a, { gas: 1 }, strecke);
  pruefe(a.tempo <= P.KONST.HOECHST, "nie schneller als das Höchsttempo");
  const b = P.neuesAuto(1000, 0);
  b.tempo = P.KONST.HOECHST;
  let t = 0;
  while (b.tempo > 0 && t < 600) { P.schritt(b, { bremse: 1 }, strecke); t++; }
  pruefe(t / 60 > 0.8 && t / 60 < 2.5, "Vollbremsung aus Höchsttempo dauert 0,8 bis 2,5 s (" + (t / 60).toFixed(2) + " s)");
  const c = P.neuesAuto(1000, 0);
  c.tempo = P.KONST.HOECHST * 0.6;
  for (let i = 0; i < 6; i++) P.schritt(c, { gas: 1, lenken: 1 }, strecke);
  pruefe(c.lenk > 0.3 && c.lenk < 0.9, "Lenkung folgt mit Trägheit (nach 0,1 s Einschlag " + c.lenk.toFixed(2) + ")");
}
{
  // Rundenzeit auf den Bruchteil eines Takts: 1000 Einheiten vor der Linie mit Höchsttempo auf gerader, ebener Bahn
  const a = P.neuesAuto(strecke.laenge - 1000, 0);
  a.tempo = P.KONST.HOECHST;
  while (a.rundenZeiten.length === 0) P.schritt(a, { gas: 1 }, strecke);
  const soll = 1000 / P.KONST.HOECHST;
  pruefe(Math.abs(a.letzte - soll) < 1e-9, "Rundenzeit genau auf den Zeitpunkt der Linie (" + a.letzte.toFixed(5) + " statt " + soll.toFixed(5) + ")");
  pruefe(a.runde === 2 && a.beste === a.letzte, "Runde und Bestzeit fortgeschrieben");
}
{
  // Haarnadel im Fahrversuch statt nur über die Formel: Vollgas trägt ins Gras, und Bremsen ist schneller als das Gras.
  // Fahrt von 120 Segmenten davor bis 120 danach, Lenkung mit Vorsteuerung zur Innenseite.
  const hn = strecke.stuecke.find((st) => st.name === "Haarnadel am Leuchtturm");
  const fahrt = (bremsAb, vZiel, gasAb) => {
    const a = P.neuesAuto((hn.von - 120) * L, -0.9);
    a.tempo = P.KONST.HOECHST;
    let gras = 0;
    while (a.z < (hn.bis + 120) * L && a.zeit < 60) {
      const nr = strecke.segment(a.z).nr, k = strecke.segment(a.z).kurve;
      const bremsen = hn.von - nr <= bremsAb && nr < hn.von + gasAb && a.tempo > vZiel * P.KONST.HOECHST;
      const zielX = nr < hn.von ? -0.9 : nr < hn.bis ? 0.85 : 0;
      const vor = (P.KONST.FLIEHKRAFT * k * a.tempo / P.KONST.HOECHST) / P.KONST.LENKUNG;
      P.schritt(a, { gas: bremsen ? 0 : 1, bremse: bremsen ? 1 : 0, lenken: P.begrenze(vor + (zielX - a.x) * 3, -1, 1) }, strecke);
      if (a.untergrund === "gras") gras++;
    }
    return { zeit: a.zeit, gras };
  };
  const voll = fahrt(-1, 1, 0);
  let beste = null;
  for (let v = 0.3; v <= 0.6; v += 0.02) for (let b = 0; b <= 60; b += 4) for (const g of [0, 20, 40]) {
    const f = fahrt(b, v, g);
    if (f.gras === 0 && (!beste || f.zeit < beste.zeit)) beste = f;
  }
  pruefe(voll.gras > 60, "Haarnadel mit Vollgas trägt ins Gras (" + voll.gras + " Takte)");
  pruefe(!!beste && beste.zeit < voll.zeit - 0.3, "Haarnadel: Bremsen ist schneller als durchs Gras (" + (beste ? beste.zeit.toFixed(2) : "keine Fahrt ohne Gras") + " s gegen " + voll.zeit.toFixed(2) + " s)");
}

// --- Tempo, Rekuperation und E-Turbo (M5) -----------------------------------------
abschnitt("Höchsttempo und E-Turbo");
{
  const K = P.KONST;
  // Eine lange, ebene Gerade ohne Ende (nur das, was schritt() von einer Strecke braucht)
  const gerade = { laenge: 1e12, randstein: strecke.randstein, hindernisse: null, segment: () => ({ nr: 0, kurve: 0, y1: 0, y2: 0, z1: 0, z2: L }) };
  const kmh = (a) => P.kmh(a.tempo);
  const a = P.neuesAuto(0, 0);
  let max = 0, bis340 = null;
  for (let i = 0; i < 60 * 60; i++) { P.schritt(a, { gas: 1 }, gerade); max = Math.max(max, kmh(a)); if (bis340 == null && kmh(a) >= 340) bis340 = a.zeit; }
  pruefe(Math.abs(kmh(a) - 342) <= 2 && max <= 344, "ohne Turbo auf langer Gerade 342 km/h erreicht und nicht überschritten (" + kmh(a).toFixed(1) + ", höchstens " + max.toFixed(1) + " km/h, 340 nach " + (bis340 || 0).toFixed(1) + " s)");
  pruefe(Math.round(P.kmh(K.HOECHST)) === 342, "Anzeige rechnet das Höchsttempo als 342 km/h (" + P.kmh(K.HOECHST).toFixed(2) + ")");
  pruefe(a.akku === K.AKKU_START && K.AKKU_START === 0.5, "Akku startet halb voll und Gas allein lädt nicht (" + a.akku + ")");
  // Zünden mit vollem Akku bei 342 km/h: schneller bis etwa 365, danach wieder zurück
  a.akku = 1;
  let turboMax = 0, akkuMin = 1, akkuMax = 0, takteAn = 0;
  for (let i = 0; i < 60 * 9; i++) {
    P.schritt(a, { gas: 1, turbo: i < 30 }, gerade); // 0,5 s gehalten: zündet nur einmal
    turboMax = Math.max(turboMax, kmh(a)); akkuMin = Math.min(akkuMin, a.akku); akkuMax = Math.max(akkuMax, a.akku);
    if (a.turbo > 0) takteAn++;
  }
  pruefe(Math.abs(turboMax - 365) <= 5, "mit Turbo etwa 365 km/h (" + turboMax.toFixed(1) + ")");
  pruefe(a.zuendungen === 1 && Math.abs(takteAn / 60 - K.TURBO_DAUER) < 0.05, "gehaltene Taste zündet einmal, Schub " + (takteAn / 60).toFixed(2) + " s");
  pruefe(Math.abs(kmh(a) - 342) <= 2, "nach dem Schub wieder zurück auf 342 km/h (" + kmh(a).toFixed(1) + ")");
  pruefe(Math.abs(1 - a.akku - K.TURBO_VERBRAUCH * K.TURBO_DAUER) < 0.01 && akkuMin >= 0 && akkuMax <= 1, "Akku leert sich im Schub um " + (1 - a.akku).toFixed(3) + " und bleibt in 0 bis 1");
  // Ein leerer werdender Akku beendet den Schub früher
  const b = P.neuesAuto(0, 0);
  b.tempo = K.HOECHST; b.akku = 0.3;
  let bAn = 0;
  for (let i = 0; i < 60 * 4; i++) { P.schritt(b, { gas: 1, turbo: i === 0 }, gerade); if (b.turbo > 0) bAn++; }
  pruefe(b.akku === 0 && Math.abs(bAn / 60 - 0.3 / K.TURBO_VERBRAUCH) < 0.05, "Schub endet, wenn der Akku leer ist (" + (bAn / 60).toFixed(2) + " s bei 0,3 Ladung)");
  // Unter der Mindestladung zündet nichts
  const c = P.neuesAuto(0, 0);
  c.tempo = 0.8 * K.HOECHST; c.akku = K.TURBO_MIN - 0.01;
  P.schritt(c, { gas: 1, turbo: true }, gerade);
  pruefe(c.zuendungen === 0 && c.turbo === 0, "unter der Mindestladung " + K.TURBO_MIN + " zündet der Turbo nicht");
  const vorLinie = P.neuesAuto(0, 0);
  vorLinie.runde = 0; vorLinie.tempo = 0.5 * K.HOECHST;
  P.schritt(vorLinie, { gas: 1, turbo: true }, gerade);
  pruefe(vorLinie.zuendungen === 0, "in der Startaufstellung (Runde 0) zündet der Turbo nicht, erst ab der Linie");
  // Kein Dauerfeuer: nach einem Schub erst nach der Pause wieder, und nur mit neuem Druck
  const d = P.neuesAuto(0, 0);
  d.tempo = K.HOECHST; d.akku = 1;
  const drueck = (n) => { for (let i = 0; i < n; i++) P.schritt(d, { gas: 1, turbo: i % 2 === 0 }, gerade); }; // Taste flattert
  drueck(Math.round(60 * (K.TURBO_DAUER + K.TURBO_PAUSE * 0.5)));
  const mitten = d.zuendungen;
  drueck(Math.round(60 * K.TURBO_PAUSE));
  const h = P.neuesAuto(0, 0);
  h.tempo = K.HOECHST; h.akku = 1;
  for (let i = 0; i < 60 * 10; i++) P.schritt(h, { gas: 1, turbo: true }, gerade);
  pruefe(h.zuendungen === 1, "dauernd gehaltene Taste zündet in 10 s nur einmal (" + h.zuendungen + ")");
  pruefe(mitten === 1 && d.zuendungen === 2, "kein Dauerfeuer: während Schub und Pause keine zweite Zündung, danach wieder (" + mitten + ", " + d.zuendungen + ")");
  // Turbo im vollen Windschatten (Faktor 1,045): höchstens 365 km/h, ohne Turbo bleibt der Windschatten wie er ist
  const w = P.neuesAuto(0, 0);
  w.hoechstFaktor = 1.045;
  for (let i = 0; i < 60 * 60; i++) P.schritt(w, { gas: 1 }, gerade);
  const wOhne = kmh(w);
  w.akku = 1;
  let wMax = 0;
  for (let i = 0; i < 60 * 4; i++) { P.schritt(w, { gas: 1, turbo: i === 0 }, gerade); wMax = Math.max(wMax, kmh(w)); }
  pruefe(wMax <= 365.5 && wMax >= 362 && wOhne > 355, "Turbo im vollen Windschatten höchstens 365 km/h (" + wMax.toFixed(1) + ", ohne Turbo " + wOhne.toFixed(1) + ")");
}
abschnitt("Rekuperation");
{
  const K = P.KONST;
  const gerade = { laenge: 1e12, randstein: strecke.randstein, hindernisse: null, segment: () => ({ nr: 0, kurve: 0, y1: 0, y2: 0, z1: 0, z2: L }) };
  const fahre = (x, tempo, eingabe, takte, st) => {
    const a = P.neuesAuto(1000, x);
    a.tempo = tempo; a.akku = 0.3;
    for (let i = 0; i < takte; i++) P.schritt(a, eingabe, st || gerade);
    return a;
  };
  const bremst = fahre(0, 0.9 * K.HOECHST, { bremse: 1 }, 60);
  const abbau = 0.9 * K.HOECHST - bremst.tempo;
  const erwartet = 0.3 + (K.REKU_BREMSE * Math.min(abbau, K.BREMSE) + K.REKU_ROLLEN * K.ROLLEN) / K.HOECHST;
  pruefe(bremst.akku > 0.3 + 0.2 && Math.abs(bremst.akku - erwartet) < 0.02, "Bremsen lädt aus dem Tempoabbau (" + (bremst.akku - 0.3).toFixed(3) + " nach 1 s Vollbremsung von 308 km/h, erwartet " + (erwartet - 0.3).toFixed(3) + ")");
  const gas = fahre(0, 0.5 * K.HOECHST, { gas: 1 }, 120);
  pruefe(gas.akku === 0.3, "Gas lädt nicht (" + gas.akku + ")");
  const rollt = fahre(0, 0.9 * K.HOECHST, {}, 60);
  pruefe(rollt.akku > 0.3 && rollt.akku - 0.3 < (bremst.akku - 0.3) / 3, "Rollen ohne Gas lädt etwas, deutlich weniger als Bremsen (" + (rollt.akku - 0.3).toFixed(3) + ")");
  const gras = fahre(2, 0.6 * K.HOECHST, { bremse: 1 }, 60, ohneDeko);
  pruefe(gras.untergrund === "gras" && gras.akku === 0.3, "im Gras lädt nichts (" + gras.akku + ")");
  const steht = fahre(0, 0, { bremse: 1 }, 120);
  pruefe(steht.akku === 0.3, "im Stand mit Bremse lädt nichts");
  // Gas und Bremse zugleich (analoge Trigger am Gamepad): geladen wird nur, was die Bremse über das Gas hinaus abbaut
  const kriecht = fahre(0, 0, { gas: 1, bremse: 0.49 }, 600);
  const haelt = fahre(0, 0.39 * K.HOECHST, { gas: 1, bremse: 0.3 }, 600);
  const beides = fahre(0, 0.9 * K.HOECHST, { gas: 1, bremse: 1 }, 60);
  pruefe(kriecht.akku === 0.3 && haelt.akku === 0.3, "Gas mit halb gedrückter Bremse lädt nicht, auch nicht über 10 s (" + kriecht.akku + " bei " + P.kmh(kriecht.tempo).toFixed(1) + " km/h, " + haelt.akku + " bei " + P.kmh(haelt.tempo).toFixed(0) + " km/h)");
  pruefe(beides.akku > 0.3 + 0.1 && beides.akku < bremst.akku, "Gas mit voller Bremse lädt aus dem echten Abbau, weniger als Bremse allein (" + (beides.akku - 0.3).toFixed(3) + ")");
  const v2 = P.neuesAuto(1000, 0); v2.tempo = K.HOECHST; v2.akku = 0.99;
  for (let i = 0; i < 120; i++) P.schritt(v2, { bremse: 1 }, gerade);
  pruefe(v2.akku === 1, "der Akku wird nie voller als 1");
}
abschnitt("Turbo deterministisch");
{
  function fahrtTurbo() {
    const a = P.neuesAuto();
    for (let i = 0; i < 6000; i++) {
      const e = P.botEingabe(a, strecke, 0.9);
      e.turbo = i % 700 === 300 || i % 700 === 301;
      P.schritt(a, e, strecke);
    }
    return JSON.stringify(a);
  }
  const t1 = fahrtTurbo(), t2 = fahrtTurbo();
  pruefe(t1 === t2 && JSON.parse(t1).zuendungen >= 3, "zweimal gleiche Eingaben mit Turbo, gleicher Zustand nach 6000 Takten (" + JSON.parse(t1).zuendungen + " Zündungen)");
  const r1 = R0.neu(strecke, { modus: "rennen", runden: 3, samen: 4 }), r2 = R0.neu(strecke, { modus: "rennen", runden: 3, samen: 4 });
  for (let i = 0; i < 60 * 70; i++) { R0.schritt(r1, null); R0.schritt(r2, null); }
  pruefe(JSON.stringify(r1.autos.map((x) => [x.z, x.tempo, x.akku, x.zuendungen])) === JSON.stringify(r2.autos.map((x) => [x.z, x.tempo, x.akku, x.zuendungen])) && r1.autos.some((x) => x.zuendungen > 0), "Rennen mit zündenden Gegnern läuft bei gleichem Samen gleich");
}

// --- Bot -----------------------------------------------------------------------
abschnitt("Bot fährt Runden");
function botRennen(vorsicht, maxZeit, runden) {
  const a = P.neuesAuto();
  let steht = 0, maxSteht = 0, gras = 0, takte = 0;
  while (a.rundenZeiten.length < runden && a.zeit < maxZeit) {
    P.schritt(a, P.botEingabe(a, strecke, vorsicht), strecke);
    takte++;
    if (a.zeit > 3 && a.tempo < 0.05 * P.KONST.HOECHST) { steht++; maxSteht = Math.max(maxSteht, steht); } else steht = 0;
    if (a.untergrund === "gras") gras++;
  }
  return { a, maxSteht, gras, takte };
}
const r = botRennen(0.9, 300, 3);
pruefe(r.a.rundenZeiten.length >= 2, "mindestens 2 Runden in 300 s (" + r.a.rundenZeiten.length + ")");
pruefe(r.maxSteht === 0, "bleibt nie stecken (Takte unter 5 % Tempo nach dem Start: " + r.maxSteht + ")");
pruefe(r.gras === 0, "kommt nicht ins Gras (" + r.gras + " Takte)");
for (const [i, t] of r.a.rundenZeiten.entries()) pruefe(t >= 45 && t <= 70, "Runde " + (i + 1) + " im Zielfenster 45 bis 70 s (" + t.toFixed(2) + " s)");
const vorsichtig = botRennen(0.75, 300, 2);
pruefe(vorsichtig.a.rundenZeiten.length >= 2 && vorsichtig.maxSteht === 0, "auch ein vorsichtiger Bot schafft 2 Runden (" + vorsichtig.a.rundenZeiten.map((t) => t.toFixed(1)).join(", ") + " s)");
pruefe(Math.max(...vorsichtig.a.rundenZeiten) <= 70, "vorsichtige Runden bleiben unter 70 s");
const b1 = botRennen(0.9, 120, 1), b2 = botRennen(0.9, 120, 1);
pruefe(b1.a.letzte === b2.a.letzte, "Bot fährt zweimal exakt gleich (" + b1.a.letzte.toFixed(3) + " s)");

// --- Rennen ----------------------------------------------------------------------
const R = require(path.join(wurzel, "rennen.js"));
const RK = R.KONST;

abschnitt("Rennen: Fahrer und Aufstellung");
{
  pruefe(R.FAHRER.length === 7, "7 Gegner (" + R.FAHRER.length + ")");
  pruefe(new Set(R.FAHRER.map((f) => f.name)).size === 7, "Namen verschieden");
  pruefe(new Set(R.FAHRER.map((f) => f.nummer)).size === 7 && R.FAHRER.every((f) => f.nummer > 0 && f.nummer < 100), "Startnummern verschieden, ein- oder zweistellig");
  pruefe(new Set([...R.FAHRER.map((f) => f.farbe), R.SPIELER.farbe]).size === 8, "acht verschiedene Farben");
  // Farben auch ohne Farbsehen etwas auseinander: Leuchtdichte nicht bei allen gleich (die Nummer trägt die Unterscheidung)
  const hell = R.FAHRER.map((f) => leuchtdichte(f.farbe));
  pruefe(Math.max(...hell) / Math.min(...hell) > 2, "Grundfarben unterscheiden sich auch in der Helligkeit (" + Math.min(...hell).toFixed(3) + " bis " + Math.max(...hell).toFixed(3) + ")");
  const r = R.neu(strecke, { modus: "rennen", runden: 3, samen: 1 });
  pruefe(r.autos.length === 8 && r.spieler === r.autos[0] && r.spieler.istSpieler, "8 Autos, das erste bist du");
  pruefe(r.spieler.startPlatz === RK.SPIELER_PLATZ && RK.SPIELER_PLATZ === 6, "du startest von Platz 6");
  const plaetze = r.autos.map((a) => a.startPlatz).sort((a, b) => a - b).join(",");
  pruefe(plaetze === "1,2,3,4,5,6,7,8", "Startplätze 1 bis 8 je einmal");
  const reihe = R.platzierung(r).map((a) => a.startPlatz).join(",");
  pruefe(reihe === "1,2,3,4,5,6,7,8", "Platzierung vor dem Start folgt der Aufstellung");
  pruefe(r.autos.every((a) => a.runde === 0 && a.z > strecke.laenge / 2), "alle stehen hinter der Ziellinie (Runde 0)");
  let frei = true;
  for (const a of r.autos) for (const b of r.autos) if (a !== b && Math.abs(R.abstand(a, b, strecke.laenge)) < RK.AUTO_LAENGE && Math.abs(a.x - b.x) < RK.AUTO_BREITE) frei = false;
  pruefe(frei, "in der Aufstellung berührt sich niemand");
}

abschnitt("Rennen: Startampel");
{
  const r = R.neu(strecke, { modus: "rennen", runden: 3, samen: 7 });
  const z0 = r.autos.map((a) => a.z);
  const folge = [];
  let takte = 0;
  while (r.phase === "ampel" && takte < 60 * 20) {
    R.schritt(r, { gas: 1, bremse: 0, lenken: 0 });
    takte++;
    const an = r.ampel.aus ? 0 : r.ampel.an;
    if ((folge.length ? folge[folge.length - 1].an : 0) !== an) folge.push({ an, t: r.zeit });
  }
  const anFolge = folge.map((f) => f.an).join(",");
  pruefe(anFolge === "1,2,3,4,5,0", "Lichter 1 bis 5 nacheinander an, dann alle zusammen aus (" + anFolge + ")");
  const takt = folge.slice(1, 5).every((f, i) => Math.abs(f.t - folge[i].t - RK.AMPEL_TAKT) < 0.02);
  pruefe(takt, "ein Licht je Sekunde (kein schnelles Wechseln)");
  const pause = folge[5].t - folge[4].t;
  pruefe(pause >= RK.AMPEL_PAUSE[0] - 0.02 && pause <= RK.AMPEL_PAUSE[1] + 0.02, "alle fünf stehen " + pause.toFixed(2) + " s, dann aus");
  pruefe(r.autos.every((a, i) => a.z === z0[i] && a.tempo === 0), "während der Ampel bewegt sich kein Auto, auch nicht mit Gas");
  pruefe(r.phase === "rennen" && r.ampel.aus, "danach läuft das Rennen");
  R.schritt(r, { gas: 1, bremse: 0, lenken: 0 });
  pruefe(r.spieler.tempo > 0, "mit dem Erlöschen fährt man los");
}

abschnitt("Rennen: Windschatten, Gummiband, Berührung");
{
  // Windschatten: dicht hinter einem anderen Auto auf gleicher Spur
  const r = R.neu(strecke, { modus: "rennen", runden: 3, samen: 1 });
  r.phase = "rennen";
  const [a, b] = r.autos;
  r.autos.slice(2).forEach((c, i) => { c.z = (strecke.laenge / 2 + i * 5000) % strecke.laenge; });
  a.z = 1000; a.x = 0; b.z = 1000 + 1000; b.x = 0.05;
  R.motor(r, a);
  const wDicht = a.windschatten;
  b.x = 0.7;
  R.motor(r, a);
  const wDaneben = a.windschatten;
  b.x = 0.05; b.z = 1000 + RK.WIND_BIS + 500;
  R.motor(r, a);
  const wWeit = a.windschatten;
  pruefe(wDicht > 0.5, "1000 Einheiten hinter einem Auto: Windschatten " + wDicht.toFixed(2));
  pruefe(wDaneben === 0 && wWeit === 0, "seitlich versetzt oder weit weg: kein Windschatten");
  // Wirkung: mit vollem Windschatten über das Höchsttempo hinaus, ohne nicht
  const mit = P.neuesAuto(1000, 0), ohne = P.neuesAuto(1000, 0);
  mit.tempo = ohne.tempo = P.KONST.HOECHST;
  mit.hoechstFaktor = 1 + RK.WIND_PLUS;
  for (let i = 0; i < 120; i++) { P.schritt(mit, { gas: 1 }, strecke); P.schritt(ohne, { gas: 1 }, strecke); }
  pruefe(mit.tempo > P.KONST.HOECHST * 1.01 && ohne.tempo <= P.KONST.HOECHST, "Windschatten hebt das Höchsttempo (" + Math.round(P.kmh(mit.tempo)) + " statt " + Math.round(P.kmh(ohne.tempo)) + " km/h)");
  mit.hoechstFaktor = 1;
  for (let i = 0; i < 120; i++) P.schritt(mit, { gas: 1 }, strecke);
  pruefe(mit.tempo <= P.KONST.HOECHST + 1e-6, "ohne Windschatten rollt es wieder auf das Höchsttempo zurück");

  // Gummiband: höchstens GUMMI nach oben oder unten
  const g = R.neu(strecke, { modus: "rennen", runden: 3, samen: 1 });
  g.phase = "rennen";
  const ki = g.autos[1];
  g.autos.forEach((c, i) => { c.runde = 1; c.z = i * 20000; c.x = (i % 2) * 0.8 - 0.4; });
  g.spieler.z = 300000;
  const hinten = R.motor(g, ki) / ki.fahrer.motor;
  g.spieler.z = 0; ki.z = 300000;
  const vorn = R.motor(g, ki) / ki.fahrer.motor;
  // fester Deckel 3 % (Briefing: Gummiband nur sanft), nicht die Konstante selbst, sonst prüfte sich der Test gegen sich
  pruefe(hinten > 1 && hinten <= 1.03 + 1e-9 && vorn < 1 && vorn >= 0.97 - 1e-9, "Gummiband wirkt, aber höchstens 3 % (" + ((hinten - 1) * 100).toFixed(1) + " % und " + ((vorn - 1) * 100).toFixed(1) + " %)");
  pruefe(Math.abs(R.motor(g, g.spieler) - 1) < 1e-9, "für dich gibt es kein Gummiband");

  // Berührung von hinten: der Hintere bremst, danach überlappen sie nicht mehr
  const k = R.neu(strecke, { modus: "rennen", runden: 3, samen: 1 });
  k.autos.slice(2).forEach((c, i) => { c.z = (strecke.laenge / 2 + i * 5000) % strecke.laenge; });
  const [h, v] = k.autos;
  h.z = 5000; h.x = 0.1; h.tempo = 9000;
  v.z = 5300; v.x = 0; v.tempo = 6000;
  R.beruehrungen(k);
  pruefe(h.tempo <= v.tempo, "Auffahren: der Hintere wird nicht schneller als der Vordere (" + Math.round(h.tempo) + ", " + Math.round(v.tempo) + ")");
  pruefe(R.abstand(v, h, strecke.laenge) >= RK.AUTO_LAENGE - 1e-6, "danach mit Abstand hintereinander");
  // nebeneinander: zur Seite geschoben
  h.z = 9000; v.z = 9100; h.x = 0.1; v.x = 0.25; h.tempo = v.tempo = 8000;
  R.beruehrungen(k);
  pruefe(Math.abs(h.x - v.x) >= RK.AUTO_BREITE - 1e-6 && h.x < v.x, "Seitenkontakt: auseinandergeschoben (" + h.x.toFixed(2) + ", " + v.x.toFixed(2) + ")");
  pruefe(h.tempo > 7500 && v.tempo > 7500, "Seitenkontakt kostet nur wenig Tempo");
}

let rennInfo = "";
abschnitt("Rennen: ganze Rennen mit Bot");
{
  // Bezug: der Bot allein mit demselben Mut wie am Steuer des Spielers
  const bezug = P.neuesAuto();
  while (bezug.rundenZeiten.length < 2) P.schritt(bezug, P.botEingabe(bezug, strecke, RK.BOT_MUT), strecke);
  const botRunde = bezug.rundenZeiten[1];
  let alleFertig = true, eindeutig = true, zeitenSteigen = true, maxKontakt = 0, kontaktTakte = 0, takteGesamt = 0;
  let maxGras = 0, ueberholt = 0, kiMin = Infinity, kiMax = 0, zuLang = false;
  const spielerPlaetze = [];
  for (const samen of [1, 2, 3, 4, 5, 6]) {
    const r = R.neu(strecke, { modus: "rennen", runden: 3, samen });
    const gras = new Array(8).fill(0);
    let vorher = null;
    while (r.phase !== "ziel" && r.zeit < 400) {
      R.schritt(r, null);
      takteGesamt++;
      for (const a of r.autos) {
        maxKontakt = Math.max(maxKontakt, a.kontakt);
        if (a.kontaktJetzt) kontaktTakte++;
        if (a.untergrund === "gras") gras[a.nr]++;
      }
      if (r.phase === "rennen") {
        const ord = R.platzierung(r).filter((a) => !a.istSpieler).map((a) => a.nr);
        if (vorher) for (let i = 0; i < ord.length; i++) if (ord[i] !== vorher[i]) { ueberholt++; break; }
        vorher = ord;
      }
    }
    if (r.zeit >= 400) zuLang = true;
    if (!R.zuEndeFahren(r, 600)) alleFertig = false;
    const e = R.ergebnis(r);
    if (e.map((z) => z.platz).join(",") !== "1,2,3,4,5,6,7,8" || new Set(e.map((z) => z.name)).size !== 8) eindeutig = false;
    for (let i = 1; i < e.length; i++) if (!(e[i].gesamt >= e[i - 1].gesamt)) zeitenSteigen = false;
    for (const z of e) if (!z.istSpieler) { kiMin = Math.min(kiMin, z.beste); kiMax = Math.max(kiMax, z.beste); }
    spielerPlaetze.push(e.find((z) => z.istSpieler).platz);
    maxGras = Math.max(maxGras, ...gras);
  }
  pruefe(!zuLang, "jedes Rennen endet für dich in unter 400 s");
  pruefe(alleFertig, "in allen 6 Rennen kommen alle 8 Autos ins Ziel");
  pruefe(eindeutig, "Platzierungen 1 bis 8 eindeutig, acht verschiedene Fahrer");
  pruefe(zeitenSteigen, "Gesamtzeiten passen zur Reihenfolge");
  pruefe(maxKontakt < 60, "niemand verkeilt sich: längste Berührung " + maxKontakt + " Takte (unter 1 s)");
  pruefe(kontaktTakte / takteGesamt < 0.5, "Berührungen selten (" + kontaktTakte + " Auto-Takte in " + takteGesamt + " Takten)");
  pruefe(maxGras < 60 * 4, "Gegner fahren höchstens kurz durchs Gras (längstens " + (maxGras / 60).toFixed(1) + " s je Rennen)");
  pruefe(ueberholt >= 6, "Gegner überholen einander (" + ueberholt + " Wechsel in 6 Rennen)");
  pruefe(kiMin >= botRunde * 0.93 && kiMax <= botRunde * 1.08, "beste KI-Runden " + kiMin.toFixed(2) + " bis " + kiMax.toFixed(2) + " s, im Band 93 bis 108 % der Bot-Runde " + botRunde.toFixed(2) + " s");
  pruefe(Math.min(...spielerPlaetze) < RK.SPIELER_PLATZ, "der Bot an deiner Stelle kann überholen (Plätze " + spielerPlaetze.join(", ") + ")");
  rennInfo = "6 Rennen: dein Bot auf Platz " + spielerPlaetze.join(", ") + "; KI-Bestrunden " + kiMin.toFixed(2) + " bis " + kiMax.toFixed(2) +
    " s (Bot allein " + botRunde.toFixed(2) + " s); längste Berührung " + maxKontakt + " Takte; " + ueberholt + " Platzwechsel unter Gegnern";
  const a1 = R.neu(strecke, { modus: "rennen", runden: 3, samen: 9 }), a2 = R.neu(strecke, { modus: "rennen", runden: 3, samen: 9 });
  for (const r of [a1, a2]) { while (r.phase !== "ziel") R.schritt(r, null); R.zuEndeFahren(r, 600); }
  pruefe(JSON.stringify(R.ergebnis(a1)) === JSON.stringify(R.ergebnis(a2)), "gleicher Samen, gleiches Rennen");
  const r5 = R.neu(strecke, { modus: "rennen", runden: 5, samen: 2 });
  while (r5.phase !== "ziel" && r5.zeit < 600) R.schritt(r5, null);
  pruefe(r5.spieler.rundenZeiten.length === 5 && R.zuEndeFahren(r5, 600), "auch über 5 Runden kommen alle an");
}

abschnitt("Zeitfahren");
{
  const r = R.neu(strecke, { modus: "zeitfahren", runden: 3, samen: 1 });
  pruefe(r.autos.length === 1, "allein auf der Strecke");
  pruefe(r.phase === "ampel", "auch das Zeitfahren beginnt mit der Ampel");
  while (r.phase !== "ziel" && r.zeit < 300) R.schritt(r, null);
  const a = r.spieler;
  pruefe(a.fertig && a.rundenZeiten.length === 3, "3 gezeitete Runden, dann Ziel");
  pruefe(a.rundenZeiten[0] < a.zeit && a.rundenZeiten[0] > 40, "die erste Runde beginnt erst an der Linie (mit Anlauf, " + a.rundenZeiten[0].toFixed(2) + " s)");
  pruefe(a.beste === Math.min(...a.rundenZeiten), "beste Runde stimmt");
}

// --- Drei Strecken ------------------------------------------------------------------
const streckenInfo = [];
for (const id of S.REIHE) {
  abschnitt("Strecke " + id);
  const st = S.baue(S.PLAENE[id]);
  const g = st.segmente;
  pruefe(st.id === id && st.name && st.kurz, "Name und Beschreibung (" + st.name + ", " + st.kurz + ")");
  pruefe(Math.hypot(st.karte.ende.x, st.karte.ende.y) < L, "Karte geschlossen (Abstand " + Math.hypot(st.karte.ende.x, st.karte.ende.y).toFixed(1) + ")");
  pruefe(Math.abs(Math.abs(st.karte.ende.richtung) - 2 * Math.PI) < 1e-9, "genau eine Umdrehung (" + (st.karte.ende.richtung > 0 ? "im" : "gegen den") + " Uhrzeigersinn)");
  let stetig = true, sprung = 0;
  for (let i = 0; i < g.length; i++) {
    const n = g[(i + 1) % g.length];
    if (Math.abs(g[i].y2 - n.y1) > 1e-9) stetig = false;
    sprung = Math.max(sprung, Math.abs(n.kurve - g[i].kurve));
  }
  pruefe(stetig && Math.abs(g[g.length - 1].y2 - g[0].y1) < 1e-9, "Höhe stetig, auch über die Ziellinie");
  pruefe(sprung <= 1.2, "Kurven laufen sanft ein und aus (größter Sprung " + sprung.toFixed(2) + ")");
  pruefe(Math.abs(g[0].kurve) < 1e-9 && Math.abs(g[g.length - 1].kurve) < 1e-9 && g.slice(-40).every((x) => x.kurve === 0), "Start und Ziel auf gerader Strecke (Startaufstellung)");
  for (const name of ["gras", "randstein", "strasse"]) {
    const [a, b] = st.farben[name];
    pruefe(kontrast(a, b) < 1.25, name + ": Kontrast der Wechselfarben unter 1,25 (" + kontrast(a, b).toFixed(3) + ")");
  }
  // Bot: zwei Runden ohne Gras, ohne Aufprall, im Zeitfenster
  const a = P.neuesAuto();
  let gras = 0, steht = 0;
  while (a.rundenZeiten.length < 2 && a.zeit < 300) {
    P.schritt(a, P.botEingabe(a, st, 0.9), st);
    if (a.untergrund === "gras") gras++;
    if (a.zeit > 3 && a.tempo < 0.05 * P.KONST.HOECHST) steht++;
  }
  pruefe(a.rundenZeiten.length === 2 && steht === 0, "Bot fährt 2 Runden, ohne stecken zu bleiben");
  pruefe(gras === 0 && a.stoesse === 0, "Bot bleibt auf der Straße (Gras " + gras + " Takte, Aufpralle " + a.stoesse + ")");
  pruefe(a.rundenZeiten.every((t) => t >= 45 && t <= 75), "Runden im Zielfenster 45 bis 75 s (" + a.rundenZeiten.map((t) => t.toFixed(2)).join(", ") + " s)");
  // Echte Bremskurven: mindestens eine Kurve verlangt Bremsen
  const grenzen = P.kurvenGrenzen(st);
  const bremskurven = grenzen.kurven.filter((k) => grenzen.grenze[k.von] < 0.8).length;
  pruefe(bremskurven >= 1, "mindestens eine echte Bremskurve (" + bremskurven + ")");
  // Deko
  const arten = {};
  for (const d of st.deko) arten[d.art] = (arten[d.art] || 0) + 1;
  pruefe(st.deko.length >= 300, "Deko gesetzt (" + st.deko.length + ": " + Object.entries(arten).map(([k, v]) => k + " " + v).join(", ") + ")");
  pruefe(["bruecke", "tribuene", "schild", "laterne"].every((k) => arten[k] > 0), "Brücke, Tribünen, Pfeiltafeln und Laternen vorhanden");
  const aufDerStrasse = st.deko.filter((d) => d.art !== "bruecke" && Math.abs(d.x) - d.breite / 2 < 1 + st.randstein + 0.1);
  pruefe(aufDerStrasse.length === 0, "keine Deko auf Fahrbahn oder Randstein (" + aufDerStrasse.length + ")");
  let schilderOk = true;
  for (const k of st.stuecke) {
    if (Math.abs(k.kurve) < 3.5) continue;
    const vor = st.deko.filter((d) => d.art === "schild" && Math.sign(d.x) === -Math.sign(k.kurve) && (k.von - d.seg + st.anzahl) % st.anzahl <= 15);
    if (vor.length < 3 || !vor.every((d) => d.spiegel === k.kurve < 0)) schilderOk = false;
  }
  pruefe(schilderOk, "vor jeder engen Kurve drei Pfeiltafeln außen, Pfeil in Kurvenrichtung");
  const hind = st.hindernisse.reduce((n, h) => n + (h ? h.length : 0), 0);
  pruefe(hind > 0 && st.hindernisse.every((h) => !h || h.every((d) => Math.abs(d.x) - d.breite / 2 <= S.KONST.HINDERNIS_BIS)), "Hindernisse nur nahe der Fahrbahn (" + hind + " Einträge)");
  // Ein Rennen mit Bot und 7 Gegnern
  const r = R.neu(st, { modus: "rennen", runden: 3, samen: 1 });
  let akkuMin = 1, akkuMax = 0, schnellst = 0;
  while (r.phase !== "ziel" && r.zeit < 500) {
    R.schritt(r, null);
    for (const x of r.autos) { akkuMin = Math.min(akkuMin, x.akku); akkuMax = Math.max(akkuMax, x.akku); schnellst = Math.max(schnellst, x.tempo); }
  }
  const zuend = r.autos.map((x) => x.zuendungen);
  pruefe(akkuMin >= 0 && akkuMax <= 1, "Akku aller Autos im ganzen Rennen in 0 bis 1 (" + akkuMin.toFixed(2) + " bis " + akkuMax.toFixed(2) + ")");
  pruefe(zuend.slice(1).every((n) => n > 0) && zuend[0] > 0, "jeder Gegner und der Bot an deiner Stelle zünden den Turbo (" + zuend.join(", ") + ")");
  const stile = {};
  r.autos.slice(1).forEach((x) => { (stile[x.fahrer.turbo] = stile[x.fahrer.turbo] || []).push(x); });
  const sparerFrueh = (stile.spart || []).every((x) => x.zuendungen <= Math.max(...(stile.draengt || []).map((y) => y.zuendungen)));
  pruefe(Object.keys(stile).length >= 4 && sparerFrueh, "verschiedene Fahrstile (" + Object.keys(stile).join(", ") + "), Sparer zünden nicht öfter als Drängler");
  pruefe(P.kmh(schnellst) > 345 && P.kmh(schnellst) < 375, "im Rennen fährt jemand mit Turbo über 342 km/h (" + P.kmh(schnellst).toFixed(1) + ")");
  const alle = R.zuEndeFahren(r, 600);
  const e = R.ergebnis(r);
  pruefe(alle && e.map((z) => z.platz).join(",") === "1,2,3,4,5,6,7,8", "Rennen über 3 Runden: alle 8 kommen an, Plätze eindeutig");
  pruefe(e.every((z, i) => i === 0 || z.gesamt >= e[i - 1].gesamt), "Gesamtzeiten passen zur Reihenfolge");
  streckenInfo.push(st.name + ": " + st.anzahl + " Segmente, Bot " + a.rundenZeiten.map((t) => t.toFixed(2)).join(" / ") + " s, Deko " + st.deko.length +
    ", Rennen: dein Bot Platz " + e.find((z) => z.istSpieler).platz + ", Sieger " + e[0].gesamt.toFixed(2) + " s, Aufpralle " + r.autos.reduce((n, x) => n + x.stoesse, 0) + ", Zündungen " + zuend.join("/"));
}

abschnitt("Deko-Aufprall");
{
  // Ein Auto fährt neben der Straße genau auf eine Palme zu
  const palme = strecke.deko.find((d) => d.art === "palme" && strecke.hindernisse[d.seg] && Math.abs(d.x) < 2.2 && d.seg > 200);
  const fahre = (st) => {
    const a = P.neuesAuto((palme.seg - 6) * L, palme.x);
    a.tempo = 0.3 * P.KONST.HOECHST;
    const vorher = a.tempo;
    let tiefst = Infinity, maxX = 0;
    for (let i = 0; i < 40; i++) { P.schritt(a, { gas: 1 }, st); tiefst = Math.min(tiefst, a.tempo); maxX = Math.max(maxX, Math.abs(a.x)); }
    return { a, vorher, tiefst, maxX };
  };
  const mit = fahre(strecke), ohne = fahre(ohneDeko);
  pruefe(!!palme, "eine Palme nahe der Fahrbahn gefunden (x " + (palme ? palme.x.toFixed(2) : "-") + ")");
  pruefe(mit.a.stoesse === 1, "Aufprall gezählt (" + mit.a.stoesse + ")");
  pruefe(mit.tiefst < mit.vorher * 0.6, "Aufprall kostet Tempo (" + Math.round(P.kmh(mit.vorher)) + " auf " + Math.round(P.kmh(mit.tiefst)) + " km/h)");
  pruefe(Math.abs(mit.a.x - palme.x) >= palme.breite / 2 + P.KONST.AUTO_HALB, "abgeprallt: danach nicht mehr in der Palme (x " + mit.a.x.toFixed(2) + ")");
  pruefe(mit.maxX <= P.KONST.RAND_AUSSEN + 1e-9, "Abprall bleibt innerhalb des Rands");
  pruefe(ohne.a.stoesse === 0 && ohne.tiefst >= ohne.vorher * 0.9, "Gegenprobe ohne Deko: kein Aufprall, kaum Tempoverlust");
}

abschnitt("Rutschen (Reifenklang)");
{
  const hn = strecke.stuecke.find((st) => st.name === "Haarnadel am Leuchtturm");
  const a = P.neuesAuto((hn.von + 30) * L, 0);
  a.tempo = 0.9 * P.KONST.HOECHST;
  P.schritt(a, { gas: 1 }, strecke);
  const b = P.neuesAuto(1000, 0);
  b.tempo = P.KONST.HOECHST;
  P.schritt(b, { gas: 1 }, strecke);
  const c = P.neuesAuto((hn.von + 30) * L, 0);
  // langsam heißt: knapp unter dem Grenztempo dieser Stelle (seit M5 aus der Kurve selbst statt 40 % des Höchsttempos,
  // weil das Höchsttempo stieg und die Fliehkraft stärker wurde)
  c.tempo = 0.95 * P.grenzAnteil(strecke.segment(c.z).kurve) * P.KONST.HOECHST;
  P.schritt(c, { gas: 1 }, strecke);
  pruefe(a.rutschen > 0.9, "Haarnadel viel zu schnell: Reifen rutschen voll (" + a.rutschen.toFixed(2) + ")");
  pruefe(b.rutschen === 0, "Gerade mit Höchsttempo: kein Rutschen");
  pruefe(c.rutschen < 0.5, "Haarnadel langsam: wenig Rutschen (" + c.rutschen.toFixed(2) + ")");
}

abschnitt("Ton: Automatik und Drehzahl");
{
  const T = require(path.join(wurzel, "ton.js"));
  const G = T.KONST.GAENGE;
  pruefe(G.length === 7, "sieben Gänge");
  let gang = 1, wechsel = [], minFall = Infinity, maxDreh = 0, unterLeerlauf = false;
  let vorherDreh = T.drehzahl(0, 1);
  for (let a = 0; a <= 1.045; a += 0.001) {
    const neu = T.gangFuer(a, gang);
    const dreh = T.drehzahl(a, neu);
    if (neu !== gang) { wechsel.push(neu); minFall = Math.min(minFall, (vorherDreh - dreh) / vorherDreh); }
    gang = neu; vorherDreh = dreh;
    maxDreh = Math.max(maxDreh, dreh);
    if (dreh < T.KONST.LEERLAUF) unterLeerlauf = true;
  }
  pruefe(wechsel.join(",") === "2,3,4,5,6,7", "beim Beschleunigen 1 bis 7 nacheinander (" + wechsel.join(",") + ")");
  pruefe(minFall > 0.15, "beim Hochschalten fällt die Drehzahl hörbar, mindestens 15 % (" + (minFall * 100).toFixed(0) + " %)");
  pruefe(maxDreh <= T.KONST.DREH_MAX * 1.02 && !unterLeerlauf, "Drehzahl zwischen Leerlauf und Höchstdrehzahl (" + Math.round(maxDreh) + ")");
  // kein Pendeln: Tempo zittert um einen Schaltpunkt
  let g2 = T.gangFuer(G[2] * T.KONST.HOCH_BEI + 0.001, 3), pendel = 0;
  for (let i = 0; i < 200; i++) { const n = T.gangFuer(G[2] * T.KONST.HOCH_BEI + (i % 2 ? 0.004 : -0.004), g2); if (n !== g2) pendel++; g2 = n; }
  pruefe(pendel <= 1, "kein Pendeln zwischen zwei Gängen am Schaltpunkt (" + pendel + " Wechsel)");
  let g3 = 7;
  for (let a = 1; a >= 0; a -= 0.002) g3 = T.gangFuer(a, g3);
  pruefe(g3 === 1, "beim Bremsen bis zum Stand zurück in den ersten Gang");
}

// --- Streckenkarte (karte.js) ---------------------------------------------------------
abschnitt("Streckenkarte");
{
  const K = require(path.join(wurzel, "karte.js"));
  const grad = (w) => (w * 180) / Math.PI;
  // Ein Zeichenblatt ohne Browser: merkt sich Linien, Punkte und Schrift
  function blatt() {
    const log = { linie: [], text: [], fuellung: [] };
    const ctx = {
      log, setTransform() {}, clearRect() {}, fillRect() {}, beginPath() {}, closePath() {}, stroke() {}, fill() { log.fuellung.push(this.fillStyle); }, save() {}, restore() {},
      translate() {}, rotate() {}, arc() {}, moveTo(x, y) { log.linie.push([x, y]); }, lineTo(x, y) { log.linie.push([x, y]); },
      strokeText() {}, fillText(s, x, y) { log.text.push(s); }, measureText(s) { return { width: s.length * 5 }; },
      createLinearGradient() { return { addColorStop() {} }; },
    };
    return ctx;
  }
  const FARBEN = { saum: "#000", saumBreite: 5, linie: "#888", linieBreite: 2, ziel: "#fff", zielBreite: 2, du: "#3f8f93", duRand: "#fff", ring: "#000", hof: "#000", nummer: "#fff", schrift: "serif", pfeil: "#d58a4e" };
  pruefe(Math.abs(K.winkelAbstand(3.1, -3.1) - (2 * Math.PI - 6.2)) < 1e-9 && Math.abs(K.winkelAbstand(-3.1, 3.1) + (2 * Math.PI - 6.2)) < 1e-9, "Winkelabstand über ±π hinweg ist der kurze Weg");
  for (const id of S.REIHE) {
    const s = S.baue(S.PLAENE[id]), k = K.erzeuge(s);
    const lang = s.laenge;
    // Linie geschlossen und ohne Sprung an der Ziellinie
    const a = k.punkt(lang - 25), b = k.punkt(25), c = k.punkt(0), e = k.punkt(lang);
    pruefe(Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - 50) < 0.5 && Math.hypot(c.x - e.x, c.y - e.y) < 1e-6, id + ": Kartenlinie an der Ziellinie geschlossen, ohne Sprung");
    pruefe(k.linie.length > 1000 && k.spanne > 100000, id + ": " + k.linie.length + " Punkte, Ausdehnung " + Math.round(k.spanne) + " Einheiten");
    // Drehung stetig über die ganze Runde und über die Naht, gleich nach einer Runde, nahe an der Fahrtrichtung
    let groesste = 0, abweichung = 0, vorher = K.winkelBei(k, -3000);
    for (let z = -2950; z <= lang + 3000; z += 50) {
      const w = K.winkelBei(k, z);
      groesste = Math.max(groesste, Math.abs(K.winkelAbstand(vorher, w)));
      vorher = w;
      if (z >= 0 && z < lang) abweichung = Math.max(abweichung, Math.abs(K.winkelAbstand(w, s.richtungBei(z))));
    }
    pruefe(grad(groesste) < 1.5, id + ": Karte dreht stetig, höchstens " + grad(groesste).toFixed(2) + " Grad je 50 Einheiten, auch über die Naht");
    pruefe(Math.abs(K.winkelAbstand(K.winkelBei(k, 777), K.winkelBei(k, 777 + lang))) < 1e-9 && Math.abs(K.winkelAbstand(K.winkelBei(k, -10), K.winkelBei(k, 10))) < 0.01, id + ": Winkel an der Ziellinie und eine Runde später gleich");
    pruefe(grad(abweichung) < 3, id + ": Kartenrichtung höchstens " + grad(abweichung).toFixed(2) + " Grad von der Fahrtrichtung entfernt");
    // Abbildung: du in der festen Mitte, vorn ist oben, hinten unten, rechts rechts
    let vornOben = 0, hintenUnten = 0, rechts = 0, mitte = 0, n = 0;
    for (let z = 0; z < lang; z += 997) {
      n++;
      const ich = k.punkt(z, 0.3), bild = K.abbildung(ich, K.winkelBei(k, z), 0.001, 66, 79);
      const [mx, my] = bild(ich), [vx, vy] = bild(k.punkt(z + 1200, 0.3)), [hx, hy] = bild(k.punkt(z - 1200, 0.3)), [rx] = bild(k.punkt(z, 1));
      if (Math.abs(mx - 66) < 1e-9 && Math.abs(my - 79) < 1e-9) mitte++;
      if (vy < 79 - 1 && Math.abs(vx - 66) < Math.abs(79 - vy) * 0.36) vornOben++; // höchstens 20 Grad schräg, auch in der Haarnadel
      if (hy > 79 + 1) hintenUnten++;
      if (rx > 66) rechts++;
    }
    pruefe(mitte === n && vornOben === n && hintenUnten === n && rechts === n, id + ": an " + n + " Stellen steht dein Wagen fest in der Mitte, die Strecke voraus oben, dahinter unten, rechts rechts");
    // Zeichnen ohne Browser: Minikarte liefert den Winkel und die feste Stelle, Übersicht passt ganz in ihr Feld
    const st = K.zeichneMini(blatt(), k, { breite: 132, hoehe: 132, d: 1, z: 12345, x: 0, gegner: [], farben: FARBEN, nummern: false });
    pruefe(st.cx === 66 && Math.abs(st.cy - 132 * K.KONST.MITTE_Y) < 1e-9 && st.cy > 66 && st.winkel === K.winkelBei(k, 12345), id + ": Minikarte mit dir etwas unter der Mitte (" + st.cy.toFixed(1) + " von 132)");
    const ub = blatt();
    K.zeichneUebersicht(ub, k, { breite: 200, hoehe: 112, d: 1, farben: FARBEN });
    // die Punkte der Linie und des Zielstrichs (der Pfeil zeichnet in eigenen, gedrehten Koordinaten)
    const drin = ub.log.linie.slice(0, k.linie.length + 2).every(([x, y]) => x >= 0 && x <= 200 && y >= 0 && y <= 112);
    pruefe(ub.log.linie.length > k.linie.length && drin, id + ": Übersicht mit Linie, Start und Ziel und Pfeil ganz im Feld");
    // Norden oben: die Zielgerade (Richtung 0) läuft in der Übersicht genau senkrecht nach oben
    const [p0, p1] = ub.log.linie;
    pruefe(Math.abs(p0[0] - p1[0]) < 0.01 && p1[1] < p0[1] - 0.1, id + ": Übersicht steht mit Norden oben (Zielgerade senkrecht nach oben)");
  }
  // Startnummern: zwei Gegner an derselben Stelle zeigen nur eine Nummer, und eine Nummer wechselt höchstens alle 0,5 s
  {
    const s = S.baue(S.PLAENE.moewenkap), k = K.erzeuge(s);
    const ansicht = (gegner, zeit, stand) => ({ breite: 132, hoehe: 132, d: 1, z: 50000, x: 0, gegner, farben: FARBEN, nummern: true, stand, zeit });
    const fern = (dz, nr) => ({ z: 50000 + dz, x: 0, farbe: "#888", nummer: nr });
    let c = blatt();
    K.zeichneMini(c, k, ansicht([fern(30000, 4), fern(30000, 7)], 0, {}));
    pruefe(c.log.text.length === 1, "zwei Gegner übereinander: nur eine Startnummer (" + c.log.text.join(",") + ")");
    c = blatt();
    K.zeichneMini(c, k, ansicht([fern(30000, 4), fern(-30000, 7)], 0, {}));
    pruefe(c.log.text.join(",") === "4,7" || c.log.text.join(",") === "7,4", "zwei Gegner auseinander: beide Startnummern");
    const stand = {};
    const zeige = (dz7, zeit) => { const b = blatt(); K.zeichneMini(b, k, ansicht([fern(30000, 4), fern(dz7, 7)], zeit, stand)); return b.log.text.includes("7"); };
    const folge = [zeige(-30000, 0), zeige(30000, 0.1), zeige(30000, 0.3), zeige(30000, 0.6), zeige(-30000, 0.7), zeige(-30000, 1.2)];
    pruefe(folge.join() === "true,true,true,false,false,true", "Startnummer verschwindet und kommt wieder frühestens nach 0,5 s (" + folge.join() + ")");
    // Ein Gegner 3000 Einheiten vor dir liegt im Umriss deines Pfeils: sein Punkt kommt nach dem Pfeil aufs Bild, sonst wäre er verdeckt
    const vorn = blatt();
    const lage = K.zeichneMini(vorn, k, ansicht([{ z: 53000, x: 0, farbe: "#e02020", nummer: 4 }], 0, {}));
    const [gx, gy] = K.abbildung(k.punkt(50000, 0), lage.winkel, K.massstabMini(k, 132), lage.cx, lage.cy)(k.punkt(53000, 0));
    const imPfeil = Math.abs(gx - lage.cx) < 3 && gy < lage.cy && gy > lage.cy - 6.2;
    const pfeilAn = vorn.log.fuellung.indexOf(FARBEN.du), punktAn = vorn.log.fuellung.lastIndexOf("#e02020");
    pruefe(imPfeil && pfeilAn >= 0 && punktAn > pfeilAn, "Gegner 3000 Einheiten vor dir (" + (lage.cy - gy).toFixed(1) + " Pixel über deiner Mitte, im Pfeil) wird über deinem Pfeil gezeichnet");
  }
}

// --- Texte und Dateien --------------------------------------------------------------
abschnitt("Sprachen");
{
  const SP = require(path.join(wurzel, "sprachen.js"));
  const de = SP.TEXTE.de, schluessel = Object.keys(de).sort();
  const platzhalter = (t) => (t.match(/\{\w+\}/g) || []).sort().join(" ");
  pruefe(SP.SPRACHEN.length === 14 && SP.SPRACHEN.every((s) => SP.TEXTE[s.code]), "14 Sprachen, jede mit Texten");
  pruefe(SP.SPRACHEN.map((s) => s.code).join(" ") === "de en es fr it nl pl pt tr ru hi zh ja ko", "dieselben 14 Sprachen wie Kugelblitz, gleiche Reihenfolge");
  for (const s of SP.SPRACHEN) {
    const t = SP.TEXTE[s.code], k = Object.keys(t).sort();
    pruefe(k.join() === schluessel.join(), s.code + ": dieselben " + schluessel.length + " Schlüssel wie Deutsch" + (k.join() !== schluessel.join() ? " (fehlt: " + schluessel.filter((x) => !t[x]).join(",") + ")" : ""));
    const anders = schluessel.filter((x) => t[x] !== undefined && platzhalter(t[x]) !== platzhalter(de[x]));
    pruefe(!anders.length, s.code + ": dieselben Platzhalter" + (anders.length ? " (" + anders.join(",") + ")" : ""));
    pruefe(k.every((x) => typeof t[x] === "string" && t[x].trim().length > 0), s.code + ": kein Text leer");
    pruefe(/^\d:\d\d[.,]\d\d$/.test(SP.zeit(s.code, 83.456, 2)) && SP.zeit(s.code, 83.456, 2).endsWith(SP.komma(s.code) + "46"), s.code + ": Rundenzeit mit Dezimalzeichen der Sprache (" + SP.zeit(s.code, 83.456, 2) + ")");
  }
  // Englisch übersetzt wirklich (kein deutscher Text stehen geblieben, außer Namen und Abkürzungen)
  const gleich = schluessel.filter((x) => SP.TEXTE.en[x] === de[x] && !/^(kmh|strecke_text|sekunden|st_touch|st_pad|rekord|pause|darst_normal|touch_gas)$/.test(x));
  pruefe(!gleich.length, "Englisch weicht überall vom Deutschen ab (gleich: " + gleich.join(",") + ")");
  // Jeder Schlüssel, den index.html über data-i nennt, steht in den Texten
  const html = fs.readFileSync(path.join(wurzel, "index.html"), "utf8");
  const genannt = [...html.matchAll(/data-i(?:-aria)?="(\w+)"/g)].map((m) => m[1]);
  const fehlend = genannt.filter((x) => de[x] === undefined);
  pruefe(genannt.length > 30 && !fehlend.length, "alle " + genannt.length + " Schlüssel aus index.html vorhanden" + (fehlend.length ? " (fehlt: " + fehlend.join(",") + ")" : ""));
  for (const id of S.REIHE) pruefe(de["kurz_" + id] !== undefined, "Beschreibung der Strecke " + id + " übersetzt");
  pruefe(SP.erkenne(null, ["fr-CA"]) === "fr" && SP.erkenne(null, ["sv"]) === "en" && SP.erkenne("ja", ["de"]) === "ja", "Erkennung: fr-CA wird fr, Unbekanntes Englisch, gespeicherte Wahl zuerst");
  pruefe(SP.text("de", "angekommen", { n: 3, m: 8 }) === "Du bist auf Platz 3 von 8 angekommen.", "Platzhalter werden gefüllt");
}

abschnitt("Texte und Dateien");
function dateien(ordner) {
  const liste = [];
  for (const e of fs.readdirSync(ordner, { withFileTypes: true })) {
    if ([".git", "_intern", "fotos", "node_modules", "schrift", ".claude"].includes(e.name)) continue;
    const p = path.join(ordner, e.name);
    if (e.isDirectory()) liste.push(...dateien(p));
    else if (/\.(html|js|mjs|css|json|webmanifest|svg|md|txt)$/.test(e.name) || e.name === ".gitignore") liste.push(p);
  }
  return liste;
}
const alle = dateien(wurzel);
pruefe(alle.length >= 6, "mindestens 6 Textdateien gefunden (" + alle.length + ")");
const STRICHE = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]");
const PFAD = /[A-Za-z]:[\\/]+Users[\\/]/i;
for (const d of alle) {
  const text = fs.readFileSync(d, "utf8");
  const name = path.relative(wurzel, d);
  const zeile = text.split("\n").findIndex((z) => STRICHE.test(z));
  pruefe(zeile < 0, name + ": keine Gedankenstriche" + (zeile >= 0 ? " (Zeile " + (zeile + 1) + ")" : ""));
  pruefe(!PFAD.test(text), name + ": kein Benutzerpfad");
}

abschnitt("");
console.log("Streckenblitz, Logik ohne Browser (" + strecke.name + ", " + strecke.anzahl + " Segmente, Runde " + (strecke.laenge / 1000).toFixed(1) + " tausend Einheiten)");
console.log(ausgabe.join("\n"));
console.log("  Bot-Runden: " + r.a.rundenZeiten.map((t) => t.toFixed(2) + " s").join(", "));
console.log("  " + rennInfo);
for (const z of streckenInfo) console.log("  " + z);
console.log(`\nSUMME: ${gesamt} Prüfungen, ${fehler.length} Fehler`);
if (fehler.length) {
  console.log("\n" + fehler.join("\n"));
  process.exit(1);
}
