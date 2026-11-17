/*
 * Streckenblitz: Fahrphysik, Runden und Bot
 *
 * Arcade, keine Simulation: Das Auto hat eine Stelle z entlang der Strecke, eine Querlage x
 * (x = ±1 ist der Fahrbahnrand), ein Tempo und einen Lenkeinschlag mit Trägheit.
 *  - Feste Taktung 1/60 s mit Zeitkonto (takt), damit 144-Hz-Bildschirme nicht schneller fahren.
 *    Großer Rückstand (Tab im Hintergrund) wird verworfen.
 *  - Fliehkraft proportional zu Kurve mal Tempo zum Quadrat, Lenkwirkung proportional zum Tempo:
 *    Daraus folgt für jede Kurve ein Grenztempo, über dem man nach außen getragen wird.
 *  - Gras bremst stark und begrenzt das Tempo, Randsteine bremsen leicht, bergauf kostet Tempo.
 *  - Automatik: Gas beschleunigt mit zum Höchsttempo hin abnehmender Kraft.
 *  - Runden werden beim Überfahren der Ziellinie auf den Bruchteil eines Takts genau gestoppt.
 *  - Ein Bot liefert Eingaben wie ein Spieler (Gegner-KI und Tests bauen darauf auf).
 *
 * Eingabe: { gas: 0..1, bremse: 0..1, lenken: -1..1 } (analog, damit später ein Gamepad passt).
 * Die Datei läuft im Browser (window.Physik) und unter Node (require), ohne DOM.
 */
