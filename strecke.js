/*
 * Streckenblitz: Streckendaten und Streckenbau
 *
 * Eine Strecke ist eine geschlossene Folge gleich langer Segmente. Jedes Segment trägt
 *   kurve  wie stark die Straße an dieser Stelle zur Seite biegt (rechts positiv, links negativ),
 *   y1, y2 die Höhe am Anfang und am Ende des Segments (Welteinheiten).
 * Die Pseudo-3D-Ansicht addiert die Kurvenwerte zu einer Querverschiebung auf, die Physik
 * leitet daraus die Fliehkraft ab.
 *
 * Gebaut wird aus einem Bauplan aus Stücken: Geraden und Kurven mit sanftem Ein- und Auslauf,
 * dazu eine Zielhöhe je Stück (weicher Übergang über die ganze Stücklänge).
 * Aus den Kurvenwerten entsteht außerdem eine Draufsicht (karte), die Runde schließt sich dort
 * wirklich: Zwei Geraden des Bauplans sind dehnbar und werden so verlängert, dass Anfang und
 * Ende auf der Karte zusammenfallen.
 *
 * Die Datei läuft im Browser (window.Strecke) und unter Node (require), ohne DOM.
 */
(function (wurzel, fabrik) {
  if (typeof module === "object" && module.exports) module.exports = fabrik();
  else wurzel.Strecke = fabrik();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const KONST = Object.freeze({
    SEGMENT_LAENGE: 200,  // Welteinheiten je Segment
    BREITE: 1000,         // halbe Fahrbahnbreite; x = 1 ist der rechte Fahrbahnrand
    RANDSTEIN: 0.14,      // Breite der Randsteine, in halben Fahrbahnbreiten
    STREIFEN: 4,          // so viele Segmente lang ist ein Farbfeld der Randsteine und des Grases
    MIN_GERADE: 20,       // kürzer darf eine dehnbare Gerade beim Schließen nicht werden
  });

  // Weicher Übergang 0 bis 1 (ohne Knick am Anfang und am Ende)
  function sanft(t) {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return t * t * (3 - 2 * t);
  }

  // Bausteine des Bauplans. auf: Zielhöhe am Stückende (fehlt sie, bleibt die Höhe).
  function gerade(laenge, auf, name, dehnbar) {
    return { name: name || "Gerade", ein: 0, halte: laenge, aus: 0, kurve: 0, auf, dehnbar: !!dehnbar };
  }
  function kurve(ein, halte, aus, staerke, auf, name) {
    return { name: name || (staerke > 0 ? "Rechtskurve" : "Linkskurve"), ein, halte, aus, kurve: staerke, auf, dehnbar: false };
  }

  /*
   * Möwenkap: Küstenrunde in der Abenddämmerung, im Uhrzeigersinn.
   * Start mitten auf der Zielgeraden, ein schneller Rechtsbogen den Hang hinauf, die lange
   * Klippengerade mit zwei Kuppen, eine Schikane, die Haarnadel am Leuchtturm, S-Kurven
   * hinunter zum Hafen und der lange Zielbogen.
   */
  const MOEWENKAP = {
    name: "Möwenkap",
    sonne: -40,                 // Richtung der Sonne in Grad, von der Zielgeraden aus gemessen (links negativ)
    farben: {
      // Himmel von oben nach unten: tiefes Nachtblau, Violett, Malve, warmer Streifen am Horizont
      himmel: [[0.00, "#0a0a1d"], [0.42, "#1b1438"], [0.72, "#3a2048"], [0.90, "#6a3446"], [1.00, "#8a4a44"]],
      sonne: "#b4714c",
      dunst: "#3a2a44",         // Nebelfarbe am Horizont
      wolke: "#2a1d40",
      wolkenKante: "#7c4a52",   // von unten angestrahlter Wolkensaum
      stern: "#8d8eb2",
      berge: "#251a36",
      huegel: "#171226",
      // Wechselfarben mit kleinem Helligkeitsunterschied (Flimmerschutz, siehe tests/strecke.mjs)
      gras: ["#1a2e25", "#192c23"],
      randstein: ["#6a3433", "#5d4b49"],
      strasse: ["#33323d", "#31303b"],
      linie: "#5f5c66",          // Randlinie innen an den Randsteinen
      ziel: ["#57545e", "#2c2b34"],
    },
    stuecke: [
      gerade(70, 0, "Zielgerade, zweite Hälfte", true),
      kurve(30, 42, 30, 3.6, 1800, "Möwenbogen"),
      gerade(70, 2600, "Hang"),
      kurve(25, 11, 25, -1.6, 2600, "Klippenknick"),
      gerade(95, 5600, "Klippengerade, erste Kuppe"),
      gerade(85, 2200),
      gerade(80, 4200, "Klippengerade, zweite Kuppe"),
      gerade(80, 1800, "Klippengerade, Auslauf", true),
      kurve(8, 6, 8, -5.5, 1800, "Schikane links"),
      kurve(8, 6, 8, 5.5, 1800, "Schikane rechts"),
      gerade(50, 1400),
      kurve(20, 56, 20, 4.2, 1000, "Bucht"),
      gerade(250, 3800, "Leuchtturmweg"),
      gerade(280, 2000),
      kurve(14, 51, 14, 8.0, 2000, "Haarnadel am Leuchtturm"),
      gerade(70, 900, "Abfahrt"),
      kurve(15, 50, 15, -4.0, 400, "Hafenkurve"),
      gerade(200, 400, "Hafenmole"),
      kurve(15, 20, 15, -3.8, 0, "Hafen-S links"),
      kurve(15, 20, 15, 3.8, -400, "Hafen-S rechts"),
      gerade(190, 2400, "Kuppe am Hafen"),
      gerade(130, 0),
      kurve(25, 40, 25, 4.0, 0, "Zielbogen"),
      gerade(45, 0, "Zielgerade, erste Hälfte"),
    ],
  };

  // Segmente aus einem Bauplan; laengen[i] ersetzt die Haltelänge von Stück i (zum Dehnen)
  function segmenteBauen(plan, laengen) {
    const L = KONST.SEGMENT_LAENGE;
    const segmente = [];
    const stuecke = [];
    let y = 0;
    plan.stuecke.forEach((st, i) => {
      const halte = laengen && laengen[i] != null ? laengen[i] : st.halte;
      const anzahl = st.ein + halte + st.aus;
      const vonY = y;
      const nachY = st.auf == null ? y : st.auf;
      const erstes = segmente.length;
      for (let n = 0; n < anzahl; n++) {
        let k;
        if (n < st.ein) k = st.kurve * sanft((n + 0.5) / st.ein);
        else if (n < st.ein + halte) k = st.kurve;
        else k = st.kurve * sanft(1 - (n - st.ein - halte + 0.5) / st.aus);
        const y2 = vonY + (nachY - vonY) * sanft((n + 1) / anzahl);
        const nr = segmente.length;
        segmente.push({ nr, z1: nr * L, z2: (nr + 1) * L, kurve: k, y1: y, y2, stueck: i });
        y = y2;
      }
      stuecke.push({ name: st.name, von: erstes, bis: segmente.length, kurve: st.kurve, dehnbar: st.dehnbar, halte });
    });
    return { segmente, stuecke };
  }

  // Draufsicht: Die Richtung wächst mit dem Kurvenwert, so skaliert, dass eine Runde genau eine Umdrehung ist.
  // Liefert je Segment den Anfangspunkt und die Richtung, dazu den Punkt nach dem letzten Segment.
  function karteBerechnen(segmente) {
    const L = KONST.SEGMENT_LAENGE;
    const summe = segmente.reduce((s, g) => s + g.kurve, 0);
    const proKurve = (2 * Math.PI) / summe; // Bogenmaß je Kurveneinheit und Segment
    const punkte = [];
    let richtung = 0, x = 0, y = 0;
    for (const g of segmente) {
      punkte.push({ x, y, richtung });
      const mitte = richtung + g.kurve * proKurve / 2;
      x += L * Math.sin(mitte);
      y += L * Math.cos(mitte);
      richtung += g.kurve * proKurve;
    }
    return { punkte, ende: { x, y, richtung }, proKurve };
  }

  // Baut eine Strecke aus einem Bauplan und schließt sie auf der Karte über die zwei dehnbaren Geraden
  function baue(plan) {
    const L = KONST.SEGMENT_LAENGE;
    let { segmente, stuecke } = segmenteBauen(plan);
    const dehnbar = stuecke.map((s, i) => (s.dehnbar ? i : -1)).filter((i) => i >= 0);
    if (dehnbar.length === 2) {
      const k = karteBerechnen(segmente);
      const [a, b] = dehnbar;
      const ra = k.punkte[stuecke[a].von].richtung, rb = k.punkte[stuecke[b].von].richtung;
      // Gesucht: na, nb Segmente mehr, sodass ende + L * (na * (sin ra, cos ra) + nb * (sin rb, cos rb)) = 0
      const ax = Math.sin(ra), ay = Math.cos(ra), bx = Math.sin(rb), by = Math.cos(rb);
      const det = ax * by - ay * bx;
      if (Math.abs(det) < 0.2) throw new Error(plan.name + ": dehnbare Geraden fast parallel, Runde lässt sich so nicht schließen");
      const ex = -k.ende.x / L, ey = -k.ende.y / L;
      const na = Math.round((ex * by - ey * bx) / det);
      const nb = Math.round((ax * ey - ay * ex) / det);
      const laengen = plan.stuecke.map(() => null);
      laengen[a] = plan.stuecke[a].halte + na;
      laengen[b] = plan.stuecke[b].halte + nb;
      if (laengen[a] < KONST.MIN_GERADE || laengen[b] < KONST.MIN_GERADE) {
        throw new Error(plan.name + ": zum Schließen müsste eine dehnbare Gerade kürzer als " + KONST.MIN_GERADE + " Segmente werden (" + laengen[a] + ", " + laengen[b] + ")");
      }
      ({ segmente, stuecke } = segmenteBauen(plan, laengen));
    }
    const karte = karteBerechnen(segmente);
    const anzahl = segmente.length;
    const laenge = anzahl * L;

    // Segment an einer Stelle z (z darf über die Runde hinaus oder negativ sein)
    function segment(z) {
      const n = Math.floor(z / L) % anzahl;
      return segmente[n < 0 ? n + anzahl : n];
    }
    // Höhe der Straße an der Stelle z, linear im Segment
    function hoeheBei(z) {
      const g = segment(z);
      const t = (((z % L) + L) % L) / L;
      return g.y1 + (g.y2 - g.y1) * t;
    }
    // Fahrtrichtung auf der Karte an der Stelle z (Bogenmaß, 0 ist die Richtung der Zielgeraden)
    function richtungBei(z) {
      const g = segment(z);
      const t = (((z % L) + L) % L) / L;
      return karte.punkte[g.nr].richtung + g.kurve * karte.proKurve * t;
    }
    return {
      name: plan.name,
      farben: plan.farben,
      sonne: plan.sonne,
      segmente,
      stuecke,
      karte,
      anzahl,
      laenge,
      breite: KONST.BREITE,
      randstein: KONST.RANDSTEIN,
      streifen: KONST.STREIFEN,
      segment,
      hoeheBei,
      richtungBei,
    };
  }

  return {
    KONST,
    sanft,
    gerade,
    kurve,
    baue,
    karteBerechnen,
    PLAENE: { moewenkap: MOEWENKAP },
  };
});
