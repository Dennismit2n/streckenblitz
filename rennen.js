/*
 * Streckenblitz: Rennen, Gegner und Zeitfahren
 *
 * Baut auf physik.js auf und läuft wie diese im Browser (window.Rennen) und unter Node (require), ohne DOM.
 *  - Startaufstellung: acht Autos versetzt hinter der Ziellinie, du startest als Sechster.
 *  - Startampel: fünf Lichter gehen im Sekundentakt nacheinander an und nach einer kurzen,
 *    festen Pause alle zusammen aus. Kein Blinken. Bis dahin stehen alle Autos.
 *  - Gegner fahren mit der Bot-Logik und eigenem Können: Motor (Höchsttempo), Mut in Kurven,
 *    Fehlerneigung (ab und zu eine Kurve zu schnell). Sie weichen langsameren Autos aus und überholen.
 *  - Gummiband: Gegner vor dir werden ein klein wenig langsamer, Gegner hinter dir ein wenig schneller (höchstens 2,5 %).
 *  - Windschatten: dicht hinter einem Auto steigt das Höchsttempo um bis zu 4,5 %.
 *  - Berührungen bremsen und schieben zur Seite, niemand scheidet aus.
 *  - E-Turbo: Gegner laden beim Bremsen wie du und zünden je nach Fahrstil auf Geraden, zum Überholen,
 *    zum Verteidigen oder erst in der letzten Runde; erst nach der Startlinie.
 *  - Platzierung nach gefahrenem Weg, im Ziel nach Ankunft. Kommt der Spieler an, fahren die übrigen
 *    Autos ohne Bild zu Ende (zuEndeFahren), dann steht das Ergebnis fest.
 * Zufall nur aus einem festen Samen: Ein Rennen mit gleichen Eingaben läuft immer gleich.
 */
