/*
 * Streckenblitz: Klang, nur mit Web Audio erzeugt (keine Tondateien)
 *
 *  - Motor: Sägezahn und Rechteck eine Oktave tiefer, dazu leise eine Quinte darüber, durch einen
 *    Tiefpass. Die Tonhöhe folgt der Drehzahl, die Automatik schaltet sieben Gänge: Beim Hochschalten
 *    fällt die Drehzahl hörbar ab. Mit Gas öffnet der Filter und der Motor wird etwas lauter.
 *  - Reifen: gefiltertes Rauschen, lauter, je weiter die Fliehkraft über dem liegt, was die Reifen halten.
 *  - Aufprall an der Deko: kurzes, dumpfes Rauschen.
 *  - Gegner: bis zu drei nahe Autos mit eigenem, leisem Motor, nach Abstand leiser, links oder rechts.
 *  - E-Turbo: leises Surren aus zwei Sinustönen, die mit dem Tempo etwas steigen, weich ein- und ausgeblendet.
 * Beim Start ist alles stumm. Der AudioContext entsteht erst nach einer Nutzergeste (an()).
 *
 * gangFuer und drehzahl sind reine Rechnungen und laufen auch unter Node (Tests).
 * Fenstername window.Ton.
 */
(function (wurzel, fabrik) {
  if (typeof module === "object" && module.exports) module.exports = fabrik();
  else wurzel.Ton = fabrik();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const KONST = Object.freeze({
    GAENGE: [0.16, 0.29, 0.42, 0.55, 0.68, 0.83, 1.06], // Tempo-Anteil, bei dem der Gang ausgedreht ist
    HOCH_BEI: 0.97,       // hochschalten bei 97 % der Höchstdrehzahl
    RUNTER_BEI: 0.62,     // runterschalten, sobald das Tempo unter 62 % des ausgedrehten nächstkleineren Gangs fällt
    DREH_MAX: 12500,
    LEERLAUF: 3000,
    HZ_JE_UMDREHUNG: 0.0128, // Grundton in Hz je Umdrehung pro Minute (12 500 ergibt 160 Hz)
    LAUT: 0.5,            // Gesamtlautstärke
    MOTOR: 0.11, MOTOR_GAS: 0.07,
    REIFEN: 0.1,
    STOSS: 0.22,
    GEGNER: 0.045, GEGNER_WEIT: 7000, GEGNER_STIMMEN: 3,
    TURBO: 0.03, TURBO_HZ: 330, TURBO_HZ_TEMPO: 140, TURBO_WEICH: 0.12, // Surren: Lautstärke, Tonhöhe, Zeitkonstante in s
  });

  // Automatik: neuer Gang aus dem Tempo-Anteil (0..1) und dem bisherigen Gang, mit Abstand zwischen Hoch- und Runterschalten
  function gangFuer(anteil, bisher) {
    const G = KONST.GAENGE;
    let g = Math.max(1, Math.min(G.length, bisher || 1));
    while (g < G.length && anteil >= G[g - 1] * KONST.HOCH_BEI) g++;
    while (g > 1 && anteil < G[g - 2] * KONST.RUNTER_BEI) g--;
    return g;
  }
  // Drehzahl in einem Gang (nie unter Leerlauf)
  function drehzahl(anteil, gang) {
    return Math.max(KONST.LEERLAUF, KONST.DREH_MAX * Math.min(1.02, anteil / KONST.GAENGE[gang - 1]));
  }

  // Weißes Rauschen als Schleife, 2 s lang, fester Samen
  function rauschPuffer(ac) {
    const puffer = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = puffer.getChannelData(0);
    let s = 12345;
    for (let i = 0; i < d.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; d[i] = s / 2147483648 - 1; }
    return puffer;
  }

  // Ein Motor: drei Schwinger, Tiefpass, Lautstärke, Panorama
  function motorBauen(ac, ziel) {
    const tief = ac.createOscillator(), haupt = ac.createOscillator(), quinte = ac.createOscillator();
    haupt.type = "sawtooth";
    tief.type = "square";
    quinte.type = "sawtooth";
    quinte.detune.value = 6;
    const gTief = ac.createGain(), gQuinte = ac.createGain();
    gTief.gain.value = 0.45;
    gQuinte.gain.value = 0.18;
    const filter = ac.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 1.1;
    filter.frequency.value = 500;
    const laut = ac.createGain();
    laut.gain.value = 0;
    const pan = ac.createStereoPanner ? ac.createStereoPanner() : null;
    haupt.connect(filter);
    tief.connect(gTief).connect(filter);
    quinte.connect(gQuinte).connect(filter);
    filter.connect(laut);
    if (pan) laut.connect(pan).connect(ziel); else laut.connect(ziel);
    for (const o of [tief, haupt, quinte]) o.start();
    let gang = 1;
    return {
      setze(anteil, last, lautstaerke, seite, t) {
        const neu = gangFuer(anteil, gang);
        const schnell = neu !== gang;
        gang = neu;
        const hz = drehzahl(anteil, gang) * KONST.HZ_JE_UMDREHUNG;
        const tau = schnell ? 0.012 : 0.04; // beim Schalten springt der Ton schnell
        haupt.frequency.setTargetAtTime(hz, t, tau);
        tief.frequency.setTargetAtTime(hz / 2, t, tau);
        quinte.frequency.setTargetAtTime(hz * 1.5, t, tau);
        filter.frequency.setTargetAtTime(380 + 900 * last + hz * 3, t, 0.06);
        laut.gain.setTargetAtTime(lautstaerke, t, 0.07);
        if (pan) pan.pan.setTargetAtTime(seite, t, 0.1);
        return gang;
      },
      get gang() { return gang; },
    };
  }

  /*
   * Der ganze Klang auf einem AudioContext (auch OfflineAudioContext für Tests).
   * setze(zustand, t): zustand = { aktiv, anteil, gas, rutschen, stoesse, turbo, gegner: [{ abstand, quer, anteil }] }
   */
  function klangBauen(ac) {
    const K = KONST;
    const gesamt = ac.createGain();
    gesamt.gain.value = K.LAUT;
    gesamt.connect(ac.destination);
    const motor = motorBauen(ac, gesamt);
    const rauschen = rauschPuffer(ac);
    const quelle = (filterArt, hz, q) => {
      const src = ac.createBufferSource();
      src.buffer = rauschen;
      src.loop = true;
      const f = ac.createBiquadFilter();
      f.type = filterArt;
      f.frequency.value = hz;
      f.Q.value = q;
      const g = ac.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(gesamt);
      src.start();
      return g;
    };
    const reifen = quelle("bandpass", 1700, 3.5);
    const stoss = quelle("lowpass", 260, 0.8);
    const gegner = Array.from({ length: K.GEGNER_STIMMEN }, () => motorBauen(ac, gesamt));
    // Surren des E-Turbos: Grundton und leise Oktave, über einen sanften Tiefpass
    const surren = ac.createGain();
    surren.gain.value = 0;
    const surrFilter = ac.createBiquadFilter();
    surrFilter.type = "lowpass";
    surrFilter.frequency.value = 1400;
    surrFilter.connect(surren).connect(gesamt);
    const surrTon = ac.createOscillator(), surrOktave = ac.createOscillator(), gOktave = ac.createGain();
    surrTon.type = surrOktave.type = "sine";
    gOktave.gain.value = 0.3;
    surrTon.connect(surrFilter);
    surrOktave.connect(gOktave).connect(surrFilter);
    surrTon.start();
    surrOktave.start();
    let stoesse = null;
    return {
      setze(z, t) {
        const aktiv = !!z.aktiv;
        const gang = motor.setze(z.anteil || 0, z.gas || 0, aktiv ? K.MOTOR + K.MOTOR_GAS * (z.gas || 0) : 0, 0, t);
        reifen.gain.setTargetAtTime(aktiv ? K.REIFEN * (z.rutschen || 0) : 0, t, 0.05);
        if (stoesse != null && z.stoesse > stoesse && aktiv) {
          stoss.gain.cancelScheduledValues(t);
          stoss.gain.setValueAtTime(K.STOSS, t);
          stoss.gain.setTargetAtTime(0, t + 0.02, 0.09);
        }
        stoesse = z.stoesse || 0;
        const surrHz = K.TURBO_HZ + K.TURBO_HZ_TEMPO * (z.anteil || 0);
        surrTon.frequency.setTargetAtTime(surrHz, t, 0.1);
        surrOktave.frequency.setTargetAtTime(surrHz * 2.01, t, 0.1);
        surren.gain.setTargetAtTime(aktiv && z.turbo ? K.TURBO : 0, t, K.TURBO_WEICH);
        const nahe = (z.gegner || []).slice().sort((a, b) => Math.abs(a.abstand) - Math.abs(b.abstand));
        gegner.forEach((stimme, i) => {
          const g = nahe[i];
          const naehe = g ? Math.max(0, 1 - Math.abs(g.abstand) / K.GEGNER_WEIT) : 0;
          stimme.setze(g ? g.anteil : 0, 1, aktiv ? K.GEGNER * naehe * naehe : 0, g ? Math.max(-0.8, Math.min(0.8, g.quer * 0.6)) : 0, t);
        });
        return { gang };
      },
    };
  }

  // Ton im Spiel: AudioContext erst mit an(true), das aus einer Nutzergeste heraus aufgerufen werden muss
  function erzeuge() {
    let ac = null, klang = null, an = false;
    function sichtbarkeit() {
      if (!ac) return;
      if (document.hidden) ac.suspend();
      else if (an) ac.resume();
    }
    return {
      an(wert) {
        an = !!wert;
        if (an && !ac) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return false;
          ac = new AC();
          klang = klangBauen(ac);
          document.addEventListener("visibilitychange", sichtbarkeit);
        }
        if (ac) { if (an && !document.hidden) ac.resume(); else if (!an) ac.suspend(); }
        return an;
      },
      get istAn() { return an; },
      get kontext() { return ac; },
      aktualisiere(zustand) {
        if (!klang || !an) return null;
        return klang.setze(zustand, ac.currentTime);
      },
    };
  }

  return { KONST, gangFuer, drehzahl, klangBauen, erzeuge };
});