(function (wurzel, fabrik) {
  if (typeof module === "object" && module.exports) module.exports = fabrik();
  else wurzel.Physik = fabrik();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const KONST = Object.freeze({
    TAKT: 1 / 60,            // Physik-Takt in Sekunden
    MAX_NACHHOLZEIT: 0.25,   // mehr Rückstand je Bild wird verworfen
    HOECHST: 12000,          // Höchsttempo in Welteinheiten je Sekunde
    KMH: 0.026,              // Anzeige: Welteinheiten je Sekunde mal KMH ergibt km/h (Höchsttempo 312)
    BESCHLEUNIGUNG: 4200,    // Schub aus dem Stand, nimmt zum Höchsttempo hin ab
    SCHUB_REST: 0.12,        // Anteil des Schubs, der beim Höchsttempo übrig bleibt
    BREMSE: 8500,
    ROLLEN: 1400,            // Verzögerung ohne Gas und Bremse
    LENKUNG: 2.1,            // Querweg in halben Fahrbahnbreiten je Sekunde bei Höchsttempo und vollem Einschlag
    LENK_AUF: 5.5,           // so schnell folgt der Einschlag der Eingabe (je Sekunde)
    LENK_ZURUECK: 8,         // so schnell geht er zurück zur Mitte
    FLIEHKRAFT: 0.62,        // Querweg je Sekunde bei Höchsttempo und Kurve 1
    HANG: 1500,              // Tempoverlust bergauf je Einheit Steigung
    RANDSTEIN_BREMSE: 900,
    GRAS_BREMSE: 9000,       // über dem Grastempo
    GRAS_ROLLEN: 2200,
    GRAS_HOECHST: 0.34,      // Anteil des Höchsttempos, mehr geht auf dem Gras nicht
    GRAS_SCHUB: 0.45,        // Anteil des Schubs auf dem Gras
    RAND_AUSSEN: 2.3,        // weiter als so kommt das Auto nicht von der Mitte weg
  });

  function begrenze(w, min, max) {
    return w < min ? min : w > max ? max : w;
  }

  // Ein Auto am Anfang der Strecke (z = 0 ist die Ziellinie)
  function neuesAuto(z, x) {
    return {
      z: z || 0, x: x || 0, tempo: 0, lenk: 0,
      zeit: 0,               // gefahrene Zeit seit dem Start
      runde: 1,              // laufende Runde
      rundenStart: 0,        // Zeit beim Beginn der laufenden Runde
      letzte: null,          // letzte Rundenzeit in Sekunden
      beste: null,
      rundenZeiten: [],
      untergrund: "strasse", // strasse, randstein oder gras
      flieh: 0,              // Querweg je Sekunde durch die Fliehkraft (für Anzeige und Klang)
    };
  }

  function untergrund(x, strecke) {
    const a = Math.abs(x);
    if (a <= 1) return "strasse";
    if (a <= 1 + strecke.randstein) return "randstein";
    return "gras";
  }

  // Ein Takt der Physik
  function schritt(auto, eingabe, strecke) {
    const K = KONST, dt = K.TAKT;
    const gas = begrenze(eingabe.gas || 0, 0, 1);
    const bremse = begrenze(eingabe.bremse || 0, 0, 1);
    const ziel = begrenze(eingabe.lenken || 0, -1, 1);

    // Lenkeinschlag folgt der Eingabe mit Trägheit
    const rate = Math.abs(ziel) < Math.abs(auto.lenk) || ziel * auto.lenk < 0 ? K.LENK_ZURUECK : K.LENK_AUF;
    const diff = ziel - auto.lenk;
    auto.lenk += begrenze(diff, -rate * dt, rate * dt);

    const seg = strecke.segment(auto.z);
    const grund = untergrund(auto.x, strecke);
    auto.untergrund = grund;
    let anteil = auto.tempo / K.HOECHST;

    // Längs: Schub, Bremse, Rollen, Hang, Untergrund
    const grasDeckel = K.GRAS_HOECHST * K.HOECHST;
    let a = 0;
    const schub = K.BESCHLEUNIGUNG * (1 - (1 - K.SCHUB_REST) * anteil);
    if (gas > 0) a += gas * schub * (grund === "gras" ? K.GRAS_SCHUB : 1);
    else a -= grund === "gras" ? K.GRAS_ROLLEN : K.ROLLEN;
    a -= bremse * K.BREMSE;
    a -= K.HANG * (seg.y2 - seg.y1) / (seg.z2 - seg.z1);
    if (grund === "randstein") a -= K.RANDSTEIN_BREMSE;
    let neu = auto.tempo + a * dt;
    if (grund === "gras") {
      // Über dem Grastempo bremst das Gras stark, darunter kommt man nicht darüber hinaus
      if (auto.tempo > grasDeckel) neu = Math.max(Math.min(neu, auto.tempo) - K.GRAS_BREMSE * dt, grasDeckel);
      else neu = Math.min(neu, grasDeckel);
    }
    auto.tempo = begrenze(neu, 0, K.HOECHST);
    anteil = auto.tempo / K.HOECHST;

    // Quer: Lenkung gegen Fliehkraft
    auto.flieh = K.FLIEHKRAFT * seg.kurve * anteil * anteil;
    auto.x += (auto.lenk * K.LENKUNG * anteil - auto.flieh) * dt;
    if (Math.abs(auto.x) > K.RAND_AUSSEN) {
      auto.x = Math.sign(auto.x) * K.RAND_AUSSEN;
      auto.tempo *= 0.985;
    }

    // Weiter und Runde zählen
    const vorher = auto.z;
    auto.z += auto.tempo * dt;
    if (auto.z >= strecke.laenge) {
      auto.z -= strecke.laenge;
      // Bruchteil des Takts bis zur Linie, damit die Rundenzeit nicht auf 1/60 s gerundet ist
      const bruch = auto.tempo > 0 ? (strecke.laenge - vorher) / (auto.tempo * dt) : 1;
      const linie = auto.zeit + bruch * dt;
      const zeit = linie - auto.rundenStart;
      auto.rundenZeiten.push(zeit);
      auto.letzte = zeit;
      if (auto.beste == null || zeit < auto.beste) auto.beste = zeit;
      auto.rundenStart = linie;
      auto.runde++;
    }
    auto.zeit += dt;
  }

  // Zeitkonto: führt so viele Takte aus, wie in dt passen. Liefert den Anteil des angebrochenen Takts (zum Zeichnen).
  function takt(uhr, dt, jeTakt) {
    uhr.konto = (uhr.konto || 0) + Math.min(Math.max(dt, 0), KONST.MAX_NACHHOLZEIT);
    // kleine Toleranz, sonst fehlt bei 144 Hz durch Rundung ab und zu ein Takt erst ein Bild später
    while (uhr.konto >= KONST.TAKT - 1e-9) {
      uhr.konto -= KONST.TAKT;
      jeTakt();
    }
    return uhr.konto / KONST.TAKT;
  }

  // Grenztempo (Anteil am Höchsttempo) einer Kurve: Lenkung hält gerade noch die Fliehkraft
  function grenzAnteil(kurve) {
    const k = Math.abs(kurve);
    return k < 1e-6 ? Infinity : KONST.LENKUNG / (KONST.FLIEHKRAFT * k);
  }

  /*
   * Bot: fährt wie ein vorsichtiger, aber flotter Spieler.
   *  - Linie: leicht zur Kurveninnenseite der nächsten Kurve, auf Geraden zurück zur Mitte.
   *  - Lenkung: Vorsteuerung gegen die Fliehkraft plus Regler auf die Linie.
   *  - Bremsen: Für jedes Segment voraus wird das dort erlaubte Tempo (Grenztempo mit Reserve)
   *    mit dem Bremsweg verglichen. Liegt das Tempo über dem, was sich bis dort abbremsen lässt, bremst er.
   * vorsicht: Reserve auf das Grenztempo (0,9 heißt 90 % davon).
   */
  function botEingabe(auto, strecke, vorsicht) {
    const K = KONST;
    const reserve = vorsicht || 0.9;
    const L = strecke.segmente[0].z2 - strecke.segmente[0].z1;
    const v = auto.tempo;
    const anteil = v / K.HOECHST;

    // Blick voraus: Bremsbedarf und Kurve für die Linie
    let bremsen = false, gasWeg = false;
    let linienKurve = 0;
    const reichweite = Math.ceil(((v * v) / (2 * K.BREMSE * 0.75)) / L) + 12;
    for (let n = 1; n <= reichweite; n++) {
      const seg = strecke.segment(auto.z + n * L);
      const erlaubt = Math.min(1, grenzAnteil(seg.kurve) * reserve) * K.HOECHST;
      const weg = n * L - (auto.z % L);
      const moeglich = Math.sqrt(erlaubt * erlaubt + 2 * K.BREMSE * 0.75 * Math.max(weg, 0));
      if (v > moeglich) bremsen = true;
      else if (v > moeglich * 0.985) gasWeg = true;
      if (n <= 40) linienKurve += seg.kurve * (1 - n / 41);
    }

    const seg = strecke.segment(auto.z);
    const zielX = begrenze(linienKurve * 0.06, -0.55, 0.55);
    // Vorsteuerung: so viel Einschlag, wie die Fliehkraft gerade verlangt
    const vor = anteil > 0.05 ? (K.FLIEHKRAFT * seg.kurve * anteil) / K.LENKUNG : 0;
    const regler = (zielX - auto.x) * 2.2 - (auto.lenk - vor) * 0.3;
    const lenken = begrenze(vor + regler, -1, 1);

    return {
      gas: bremsen || gasWeg ? 0 : 1,
      bremse: bremsen ? 1 : 0,
      lenken,
    };
  }

  // Tempo in km/h für die Anzeige
  function kmh(tempo) {
    return tempo * KONST.KMH;
  }

  return { KONST, neuesAuto, schritt, takt, grenzAnteil, botEingabe, untergrund, kmh, begrenze };
});