(function (wurzel, fabrik) {
  if (typeof module === "object" && module.exports) module.exports = fabrik(require("./physik.js"));
  else wurzel.Rennen = fabrik(wurzel.Physik);
})(typeof self !== "undefined" ? self : this, function (P) {
  "use strict";

  const KONST = Object.freeze({
    FELD: 8,                 // Autos im Rennen
    SPIELER_PLATZ: 6,        // dein Startplatz
    VORLAUF: 400,            // so weit steht die Pole hinter der Linie
    REIHE: 700,              // Abstand von Startplatz zu Startplatz
    VERSATZ: 0.42,           // Querlage der Startplätze (abwechselnd links und rechts)
    ZEITFAHREN_VORLAUF: 1600, // Zeitfahren: Start so weit vor der Linie, die erste Runde ist dann fliegend
    AMPEL_LICHTER: 5,
    AMPEL_TAKT: 1,           // Sekunden je Licht
    AMPEL_PAUSE: [0.5, 1.3], // so lange stehen alle fünf, bevor sie ausgehen (aus dem Samen)
    AUTO_LAENGE: 560,        // Länge eines Autos für Berührungen (Welteinheiten)
    AUTO_BREITE: 0.38,       // Breite eines Autos in halben Fahrbahnbreiten
    WIND_VON: 300,           // Windschatten ab diesem Abstand ...
    WIND_BIS: 2600,          // ... bis zu diesem, dazwischen fällt er linear ab
    WIND_BREITE: 0.32,       // so genau muss man hinter dem anderen liegen
    WIND_PLUS: 0.045,        // so viel mehr Höchsttempo im vollen Windschatten
    GUMMI: 0.025,            // Gummiband: höchstens so viel schneller oder langsamer
    GUMMI_WEG: 0.3,          // ab diesem Rückstand (Anteil einer Runde) wirkt es voll
    KI_SICHT: 2400,          // so weit voraus achten Gegner auf langsamere Autos
    KI_SEITE: 0.56,          // seitlicher Abstand beim Vorbeifahren
    KI_RAND: 0.86,           // weiter nach außen weicht niemand aus
    FEHLER_SPAET: 1.4,       // Fahrfehler in einer Bremskurve: zu spät gebremst, trägt nach außen
    FEHLER_FRUEH: 0.8,       // Fahrfehler sonst: zu früh vom Gas, kostet Zeit
    AUSLAUF_MOTOR: 0.6,      // nach dem Ziel rollen die Autos gemächlich weiter
    BOT_MUT: 0.95,           // Mut des Bots, wenn er für dich fährt (?bot=1)
    TURBO_DUELL: 8000,       // so viel freie Gerade braucht ein Turbo zum Überholen oder Verteidigen
    TURBO_VORN: 2500,        // Überholen: ein Auto höchstens so weit vor dir, ungefähr auf deiner Spur
    TURBO_HINTEN: 2000,      // Verteidigen: ein Auto höchstens so weit hinter dir
    TURBO_VOLL: 0.9,         // ab dieser Ladung zündet jeder auf einer langen Geraden, sonst verfiele die Rekuperation
    TURBO_SICHT: 20000,      // so weit voraus wird die freie Gerade gesucht
  });

  // Fahrstile mit dem E-Turbo: ab (Ladung zum Zünden auf einer Geraden), gerade (freie Gerade dafür),
  // ueberholen und verteidigen (zündet im Zweikampf), zielrunde (spart für die letzte Runde)
  const STILE = Object.freeze({
    draengt: { ab: 0.25, gerade: 4000, ueberholen: true, verteidigen: true },
    ueberholt: { ab: 0.4, gerade: 14000, ueberholen: true },
    verteidigt: { ab: 0.4, gerade: 14000, verteidigen: true },
    gleichmaessig: { ab: 0.5, gerade: 16000, ueberholen: true },
    spart: { ab: 0.9, gerade: 16000, zielrunde: true },
  });

  // Erfundene Fahrer (keine echten Namen). Farbe und Startnummer, damit sie auch ohne Farbsehen unterscheidbar sind.
  // Reihenfolge = Startaufstellung (dein Platz wird eingeschoben); sie folgt nicht ganz dem Können, damit es Überholmanöver gibt.
  // motor: Faktor auf das Höchsttempo, mut: Reserve auf die Kurvengrenze, fehler: Anteil der Kurven mit Fahrfehler,
  // turbo: Fahrstil mit dem E-Turbo (STILE)
  const FAHRER = Object.freeze([
    { name: "Linnea Krook", nummer: 9, farbe: "#3f6a39", motor: 0.992, mut: 0.97, fehler: 0.05, turbo: "verteidigt" },
    { name: "Ravi Tannhold", nummer: 12, farbe: "#34508e", motor: 0.990, mut: 0.95, fehler: 0.08, turbo: "ueberholt" },
    { name: "Greta Ostwald", nummer: 4, farbe: "#7c2f3a", motor: 1.000, mut: 0.99, fehler: 0.04, turbo: "spart" },
    { name: "Selin Arda", nummer: 16, farbe: "#653f86", motor: 0.985, mut: 0.94, fehler: 0.06, turbo: "gleichmaessig" },
    { name: "Mateo Brisa", nummer: 7, farbe: "#94742c", motor: 0.995, mut: 0.98, fehler: 0.07, turbo: "draengt" },
    { name: "Juna Fahlberg", nummer: 27, farbe: "#6b7183", motor: 0.978, mut: 0.91, fehler: 0.12, turbo: "draengt" },
    { name: "Oskar Wendelin", nummer: 21, farbe: "#9c5530", motor: 0.982, mut: 0.92, fehler: 0.10, turbo: "spart" },
  ]);
  const SPIELER = Object.freeze({ name: "Du", nummer: null, farbe: "#287178", motor: 1, mut: KONST.BOT_MUT, fehler: 0, turbo: "gleichmaessig" });

  // Kleiner, fester Zufallsgenerator (mulberry32)
  function zufallAus(samen) {
    let s = samen >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Abstand von b nach a entlang der Strecke, auf eine halbe Runde nach vorn oder hinten gefaltet
  function abstand(a, b, laenge) {
    let d = (a.z - b.z) % laenge;
    if (d > laenge / 2) d -= laenge;
    if (d < -laenge / 2) d += laenge;
    return d;
  }

  /*
   * Neues Rennen.
   * einstellung: { modus: "rennen" | "zeitfahren" | "frei", runden: 3, samen: 1, startZ: 0 (nur frei) }
   * Das erste Auto in autos ist immer der Spieler.
   */
  function neu(strecke, einstellung) {
    const e = einstellung || {};
    const modus = e.modus || "rennen";
    const zufall = zufallAus(e.samen == null ? 1 : e.samen);
    const laenge = strecke.laenge;
    const r = {
      strecke, modus, laenge,
      runden: modus === "frei" ? Infinity : e.runden || 3,
      phase: modus === "frei" ? "rennen" : "ampel",
      zeit: 0,             // Sekunden seit Beginn (mit Ampel)
      ampel: { an: 0, aus: modus === "frei", pause: KONST.AMPEL_PAUSE[0] + zufall() * (KONST.AMPEL_PAUSE[1] - KONST.AMPEL_PAUSE[0]) },
      autos: [],
      ziel: [],            // Autos in der Reihenfolge ihrer Ankunft
      zufall,
    };
    function auto(fahrer, z, x, runde, startPlatz) {
      const a = P.neuesAuto(((z % laenge) + laenge) % laenge, x);
      a.runde = runde;
      a.fahrer = fahrer;
      a.startPlatz = startPlatz;
      a.istSpieler = fahrer === SPIELER;
      a.fertig = false;
      a.zielZeit = null;
      a.windschatten = 0;
      a.kontakt = 0;          // Takte in Berührung mit einem anderen Auto (für Klang und Tests)
      a.kurveNr = -1;         // Kurve, für die zuletzt über einen Fahrfehler gewürfelt wurde
      a.fehlerMut = 1;
      a.nr = r.autos.length;
      r.autos.push(a);
      return a;
    }
    if (modus === "rennen") {
      // Startplätze 1 bis 8: die Gegner nach Können, du auf Platz 6
      const reihe = FAHRER.slice();
      reihe.splice(KONST.SPIELER_PLATZ - 1, 0, SPIELER);
      const platzVon = new Map(reihe.map((f, i) => [f, i + 1]));
      for (const f of [SPIELER, ...FAHRER]) {
        const p = platzVon.get(f);
        auto(f, -(KONST.VORLAUF + (p - 1) * KONST.REIHE), p % 2 ? -KONST.VERSATZ : KONST.VERSATZ, 0, p);
      }
    } else if (modus === "zeitfahren") {
      auto(SPIELER, -KONST.ZEITFAHREN_VORLAUF, 0, 0, 1);
    } else {
      auto(SPIELER, e.startZ || 0, 0, 1, 1);
    }
    r.spieler = r.autos[0];
    return r;
  }

  // Gefahrener Weg seit dem Start der ersten Runde (für die Platzierung)
  function fortschritt(r, a) {
    return (a.runde - 1) * r.laenge + a.z;
  }

  // Platzierung: zuerst die Angekommenen nach Ankunft, dann nach gefahrenem Weg, bei Gleichstand nach Startplatz
  function platzierung(r) {
    const unterwegs = r.autos.filter((a) => !a.fertig)
      .sort((a, b) => fortschritt(r, b) - fortschritt(r, a) || a.startPlatz - b.startPlatz);
    return r.ziel.concat(unterwegs);
  }

  // Gegner und Bot: Wunsch für Linie und Tempo aus dem Verkehr ringsum
  function verkehr(r, a) {
    const K = KONST;
    let vorne = null, naechst = Infinity;
    for (const b of r.autos) {
      if (b === a || b.fertig) continue;
      const dz = abstand(b, a, r.laenge);
      if (dz <= 0 || dz > K.KI_SICHT) continue;
      // nur wer im Weg ist und nicht deutlich schneller fährt
      if (Math.abs(b.x - a.x) < K.AUTO_BREITE + 0.12 && b.tempo < a.tempo + 200 && dz < naechst) { vorne = b; naechst = dz; }
    }
    // Autos daneben: Abstand halten, nicht hineinlenken
    let xMin = -Infinity, xMax = Infinity;
    for (const b of r.autos) {
      if (b === a || b.fertig || Math.abs(abstand(b, a, r.laenge)) > K.AUTO_LAENGE * 1.4) continue;
      if (b.x > a.x) xMax = Math.min(xMax, b.x - K.AUTO_BREITE - 0.1);
      else xMin = Math.max(xMin, b.x + K.AUTO_BREITE + 0.1);
    }
    const seiten = xMin > -Infinity || xMax < Infinity ? { xMin, xMax } : null;
    if (!vorne) return seiten;
    // Seite frei? Kein drittes Auto in der Nähe der Wunschspur
    const frei = (x) => Math.abs(x) <= K.KI_RAND && r.autos.every((b) => b === a || b === vorne || b.fertig ||
      Math.abs(abstand(b, a, r.laenge)) > K.AUTO_LAENGE * 1.6 || Math.abs(b.x - x) > K.AUTO_BREITE + 0.06);
    const links = vorne.x - K.KI_SEITE, rechts = vorne.x + K.KI_SEITE;
    const lieber = a.x <= vorne.x ? links : rechts, sonst = a.x <= vorne.x ? rechts : links;
    if (frei(lieber)) return { zielX: lieber, xMin, xMax };
    if (frei(sonst)) return { zielX: sonst, xMin, xMax };
    // kein Platz: dahinter bleiben, nicht auffahren
    return { tempoDeckel: naechst < K.AUTO_LAENGE * 2.2 ? vorne.tempo * 0.985 : vorne.tempo + 300, xMin, xMax };
  }

  // Eingabe für einen Gegner (oder den Bot am Steuer des Spielers)
  function kiEingabe(r, a) {
    const g = P.kurvenGrenzen(r.strecke);
    const seg = r.strecke.segment(a.z);
    // Über einen Fahrfehler wird einmal je Kurve gewürfelt, sobald sie die nächste ist
    const kurve = g.kurveBei[seg.nr];
    if (kurve !== a.kurveNr) {
      a.kurveNr = kurve;
      const bremskurve = kurve >= 0 && g.grenze[g.kurven[kurve].von] < 1;
      a.fehlerMut = a.fahrer.fehler > 0 && r.zufall() < a.fahrer.fehler ? (bremskurve ? KONST.FEHLER_SPAET : KONST.FEHLER_FRUEH) : 1;
    }
    const mut = a.fertig ? 0.8 : a.fahrer.mut * a.fehlerMut;
    const e = P.botEingabe(a, r.strecke, mut, verkehr(r, a));
    e.turbo = !a.fertig && e.gas === 1 && turboZuenden(r, a);
    return e;
  }

  // E-Turbo der Gegner (und des Bots): auf einer freien Geraden, im Zweikampf oder in der letzten Runde, je nach Stil
  function turboZuenden(r, a) {
    const K = KONST;
    if (!P.turboBereit(a)) return false;
    const stil = STILE[a.fahrer.turbo] || STILE.gleichmaessig;
    const frei = P.freieStrecke(a, r.strecke, K.TURBO_SICHT);
    if (a.akku >= stil.ab && frei >= stil.gerade) return true;
    if (a.akku >= K.TURBO_VOLL && frei >= K.TURBO_DUELL) return true;
    if (frei < K.TURBO_DUELL) return false;
    if (stil.zielrunde && a.runde >= r.runden) return true;
    if (!stil.ueberholen && !stil.verteidigen) return false;
    for (const b of r.autos) {
      if (b === a || b.fertig) continue;
      const dz = abstand(b, a, r.laenge);
      if (stil.ueberholen && dz > 0 && dz < K.TURBO_VORN && Math.abs(b.x - a.x) < 0.6) return true;
      if (stil.verteidigen && dz < 0 && dz > -K.TURBO_HINTEN) return true;
    }
    return false;
  }

  // Höchsttempo-Faktor: Können, Gummiband (nur Gegner im Rennen), Windschatten
  function motor(r, a) {
    const K = KONST;
    if (a.fertig) return K.AUSLAUF_MOTOR;
    let f = a.fahrer.motor;
    if (!a.istSpieler && r.modus === "rennen" && !r.spieler.fertig) {
      const rueckstand = (fortschritt(r, r.spieler) - fortschritt(r, a)) / (K.GUMMI_WEG * r.laenge);
      f *= 1 + K.GUMMI * P.begrenze(rueckstand, -1, 1);
    }
    let w = 0;
    for (const b of r.autos) {
      if (b === a || b.fertig) continue;
      const dz = abstand(b, a, r.laenge);
      if (dz > K.WIND_VON && dz < K.WIND_BIS && Math.abs(b.x - a.x) < K.WIND_BREITE) w = Math.max(w, 1 - (dz - K.WIND_VON) / (K.WIND_BIS - K.WIND_VON));
    }
    a.windschatten = w;
    return f * (1 + K.WIND_PLUS * w);
  }

  // Berührungen: wer hinten ist, bremst; beide werden zur Seite geschoben. Angekommene fahren als Geister.
  function beruehrungen(r) {
    const K = KONST, autos = r.autos;
    for (const a of autos) a.kontaktJetzt = false;
    for (let i = 0; i < autos.length; i++) {
      for (let j = i + 1; j < autos.length; j++) {
        const a = autos[i], b = autos[j];
        if (a.fertig || b.fertig) continue;
        const dz = abstand(a, b, r.laenge);
        const dx = a.x - b.x;
        const ueberLaengs = K.AUTO_LAENGE - Math.abs(dz), ueberQuer = K.AUTO_BREITE - Math.abs(dx);
        if (ueberLaengs <= 0 || ueberQuer <= 0) continue;
        a.kontaktJetzt = b.kontaktJetzt = true;
        // Seitenrichtung: weg vom anderen; liegen sie genau übereinander, nach der Startnummer
        const seite = dx > 0 || (dx === 0 && a.nr > b.nr) ? 1 : -1;
        if (ueberQuer / K.AUTO_BREITE < ueberLaengs / K.AUTO_LAENGE) {
          // eher nebeneinander: auseinanderschieben, beide verlieren etwas Tempo
          const schub = ueberQuer / 2 + 0.005;
          a.x += seite * schub;
          b.x -= seite * schub;
          a.tempo *= 0.995;
          b.tempo *= 0.995;
        } else {
          // eher hintereinander: der Hintere bremst auf das Tempo des Vorderen und weicht etwas aus
          const [vorn, hinten] = dz > 0 ? [a, b] : [b, a];
          hinten.z -= ueberLaengs;
          hinten.tempo = Math.min(hinten.tempo, vorn.tempo) * 0.97;
          const weg = hinten === a ? seite : -seite;
          hinten.x += weg * 0.02;
          vorn.x -= weg * 0.01;
        }
      }
    }
    for (const a of autos) {
      a.x = P.begrenze(a.x, -P.KONST.RAND_AUSSEN, P.KONST.RAND_AUSSEN);
      a.kontakt = a.kontaktJetzt ? a.kontakt + 1 : 0;
    }
  }

  /*
   * Ein Takt (1/60 s). eingabe: Eingabe des Spielers, null heißt: der Bot fährt für dich.
   */
  function schritt(r, eingabe) {
    const K = KONST;
    r.zeit += P.KONST.TAKT;
    if (r.phase === "ampel") {
      const an = Math.floor(r.zeit / K.AMPEL_TAKT + 1e-9);
      r.ampel.an = Math.min(K.AMPEL_LICHTER, an);
      if (r.zeit >= K.AMPEL_LICHTER * K.AMPEL_TAKT + r.ampel.pause) {
        r.ampel.an = 0;
        r.ampel.aus = true;
        r.phase = "rennen";
      }
      return;
    }
    // Nach deiner Ankunft (Phase ziel) fahren die anderen weiter, bis alle angekommen sind
    if (r.phase !== "rennen" && r.phase !== "ziel") return;
    // Eingaben aller Autos auf demselben Stand berechnen, dann alle bewegen
    const eingaben = r.autos.map((a) => (a.istSpieler && eingabe && !a.fertig ? eingabe : kiEingabe(r, a)));
    r.autos.forEach((a, i) => {
      a.hoechstFaktor = motor(r, a);
      P.schritt(a, eingaben[i], r.strecke);
      if (!a.fertig && a.rundenZeiten.length >= r.runden) {
        a.fertig = true;
        a.zielZeit = a.rundenStart; // Zeitpunkt der Linie, auf den Bruchteil eines Takts genau
        r.ziel.push(a);
      }
    });
    if (r.modus === "rennen") beruehrungen(r);
    if (r.spieler.fertig) r.phase = "ziel";
  }

  // Nach deiner Ankunft: die übrigen Autos ohne Bild zu Ende fahren (höchstens maxSek Sekunden)
  function zuEndeFahren(r, maxSek) {
    const ende = r.zeit + (maxSek || 600);
    while (r.ziel.length < r.autos.length && r.zeit < ende) schritt(r, null);
    return r.ziel.length === r.autos.length;
  }

  // Ergebniszeilen: Platz, Fahrer, Gesamtzeit (Sieger) oder Rückstand, beste Runde
  function ergebnis(r) {
    const liste = platzierung(r);
    const sieger = liste[0];
    return liste.map((a, i) => ({
      platz: i + 1,
      name: a.fahrer.name,
      nummer: a.fahrer.nummer,
      farbe: a.fahrer.farbe,
      istSpieler: a.istSpieler,
      gesamt: a.zielZeit,
      rueckstand: a.zielZeit != null && sieger.zielZeit != null ? a.zielZeit - sieger.zielZeit : null,
      beste: a.beste,
      runden: a.rundenZeiten.slice(),
    }));
  }

  return { KONST, FAHRER, SPIELER, STILE, neu, schritt, platzierung, fortschritt, zuEndeFahren, ergebnis, abstand, zufallAus, motor, beruehrungen };
});
