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
 *  - Deko nahe der Fahrbahn (Bäume, Felsen, Laternen, Schilder, Brückenpfeiler) ist fest: Wer
 *    hineinfährt, prallt zur Seite ab und verliert gut die Hälfte des Tempos.
 *  - Automatik: Gas beschleunigt mit zum Höchsttempo hin abnehmender Kraft.
 *  - Runden werden beim Überfahren der Ziellinie auf den Bruchteil eines Takts genau gestoppt.
 *  - Ein Bot liefert Eingaben wie ein Spieler (Gegner-KI und Tests bauen darauf auf).
 *  - Rekuperation: Bremsen und Rollen laden einen Akku (0 bis 1). Der E-Turbo zündet auf Tastendruck, gibt für
 *    einige Sekunden mehr Schub und ein höheres Höchsttempo und leert dabei den Akku.
 *
 * Eingabe: { gas: 0..1, bremse: 0..1, lenken: -1..1, turbo: true|false } (analog, damit ein Gamepad passt).
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
    HOECHST: 13154,          // Höchsttempo in Welteinheiten je Sekunde (342 km/h)
    BEZUG: 12000,            // Lenkung und Fliehkraft rechnen mit diesem Tempo (das Höchsttempo bis M4): Kurven bleiben gleich schnell
    KMH: 0.026,              // Anzeige: Welteinheiten je Sekunde mal KMH ergibt km/h (Höchsttempo 342)
    BESCHLEUNIGUNG: 4200,    // Schub aus dem Stand, nimmt zum Höchsttempo hin ab
    SCHUB_REST: 0.035,       // Anteil des Schubs, der beim Höchsttempo übrig bleibt (bis 312 km/h derselbe Schub wie bis M4)
    BREMSE: 8500,
    ROLLEN: 1400,            // Verzögerung ohne Gas und Bremse
    LENKUNG: 2.1,            // Querweg in halben Fahrbahnbreiten je Sekunde bei Bezugstempo und vollem Einschlag
    LENK_AUF: 5.5,           // so schnell folgt der Einschlag der Eingabe (je Sekunde)
    LENK_ZURUECK: 8,         // so schnell geht er zurück zur Mitte
    FLIEHKRAFT: 0.70,        // Querweg je Sekunde bei Bezugstempo und Kurve 1 (bis M4 0,62)
    HANG: 1500,              // Tempoverlust bergauf je Einheit Steigung
    RANDSTEIN_BREMSE: 900,
    GRAS_BREMSE: 9000,       // über dem Grastempo
    GRAS_ROLLEN: 2200,
    GRAS_HOECHST: 0.31,      // Anteil des Höchsttempos, mehr geht auf dem Gras nicht (106 km/h wie bisher)
    GRAS_SCHUB: 0.45,        // Anteil des Schubs auf dem Gras
    RAND_AUSSEN: 2.3,        // weiter als so kommt das Auto nicht von der Mitte weg
    BOT_VERZOEGERUNG: 0.85,  // der Bot plant mit diesem Anteil der echten Verzögerung (Bremse plus Rollen)
    BOT_BREITE: 1.0,         // so viel Fahrbahn (halbe Breiten) darf eine Kurve den Bot nach außen tragen
    KURVE_AB: 0.05,          // ab diesem Kurvenwert zählt ein Segment zu einer Kurve
    AUTO_HALB: 0.19,         // halbe Autobreite in halben Fahrbahnbreiten (für Deko)
    STOSS_TEMPO: 0.45,       // so viel Tempo bleibt nach einem Aufprall an der Deko
    ABPRALL: 0.08,           // so weit springt das Auto über die Berührung hinaus zurück
    RUTSCH_AB: 0.9,          // Reifen beginnen zu rutschen ab diesem Anteil am Grenztempo der Kurve ...
    RUTSCH_VOLL: 1.15,       // ... und rutschen voll ab diesem (Klang)
    // Rekuperation und E-Turbo
    AKKU_START: 0.5,         // so voll ist der Akku am Start
    REKU_BREMSE: 0.5,        // Akku je Höchsttempo, das die Bremse abbaut
    REKU_ROLLEN: 0.25,       // Akku je Höchsttempo, das beim Rollen ohne Gas verloren geht
    TURBO_MIN: 0.25,         // mindestens so viel Akku zum Zünden
    TURBO_DAUER: 3,          // Sekunden Schub je Zündung, solange der Akku reicht
    TURBO_VERBRAUCH: 0.22,   // Akku je Sekunde während des Schubs
    TURBO_PAUSE: 2,          // Sekunden nach einem Schub, bevor wieder gezündet werden kann
    TURBO_HOECHST: 365 / 342, // Faktor auf das Höchsttempo während des Schubs (365 km/h)
    TURBO_SCHUB: 2,          // Faktor auf den Schub des Motors
  });

  function begrenze(w, min, max) {
    return w < min ? min : w > max ? max : w;
  }

  // Ein Auto am Anfang der Strecke (z = 0 ist die Ziellinie)
  function neuesAuto(z, x) {
    return {
      z: z || 0, x: x || 0, tempo: 0, lenk: 0,
      zeit: 0,               // gefahrene Zeit seit dem Start
      runde: 1,              // laufende Runde; 0 heißt: steht in der Startaufstellung vor der Linie
      hoechstFaktor: 1,      // Motor: Faktor auf das Höchsttempo (Können, Windschatten, Gummiband)
      rundenStart: 0,        // Zeit beim Beginn der laufenden Runde
      letzte: null,          // letzte Rundenzeit in Sekunden
      beste: null,
      rundenZeiten: [],
      untergrund: "strasse", // strasse, randstein oder gras
      flieh: 0,              // Querweg je Sekunde durch die Fliehkraft (für Anzeige und Klang)
      rutschen: 0,           // 0 bis 1: wie weit die Fliehkraft über dem liegt, was die Reifen halten (Klang)
      stoesse: 0,            // Zahl der Aufpralle an der Deko (Klang und Tests)
      akku: KONST.AKKU_START, // 0 bis 1, lädt beim Bremsen und Rollen
      turbo: 0,              // Sekunden Schub, die noch bleiben (0 heißt: aus)
      turboPause: 0,         // Sekunden, bis wieder gezündet werden kann
      turboTaste: false,     // Turbo-Eingabe im letzten Takt: gezündet wird nur beim Drücken, nicht beim Halten
      zuendungen: 0,         // Zahl der Zündungen (Tests)
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

    // E-Turbo: zündet beim Drücken (nicht beim Halten), wenn der Akku reicht und die Pause nach dem letzten Schub um ist
    const taste = !!eingabe.turbo;
    if (taste && !auto.turboTaste && turboBereit(auto)) {
      auto.turbo = K.TURBO_DAUER;
      auto.zuendungen++;
    }
    auto.turboTaste = taste;
    const turboAn = auto.turbo > 0;

    // Der Motor rechnet mit dem eigenen Höchsttempo, Fliehkraft und Lenkung mit dem echten Tempo
    const hoechst = K.HOECHST * (auto.hoechstFaktor || 1) * (turboAn ? K.TURBO_HOECHST : 1);

    // Längs: Schub, Bremse, Rollen, Hang, Untergrund
    const grasDeckel = K.GRAS_HOECHST * K.HOECHST;
    let a = 0;
    const schub = K.BESCHLEUNIGUNG * (1 - (1 - K.SCHUB_REST) * Math.min(1, auto.tempo / hoechst)) * (turboAn ? K.TURBO_SCHUB : 1);
    if (gas > 0) a += gas * schub * (grund === "gras" ? K.GRAS_SCHUB : 1);
    else a -= grund === "gras" ? K.GRAS_ROLLEN : K.ROLLEN;
    a -= bremse * K.BREMSE;

    // Rekuperation: Was Bremse und Rollen an Tempo abbauen, lädt den Akku (nicht im Gras, nicht im Stand, nicht im Schub)
    if (turboAn) {
      auto.akku = Math.max(0, auto.akku - K.TURBO_VERBRAUCH * dt);
      auto.turbo -= dt;
      if (auto.akku <= 0 || auto.turbo <= 1e-9) { auto.turbo = 0; auto.turboPause = K.TURBO_PAUSE; }
    } else {
      if (auto.turboPause > 0) auto.turboPause = Math.max(0, auto.turboPause - dt);
      if (grund !== "gras" && auto.tempo > 0) {
        const bremsAbbau = Math.min(auto.tempo, bremse * K.BREMSE * dt);
        const rollAbbau = gas > 0 ? 0 : Math.min(auto.tempo - bremsAbbau, K.ROLLEN * dt);
        auto.akku = Math.min(1, auto.akku + (K.REKU_BREMSE * bremsAbbau + K.REKU_ROLLEN * rollAbbau) / K.HOECHST);
      }
    }
    a -= K.HANG * (seg.y2 - seg.y1) / (seg.z2 - seg.z1);
    if (grund === "randstein") a -= K.RANDSTEIN_BREMSE;
    let neu = auto.tempo + a * dt;
    if (grund === "gras") {
      // Über dem Grastempo bremst das Gras stark, darunter kommt man nicht darüber hinaus
      if (auto.tempo > grasDeckel) neu = Math.max(Math.min(neu, auto.tempo) - K.GRAS_BREMSE * dt, grasDeckel);
      else neu = Math.min(neu, grasDeckel);
    }
    // Über dem eigenen Höchsttempo (Windschatten vorbei) rollt das Auto langsam darauf zurück
    auto.tempo = Math.max(0, neu > hoechst ? Math.max(hoechst, Math.min(neu, auto.tempo) - K.ROLLEN * dt) : neu);
    const anteil = auto.tempo / K.BEZUG;

    // Quer: Lenkung gegen Fliehkraft
    auto.flieh = K.FLIEHKRAFT * seg.kurve * anteil * anteil;
    auto.x += (auto.lenk * K.LENKUNG * anteil - auto.flieh) * dt;
    if (Math.abs(auto.x) > K.RAND_AUSSEN) {
      auto.x = Math.sign(auto.x) * K.RAND_AUSSEN;
      auto.tempo *= 0.985;
    }
    // Rutschen: Verhältnis von Fliehkraft zu dem, was die volle Lenkung hält (= Tempo zum Grenztempo der Kurve)
    const verhaeltnis = anteil > 0.2 ? Math.abs(auto.flieh) / (K.LENKUNG * anteil) : 0;
    auto.rutschen = begrenze((verhaeltnis - K.RUTSCH_AB) / (K.RUTSCH_VOLL - K.RUTSCH_AB), 0, 1);

    // Deko: abprallen und Tempo verlieren
    const hindernisse = strecke.hindernisse && strecke.hindernisse[seg.nr];
    if (hindernisse) {
      for (const d of hindernisse) {
        const dx = auto.x - d.x, noetig = d.breite / 2 + K.AUTO_HALB;
        if (Math.abs(dx) >= noetig) continue;
        let seite = dx !== 0 ? Math.sign(dx) : -Math.sign(d.x); // zurück, woher das Auto kam
        if (Math.abs(d.x + seite * (noetig + K.ABPRALL)) > K.RAND_AUSSEN) seite = -seite; // außen ist kein Platz
        auto.x = d.x + seite * (noetig + K.ABPRALL);
        auto.tempo *= K.STOSS_TEMPO;
        auto.lenk *= 0.3;
        auto.stoesse++;
      }
    }

    // Weiter und Runde zählen
    const vorher = auto.z;
    auto.z += auto.tempo * dt;
    if (auto.z >= strecke.laenge) {
      auto.z -= strecke.laenge;
      // Bruchteil des Takts bis zur Linie, damit die Rundenzeit nicht auf 1/60 s gerundet ist
      const bruch = auto.tempo > 0 ? (strecke.laenge - vorher) / (auto.tempo * dt) : 1;
      const linie = auto.zeit + bruch * dt;
      // Aus der Startaufstellung (Runde 0) beginnt mit der Linie erst die erste Runde
      if (auto.runde > 0) {
        const zeit = linie - auto.rundenStart;
        auto.rundenZeiten.push(zeit);
        auto.letzte = zeit;
        if (auto.beste == null || zeit < auto.beste) auto.beste = zeit;
      }
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
    return k < 1e-6 ? Infinity : (KONST.LENKUNG / (KONST.FLIEHKRAFT * k)) * (KONST.BEZUG / KONST.HOECHST);
  }

  /*
   * Kurvengrenzen je Segment (Anteil am Höchsttempo), einmal je Strecke berechnet.
   * Eine Kurve darf das Auto um BOT_BREITE nach außen tragen: Was die Lenkung nicht hält,
   * wandert während der Kurve zur Seite. Kurze Kurven vertragen also mehr Tempo als lange.
   * Aus (Fliehkraft · Tempo − Lenkung) · Kurvendauer ≤ Breite folgt für eine Kurve mit dem
   * stärksten Wert k und der wirksamen Länge n (Summe |kurve| / k), Tempo als Anteil am BEZUG:
   *   Anteil ≤ (LENKUNG + BREITE · BEZUG / (n · L)) / (FLIEHKRAFT · k)
   * Gespeichert als Anteil am Höchsttempo, höchstens TURBO_HOECHST (Geraden: genau das). Unter 1 heißt:
   * Diese Kurve verlangt Bremsen, auch ohne Turbo.
   */
  const grenzSpeicher = new WeakMap();
  function kurvenGrenzen(strecke) {
    if (grenzSpeicher.has(strecke)) return grenzSpeicher.get(strecke);
    const K = KONST, seg = strecke.segmente, n = seg.length;
    const L = seg[0].z2 - seg[0].z1;
    const grenze = new Float64Array(n).fill(K.TURBO_HOECHST);
    const kurven = [];                  // zusammenhängende Kurven: { von, bis }
    const kurveBei = new Int32Array(n); // Nummer der Kurve, die hier liegt oder als nächste kommt
    const kurveIn = new Int32Array(n).fill(-1);
    let i = 0;
    while (i < n) {
      if (Math.abs(seg[i].kurve) <= K.KURVE_AB) { i++; continue; }
      const vz = Math.sign(seg[i].kurve);
      let j = i, summe = 0, staerkste = 0;
      while (j < n && Math.abs(seg[j].kurve) > K.KURVE_AB && Math.sign(seg[j].kurve) === vz) {
        summe += Math.abs(seg[j].kurve);
        staerkste = Math.max(staerkste, Math.abs(seg[j].kurve));
        j++;
      }
      const wirksam = summe / staerkste;
      const anteil = ((K.LENKUNG + (K.BOT_BREITE * K.BEZUG) / (wirksam * L)) / (K.FLIEHKRAFT * staerkste)) * (K.BEZUG / K.HOECHST);
      for (let k = i; k < j; k++) { grenze[k] = Math.min(K.TURBO_HOECHST, anteil); kurveIn[k] = kurven.length; }
      kurven.push({ von: i, bis: j });
      i = j;
    }
    // rückwärts über zwei Runden: so finden auch die Segmente nach der letzten Kurve die erste der nächsten Runde
    let naechste = -1;
    for (let k = 2 * n - 1; k >= 0; k--) {
      if (kurveIn[k % n] >= 0) naechste = kurveIn[k % n];
      if (k < n) kurveBei[k] = naechste;
    }
    const daten = { grenze, kurven, kurveBei };
    grenzSpeicher.set(strecke, daten);
    return daten;
  }

  /*
   * Bot: fährt wie ein flotter Spieler. Grundlage auch für die Gegner (rennen.js).
   *  - Linie: zur Innenseite der nächsten Kurve, auf Geraden zurück zur Mitte.
   *  - Lenkung: Vorsteuerung gegen die Fliehkraft plus Regler auf die Linie.
   *  - Bremsen: Für jedes Segment voraus wird das dort erlaubte Tempo (Kurvengrenze mal Reserve)
   *    mit dem Bremsweg verglichen. Liegt das Tempo über dem, was sich bis dort abbremsen lässt, bremst er.
   * vorsicht: Reserve auf die Kurvengrenze (0,9 heißt 90 % davon).
   * wunsch (frei): { zielX } ersetzt die Linie (Ausweichen, Überholen),
   *                { tempoDeckel } schneller will er gerade nicht (hinter einem Gegner bleiben).
   */
  function botEingabe(auto, strecke, vorsicht, wunsch) {
    const K = KONST;
    const reserve = vorsicht || 0.9;
    const L = strecke.segmente[0].z2 - strecke.segmente[0].z1;
    const { grenze } = kurvenGrenzen(strecke);
    const v = auto.tempo;
    const anteil = v / K.BEZUG;
    const verz = K.BOT_VERZOEGERUNG * (K.BREMSE + K.ROLLEN);
    // Schneller will er auch auf der Geraden nicht; im Schub entsprechend mehr. Darüber geht er nur vom Gas,
    // gebremst wird allein für Kurven (sonst bremste er nach jedem Schub und lüde den Akku damit wieder auf).
    const deckel = Math.min(1, reserve) * K.HOECHST * (auto.turbo > 0 ? K.TURBO_HOECHST : 1);

    // Blick voraus: Bremsbedarf und Kurve für die Linie
    let bremsen = false, gasWeg = false;
    let linienKurve = 0;
    const reichweite = Math.ceil(((v * v) / (2 * verz)) / L) + 12;
    for (let n = 1; n <= reichweite; n++) {
      const seg = strecke.segment(auto.z + n * L);
      const kurve = grenze[seg.nr] * reserve * K.HOECHST;
      const erlaubt = Math.min(deckel, kurve);
      const weg = Math.max(n * L - (((auto.z % L) + L) % L), 0);
      if (v > Math.sqrt(kurve * kurve + 2 * verz * weg)) bremsen = true;
      else if (v > Math.sqrt(erlaubt * erlaubt + 2 * verz * weg) * 0.985) gasWeg = true;
      if (n <= 40) linienKurve += seg.kurve * (1 - n / 41);
    }
    const hierKurve = grenze[strecke.segment(auto.z).nr] * reserve * K.HOECHST;
    if (v > hierKurve * 1.03) bremsen = true;
    else if (v > Math.min(deckel, hierKurve)) gasWeg = true;
    if (wunsch && wunsch.tempoDeckel != null) {
      if (v > wunsch.tempoDeckel + 150) bremsen = true;
      else if (v > wunsch.tempoDeckel) gasWeg = true;
    }

    const seg = strecke.segment(auto.z);
    let zielX = wunsch && wunsch.zielX != null ? wunsch.zielX : begrenze(linienKurve * 0.06, -0.55, 0.55);
    if (wunsch && wunsch.xMin != null && wunsch.xMax != null) {
      // eingeklemmt zwischen zwei Autos: in die Mitte der Lücke
      zielX = wunsch.xMin > wunsch.xMax ? (wunsch.xMin + wunsch.xMax) / 2 : begrenze(zielX, wunsch.xMin, wunsch.xMax);
    }
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

  // Freie Fahrt voraus (Welteinheiten, höchstens max): bis zur ersten Kurve, die langsamer als das Höchsttempo
  // verlangt. Grundlage, um den Turbo auf einer Geraden zu zünden.
  function freieStrecke(auto, strecke, max) {
    const L = strecke.segmente[0].z2 - strecke.segmente[0].z1;
    const { grenze } = kurvenGrenzen(strecke);
    const n = Math.ceil(max / L);
    for (let i = 0; i < n; i++) if (grenze[strecke.segment(auto.z + i * L).nr] < 1) return i * L;
    return max;
  }

  // Bereit zum Zünden: kein Schub läuft, die Pause ist um, der Akku reicht und die Startlinie ist überfahren
  // (für alle gleich, damit der Start ein Pulk bleibt)
  function turboBereit(auto) {
    return auto.turbo <= 0 && auto.turboPause <= 0 && auto.akku >= KONST.TURBO_MIN && auto.runde >= 1;
  }

  // Tempo in km/h für die Anzeige
  function kmh(tempo) {
    return tempo * KONST.KMH;
  }

  return { KONST, neuesAuto, schritt, takt, grenzAnteil, kurvenGrenzen, botEingabe, freieStrecke, turboBereit, untergrund, kmh, begrenze };
});
