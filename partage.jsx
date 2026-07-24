import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import {
  Plus, Minus, X, Trash2, Copy, ChevronLeft, ChevronDown, ArrowRight, ArrowUpDown,
  AlertCircle, Receipt, Download, Share2, Check, Loader2, Image as ImageIcon,
  CalendarDays, Wallet, Users, Info, Home, Utensils, KeyRound,
} from "lucide-react";

/* ==================================================================== */
/*  Partage — deux modules sous une même enveloppe.                     */
/*                                                                      */
/*    Addition  : partage d'une note de restaurant, article par article */
/*    Location  : partage d'un loyer au prorata des nuitées             */
/*                                                                      */
/*  Chaque module garde son état et son stockage propres ; l'accueil    */
/*  n'est qu'un aiguillage.                                             */
/* ==================================================================== */

const CLE_MODULE = "partage:module";

/* ------------------------------------------------------------------ */
/*  Direction : le ticket de caisse. Papier ivoire, encre thermique,   */
/*  un seul accent — le rouge tampon des caisses enregistreuses.       */
/*                                                                     */
/*  papier   #F7F3E8    encre    #1C1A17    encre-pale #8B8578         */
/*  tampon   #C1362F    filet    #DDD5C4    ombre      #E9E2D2         */
/* ------------------------------------------------------------------ */

const COULEURS = [
  "#C1362F", "#2E6F5E", "#B5761F", "#3B5A8C",
  "#8E4576", "#5C7A2E", "#A8523A", "#456B7D",
];

const CLE_ETAT = "addition:encours";
const CLE_HISTO = "addition:historique";
const CLE_NOMS = "addition:noms";

const enCentimes = (v) => Math.round((parseFloat(v) || 0) * 100);
const fmt = (c) =>
  (c / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const dateCourte = (iso) =>
  new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });

function repartir(centimes, n) {
  if (n <= 0) return [];
  const base = Math.floor(centimes / n);
  const reste = centimes - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < reste ? 1 : 0));
}


/* ---------- fractions exactes ---------- */
/* Stockées en [numérateur, dénominateur] : ⅓+⅓+⅓ fait exactement 1, pas 0,9999. */

const pgcd = (a, b) => (b === 0 ? a : pgcd(b, a % b));

/** Fraction d'un participant sur une ligne. [1,1] par défaut (part pleine). */
const fractionDe = (ligne, id) => {
  const f = ligne.parts?.[id];
  return Array.isArray(f) && f.length === 2 && f[1] > 0 ? f : [1, 1];
};

/** Somme exacte d'une liste de fractions, réduite. */
function sommeFractions(fractions) {
  let [n, d] = [0, 1];
  for (const [fn, fd] of fractions) {
    n = n * fd + fn * d;
    d = d * fd;
    const g = pgcd(Math.abs(n) || 1, d);
    n /= g; d /= g;
  }
  return [n, d];
}

/** Compare une fraction à un entier cible. Renvoie -1, 0 ou 1. */
const compareCible = ([n, d], cible) => {
  const g = n - cible * d;
  return g < 0 ? -1 : g > 0 ? 1 : 0;
};

/**
 * Parts égales pour n personnes sur q exemplaires, si le résultat tombe sur une
 * fraction représentable (dénominateur ≤ 4 après réduction). Sinon null :
 * on laisse alors le partage implicite, qui divise exactement.
 */
function partsEgales(quantite, nombre) {
  if (nombre <= 0) return null;
  const g = pgcd(quantite, nombre);
  const [n, d] = [quantite / g, nombre / g];
  if (d > 4) return null;
  return [n, d];
}

/** Réduit une fraction à sa forme irréductible. */
function reduire([n, d]) {
  if (d < 0) { n = -n; d = -d; }
  const g = pgcd(Math.abs(n) || 1, d);
  return [n / g, d / g];
}

/**
 * Attribue le reste d'une ligne à un sous-ensemble de participants.
 * Leur part est remplacée par reste ÷ nombre de désignés, en fraction exacte
 * (peut sortir de la palette : ⅙, ⅕… c'est voulu, le calcul reste juste).
 */
function attribuerReste(ligne, designes) {
  const ids = ligne.participantIds;
  if (designes.length === 0) return ligne.parts;

  // somme des parts de ceux qui ne sont pas désignés
  const autres = ids.filter((id) => !designes.includes(id));
  const sommeAutres = sommeFractions(autres.map((id) => fractionDe(ligne, id)));
  const cible = ligne.quantite ?? 1;

  // reste = cible − somme des autres
  const reste = reduire(sommeFractions([[cible, 1], [-sommeAutres[0], sommeAutres[1]]]));
  if (reste[0] <= 0) return ligne.parts;

  const chacun = reduire([reste[0], reste[1] * designes.length]);
  const parts = { ...(ligne.parts || {}) };
  for (const id of designes) parts[id] = chacun;
  for (const id of autres) if (!parts[id]) parts[id] = fractionDe(ligne, id);
  return parts;
}

/** Parts d'une ligne en partage égal. undefined si 1 chacun ou non exprimable. */
function partsEquilibrees(ligne, ids) {
  const eg = partsEgales(ligne.quantite ?? 1, ids.length);
  if (!eg || eg[0] === eg[1]) return undefined;
  return Object.fromEntries(ids.map((id) => [id, eg]));
}

const texteFraction = ([n, d]) => (d === 1 ? String(n) : `${n}/${d}`);

/**
 * Répartit un montant selon des fractions exactes, en centimes entiers.
 * Le reliquat d'arrondi va aux plus fortes décimales ; `graine` fait tourner
 * l'attribution d'une ligne à l'autre.
 */
function repartirFractions(centimes, fractions, graine = 0) {
  const total = sommeFractions(fractions);
  if (total[0] <= 0) return fractions.map(() => 0);
  // chaque part vaut (sa fraction / somme des fractions) du montant total de la ligne
  const bruts = fractions.map(([n, d]) => (centimes * n * total[1]) / (d * total[0]));
  const planchers = bruts.map(Math.floor);
  const reste = centimes - planchers.reduce((a, b) => a + b, 0);

  const ordre = bruts
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const depart = fractions.length ? graine % fractions.length : 0;
  for (let k = 0; k < reste; k++) planchers[ordre[(k + depart) % ordre.length].i]++;

  return planchers;
}

const totalLigne = (l) => l.montant * (l.quantite ?? 1);

function calculer(participants, lignes, extras) {
  const sousTotaux = Object.fromEntries(participants.map((p) => [p.id, 0]));
  const details = Object.fromEntries(participants.map((p) => [p.id, []]));

  for (const ligne of lignes) {
    const ids = ligne.participantIds.filter((id) => sousTotaux[id] !== undefined);
    if (ids.length === 0) continue;

    const fractions = ids.map((id) => fractionDe(ligne, id));
    const montants = repartirFractions(totalLigne(ligne), fractions, ligne.id);

    ids.forEach((id, i) => {
      sousTotaux[id] += montants[i];
      details[id].push({
        id: ligne.id,
        libelle: ligne.libelle,
        quantite: ligne.quantite ?? 1,
        partage: ids.length,
        fraction: fractions[i],
        part: montants[i],
      });
    });
  }

  const totalLignes = Object.values(sousTotaux).reduce((a, b) => a + b, 0);
  const service = extras.service;

  let partsService;
  if (service === 0 || participants.length === 0) {
    partsService = Object.fromEntries(participants.map((p) => [p.id, 0]));
  } else if (extras.mode === "egal" || totalLignes === 0) {
    const parts = repartir(service, participants.length);
    partsService = Object.fromEntries(participants.map((p, i) => [p.id, parts[i]]));
  } else {
    const bruts = participants.map((p) => (sousTotaux[p.id] * service) / totalLignes);
    const planchers = bruts.map(Math.floor);
    const reste = service - planchers.reduce((a, b) => a + b, 0);
    const ordre = bruts
      .map((v, i) => ({ i, frac: v - Math.floor(v) }))
      .sort((a, b) => b.frac - a.frac);
    for (let k = 0; k < reste; k++) planchers[ordre[k % ordre.length].i]++;
    partsService = Object.fromEntries(participants.map((p, i) => [p.id, planchers[i]]));
  }

  const resultats = participants.map((p) => ({
    ...p,
    sousTotal: sousTotaux[p.id],
    service: partsService[p.id],
    total: sousTotaux[p.id] + partsService[p.id],
    articles: details[p.id],
  }));

  return { resultats, totalLignes, service, total: totalLignes + service };
}

/* ---------- export image ---------- */

function dessinerTicket(titre, dateISO, calcul) {
  const E = 3;                 // densité, pour un rendu net sur écran rétine
  const L = 680;               // largeur logique
  const pad = 44;
  const H_LIGNE = 26;
  const H_ENTETE = 28;
  const H_ESPACE = 26;

  const mono = (t, w = "400") => `${w} ${t}px "Roboto Mono", ui-monospace, monospace`;
  const sans = (t, w = "400") => `${w} ${t}px Archivo, system-ui, sans-serif`;

  // ---- passe 1 : dessin sur une toile généreuse, on note où l'encre s'arrête
  const hMax =
    pad + 90 +
    calcul.resultats.reduce(
      (n, r) => n + H_ENTETE + r.articles.length * H_LIGNE + (r.service > 0 ? H_LIGNE : 0) + H_ESPACE,
      0
    ) + 200;

  const c = document.createElement("canvas");
  c.width = L * E;
  c.height = Math.ceil(hMax) * E;
  const x = c.getContext("2d");
  if (!x) return null;
  x.scale(E, E);
  x.textBaseline = "alphabetic";

  x.fillStyle = "#F7F3E8";
  x.fillRect(0, 0, L, hMax);

  const tronque = (texte, largeurMax) => {
    if (x.measureText(texte).width <= largeurMax) return texte;
    let t = texte;
    while (t.length > 1 && x.measureText(t + "…").width > largeurMax) t = t.slice(0, -1);
    return t + "…";
  };

  let y = pad + 26;

  x.fillStyle = "#1C1A17";
  x.font = sans(30, "700");
  x.fillText(tronque(titre, L - pad * 2), pad, y);

  y += 24;
  x.fillStyle = "#8B8578";
  x.font = mono(14);
  x.fillText(
    new Date(dateISO).toLocaleDateString("fr-FR", {
      weekday: "long", day: "numeric", month: "long", year: "numeric",
    }),
    pad, y
  );

  y += 30;
  x.strokeStyle = "#DDD5C4";
  x.lineWidth = 1;
  x.setLineDash([4, 4]);
  x.beginPath(); x.moveTo(pad, y); x.lineTo(L - pad, y); x.stroke();
  x.setLineDash([]);
  y += 34;

  calcul.resultats.forEach((r, index) => {
    if (index > 0) {
      x.strokeStyle = "#E5DECD";
      x.lineWidth = 1;
      x.beginPath(); x.moveTo(pad, y - 20); x.lineTo(L - pad, y - 20); x.stroke();
    }

    x.fillStyle = r.couleur;
    x.beginPath(); x.arc(pad + 14, y - 6, 14, 0, Math.PI * 2); x.fill();
    x.fillStyle = "#F7F3E8";
    x.font = sans(12, "700");
    x.textAlign = "center";
    x.fillText(r.nom.slice(0, 2).toUpperCase(), pad + 14, y - 1);
    x.textAlign = "left";

    x.fillStyle = "#1C1A17";
    x.font = mono(21, "700");
    const largeurTotal = x.measureText(fmt(r.total) + " €").width;
    x.textAlign = "right";
    x.fillText(`${fmt(r.total)} €`, L - pad, y);
    x.textAlign = "left";

    x.font = sans(19, "600");
    x.fillText(tronque(r.nom, L - pad * 2 - 38 - largeurTotal - 16), pad + 38, y);

    y += H_ENTETE;

    x.font = mono(13);
    for (const a of r.articles) {
      x.fillStyle = "#8B8578";
      const q = a.quantite > 1 ? `${a.quantite}× ` : "";
      const d = a.partage > 1
        ? (a.fraction && a.fraction[0] !== a.fraction[1]
            ? ` ${nomFraction(a.fraction)}/${a.quantite}`
            : ` ÷${a.partage}`)
        : "";
      const montant = fmt(a.part);
      const largeurM = x.measureText(montant).width;
      x.fillText(tronque(`${q}${a.libelle}${d}`, L - pad * 2 - 38 - largeurM - 16), pad + 38, y);
      x.textAlign = "right";
      x.fillText(montant, L - pad, y);
      x.textAlign = "left";
      y += H_LIGNE;
    }

    if (r.articles.length === 0) {
      x.fillStyle = "#B0A897";
      x.font = mono(13);
      x.fillText("rien pris", pad + 38, y);
      y += H_LIGNE;
    }

    if (r.service > 0) {
      x.fillStyle = "#8B8578";
      x.font = mono(13);
      x.fillText("Service", pad + 38, y);
      x.textAlign = "right";
      x.fillText(fmt(r.service), L - pad, y);
      x.textAlign = "left";
      y += H_LIGNE;
    }

    y += H_ESPACE;
  });

  // bloc total
  y -= 6;
  x.strokeStyle = "#1C1A17";
  x.lineWidth = 1.5;
  x.beginPath(); x.moveTo(pad, y); x.lineTo(L - pad, y); x.stroke();
  y += 30;
  x.fillStyle = "#1C1A17";
  x.font = sans(19, "700");
  x.fillText("Total", pad, y);
  x.font = mono(21, "700");
  x.textAlign = "right";
  x.fillText(`${fmt(calcul.total)} €`, L - pad, y);
  x.textAlign = "left";

  // ---- passe 2 : recadrage à la hauteur réelle du contenu + marge égale au padding
  const hReelle = Math.ceil(y + 12 + pad);
  const finale = document.createElement("canvas");
  finale.width = L * E;
  finale.height = hReelle * E;
  const fx = finale.getContext("2d");
  if (!fx) return c;
  fx.fillStyle = "#F7F3E8";
  fx.fillRect(0, 0, finale.width, finale.height);
  fx.drawImage(c, 0, 0, L * E, hReelle * E, 0, 0, L * E, hReelle * E);

  return finale;
}

/* ---------- composants ---------- */

function Pastille({ participant, actif, onClick, taille = 36 }) {
  const initiales = participant.nom.trim().slice(0, 2).toUpperCase() || "?";
  return (
    <button
      onClick={onClick}
      aria-pressed={actif}
      aria-label={participant.nom}
      style={{
        width: taille, height: taille,
        background: actif ? participant.couleur : "#F7F3E8",
        color: actif ? "#F7F3E8" : "#B0A897",
        borderColor: actif ? participant.couleur : "#DDD5C4",
      }}
      className="shrink-0 rounded-full border flex items-center justify-center
                 text-[12px] font-semibold tracking-[0.02em]
                 transition-[background-color,color,border-color,transform] duration-200
                 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1C1A17]
                 focus-visible:ring-offset-2 focus-visible:ring-offset-[#F7F3E8]
                 active:scale-90 motion-reduce:transition-none"
    >
      {initiales}
    </button>
  );
}

function ChampMontant({ centimes, onChange, className, ...props }) {
  const [brouillon, setBrouillon] = useState(null);
  const affiche = brouillon ?? fmt(centimes);
  return (
    <input
      value={affiche}
      onChange={(e) => {
        const v = e.target.value;
        if (!/^[\d.,]*$/.test(v)) return;
        setBrouillon(v);
        onChange(enCentimes(v.replace(",", ".")));
      }}
      onFocus={(e) => { setBrouillon(centimes === 0 ? "" : fmt(centimes)); e.target.select(); }}
      onBlur={() => setBrouillon(null)}
      inputMode="decimal"
      className={className}
      {...props}
    />
  );
}

function Compteur({ valeur, onChange, compact = false }) {
  const inactif = valeur <= 1;
  const t = compact ? "h-6 w-6" : "h-7 w-7";
  return (
    <span className={`flex shrink-0 items-center gap-0.5 rounded-full p-0.5 transition-colors
                      ${inactif ? "bg-transparent" : "bg-[#F2EDE0]"}`}>
      <button onClick={() => onChange(-1)} disabled={inactif} aria-label="Retirer un exemplaire"
        className={`${t} flex items-center justify-center rounded-full text-[#8B8578]
                    hover:bg-white hover:text-[#1C1A17] disabled:text-[#D3CBB8]
                    disabled:hover:bg-transparent transition-colors`}>
        <Minus size={compact ? 12 : 13} strokeWidth={2.5} />
      </button>
      <span aria-live="polite"
        className={`min-w-[18px] text-center tabular-nums font-bold
                    ${compact ? "text-[12px]" : "text-[13px]"}
                    ${inactif ? "text-[#B0A897]" : "text-[#1C1A17]"}`}
        style={{ fontFamily: "'Roboto Mono', monospace" }}>
        {valeur}
      </span>
      <button onClick={() => onChange(1)} aria-label="Ajouter un exemplaire"
        className={`${t} flex items-center justify-center rounded-full text-[#8B8578]
                    hover:bg-white hover:text-[#1C1A17] transition-colors`}>
        <Plus size={compact ? 12 : 13} strokeWidth={2.5} />
      </button>
    </span>
  );
}

/* ---------- affichage des parts ---------- */
/* Une part = un nombre d'exemplaires : 1, 2, 3… ou ½, 1½ pour les partages. */

const SYMBOLE_DEMI = {
  "1/2": "½", "1/3": "⅓", "2/3": "⅔", "1/4": "¼", "3/4": "¾",
  "1/5": "⅕", "2/5": "⅖", "3/5": "⅗", "4/5": "⅘",
  "1/6": "⅙", "5/6": "⅚", "1/8": "⅛", "3/8": "⅜", "5/8": "⅝", "7/8": "⅞",
};

/** Écrit [3,2] en "1½", [1,3] en "⅓", [2,1] en "2", [4,3] en "1⅓". */
function nomFraction([n, d]) {
  if (d === 1) return String(n);
  const entier = Math.floor(n / d);
  const reste = n - entier * d;
  if (reste === 0) return String(entier);
  const sym = SYMBOLE_DEMI[`${reste}/${d}`] ?? `${reste}/${d}`;
  return entier > 0 ? `${entier}${sym}` : sym;
}

/**
 * Paliers de parts : à chaque niveau entier, les fractions irréductibles
 * à dénominateur ≤ 4 (¼ ⅓ ½ ⅔ ¾). Permet 1⅓ + 1⅔ = 3, ¼ + ¾ = 1, etc.
 */
const FRACTIONS_BASE = [[0, 1], [1, 4], [1, 3], [1, 2], [2, 3], [3, 4]];
const MAX_ENTIER = 10;

const PALIERS = (() => {
  const liste = [];
  for (let e = 0; e <= MAX_ENTIER; e++) {
    for (const [fn, fd] of FRACTIONS_BASE) {
      if (e === 0 && fn === 0) continue;        // pas de part nulle
      if (e === MAX_ENTIER && fn !== 0) break;  // on s'arrête à 10 pile
      liste.push([e * fd + fn, fd]);
    }
  }
  return liste;
})();

/** Palier suivant ou précédent. */
function pasSuivant([n, d], sens) {
  const v = n / d;
  const i = PALIERS.findIndex((p) => Math.abs(p[0] / p[1] - v) < 0.0001);
  if (i === -1) {
    // valeur hors palette (issue d'une attribution de reste) : on rejoint la palette
    const candidats = PALIERS.filter((p) => (sens > 0 ? p[0] / p[1] > v : p[0] / p[1] < v));
    if (candidats.length === 0) return sens > 0 ? PALIERS[PALIERS.length - 1] : PALIERS[0];
    return sens > 0 ? candidats[0] : candidats[candidats.length - 1];
  }
  const j = Math.max(0, Math.min(PALIERS.length - 1, i + sens));
  return PALIERS[j];
}

/** Entier suivant ou précédent — pour l'appui long, qui saute les fractions. */
function entierSuivant([n, d], sens) {
  const v = n / d;
  const cible = sens > 0 ? Math.floor(v) + 1 : Math.ceil(v) - 1;
  return [Math.max(1, Math.min(MAX_ENTIER, cible)), 1];
}

/** Avatar + nombre d'exemplaires, réglable par − et +. Appui long = saut à l'entier. */
function PastilleParts({ participant, actif, fraction, onBasculer, onFraction, taille = 36 }) {
  const initiales = participant.nom.trim().slice(0, 2).toUpperCase() || "?";
  const pleine = fraction[0] === fraction[1];
  const minuterie = useRef(null);
  const aSaute = useRef(false);

  const demarrer = (sens) => {
    aSaute.current = false;
    minuterie.current = setTimeout(() => {
      aSaute.current = true;
      onFraction(entierSuivant(fraction, sens));
    }, 450);
  };
  const relacher = (sens) => {
    clearTimeout(minuterie.current);
    if (!aSaute.current) onFraction(pasSuivant(fraction, sens));
    aSaute.current = false;
  };
  const annuler = () => { clearTimeout(minuterie.current); aSaute.current = false; };

  const commande = (sens, symbole, etiquette) => (
    <button
      onPointerDown={() => demarrer(sens)}
      onPointerUp={() => relacher(sens)}
      onPointerLeave={annuler}
      onPointerCancel={annuler}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onFraction(pasSuivant(fraction, sens)); } }}
      aria-label={etiquette}
      className={`flex h-[26px] w-[26px] items-center justify-center rounded-full text-[16px]
                  font-medium leading-none transition-colors touch-none select-none ${
        pleine ? "text-[#8B8578] hover:bg-white hover:text-[#1C1A17]"
               : "text-[#F7F3E8]/70 hover:bg-white/15 hover:text-[#F7F3E8]"}`}
    >
      {symbole}
    </button>
  );

  return (
    <span className="flex shrink-0 flex-col items-center gap-1">
      <button
        onClick={onBasculer}
        aria-pressed={actif}
        aria-label={participant.nom}
        style={{
          width: taille, height: taille,
          background: actif ? participant.couleur : "#F7F3E8",
          color: actif ? "#F7F3E8" : "#B0A897",
          borderColor: actif ? participant.couleur : "#DDD5C4",
        }}
        className="rounded-full border flex items-center justify-center text-[12px] font-semibold
                   tracking-[0.02em] transition-[background-color,color,border-color,transform]
                   duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1C1A17]
                   focus-visible:ring-offset-2 focus-visible:ring-offset-[#F7F3E8]
                   active:scale-90 motion-reduce:transition-none"
      >
        {initiales}
      </button>

      {actif ? (
        <span className={`flex items-center gap-px rounded-full transition-colors ${
                pleine ? "bg-[#F2EDE0]" : "bg-[#1C1A17]"}`}>
          {commande(-1, "−", `Moins pour ${participant.nom}`)}
          <span
            aria-label={`Part de ${participant.nom} : ${texteFraction(fraction)}`}
            className={`min-w-[20px] text-center text-[12px] font-bold leading-none ${
              pleine ? "text-[#8B8578]" : "text-[#F7F3E8]"}`}
            style={{ fontFamily: "'Roboto Mono', monospace" }}
          >
            {nomFraction(fraction)}
          </span>
          {commande(1, "+", `Plus pour ${participant.nom}`)}
        </span>
      ) : (
        <span className="h-[26px]" aria-hidden="true" />
      )}
    </span>
  );
}

/* ---------- application ---------- */

const etatVierge = () => ({
  titre: "",
  date: new Date().toISOString(),
  participants: [],
  lignes: [],
  extras: { service: 0, mode: "prorata" },
  totalAttendu: 0,     // ce qu'affiche le ticket ; 0 = non renseigné
  prochainId: 1000,
});

function ModuleAddition({ onRetour }) {
  const [pret, setPret] = useState(false);
  const [ecran, setEcran] = useState("historique");
  const [etat, setEtat] = useState(etatVierge);
  const [historique, setHistorique] = useState([]);
  const [nomsConnus, setNomsConnus] = useState([]);

  const [nouveauNom, setNouveauNom] = useState("");
  const [libelle, setLibelle] = useState("");
  const [montant, setMontant] = useState("");
  const [quantite, setQuantite] = useState(1);
  const [selection, setSelection] = useState([]);
  const [deplie, setDeplie] = useState([]);
  const [exportEtat, setExportEtat] = useState("pret");
  const [image, setImage] = useState(null);
  const [partageEtat, setPartageEtat] = useState("pret");
  const [confirmation, setConfirmation] = useState(null);
  const [resteLigne, setResteLigne] = useState(null); // { ligneId, designes[] }
  const [tri, setTri] = useState("saisie");           // saisie | montant | nom
  const [sauvegarde, setSauvegarde] = useState("repos"); // repos | cours | ok | erreur

  const refLibelle = useRef(null);
  const premierRendu = useRef(true);
  const secours = useRef({});

  const { participants, lignes, extras } = etat;

  /* --- chargement initial --- */
  useEffect(() => {
    (async () => {
      const lire = async (cle, defaut) => {
        try {
          const r = await window.storage?.get(cle);
          if (r?.value) return JSON.parse(r.value);
        } catch { /* clé absente ou stockage indisponible */ }
        try {
          if (secours.current[cle]) return JSON.parse(secours.current[cle]);
        } catch { /* secours illisible */ }
        return defaut;
      };
      const [e, h, n] = await Promise.all([
        lire(CLE_ETAT, null),
        lire(CLE_HISTO, []),
        lire(CLE_NOMS, []),
      ]);
      setHistorique(Array.isArray(h) ? h : []);
      setNomsConnus(Array.isArray(n) ? n : []);
      if (e && e.lignes) {
        setEtat(e);
        setEcran("saisie");
      } else if (Array.isArray(h) && h.length === 0) {
        setEcran("saisie");
        setEtat({ ...etatVierge(), participants: [] });
      }
      setPret(true);
    })();
  }, []);

  /**
   * Écritures sérialisées : deux sauvegardes simultanées déclenchent la
   * limitation de débit du stockage. On enfile, on écrit une par une.
   */
  const file = useRef(Promise.resolve());

  const ecrire = useCallback((cle, valeur) => {
    const texte = JSON.stringify(valeur);
    secours.current[cle] = texte;

    if (!window.storage?.set) {
      setSauvegarde("local");
      return Promise.resolve(false);
    }

    const tache = file.current.then(async () => {
      setSauvegarde("cours");
      for (let essai = 0; essai < 3; essai++) {
        try {
          const r = await window.storage.set(cle, texte);
          if (!r) throw new Error("écriture refusée");
          setSauvegarde("ok");
          return true;
        } catch (err) {
          if (essai < 2) {
            await new Promise((r) => setTimeout(r, 500 * (essai + 1)));
            continue;
          }
          console.error("Sauvegarde impossible:", cle, err);
          setSauvegarde("erreur");
          return false;
        }
      }
      return false;
    });

    // la file continue même si une écriture échoue
    file.current = tache.catch(() => {});
    return tache;
  }, []);

  /* --- sauvegarde de l'addition en cours --- */
  useEffect(() => {
    if (!pret) return;
    if (premierRendu.current) { premierRendu.current = false; return; }
    const t = setTimeout(() => { ecrire(CLE_ETAT, etat); }, 900);
    return () => clearTimeout(t);
  }, [etat, pret, ecrire]);

  /* --- sauvegarde différée de la liste des prénoms --- */
  useEffect(() => {
    if (!pret || nomsConnus.length === 0) return;
    const t = setTimeout(() => { ecrire(CLE_NOMS, nomsConnus); }, 1200);
    return () => clearTimeout(t);
  }, [nomsConnus, pret, ecrire]);

  const majEtat = useCallback((f) => setEtat((e) => ({ ...e, ...f(e) })), []);
  const lignesAffichees = useMemo(() => {
    if (tri === "saisie") return lignes;
    const copie = [...lignes];
    if (tri === "montant")
      copie.sort((a, b) => totalLigne(b) - totalLigne(a));
    else if (tri === "nom")
      copie.sort((a, b) => a.libelle.localeCompare(b.libelle, "fr", { sensitivity: "base" }));
    return copie;
  }, [lignes, tri]);

  const nonAttribuees = lignes.filter((l) => l.participantIds.length === 0).length;
  const desequilibrees = lignes.filter((l) => {
    if (l.participantIds.length === 0) return false;
    const q = l.quantite ?? 1;
    // partage égal automatique : toujours juste, rien à vérifier
    if (!l.reglee) return false;
    return compareCible(
      sommeFractions(l.participantIds.map((id) => fractionDe(l, id))),
      q
    ) !== 0;
  }).length;
  const bloque = nonAttribuees > 0 || desequilibrees > 0;
  const nbArticles = lignes.reduce((n, l) => n + (l.quantite ?? 1), 0);
  const calcul = useMemo(() => calculer(participants, lignes, extras), [participants, lignes, extras]);
  const ecartTotal = (etat.totalAttendu ?? 0) > 0 ? calcul.total - etat.totalAttendu : 0;

  /* --- participants --- */
  const ajouterNom = (nom) => {
    const n = nom.trim();
    if (!n) return;
    if (participants.some((p) => p.nom.toLowerCase() === n.toLowerCase())) return;
    majEtat((e) => ({
      participants: [
        ...e.participants,
        { id: e.prochainId + 1, nom: n, couleur: COULEURS[e.participants.length % COULEURS.length] },
      ],
      prochainId: e.prochainId + 1,
    }));
    setNomsConnus((ns) =>
      [n, ...ns.filter((x) => x.toLowerCase() !== n.toLowerCase())].slice(0, 12)
    );
    setNouveauNom("");
  };

  const retirerParticipant = (id) =>
    majEtat((e) => ({
      participants: e.participants.filter((x) => x.id !== id),
      lignes: e.lignes.map((l) => {
        if (!l.parts) return { ...l, participantIds: l.participantIds.filter((x) => x !== id) };
        const parts = { ...l.parts };
        delete parts[id];
        return {
          ...l,
          participantIds: l.participantIds.filter((x) => x !== id),
          parts: Object.keys(parts).length ? parts : undefined,
        };
      }),
    }));

  /* --- lignes --- */
  const ajouterLigne = () => {
    const c = enCentimes(montant);
    if (c <= 0) return;
    majEtat((e) => ({
      lignes: [
        ...e.lignes,
        (() => {
          const base = {
            id: e.prochainId + 1,
            libelle: libelle.trim() || "Article",
            montant: c, quantite,
            participantIds: [...selection],
          };
          return { ...base, parts: partsEquilibrees(base, base.participantIds) };
        })(),
      ],
      prochainId: e.prochainId + 1,
    }));
    setLibelle(""); setMontant(""); setQuantite(1); setSelection([]);
    refLibelle.current?.focus();
  };

  const modifierLigne = (id, champ, valeur) =>
    majEtat((e) => ({ lignes: e.lignes.map((l) => (l.id !== id ? l : { ...l, [champ]: valeur })) }));

  const changerQuantite = (id, d) =>
    majEtat((e) => ({
      lignes: e.lignes.map((l) => {
        if (l.id !== id) return l;
        const suite = { ...l, quantite: Math.max(1, Math.min(99, (l.quantite ?? 1) + d)) };
        return { ...suite, parts: partsEquilibrees(suite, suite.participantIds), reglee: false };
      }),
    }));

  const dupliquerLigne = (id) =>
    majEtat((e) => {
      const i = e.lignes.findIndex((l) => l.id === id);
      if (i === -1) return {};
      const copie = { ...e.lignes[i], id: e.prochainId + 1,
        participantIds: [...e.lignes[i].participantIds],
        parts: e.lignes[i].parts ? { ...e.lignes[i].parts } : undefined };
      return {
        lignes: [...e.lignes.slice(0, i + 1), copie, ...e.lignes.slice(i + 1)],
        prochainId: e.prochainId + 1,
      };
    });

  const supprimerLigne = (id) =>
    majEtat((e) => ({ lignes: e.lignes.filter((l) => l.id !== id) }));

  const basculer = (ligneId, pid) =>
    majEtat((e) => ({
      lignes: e.lignes.map((l) => {
        if (l.id !== ligneId) return l;
        const ids = l.participantIds.includes(pid)
          ? l.participantIds.filter((x) => x !== pid)
          : [...l.participantIds, pid];
        return { ...l, participantIds: ids, parts: partsEquilibrees(l, ids), reglee: false };
      }),
    }));

  const changerFraction = (ligneId, pid, fraction) =>
    majEtat((e) => ({
      lignes: e.lignes.map((l) => {
        if (l.id !== ligneId) return l;
        const parts = { ...(l.parts || {}) };
        parts[pid] = fraction;
        return { ...l, parts, reglee: true };
      }),
    }));

  const validerReste = () => {
    if (!resteLigne || resteLigne.designes.length === 0) return;
    majEtat((e) => ({
      lignes: e.lignes.map((l) =>
        l.id !== resteLigne.ligneId ? l : { ...l, parts: attribuerReste(l, resteLigne.designes), reglee: true }),
    }));
    setResteLigne(null);
  };

  /** Remet la ligne en partage égal. */
  const equilibrer = (ligneId) =>
    majEtat((e) => ({
      lignes: e.lignes.map((l) =>
        l.id !== ligneId || l.participantIds.length === 0
          ? l
          : { ...l, parts: partsEquilibrees(l, l.participantIds), reglee: false }),
    }));

  const tousOuAucun = (ligneId, tous) =>
    majEtat((e) => ({
      lignes: e.lignes.map((l) => {
        if (l.id !== ligneId) return l;
        const ids = tous ? e.participants.map((p) => p.id) : [];
        return { ...l, participantIds: ids, parts: partsEquilibrees(l, ids), reglee: false };
      }),
    }));

  /* --- historique --- */
  const titreAuto = () =>
    etat.titre.trim() ||
    `Addition du ${new Date(etat.date).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}`;

  const cloturer = async () => {
    const entree = { ...etat, titre: titreAuto(), cloturee: new Date().toISOString(), total: calcul.total };
    const suite = [entree, ...historique].slice(0, 50);
    setHistorique(suite);
    await ecrire(CLE_HISTO, suite);
    const vierge = { ...etatVierge(), prochainId: etat.prochainId + 100 };
    setEtat(vierge);
    await ecrire(CLE_ETAT, vierge);
    setDeplie([]);
    setEcran("historique");
  };

  const rouvrir = (entree) => {
    setEtat({ ...entree });
    setDeplie([]);
    setEcran("saisie");
  };

  const supprimerHisto = async (dateISO) => {
    const suite = historique.filter((h) => h.cloturee !== dateISO);
    setHistorique(suite);
    await ecrire(CLE_HISTO, suite);
  };

  const abandonner = async () => {
    const vierge = { ...etatVierge(), prochainId: etat.prochainId + 100 };
    setEtat(vierge);
    await ecrire(CLE_ETAT, vierge);
    setDeplie([]); setImage(null); setConfirmation(null);
    setEcran("historique");
  };

  const nouvelleAddition = () => {
    setEtat({ ...etatVierge(), prochainId: etat.prochainId + 100 });
    setDeplie([]);
    setEcran("saisie");
  };

  /* --- export --- */
  const exporter = async () => {
    setExportEtat("cours");
    try {
      const canvas = dessinerTicket(titreAuto(), etat.date, calcul);
      if (!canvas) throw new Error("canvas indisponible");
      const url = canvas.toDataURL("image/png");
      setImage(url);
      setExportEtat("pret");
    } catch {
      setExportEtat("erreur");
      setTimeout(() => setExportEtat("pret"), 3000);
    }
  };

  const fichierImage = async () => {
    const blob = await (await fetch(image)).blob();
    const nom = `${titreAuto().replace(/[^\w\sÀ-ÿ-]/g, "").trim() || "addition"}.png`;
    return { blob, nom, fichier: new File([blob], nom, { type: "image/png" }) };
  };

  const partager = async () => {
    if (!image) return;
    try {
      const { fichier } = await fichierImage();
      if (navigator.canShare?.({ files: [fichier] })) {
        await navigator.share({ files: [fichier], title: titreAuto() });
        return;
      }
      setPartageEtat("indisponible");
      setTimeout(() => setPartageEtat("pret"), 3500);
    } catch (err) {
      if (err?.name === "AbortError") return;
      setPartageEtat("indisponible");
      setTimeout(() => setPartageEtat("pret"), 3500);
    }
  };

  const telecharger = async () => {
    if (!image) return;
    try {
      const { blob, nom } = await fichierImage();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = nom;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setPartageEtat("telecharge");
      setTimeout(() => setPartageEtat("pret"), 2500);
    } catch {
      setPartageEtat("indisponible");
      setTimeout(() => setPartageEtat("pret"), 3500);
    }
  };

  const suggestions = nomsConnus.filter(
    (n) => !participants.some((p) => p.nom.toLowerCase() === n.toLowerCase())
  );

  const styles = `
    @import url('https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=Roboto+Mono:wght@400;500;700&display=swap');
    .grain::before {
      content: ""; position: fixed; inset: 0; pointer-events: none; opacity: .035; z-index: -1;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)'/%3E%3C/svg%3E");
    }
    .dents {
      -webkit-mask-image: radial-gradient(circle at 5px -1px, transparent 5px, #000 5.5px);
      mask-image: radial-gradient(circle at 5px -1px, transparent 5px, #000 5.5px);
      -webkit-mask-size: 10px 10px; mask-size: 10px 10px;
      -webkit-mask-repeat: repeat-x; mask-repeat: repeat-x;
    }
    @keyframes monte { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
    .monte { animation: monte .28s cubic-bezier(.2,.7,.3,1) both; }
    @media (prefers-reduced-motion: reduce) { .monte { animation: none; } }
  `;

  if (!pret) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F7F3E8]">
        <Loader2 size={22} className="animate-spin text-[#B0A897]" />
      </div>
    );
  }

  return (
    <div className="relative grain min-h-screen bg-[#F7F3E8] text-[#1C1A17] antialiased"
         style={{ fontFamily: "'Archivo', system-ui, sans-serif" }}>
      <style>{styles}</style>

      <div className="relative z-[1] mx-auto max-w-[430px] px-5 pb-44">

        {/* ================= HISTORIQUE ================= */}
        {ecran === "historique" && (
          <>
            <header className="pt-10 pb-8">
              <button onClick={onRetour}
                className="mb-5 -ml-1 flex items-center gap-1 text-[13px] transition-colors"
                style={{ color: "#8B8578" }}>
                <ChevronLeft size={16} /> Accueil
              </button>
              <h1 className="text-[34px] font-bold leading-[0.95] tracking-[-0.035em]">Mes additions</h1>
              <p className="mt-2 text-[13px] text-[#8B8578]">
                {historique.length === 0
                  ? "Rien pour l'instant."
                  : `${historique.length} ${historique.length > 1 ? "additions gardées" : "addition gardée"}`}
              </p>
            </header>

            {lignes.length > 0 && (
              <button onClick={() => setEcran("saisie")}
                className="monte mb-4 flex w-full items-center gap-3 rounded-[18px] border border-dashed
                           border-[#C1362F] bg-[#FBEBE8] p-4 text-left">
                <Receipt size={18} className="shrink-0 text-[#C1362F]" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-semibold text-[#C1362F]">Addition en cours</span>
                  <span className="block text-[11.5px] text-[#C1362F]/70"
                        style={{ fontFamily: "'Roboto Mono', monospace" }}>
                    {nbArticles} articles · {fmt(calcul.total)} €
                  </span>
                </span>
                <ArrowRight size={16} className="shrink-0 text-[#C1362F]" />
              </button>
            )}

            {historique.length === 0 ? (
              <p className="rounded-[18px] border border-dashed border-[#DDD5C4] px-6 py-12 text-center
                            text-[13.5px] leading-relaxed text-[#8B8578]">
                Les additions terminées<br />apparaîtront ici.
              </p>
            ) : (
              <ul className="space-y-2.5">
                {historique.map((h, i) => (
                  <li key={h.cloturee}
                      className="monte flex items-center gap-3 rounded-[18px] bg-white p-4
                                 shadow-[0_0_0_1px_#E9E2D2]"
                      style={{ animationDelay: `${i * 35}ms` }}>
                    <button onClick={() => rouvrir(h)} className="min-w-0 flex-1 text-left">
                      <span className="block truncate text-[15px] font-semibold tracking-[-0.01em]">
                        {h.titre}
                      </span>
                      <span className="mt-0.5 block text-[11.5px] text-[#8B8578]"
                            style={{ fontFamily: "'Roboto Mono', monospace" }}>
                        {dateCourte(h.cloturee)} · {h.participants.length} pers. · {h.lignes.length} art.
                      </span>
                    </button>
                    <span className="shrink-0 text-[17px] font-bold tabular-nums"
                          style={{ fontFamily: "'Roboto Mono', monospace" }}>
                      {fmt(h.total)} €
                    </span>
                    <button onClick={() => supprimerHisto(h.cloturee)}
                            aria-label={`Supprimer ${h.titre}`}
                            className="shrink-0 text-[#C4BCA9] hover:text-[#C1362F] transition-colors">
                      <Trash2 size={15} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {/* ================= SAISIE ================= */}
        {ecran === "saisie" && (
          <>
            <header className="pt-10 pb-8">
              <div className="mb-5 flex items-center justify-between">
                <button onClick={() => setEcran("historique")}
                  className="-ml-1 flex items-center gap-1 text-[13px] text-[#8B8578]
                             hover:text-[#1C1A17] transition-colors">
                  <ChevronLeft size={16} /> Mes additions
                </button>
                <span className="flex items-center gap-3">
                  <span className={`flex items-center gap-1.5 text-[11px] transition-colors ${
                          sauvegarde === "erreur" ? "text-[#C1362F]"
                          : sauvegarde === "local" ? "text-[#B5761F]" : "text-[#B0A897]"}`}
                        style={{ fontFamily: "'Roboto Mono', monospace" }}>
                    {sauvegarde === "cours" ? <Loader2 size={12} className="animate-spin" />
                      : sauvegarde === "erreur" || sauvegarde === "local" ? <AlertCircle size={12} />
                      : <Check size={12} />}
                    {sauvegarde === "cours" ? "…"
                      : sauvegarde === "erreur" ? "Non enregistré"
                      : sauvegarde === "local" ? "Session seule" : "Enregistré"}
                  </span>
                  {(lignes.length > 0 || participants.length > 0) && (
                    <button onClick={() => setConfirmation("abandon")}
                      className="text-[11px] font-medium text-[#B0A897] hover:text-[#C1362F] transition-colors">
                      Abandonner
                    </button>
                  )}
                </span>
              </div>
              <div className="flex items-end justify-between gap-4">
                <input
                  value={etat.titre}
                  onChange={(e) => majEtat(() => ({ titre: e.target.value }))}
                  placeholder="L'addition"
                  aria-label="Nom de l'addition"
                  className="min-w-0 flex-1 rounded-md bg-transparent -ml-1 px-1 text-[34px] font-bold
                             leading-[0.95] tracking-[-0.035em] placeholder-[#1C1A17]
                             hover:bg-[#F0EADB] focus:bg-[#F0EADB] focus:outline-none transition-colors"
                />
                {lignes.length > 0 && (
                  <span className="shrink-0 pb-1 font-bold text-[13px] tabular-nums text-[#8B8578]"
                        style={{ fontFamily: "'Roboto Mono', monospace" }}>
                    {nbArticles} {nbArticles > 1 ? "ART." : "ART."}
                  </span>
                )}
              </div>
            </header>

            {/* convives */}
            <section className="mb-9">
              <div className="mb-3.5 flex items-center gap-3">
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#8B8578]"
                      style={{ fontFamily: "'Roboto Mono', monospace" }}>À table</span>
                <span className="h-px flex-1 bg-[#DDD5C4]" />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {participants.map((p) => (
                  <span key={p.id}
                        className="flex items-center gap-2 rounded-full bg-white py-1 pl-1 pr-2.5
                                   shadow-[0_1px_0_#E9E2D2,0_0_0_1px_#E9E2D2]">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full
                                     text-[10px] font-bold text-[#F7F3E8]"
                          style={{ background: p.couleur }}>
                      {p.nom.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="text-[13.5px] font-medium">{p.nom}</span>
                    <button onClick={() => retirerParticipant(p.id)} aria-label={`Retirer ${p.nom}`}
                            className="text-[#C4BCA9] hover:text-[#C1362F] transition-colors">
                      <X size={13} strokeWidth={2.5} />
                    </button>
                  </span>
                ))}

                <span className="flex items-center gap-1 rounded-full border border-dashed
                                 border-[#CDC4B0] py-1 pl-3 pr-1">
                  <input
                    value={nouveauNom}
                    onChange={(e) => setNouveauNom(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && ajouterNom(nouveauNom)}
                    placeholder="Prénom"
                    enterKeyHint="done"
                    className="w-[68px] bg-transparent text-[13.5px] placeholder-[#B0A897] focus:outline-none"
                  />
                  <button onClick={() => ajouterNom(nouveauNom)} disabled={!nouveauNom.trim()}
                          aria-label="Ajouter cette personne"
                          className="flex h-6 w-6 items-center justify-center rounded-full bg-[#1C1A17]
                                     text-[#F7F3E8] disabled:bg-[#E0D8C7] disabled:text-[#B0A897] transition-colors">
                    <Plus size={13} strokeWidth={2.5} />
                  </button>
                </span>
              </div>

              {suggestions.length > 0 && (
                <div className="mt-3">
                  <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.14em] text-[#B0A897]"
                        style={{ fontFamily: "'Roboto Mono', monospace" }}>
                    Déjà venus
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {suggestions.map((n) => (
                      <button key={n} onClick={() => ajouterNom(n)}
                        className="rounded-full border border-[#E0D8C7] px-3 py-1 text-[12.5px] text-[#8B8578]
                                   hover:border-[#1C1A17] hover:text-[#1C1A17] transition-colors">
                        + {n}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </section>

            {/* total du ticket */}
            {participants.length > 0 && (
              <section className="mb-9">
                <div className="mb-3.5 flex items-center gap-3">
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#8B8578]"
                        style={{ fontFamily: "'Roboto Mono', monospace" }}>
                    Total du ticket
                  </span>
                  <span className="h-px flex-1 bg-[#DDD5C4]" />
                </div>
                <div className="rounded-[18px] p-4"
                     style={{ background: "#fff", boxShadow: "0 0 0 1px #E9E2D2" }}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[14px] text-[#8B8578]">
                      Montant inscrit sur l'addition
                    </span>
                    <div className="flex shrink-0 items-baseline gap-1">
                      <ChampMontant
                        centimes={etat.totalAttendu ?? 0}
                        onChange={(c) => majEtat(() => ({ totalAttendu: c }))}
                        aria-label="Total inscrit sur l'addition"
                        className="w-[78px] rounded-md bg-transparent px-1.5 py-1 text-right text-[17px]
                                   font-bold tabular-nums hover:bg-[#F5F1E5] focus:bg-[#F5F1E5]
                                   focus:outline-none transition-colors"
                        style={{ fontFamily: "'Roboto Mono', monospace" }}
                      />
                      <span className="text-[13px] font-medium text-[#8B8578]">€</span>
                    </div>
                  </div>

                  {(etat.totalAttendu ?? 0) > 0 && lignes.length > 0 && (
                    <div className="monte mt-3 border-t border-dashed border-[#E5DECD] pt-3">
                      {(() => {
                        const ecart = calcul.total - etat.totalAttendu;
                        if (ecart === 0)
                          return (
                            <p className="flex items-center gap-1.5 text-[12px] tabular-nums text-[#2E6F5E]"
                               style={{ fontFamily: "'Roboto Mono', monospace" }}>
                              <Check size={13} strokeWidth={3} />
                              Tout est saisi — {fmt(calcul.total)} €
                            </p>
                          );
                        const manque = ecart < 0;
                        return (
                          <p className="flex items-center gap-1.5 text-[12px] tabular-nums text-[#C1362F]"
                             style={{ fontFamily: "'Roboto Mono', monospace" }}>
                            <AlertCircle size={13} className="shrink-0" />
                            {manque
                              ? `Il manque ${fmt(-ecart)} € — saisi ${fmt(calcul.total)} €`
                              : `Dépassement de ${fmt(ecart)} € — saisi ${fmt(calcul.total)} €`}
                          </p>
                        );
                      })()}
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* nouvelle ligne */}
            {participants.length > 0 && (
              <section className="mb-9 rounded-[18px] bg-white p-4 shadow-[0_2px_0_#E9E2D2,0_0_0_1px_#E9E2D2]">
                <div className="flex items-baseline gap-3 border-b border-dashed border-[#E0D8C7] pb-3.5">
                  <input ref={refLibelle} value={libelle} onChange={(e) => setLibelle(e.target.value)}
                    placeholder="Bouteille de vin"
                    className="min-w-0 flex-1 bg-transparent text-[16px] font-medium
                               placeholder-[#B0A897] focus:outline-none" />
                  <div className="flex items-baseline gap-1">
                    <input value={montant}
                      onChange={(e) => setMontant(e.target.value.replace(",", "."))}
                      onKeyDown={(e) => e.key === "Enter" && ajouterLigne()}
                      inputMode="decimal" placeholder="0,00" aria-label="Montant"
                      className="w-[70px] bg-transparent text-right text-[16px] font-bold tabular-nums
                                 placeholder-[#B0A897] focus:outline-none"
                      style={{ fontFamily: "'Roboto Mono', monospace" }} />
                    <span className="text-[13px] font-medium text-[#8B8578]">€</span>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between">
                  <Compteur valeur={quantite}
                            onChange={(d) => setQuantite((q) => Math.max(1, Math.min(99, q + d)))} />
                  {quantite > 1 && enCentimes(montant) > 0 && (
                    <span className="text-[12px] font-bold tabular-nums text-[#8B8578]"
                          style={{ fontFamily: "'Roboto Mono', monospace" }}>
                      = {fmt(enCentimes(montant) * quantite)} €
                    </span>
                  )}
                </div>

                <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-0.5">
                  {participants.map((p) => (
                    <Pastille key={p.id} participant={p} actif={selection.includes(p.id)}
                      onClick={() => setSelection((s) =>
                        s.includes(p.id) ? s.filter((x) => x !== p.id) : [...s, p.id])} />
                  ))}
                  <button onClick={() => setSelection(
                            selection.length === participants.length ? [] : participants.map((p) => p.id))}
                    className="ml-auto shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold uppercase
                               tracking-[0.08em] text-[#8B8578] hover:bg-[#F2EDE0] hover:text-[#1C1A17]
                               transition-colors"
                    style={{ fontFamily: "'Roboto Mono', monospace" }}>
                    {selection.length === participants.length ? "Personne" : "Tous"}
                  </button>
                </div>

                <button onClick={ajouterLigne} disabled={enCentimes(montant) <= 0}
                  className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-[13px] bg-[#1C1A17]
                             py-3.5 text-[14px] font-semibold text-[#F7F3E8] tracking-[-0.01em]
                             disabled:bg-[#EFE9DA] disabled:text-[#B0A897] transition-colors">
                  <Plus size={16} strokeWidth={2.5} /> Ajouter à l'addition
                </button>
              </section>
            )}

            {participants.length === 0 && (
              <p className="rounded-[18px] border border-dashed border-[#DDD5C4] px-6 py-10 text-center
                            text-[13.5px] leading-relaxed text-[#8B8578]">
                Ajoutez d'abord qui est à table.
              </p>
            )}

            {/* la note */}
            {lignes.length > 0 && (
              <section>
                <div className="mb-3.5 flex items-center gap-3">
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#8B8578]"
                        style={{ fontFamily: "'Roboto Mono', monospace" }}>La note</span>
                  <span className="h-px flex-1 bg-[#DDD5C4]" />
                  {lignes.length > 2 && (
                    <button
                      onClick={() => setTri((t) =>
                        t === "saisie" ? "montant" : t === "montant" ? "nom" : "saisie")}
                      aria-label={`Trier — actuellement ${
                        tri === "saisie" ? "ordre de saisie" : tri === "montant" ? "par montant" : "par nom"}`}
                      className="flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[10px]
                                 font-bold uppercase tracking-[0.1em] transition-colors"
                      style={{
                        color: tri === "saisie" ? "#B0A897" : "#1C1A17",
                        background: tri === "saisie" ? "transparent" : "#F2EDE0",
                      }}
                    >
                      <ArrowUpDown size={11} strokeWidth={2.5} />
                      {tri === "saisie" ? "Saisie" : tri === "montant" ? "Montant" : "Nom"}
                    </button>
                  )}
                </div>

                <div className="overflow-hidden rounded-t-[18px] bg-white shadow-[0_0_0_1px_#E9E2D2]">
                  {lignesAffichees.map((l, i) => {
                    const orphelin = l.participantIds.length === 0;
                    const aDesParts = !!l.reglee;
                    const cibleL = l.quantite ?? 1;
                    const sommeL = aDesParts
                      ? sommeFractions(l.participantIds.map((id) => fractionDe(l, id)))
                      : null;
                    const ecartL = sommeL ? compareCible(sommeL, cibleL) : 0;
                    const incomplete = orphelin || ecartL !== 0;
                    return (
                      <div key={l.id}
                           className={`monte px-4 py-4 ${i > 0 ? "border-t border-dashed border-[#E5DECD]" : ""}`}
                           style={incomplete ? { background: "#FDF6F4" } : undefined}>
                        <div className="flex items-baseline gap-2">
                          <input value={l.libelle}
                            onChange={(e) => modifierLigne(l.id, "libelle", e.target.value)}
                            aria-label="Nom de l'article"
                            className="min-w-0 flex-1 rounded-md bg-transparent px-1.5 py-1 -ml-1.5
                                       text-[15.5px] font-medium hover:bg-[#F5F1E5] focus:bg-[#F5F1E5]
                                       focus:outline-none transition-colors" />
                          <div className="flex shrink-0 items-baseline gap-1">
                            <ChampMontant centimes={l.montant}
                              onChange={(c) => modifierLigne(l.id, "montant", c)} aria-label="Montant"
                              className="w-[68px] rounded-md bg-transparent px-1.5 py-1 text-right
                                         text-[15.5px] font-bold tabular-nums hover:bg-[#F5F1E5]
                                         focus:bg-[#F5F1E5] focus:outline-none transition-colors"
                              style={{ fontFamily: "'Roboto Mono', monospace" }} />
                            <span className="text-[12px] font-medium text-[#8B8578]">€</span>
                          </div>
                        </div>

                        <div className="mt-2 flex items-center gap-1">
                          <Compteur compact valeur={l.quantite ?? 1}
                                    onChange={(d) => changerQuantite(l.id, d)} />
                          <button onClick={() => dupliquerLigne(l.id)} title="Dupliquer"
                            aria-label={`Dupliquer ${l.libelle}`}
                            className="flex h-7 w-7 items-center justify-center rounded-full text-[#C4BCA9]
                                       hover:bg-[#F2EDE0] hover:text-[#1C1A17] transition-colors">
                            <Copy size={14} />
                          </button>
                          <button onClick={() => supprimerLigne(l.id)} title="Supprimer"
                            aria-label={`Supprimer ${l.libelle}`}
                            className="flex h-7 w-7 items-center justify-center rounded-full text-[#C4BCA9]
                                       hover:bg-[#FBEBE8] hover:text-[#C1362F] transition-colors">
                            <Trash2 size={14} />
                          </button>
                        </div>

                        <div className="mt-3 flex items-center gap-2.5 overflow-x-auto pb-1">
                          {participants.map((p) => (
                            <PastilleParts key={p.id} participant={p} taille={34}
                              actif={l.participantIds.includes(p.id)}
                              fraction={fractionDe(l, p.id)}
                              onBasculer={() => basculer(l.id, p.id)}
                              onFraction={(f) => changerFraction(l.id, p.id, f)} />
                          ))}
                          <button onClick={() => tousOuAucun(l.id, l.participantIds.length !== participants.length)}
                            className="ml-auto shrink-0 rounded-full px-2 py-1 text-[10px] font-bold uppercase
                                       tracking-[0.08em] text-[#B0A897] hover:bg-[#F2EDE0]
                                       hover:text-[#1C1A17] transition-colors"
                            style={{ fontFamily: "'Roboto Mono', monospace" }}>
                            {l.participantIds.length === participants.length ? "Personne" : "Tous"}
                          </button>
                        </div>

                        {(() => {
                          if (orphelin)
                            return (
                              <p className="mt-3 flex items-center gap-1.5 border-t border-[#F0D5CF] pt-2.5
                                            text-[11.5px] text-[#C1362F]"
                                 style={{ fontFamily: "'Roboto Mono', monospace" }}>
                                <AlertCircle size={12} />
                                Personne n'y participe
                              </p>
                            );

                          const fractions = l.participantIds.map((id) => fractionDe(l, id));
                          const explicite = !!l.reglee;
                          const somme = sommeFractions(fractions);
                          const cible = l.quantite ?? 1;
                          const ecart = compareCible(somme, cible);
                          const inegal = explicite;

                          const detail = [];
                          if ((l.quantite ?? 1) > 1)
                            detail.push(`${l.quantite} × ${fmt(l.montant)} = ${fmt(totalLigne(l))} €`);
                          if (!inegal)
                            detail.push(`${fmt(Math.floor(totalLigne(l) / l.participantIds.length))} € par personne`);

                          return (
                            <>
                              {detail.length > 0 && (
                                <p className="mt-2 text-[11.5px] tabular-nums text-[#8B8578]"
                                   style={{ fontFamily: "'Roboto Mono', monospace" }}>
                                  {detail.join("  ·  ")}
                                </p>
                              )}
                              {inegal && (
                                <div className={`mt-3 flex items-center gap-2 border-t pt-2.5 ${
                                        ecart === 0 ? "border-[#E5DECD]" : "border-[#F0D5CF]"}`}>
                                  {ecart === 0 ? (
                                    <span className="flex items-center gap-1.5 text-[11.5px] tabular-nums text-[#2E6F5E]"
                                          style={{ fontFamily: "'Roboto Mono', monospace" }}>
                                      <Check size={12} strokeWidth={3} />
                                      {texteFraction(somme)} / {cible} réparti
                                    </span>
                                  ) : (
                                    <>
                                      <button
                                        onClick={() => setResteLigne({ ligneId: l.id, designes: [] })}
                                        className="flex items-center gap-1.5 rounded-[9px] border border-[#C1362F]
                                                   bg-white px-2.5 py-1.5 text-[11.5px] font-semibold text-[#C1362F]
                                                   shadow-[0_1px_0_#EFD9D4] hover:bg-[#FFF8F7] transition-colors"
                                        style={{ fontFamily: "'Roboto Mono', monospace" }}>
                                        {(() => {
                                          const reste = sommeFractions([somme, [-cible, 1]]);
                                          const manque = reste[0] < 0;
                                          const abs = reduire([Math.abs(reste[0]), reste[1]]);
                                          return `${manque ? "reste" : "excédent"} ${nomFraction(abs)}`;
                                        })()}
                                        <span className="opacity-60">— attribuer</span>
                                      </button>
                                      <button onClick={() => equilibrer(l.id)}
                                        className="ml-auto shrink-0 rounded-[9px] px-2 py-1.5 text-[10px]
                                                   font-bold uppercase tracking-[0.08em] text-[#B0A897]
                                                   hover:text-[#1C1A17] transition-colors"
                                        style={{ fontFamily: "'Roboto Mono', monospace" }}>
                                        Égaliser
                                      </button>
                                    </>
                                  )}
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    );
                  })}
                </div>
                <div className="dents h-[10px] bg-white shadow-[0_0_0_1px_#E9E2D2]" />

                <div className="mt-7 rounded-[18px] bg-white p-4 shadow-[0_0_0_1px_#E9E2D2]">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[15px] font-medium">Service</span>
                    <div className="flex items-baseline gap-1">
                      <ChampMontant centimes={extras.service}
                        onChange={(c) => majEtat((e) => ({ extras: { ...e.extras, service: c } }))}
                        aria-label="Montant du service"
                        className="w-[68px] rounded-md bg-transparent px-1.5 py-1 text-right text-[15px]
                                   font-bold tabular-nums hover:bg-[#F5F1E5] focus:bg-[#F5F1E5]
                                   focus:outline-none transition-colors"
                        style={{ fontFamily: "'Roboto Mono', monospace" }} />
                      <span className="text-[12px] font-medium text-[#8B8578]">€</span>
                    </div>
                  </div>

                  {extras.service > 0 && (
                    <div className="monte mt-3.5 flex gap-1.5 rounded-[11px] bg-[#F2EDE0] p-1">
                      {[["prorata", "Au prorata"], ["egal", "Parts égales"]].map(([val, label]) => (
                        <button key={val}
                          onClick={() => majEtat((e) => ({ extras: { ...e.extras, mode: val } }))}
                          className={`flex-1 rounded-[8px] py-2 text-[12.5px] font-semibold transition-colors ${
                            extras.mode === val
                              ? "bg-white text-[#1C1A17] shadow-[0_1px_2px_rgba(28,26,23,.1)]"
                              : "text-[#8B8578] hover:text-[#1C1A17]"}`}>
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            )}
          </>
        )}

        {/* ================= RÉSULTAT ================= */}
        {ecran === "resultat" && (
          <section>
            <header className="pt-10 pb-8">
              <button onClick={() => setEcran("saisie")}
                className="mb-5 -ml-1 flex items-center gap-1 text-[13px] text-[#8B8578]
                           hover:text-[#1C1A17] transition-colors">
                <ChevronLeft size={16} /> Modifier l'addition
              </button>
              <h1 className="text-[34px] font-bold leading-[0.95] tracking-[-0.035em]">
                Qui paie<br />quoi
              </h1>
            </header>

            <div className="space-y-2.5">
              {calcul.resultats.slice().sort((a, b) => b.total - a.total).map((r, i) => {
                const ouverte = deplie.includes(r.id);
                return (
                  <div key={r.id}
                       className="monte relative overflow-hidden rounded-[18px] bg-white shadow-[0_0_0_1px_#E9E2D2]"
                       style={{ animationDelay: `${i * 45}ms` }}>
                    <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: r.couleur }} />
                    <button
                      onClick={() => setDeplie((d) =>
                        d.includes(r.id) ? d.filter((x) => x !== r.id) : [...d, r.id])}
                      aria-expanded={ouverte}
                      className="flex w-full items-center gap-3 p-4 pl-[22px] text-left
                                 hover:bg-[#FCFAF5] transition-colors">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full
                                       text-[12px] font-bold text-[#F7F3E8]"
                            style={{ background: r.couleur }}>
                        {r.nom.slice(0, 2).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[16px] font-semibold tracking-[-0.01em]">
                          {r.nom}
                        </span>
                        <span className="mt-0.5 block text-[11.5px] text-[#8B8578]"
                              style={{ fontFamily: "'Roboto Mono', monospace" }}>
                          {r.articles.length === 0 ? "rien pris"
                            : `${r.articles.length} ${r.articles.length > 1 ? "articles" : "article"}`}
                        </span>
                      </span>
                      <span className="text-[22px] font-bold tabular-nums tracking-[-0.02em]"
                            style={{ fontFamily: "'Roboto Mono', monospace" }}>
                        {fmt(r.total)}
                        <span className="ml-1 text-[13px] font-medium text-[#8B8578]">€</span>
                      </span>
                      <ChevronDown size={16}
                        className={`shrink-0 text-[#B0A897] transition-transform duration-200
                                    motion-reduce:transition-none ${ouverte ? "rotate-180" : ""}`} />
                    </button>

                    {ouverte && (
                      <div className="border-t border-dashed border-[#E5DECD] px-4 pb-4 pl-[22px] pt-3"
                           style={{ fontFamily: "'Roboto Mono', monospace" }}>
                        {r.articles.length === 0 ? (
                          <p className="text-[12px] text-[#8B8578]">Aucun article à son nom.</p>
                        ) : (
                          <ul className="space-y-1.5">
                            {r.articles.map((a) => (
                              <li key={a.id} className="flex items-baseline gap-2 text-[12px]">
                                <span className="min-w-0 flex-1 truncate text-[#1C1A17]">
                                  {a.quantite > 1 && <span className="text-[#8B8578]">{a.quantite}× </span>}
                                  {a.libelle}
                                  {a.partage > 1 && (
                                    <span className="text-[#8B8578]">
                                      {" "}
                                      {a.fraction && a.fraction[0] !== a.fraction[1]
                                        ? `${nomFraction(a.fraction)}/${a.quantite}`
                                        : `÷${a.partage}`}
                                    </span>
                                  )}
                                </span>
                                <span className="shrink-0 tabular-nums font-medium">{fmt(a.part)}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                        {r.service > 0 && (
                          <div className="mt-2.5 flex items-baseline justify-between border-t border-dashed
                                          border-[#E5DECD] pt-2.5 text-[12px] text-[#8B8578]">
                            <span>Service</span>
                            <span className="tabular-nums font-medium">{fmt(r.service)}</span>
                          </div>
                        )}
                        <div className="mt-2 flex items-baseline justify-between border-t border-[#E5DECD]
                                        pt-2 text-[12.5px] font-bold">
                          <span>Total</span>
                          <span className="tabular-nums">{fmt(r.total)} €</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <button onClick={() => setDeplie((d) =>
                      d.length === participants.length ? [] : participants.map((p) => p.id))}
              className="mt-3.5 w-full rounded-[12px] border border-dashed border-[#CDC4B0] py-2.5
                         text-[11px] font-bold uppercase tracking-[0.12em] text-[#8B8578]
                         hover:bg-white hover:text-[#1C1A17] transition-colors"
              style={{ fontFamily: "'Roboto Mono', monospace" }}>
              {deplie.length === participants.length ? "Tout replier" : "Tout déplier"}
            </button>

            <div className="mt-7 rounded-[18px] border border-dashed border-[#CDC4B0] p-4"
                 style={{ fontFamily: "'Roboto Mono', monospace" }}>
              <div className="flex justify-between text-[12.5px] tabular-nums text-[#8B8578]">
                <span>Articles</span><span>{fmt(calcul.totalLignes)} €</span>
              </div>
              {calcul.service > 0 && (
                <div className="mt-1.5 flex justify-between text-[12.5px] tabular-nums text-[#8B8578]">
                  <span>Service</span><span>{fmt(calcul.service)} €</span>
                </div>
              )}
              <div className="mt-3 flex justify-between border-t border-dashed border-[#DDD5C4] pt-3
                              text-[15px] font-bold tabular-nums">
                <span>Total</span><span>{fmt(calcul.total)} €</span>
              </div>
              {ecartTotal !== 0 && (
                <p className="mt-2.5 text-[11.5px] tabular-nums"
                   style={{ color: "#8A5A18" }}>
                  Ticket annoncé : {fmt(etat.totalAttendu)} € —
                  {ecartTotal < 0 ? ` ${fmt(-ecartTotal)} € non saisis`
                                  : ` ${fmt(ecartTotal)} € de trop`}
                </p>
              )}
            </div>

            <div className="mt-6 space-y-2.5">
              {!image ? (
                <button onClick={exporter} disabled={exportEtat === "cours"}
                  className="flex w-full items-center justify-center gap-2 rounded-[14px] bg-white py-3.5
                             text-[14px] font-semibold shadow-[0_0_0_1px_#E9E2D2]
                             hover:bg-[#FCFAF5] disabled:text-[#B0A897] transition-colors">
                  {exportEtat === "cours" ? <Loader2 size={16} className="animate-spin" />
                    : exportEtat === "erreur" ? <AlertCircle size={16} className="text-[#C1362F]" />
                    : <ImageIcon size={16} />}
                  {exportEtat === "erreur" ? "Génération impossible" : "Créer l'image du ticket"}
                </button>
              ) : (
                <div className="monte rounded-[18px] bg-white p-3 shadow-[0_0_0_1px_#E9E2D2]">
                  <img src={image} alt="Ticket de l'addition"
                       className="w-full rounded-[10px] shadow-[0_0_0_1px_#E9E2D2]" />
                  <p className="mt-2.5 px-1 text-center text-[11.5px] leading-relaxed text-[#8B8578]">
                    Appui long sur l'image pour l'enregistrer ou la partager.
                  </p>
                  <div className="mt-2.5 flex gap-2">
                    <button onClick={partager}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-[11px] bg-[#1C1A17]
                                 py-2.5 text-[12.5px] font-semibold text-[#F7F3E8] transition-colors">
                      <Share2 size={14} /> Partager
                    </button>
                    <button onClick={telecharger}
                      className="flex items-center justify-center gap-1.5 rounded-[11px] border border-[#E0D8C7]
                                 px-3.5 py-2.5 text-[12.5px] font-semibold text-[#8B8578]
                                 hover:text-[#1C1A17] transition-colors">
                      {partageEtat === "telecharge" ? <Check size={14} className="text-[#2E6F5E]" />
                        : <Download size={14} />}
                    </button>
                    <button onClick={() => setImage(null)}
                      className="rounded-[11px] border border-[#E0D8C7] px-3.5 py-2.5 text-[12.5px]
                                 font-semibold text-[#8B8578] hover:text-[#1C1A17] transition-colors">
                      Fermer
                    </button>
                  </div>
                  {partageEtat === "indisponible" && (
                    <p className="monte mt-2 text-center text-[11.5px] leading-relaxed text-[#C1362F]">
                      Le partage direct n'est pas disponible ici.
                      Utilisez l'appui long sur l'image pour l'enregistrer.
                    </p>
                  )}
                </div>
              )}

              <button onClick={cloturer}
                className="w-full rounded-[14px] border border-dashed border-[#CDC4B0] py-3.5
                           text-[13px] font-semibold text-[#8B8578]
                           hover:border-[#1C1A17] hover:text-[#1C1A17] transition-colors">
                Terminer et ranger dans l'historique
              </button>
            </div>
          </section>
        )}
      </div>

      {/* barre fixe */}
      {ecran === "historique" && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-[#E5DECD] bg-[#F7F3E8]/92 backdrop-blur-md">
          <div className="mx-auto max-w-[430px] px-5 pb-6 pt-4">
            <button onClick={nouvelleAddition}
              className="flex w-full items-center justify-center gap-2 rounded-[14px] bg-[#1C1A17] px-5 py-4
                         text-[15px] font-semibold text-[#F7F3E8] tracking-[-0.01em]">
              <Plus size={17} strokeWidth={2.5} /> Nouvelle addition
            </button>
          </div>
        </div>
      )}

      {ecran === "saisie" && lignes.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-[#E5DECD] bg-[#F7F3E8]/92 backdrop-blur-md">
          <div className="mx-auto max-w-[430px] px-5 pb-6 pt-4">
            {(bloque || ecartTotal !== 0) && (
              <div className="monte mb-3 flex items-center gap-2 rounded-[12px] px-3.5 py-2.5
                              text-[12.5px] font-medium"
                   style={{ background: bloque ? "#FBEBE8" : "#FDF3E6",
                            color: bloque ? "#C1362F" : "#8A5A18" }}>
                <AlertCircle size={15} className="shrink-0" />
                {nonAttribuees > 0
                  ? (nonAttribuees === 1 ? "1 article n'est associé à personne"
                     : `${nonAttribuees} articles ne sont associés à personne`)
                  : desequilibrees > 0
                    ? (desequilibrees === 1 ? "1 article n'est pas partagé en entier"
                       : `${desequilibrees} articles ne sont pas partagés en entier`)
                    : ecartTotal < 0
                      ? `Il manque ${fmt(-ecartTotal)} € par rapport au ticket`
                      : `Vous dépassez le ticket de ${fmt(ecartTotal)} €`}
              </div>
            )}
            <button onClick={() => setEcran("resultat")} disabled={bloque}
              className="group flex w-full items-center justify-between rounded-[14px] bg-[#1C1A17] px-5 py-4
                         text-[15px] font-semibold text-[#F7F3E8] tracking-[-0.01em]
                         disabled:bg-[#EFE9DA] disabled:text-[#B0A897] transition-colors">
              <span className="flex items-center gap-2">
                Voir qui paie quoi
                <ArrowRight size={16} strokeWidth={2.5}
                  className="transition-transform duration-200 group-enabled:group-hover:translate-x-0.5
                             motion-reduce:transition-none" />
              </span>
              <span className="tabular-nums" style={{ fontFamily: "'Roboto Mono', monospace" }}>
                {fmt(calcul.total)} €
              </span>
            </button>
          </div>
        </div>
      )}
      {/* attribution du reste */}
      {resteLigne && (() => {
        const ligne = lignes.find((l) => l.id === resteLigne.ligneId);
        if (!ligne) return null;
        const cible = ligne.quantite ?? 1;
        const autres = ligne.participantIds.filter((id) => !resteLigne.designes.includes(id));
        const sommeAutres = sommeFractions(autres.map((id) => fractionDe(ligne, id)));
        const reste = reduire(sommeFractions([[cible, 1], [-sommeAutres[0], sommeAutres[1]]]));
        const possible = reste[0] > 0 && resteLigne.designes.length > 0;
        const chacun = possible ? reduire([reste[0], reste[1] * resteLigne.designes.length]) : null;

        return (
          <div className="fixed inset-0 z-50 flex items-end justify-center px-5 pb-6 sm:items-center"
             style={{ background: "rgba(28,26,23,.55)", backdropFilter: "blur(3px)",
                      WebkitBackdropFilter: "blur(3px)" }}
               onClick={() => setResteLigne(null)}>
            <div className="monte relative w-full max-w-[400px] rounded-[20px] p-5"
               style={{ background: "#F7F3E8", border: "1px solid #E5DECD",
                        boxShadow: "0 20px 50px rgba(28,26,23,.35)" }}
                 onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
              <h2 className="text-[18px] font-bold tracking-[-0.02em]">Qui prend le reste ?</h2>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-[#8B8578]">
                Sur {ligne.libelle}. Les personnes choisies se partagent également
                ce qui n'est pas encore attribué.
              </p>

              <div className="mt-4 space-y-1.5">
                {ligne.participantIds.map((id) => {
                  const p = participants.find((x) => x.id === id);
                  if (!p) return null;
                  const choisi = resteLigne.designes.includes(id);
                  return (
                    <button key={id}
                      onClick={() => setResteLigne((r) => ({
                        ...r,
                        designes: r.designes.includes(id)
                          ? r.designes.filter((x) => x !== id)
                          : [...r.designes, id],
                      }))}
                      className={`flex w-full items-center gap-3 rounded-[12px] border px-3 py-2.5
                                  text-left transition-colors ${
                        choisi ? "border-[#1C1A17] bg-white" : "border-[#E0D8C7] hover:border-[#CDC4B0]"}`}>
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full
                                       text-[10px] font-bold text-[#F7F3E8]"
                            style={{ background: p.couleur }}>
                        {p.nom.slice(0, 2).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{p.nom}</span>
                      <span className="shrink-0 text-[12px] tabular-nums text-[#8B8578]"
                            style={{ fontFamily: "'Roboto Mono', monospace" }}>
                        {choisi && chacun ? nomFraction(chacun) : nomFraction(fractionDe(ligne, id))}
                      </span>
                      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border
                                        transition-colors ${
                        choisi ? "border-[#1C1A17] bg-[#1C1A17]" : "border-[#DDD5C4]"}`}>
                        {choisi && <Check size={12} className="text-[#F7F3E8]" strokeWidth={3} />}
                      </span>
                    </button>
                  );
                })}
              </div>

              <p className="mt-3 text-[12px] tabular-nums text-[#8B8578]"
                 style={{ fontFamily: "'Roboto Mono', monospace" }}>
                {resteLigne.designes.length === 0
                  ? `Reste à attribuer : ${nomFraction(reste)}`
                  : reste[0] <= 0
                    ? "Rien à répartir avec cette sélection"
                    : `${nomFraction(reste)} ÷ ${resteLigne.designes.length} = ${nomFraction(chacun)} chacun`}              </p>

              <div className="mt-4 flex gap-2">
                <button onClick={() => setResteLigne(null)}
                  className="flex-1 rounded-[12px] border border-[#DDD5C4] py-3 text-[13.5px] font-semibold
                             hover:bg-white transition-colors">
                  Annuler
                </button>
                <button onClick={validerReste} disabled={!possible}
                  className="flex-1 rounded-[12px] bg-[#1C1A17] py-3 text-[13.5px] font-semibold text-[#F7F3E8]
                             disabled:bg-[#E0D8C7] disabled:text-[#B0A897] transition-colors">
                  Attribuer
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* modale de confirmation */}
      {confirmation === "abandon" && (
        <div className="fixed inset-0 z-50 flex items-end justify-center px-5 pb-6 sm:items-center"
             style={{ background: "rgba(28,26,23,.55)", backdropFilter: "blur(3px)",
                      WebkitBackdropFilter: "blur(3px)" }}
             onClick={() => setConfirmation(null)}>
          <div className="monte relative w-full max-w-[400px] rounded-[20px] p-5"
               style={{ background: "#F7F3E8", border: "1px solid #E5DECD",
                        boxShadow: "0 20px 50px rgba(28,26,23,.35)" }}
               onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h2 className="text-[19px] font-bold tracking-[-0.02em]">Abandonner cette addition ?</h2>
            <p className="mt-2 text-[13.5px] leading-relaxed text-[#8B8578]">
              {nbArticles > 0
                ? `${nbArticles} ${nbArticles > 1 ? "articles seront supprimés" : "article sera supprimé"}. Cette action est définitive.`
                : "Les personnes ajoutées seront effacées."}
            </p>
            <div className="mt-5 flex gap-2">
              <button onClick={() => setConfirmation(null)}
                className="flex-1 rounded-[12px] border border-[#DDD5C4] py-3 text-[13.5px] font-semibold
                           hover:bg-white transition-colors">
                Garder
              </button>
              <button onClick={abandonner}
                className="flex-1 rounded-[12px] bg-[#C1362F] py-3 text-[13.5px] font-semibold text-white
                           hover:bg-[#A82E28] transition-colors">
                Abandonner
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Même langage visuel que le partage d'addition : papier ivoire,     */
/*  encre thermique, un accent rouge tampon.                           */
/*                                                                     */
/*  Principe de calcul : on ne stocke JAMAIS de dettes figées.         */
/*  Deux couches indépendantes —                                       */
/*    1. ce que chacun DOIT   (loyer ÷ nuitées de chacun)              */
/*    2. ce que chacun A VERSÉ (paiements pointés)                     */
/*  Le solde en découle. Un retardataire qui s'ajoute ne demande       */
/*  aucune reprise manuelle : les parts baissent, les avances          */
/*  deviennent des crédits, les remboursements se déduisent.           */
/* ------------------------------------------------------------------ */

const COULEURS_LOC = [
  "#C1362F", "#2E6F5E", "#B5761F", "#3B5A8C",
  "#8E4576", "#5C7A2E", "#A8523A", "#456B7D",
];

const CLE_LOC_ETAT = "location:encours";
const CLE_LOC_NOMS = "location:noms";

const locCentimes = (v) => Math.round((parseFloat(v) || 0) * 100);
const locFmt = (c) =>
  (c / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const locJour = (iso) => (iso ? new Date(iso + "T12:00:00") : null);
const locEnISO = (d) => d.toISOString().slice(0, 10);

/** Nombre de locNuits entre deux dates ISO. Départ exclu : 12→15 = 3 locNuits. */
function locNuits(debut, fin) {
  const a = locJour(debut), b = locJour(fin);
  if (!a || !b) return 0;
  return Math.max(0, Math.round((b - a) / 86400000));
}

const locDateCourte = (iso) =>
  iso ? locJour(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : "—";

/** Répartit un montant en centimes selon des poids entiers, sans perte. */
function locRepartir(centimes, poids) {
  const total = poids.reduce((a, b) => a + b, 0);
  if (total <= 0) return poids.map(() => 0);
  const bruts = poids.map((p) => (centimes * p) / total);
  const planchers = bruts.map(Math.floor);
  const reste = centimes - planchers.reduce((a, b) => a + b, 0);
  const ordre = bruts
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; k < reste; k++) planchers[ordre[k % ordre.length].i]++;
  return planchers;
}

/* ---------- calcul central ---------- */

function locCalculer(etat) {
  const { loyer, debut, fin, personnes, paiements } = etat;

  // 1) couche dépenses : nuitées de chacun, bornées au séjour
  const details = personnes.map((p) => {
    const d = p.debut || debut;
    const f = p.fin || fin;
    const dEff = locJour(d) > locJour(debut) ? d : debut;
    const fEff = locJour(f) < locJour(fin) ? f : fin;
    return { ...p, debutEff: dEff, finEff: fEff, locNuits: locNuits(dEff, fEff) };
  });

  const totalNuitees = details.reduce((n, p) => n + p.locNuits, 0);
  const parts = locRepartir(loyer, details.map((p) => p.locNuits));

  // 2) couche paiements
  const verse = Object.fromEntries(personnes.map((p) => [p.id, 0]));
  for (const v of paiements) {
    if (v.recu && verse[v.personneId] !== undefined) verse[v.personneId] += v.montant;
  }
  const annonce = Object.fromEntries(personnes.map((p) => [p.id, 0]));
  for (const v of paiements) {
    if (annonce[v.personneId] !== undefined) annonce[v.personneId] += v.montant;
  }

  // 3) soldes
  const resultats = details.map((p, i) => ({
    ...p,
    part: parts[i],
    verse: verse[p.id],
    annonce: annonce[p.id],
    solde: verse[p.id] - parts[i],       // > 0 : a trop payé, < 0 : doit encore
  }));

  const totalVerse = Object.values(verse).reduce((a, b) => a + b, 0);
  const totalAnnonce = Object.values(annonce).reduce((a, b) => a + b, 0);

  return {
    resultats,
    totalNuitees,
    nuitsSejour: locNuits(debut, fin),
    totalVerse,
    totalAnnonce,
    reste: loyer - totalVerse,
    loyer,
  };
}

/**
 * Transferts à effectuer pour solder les comptes.
 *  - "cagnotte" : chaque débiteur verse une fois dans un pot commun ; ceux qui
 *                 ont trop avancé y puisent. En grand groupe, c'est le seul mode
 *                 praticable : sans lui, un retardataire ferait 14 virements de 5 €.
 *  - "simple"   : appariement glouton, minimise le nombre de virements directs.
 *  - "prorata"  : chaque débiteur rembourse chaque créditeur au prorata.
 */
function locTransferts(resultats, mode) {
  const debiteurs = resultats.filter((r) => r.solde < 0).map((r) => ({ ...r, du: -r.solde }));
  const crediteurs = resultats.filter((r) => r.solde > 0).map((r) => ({ ...r, du: r.solde }));
  if (debiteurs.length === 0 && crediteurs.length === 0) return [];

  if (mode === "cagnotte") {
    return [
      ...debiteurs.map((d) => ({ de: d, vers: null, montant: d.du })),      // versement
      ...crediteurs.map((c) => ({ de: null, vers: c, montant: c.du })),     // retrait
    ];
  }

  if (debiteurs.length === 0 || crediteurs.length === 0) return [];
  const liste = [];

  if (mode === "prorata") {
    for (const d of debiteurs) {
      const montants = locRepartir(d.du, crediteurs.map((c) => c.du));
      crediteurs.forEach((c, i) => {
        if (montants[i] > 0) liste.push({ de: d, vers: c, montant: montants[i] });
      });
    }
    return liste;
  }

  const d = debiteurs.map((x) => ({ ...x })).sort((a, b) => b.du - a.du);
  const c = crediteurs.map((x) => ({ ...x })).sort((a, b) => b.du - a.du);
  let i = 0, j = 0;
  while (i < d.length && j < c.length) {
    const m = Math.min(d[i].du, c[j].du);
    if (m > 0) liste.push({ de: d[i], vers: c[j], montant: m });
    d[i].du -= m;
    c[j].du -= m;
    if (d[i].du === 0) i++;
    if (c[j].du === 0) j++;
  }
  return liste;
}

/* ---------- composants ---------- */

function ChampMontantLoc({ centimes, onChange, className, ...props }) {
  const [brouillon, setBrouillon] = useState(null);
  const affiche = brouillon ?? locFmt(centimes);
  return (
    <input
      value={affiche}
      onChange={(e) => {
        const v = e.target.value;
        if (!/^[\d.,]*$/.test(v)) return;
        setBrouillon(v);
        onChange(locCentimes(v.replace(",", ".")));
      }}
      onFocus={(e) => { setBrouillon(centimes === 0 ? "" : locFmt(centimes)); e.target.select(); }}
      onBlur={() => setBrouillon(null)}
      inputMode="decimal"
      className={className}
      {...props}
    />
  );
}

function AvatarLoc({ personne, taille = 32 }) {
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full font-bold text-[#F7F3E8]"
          style={{ width: taille, height: taille, background: personne.couleur,
                   fontSize: taille * 0.36 }}>
      {personne.nom.slice(0, 2).toUpperCase()}
    </span>
  );
}

/* ---------- application ---------- */

const locAujourdhui = () => locEnISO(new Date());
const locDansNJours = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return locEnISO(d);
};

const locEtatVierge = () => ({
  titre: "",
  loyer: 0,
  debut: locAujourdhui(),
  fin: locDansNJours(7),
  personnes: [],
  paiements: [],
  prochainId: 1000,
  modeTransfert: "cagnotte",
});

function ModuleLocation({ onRetour }) {
  const [pret, setPret] = useState(false);
  const [ecran, setEcran] = useState("sejour");
  const [etat, setEtat] = useState(locEtatVierge);
  const [nomsConnus, setNomsConnus] = useState([]);
  const [sauvegarde, setSauvegarde] = useState("repos");
  const [nouveauNom, setNouveauNom] = useState("");
  const [deplie, setDeplie] = useState([]);
  const [ajoutPaiement, setAjoutPaiement] = useState(null); // personneId
  const [montantSaisi, setMontantSaisi] = useState(0);

  const secours = useRef({});
  const file = useRef(Promise.resolve());
  const premierRendu = useRef(true);

  const { loyer, debut, fin, personnes, paiements } = etat;
  const calcul = useMemo(() => locCalculer(etat), [etat]);
  const mouvements = useMemo(
    () => locTransferts(calcul.resultats, etat.modeTransfert),
    [calcul.resultats, etat.modeTransfert]
  );
  // mouvements de la cagnotte : entrées des débiteurs, sorties vers les créditeurs
  const potCommun = useMemo(() => {
    const entrees = calcul.resultats.filter((r) => r.solde < 0)
      .reduce((a, r) => a - r.solde, 0);
    const sorties = calcul.resultats.filter((r) => r.solde > 0)
      .reduce((a, r) => a + r.solde, 0);
    return { entrees, sorties, solde: entrees - sorties };
  }, [calcul.resultats]);

  /* --- persistance --- */
  const ecrire = useCallback((cle, valeur) => {
    const texte = JSON.stringify(valeur);
    secours.current[cle] = texte;
    if (!window.storage?.set) { setSauvegarde("local"); return Promise.resolve(false); }
    const tache = file.current.then(async () => {
      setSauvegarde("cours");
      for (let essai = 0; essai < 3; essai++) {
        try {
          const r = await window.storage.set(cle, texte);
          if (!r) throw new Error("refus");
          setSauvegarde("ok");
          return true;
        } catch (err) {
          if (essai < 2) { await new Promise((r) => setTimeout(r, 500 * (essai + 1))); continue; }
          console.error("Sauvegarde impossible:", cle, err);
          setSauvegarde("erreur");
          return false;
        }
      }
      return false;
    });
    file.current = tache.catch(() => {});
    return tache;
  }, []);

  useEffect(() => {
    (async () => {
      const lire = async (cle, defaut) => {
        try {
          const r = await window.storage?.get(cle);
          if (r?.value) return JSON.parse(r.value);
        } catch { /* absent */ }
        return defaut;
      };
      const [e, n] = await Promise.all([lire(CLE_LOC_ETAT, null), lire(CLE_LOC_NOMS, [])]);
      if (e?.personnes) setEtat(e);
      setNomsConnus(Array.isArray(n) ? n : []);
      setPret(true);
    })();
  }, []);

  useEffect(() => {
    if (!pret) return;
    if (premierRendu.current) { premierRendu.current = false; return; }
    const t = setTimeout(() => { ecrire(CLE_LOC_ETAT, etat); }, 900);
    return () => clearTimeout(t);
  }, [etat, pret, ecrire]);

  useEffect(() => {
    if (!pret || nomsConnus.length === 0) return;
    const t = setTimeout(() => { ecrire(CLE_LOC_NOMS, nomsConnus); }, 1200);
    return () => clearTimeout(t);
  }, [nomsConnus, pret, ecrire]);

  const majEtat = useCallback((f) => setEtat((e) => ({ ...e, ...f(e) })), []);

  /* --- personnes --- */
  const ajouterPersonne = (nom) => {
    const n = nom.trim();
    if (!n) return;
    if (personnes.some((p) => p.nom.toLowerCase() === n.toLowerCase())) return;
    majEtat((e) => ({
      personnes: [
        ...e.personnes,
        { id: e.prochainId + 1, nom: n, couleur: COULEURS_LOC[e.personnes.length % COULEURS_LOC.length],
          debut: null, fin: null },   // null = tout le séjour
      ],
      prochainId: e.prochainId + 1,
    }));
    setNomsConnus((ns) => [n, ...ns.filter((x) => x.toLowerCase() !== n.toLowerCase())].slice(0, 12));
    setNouveauNom("");
  };

  const retirerPersonne = (id) =>
    majEtat((e) => ({
      personnes: e.personnes.filter((p) => p.id !== id),
      paiements: e.paiements.filter((v) => v.personneId !== id),
    }));

  const majPersonne = (id, champ, valeur) =>
    majEtat((e) => ({
      personnes: e.personnes.map((p) => (p.id === id ? { ...p, [champ]: valeur || null } : p)),
    }));

  /* --- paiements --- */
  const ajouterPaiement = (personneId, montant) => {
    if (montant <= 0) return;
    majEtat((e) => ({
      paiements: [...e.paiements,
        { id: e.prochainId + 1, personneId, montant, recu: false, date: locAujourdhui() }],
      prochainId: e.prochainId + 1,
    }));
    setAjoutPaiement(null);
    setMontantSaisi(0);
  };

  const soldeEnUnCoup = (personneId, montant) => {
    if (montant <= 0) return;
    majEtat((e) => ({
      paiements: [...e.paiements,
        { id: e.prochainId + 1, personneId, montant, recu: true, date: locAujourdhui() }],
      prochainId: e.prochainId + 1,
    }));
  };

  const basculerRecu = (id) =>
    majEtat((e) => ({
      paiements: e.paiements.map((v) => (v.id === id ? { ...v, recu: !v.recu } : v)),
    }));

  const supprimerPaiement = (id) =>
    majEtat((e) => ({ paiements: e.paiements.filter((v) => v.id !== id) }));

  const suggestions = nomsConnus.filter(
    (n) => !personnes.some((p) => p.nom.toLowerCase() === n.toLowerCase())
  );

  const styles = `
    @import url('https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=Roboto+Mono:wght@400;500;700&display=swap');
    @keyframes monte { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
    .monte { animation: monte .28s cubic-bezier(.2,.7,.3,1) both; }
    @media (prefers-reduced-motion: reduce) { .monte { animation: none; } }
  `;

  if (!pret) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: "#F7F3E8" }}>
        <Loader2 size={22} className="animate-spin" style={{ color: "#B0A897" }} />
      </div>
    );
  }

  const ongletActif = (nom) => ecran === nom;
  const onglet = (nom, libelle, icone) => (
    <button
      onClick={() => setEcran(nom)}
      className="flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-bold uppercase
                 tracking-[0.1em] transition-colors"
      style={{ fontFamily: "'Roboto Mono', monospace",
               color: ongletActif(nom) ? "#1C1A17" : "#B0A897" }}
    >
      {icone}
      {libelle}
    </button>
  );

  return (
    <div className="min-h-screen antialiased"
         style={{ background: "#F7F3E8", color: "#1C1A17",
                  fontFamily: "'Archivo', system-ui, sans-serif" }}>
      <style>{styles}</style>

      <div className="mx-auto max-w-[430px] px-5 pb-32">

        {/* en-tête */}
        <header className="pt-10 pb-7">
          <div className="mb-4 flex items-center justify-between">
            <button onClick={onRetour}
              className="-ml-1 flex items-center gap-1 text-[13px] transition-colors"
              style={{ color: "#8B8578" }}>
              <ChevronLeft size={16} /> Accueil
            </button>
            <span className="flex items-center gap-1.5 text-[11px]"
                  style={{ fontFamily: "'Roboto Mono', monospace",
                           color: sauvegarde === "erreur" ? "#C1362F" : "#B0A897" }}>
              {sauvegarde === "cours" ? <Loader2 size={12} className="animate-spin" />
                : sauvegarde === "erreur" ? <AlertCircle size={12} /> : <Check size={12} />}
              {sauvegarde === "cours" ? "…" : sauvegarde === "erreur" ? "Non enregistré" : "Enregistré"}
            </span>
          </div>
          <input
            value={etat.titre}
            onChange={(e) => majEtat(() => ({ titre: e.target.value }))}
            placeholder="La location"
            aria-label="Nom de la location"
            className="w-full rounded-md bg-transparent -ml-1 px-1 text-[32px] font-bold
                       leading-[0.95] tracking-[-0.035em] focus:outline-none"
            style={{ }}
          />
          {calcul.nuitsSejour > 0 && (
            <p className="mt-2 text-[12.5px]"
               style={{ fontFamily: "'Roboto Mono', monospace", color: "#8B8578" }}>
              {locDateCourte(debut)} → {locDateCourte(fin)} · {calcul.nuitsSejour} nuit
              {calcul.nuitsSejour > 1 ? "s" : ""} · {personnes.length} pers.
            </p>
          )}
        </header>

        {/* ================= SÉJOUR ================= */}
        {ecran === "sejour" && (
          <>
            <section className="mb-8 rounded-[18px] p-4"
                     style={{ background: "#fff", boxShadow: "0 0 0 1px #E9E2D2" }}>
              <div className="mb-4 flex items-baseline justify-between gap-3">
                <span className="text-[14px]" style={{ color: "#8B8578" }}>Coût total de la location</span>
                <div className="flex shrink-0 items-baseline gap-1">
                  <ChampMontantLoc
                    centimes={loyer}
                    onChange={(c) => majEtat(() => ({ loyer: c }))}
                    aria-label="Coût total"
                    className="w-[92px] rounded-md bg-transparent px-1.5 py-1 text-right text-[19px]
                               font-bold tabular-nums focus:outline-none"
                    style={{ fontFamily: "'Roboto Mono', monospace" }}
                  />
                  <span className="text-[13px] font-medium" style={{ color: "#8B8578" }}>€</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5 border-t border-dashed pt-4"
                   style={{ borderColor: "#E5DECD" }}>
                <label className="block">
                  <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.14em]"
                        style={{ fontFamily: "'Roboto Mono', monospace", color: "#8B8578" }}>
                    Arrivée
                  </span>
                  <input type="date" value={debut}
                    onChange={(e) => majEtat(() => ({ debut: e.target.value }))}
                    className="w-full rounded-[10px] px-2.5 py-2 text-[13.5px] focus:outline-none"
                    style={{ border: "1px solid #E0D8C7", background: "#FCFAF5",
                             fontFamily: "'Roboto Mono', monospace" }} />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.14em]"
                        style={{ fontFamily: "'Roboto Mono', monospace", color: "#8B8578" }}>
                    Départ
                  </span>
                  <input type="date" value={fin} min={debut}
                    onChange={(e) => majEtat(() => ({ fin: e.target.value }))}
                    className="w-full rounded-[10px] px-2.5 py-2 text-[13.5px] focus:outline-none"
                    style={{ border: "1px solid #E0D8C7", background: "#FCFAF5",
                             fontFamily: "'Roboto Mono', monospace" }} />
                </label>
              </div>

              {calcul.nuitsSejour > 0 && loyer > 0 && (
                <p className="mt-3 text-[12px] tabular-nums"
                   style={{ fontFamily: "'Roboto Mono', monospace", color: "#8B8578" }}>
                  {locFmt(Math.round(loyer / calcul.nuitsSejour))} € la nuit
                  {calcul.totalNuitees > 0 &&
                    ` · ${locFmt(Math.round(loyer / calcul.totalNuitees))} € par personne et par nuit`}
                </p>
              )}
              {calcul.nuitsSejour === 0 && (
                <p className="mt-3 flex items-center gap-1.5 text-[12px]" style={{ color: "#C1362F" }}>
                  <AlertCircle size={13} /> La date de départ doit suivre l'arrivée.
                </p>
              )}
            </section>

            {/* occupants */}
            <section>
              <div className="mb-3.5 flex items-center gap-3">
                <span className="text-[10px] font-bold uppercase tracking-[0.2em]"
                      style={{ fontFamily: "'Roboto Mono', monospace", color: "#8B8578" }}>
                  Qui vient
                </span>
                <span className="h-px flex-1" style={{ background: "#DDD5C4" }} />
              </div>

              {personnes.length === 0 ? (
                <p className="rounded-[18px] px-6 py-10 text-center text-[13.5px] leading-relaxed"
                   style={{ border: "1px dashed #DDD5C4", color: "#8B8578" }}>
                  Ajoutez les personnes qui participent.
                </p>
              ) : (
                <ul className="space-y-2.5">
                  {calcul.resultats.map((p) => {
                    const partiel = p.locNuits !== calcul.nuitsSejour;
                    const ouvert = deplie.includes(p.id);
                    return (
                      <li key={p.id} className="monte overflow-hidden rounded-[18px]"
                          style={{ background: "#fff", boxShadow: "0 0 0 1px #E9E2D2" }}>
                        <div className="flex items-center gap-3 p-4">
                          <AvatarLoc personne={p} taille={34} />
                          <button onClick={() => setDeplie((d) =>
                                    d.includes(p.id) ? d.filter((x) => x !== p.id) : [...d, p.id])}
                                  className="min-w-0 flex-1 text-left">
                            <span className="block truncate text-[15px] font-semibold">{p.nom}</span>
                            <span className="mt-0.5 block text-[11.5px] tabular-nums"
                                  style={{ fontFamily: "'Roboto Mono', monospace",
                                           color: partiel ? "#B5761F" : "#8B8578" }}>
                              {p.locNuits} nuit{p.locNuits > 1 ? "s" : ""}
                              {partiel && ` · ${locDateCourte(p.debutEff)}→${locDateCourte(p.finEff)}`}
                            </span>
                          </button>
                          <span className="shrink-0 text-[16px] font-bold tabular-nums"
                                style={{ fontFamily: "'Roboto Mono', monospace" }}>
                            {locFmt(p.part)} €
                          </span>
                          <button onClick={() => retirerPersonne(p.id)}
                                  aria-label={`Retirer ${p.nom}`}
                                  className="shrink-0 transition-colors"
                                  style={{ color: "#C4BCA9" }}>
                            <Trash2 size={15} />
                          </button>
                        </div>

                        {ouvert && (
                          <div className="border-t border-dashed px-4 pb-4 pt-3"
                               style={{ borderColor: "#E5DECD" }}>
                            <p className="mb-3 text-[11.5px] leading-relaxed" style={{ color: "#8B8578" }}>
                              Laissez vide si la personne est présente tout le séjour.
                            </p>
                            <div className="grid grid-cols-2 gap-2.5">
                              <label className="block">
                                <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.14em]"
                                      style={{ fontFamily: "'Roboto Mono', monospace", color: "#8B8578" }}>
                                  Arrive le
                                </span>
                                <input type="date" value={p.debut || ""} min={debut} max={fin}
                                  onChange={(e) => majPersonne(p.id, "debut", e.target.value)}
                                  className="w-full rounded-[10px] px-2.5 py-2 text-[13px] focus:outline-none"
                                  style={{ border: "1px solid #E0D8C7", background: "#FCFAF5",
                                           fontFamily: "'Roboto Mono', monospace" }} />
                              </label>
                              <label className="block">
                                <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.14em]"
                                      style={{ fontFamily: "'Roboto Mono', monospace", color: "#8B8578" }}>
                                  Repart le
                                </span>
                                <input type="date" value={p.fin || ""} min={p.debut || debut} max={fin}
                                  onChange={(e) => majPersonne(p.id, "fin", e.target.value)}
                                  className="w-full rounded-[10px] px-2.5 py-2 text-[13px] focus:outline-none"
                                  style={{ border: "1px solid #E0D8C7", background: "#FCFAF5",
                                           fontFamily: "'Roboto Mono', monospace" }} />
                              </label>
                            </div>
                            {(p.debut || p.fin) && (
                              <button onClick={() => { majPersonne(p.id, "debut", ""); majPersonne(p.id, "fin", ""); }}
                                className="mt-2.5 text-[11.5px] font-medium transition-colors"
                                style={{ color: "#8B8578" }}>
                                Tout le séjour
                              </button>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              {/* ajout */}
              <div className="mt-3 flex items-center gap-1 rounded-full py-1 pl-3 pr-1"
                   style={{ border: "1px dashed #CDC4B0", width: "fit-content" }}>
                <input
                  value={nouveauNom}
                  onChange={(e) => setNouveauNom(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && ajouterPersonne(nouveauNom)}
                  placeholder="Prénom"
                  enterKeyHint="done"
                  className="w-[76px] bg-transparent text-[13.5px] focus:outline-none"
                />
                <button onClick={() => ajouterPersonne(nouveauNom)} disabled={!nouveauNom.trim()}
                  aria-label="Ajouter cette personne"
                  className="flex h-7 w-7 items-center justify-center rounded-full transition-colors"
                  style={{ background: nouveauNom.trim() ? "#1C1A17" : "#E0D8C7",
                           color: nouveauNom.trim() ? "#F7F3E8" : "#B0A897" }}>
                  <Plus size={14} strokeWidth={2.5} />
                </button>
              </div>

              {suggestions.length > 0 && (
                <div className="mt-3">
                  <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.14em]"
                        style={{ fontFamily: "'Roboto Mono', monospace", color: "#B0A897" }}>
                    Déjà venus
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {suggestions.map((n) => (
                      <button key={n} onClick={() => ajouterPersonne(n)}
                        className="rounded-full px-3 py-1 text-[12.5px] transition-colors"
                        style={{ border: "1px solid #E0D8C7", color: "#8B8578" }}>
                        + {n}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </section>
          </>
        )}

        {/* ================= PAIEMENTS ================= */}
        {ecran === "paiements" && (
          <>
            <section className="mb-7 rounded-[18px] p-4"
                     style={{ background: "#fff", boxShadow: "0 0 0 1px #E9E2D2" }}>
              <div className="flex items-baseline justify-between text-[13px]"
                   style={{ fontFamily: "'Roboto Mono', monospace", color: "#8B8578" }}>
                <span>Encaissé</span>
                <span className="tabular-nums">{locFmt(calcul.totalVerse)} € / {locFmt(loyer)} €</span>
              </div>
              <div className="mt-2.5 h-2 overflow-hidden rounded-full" style={{ background: "#F0EADB" }}>
                <div className="h-full rounded-full transition-all duration-500"
                     style={{ width: `${loyer > 0 ? Math.min(100, (calcul.totalVerse / loyer) * 100) : 0}%`,
                              background: calcul.reste <= 0 ? "#2E6F5E" : "#B5761F" }} />
              </div>
              {calcul.totalAnnonce > calcul.totalVerse && (
                <p className="mt-2.5 text-[11.5px] tabular-nums"
                   style={{ fontFamily: "'Roboto Mono', monospace", color: "#B5761F" }}>
                  {locFmt(calcul.totalAnnonce - calcul.totalVerse)} € annoncés mais pas encore reçus
                </p>
              )}
              {calcul.reste > 0 && (
                <p className="mt-1.5 text-[11.5px] tabular-nums"
                   style={{ fontFamily: "'Roboto Mono', monospace", color: "#8B8578" }}>
                  Reste à collecter : {locFmt(calcul.reste)} €
                </p>
              )}
              {calcul.reste < 0 && (
                <p className="mt-1.5 text-[11.5px] tabular-nums"
                   style={{ fontFamily: "'Roboto Mono', monospace", color: "#2E6F5E" }}>
                  Trop-perçu de {locFmt(-calcul.reste)} € — à redistribuer
                </p>
              )}
            </section>

            {calcul.resultats.filter((p) => p.solde < 0).length > 1 && (
              <button
                onClick={() => {
                  const aRegler = calcul.resultats.filter((p) => p.solde < 0);
                  majEtat((e) => {
                    let id = e.prochainId;
                    return {
                      paiements: [...e.paiements, ...aRegler.map((p) => ({
                        id: ++id, personneId: p.id, montant: -p.solde,
                        recu: true, date: locAujourdhui(),
                      }))],
                      prochainId: id,
                    };
                  });
                }}
                className="mb-4 flex w-full items-center justify-center gap-2 rounded-[14px] py-3
                           text-[13px] font-semibold transition-colors"
                style={{ border: "1px dashed #CDC4B0", color: "#8B8578" }}>
                <Check size={15} strokeWidth={2.5} />
                Tout le monde a réglé sa part
              </button>
            )}

            {personnes.length === 0 ? (
              <p className="rounded-[18px] px-6 py-10 text-center text-[13.5px] leading-relaxed"
                 style={{ border: "1px dashed #DDD5C4", color: "#8B8578" }}>
                Ajoutez d'abord les participants dans l'onglet Séjour.
              </p>
            ) : (
              <ul className="space-y-2.5">
                {calcul.resultats.map((p) => {
                  const versements = paiements.filter((v) => v.personneId === p.id);
                  return (
                    <li key={p.id} className="monte overflow-hidden rounded-[18px]"
                        style={{ background: "#fff", boxShadow: "0 0 0 1px #E9E2D2" }}>
                      <div className="flex items-center gap-3 p-4">
                        <AvatarLoc personne={p} taille={34} />
                        <div className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] font-semibold">{p.nom}</span>
                          <span className="mt-0.5 block text-[11.5px] tabular-nums"
                                style={{ fontFamily: "'Roboto Mono', monospace", color: "#8B8578" }}>
                            doit {locFmt(p.part)} € · versé {locFmt(p.verse)} €
                          </span>
                        </div>
                        <span className="shrink-0 text-[15px] font-bold tabular-nums"
                              style={{ fontFamily: "'Roboto Mono', monospace",
                                       color: p.solde === 0 ? "#2E6F5E"
                                            : p.solde > 0 ? "#B5761F" : "#C1362F" }}>
                          {p.solde === 0 ? "à locJour"
                            : p.solde > 0 ? `+${locFmt(p.solde)}` : locFmt(p.solde)}
                        </span>
                      </div>

                      {versements.length > 0 && (
                        <ul className="border-t border-dashed px-4 py-2"
                            style={{ borderColor: "#E5DECD" }}>
                          {versements.map((v) => (
                            <li key={v.id} className="flex items-center gap-2.5 py-1.5">
                              <button onClick={() => basculerRecu(v.id)}
                                aria-label={v.recu ? "Marquer comme non reçu" : "Marquer comme reçu"}
                                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full
                                           transition-colors"
                                style={{ border: `1.5px solid ${v.recu ? "#2E6F5E" : "#DDD5C4"}`,
                                         background: v.recu ? "#2E6F5E" : "transparent" }}>
                                {v.recu && <Check size={13} strokeWidth={3} style={{ color: "#fff" }} />}
                              </button>
                              <span className="flex-1 text-[13px] tabular-nums"
                                    style={{ fontFamily: "'Roboto Mono', monospace",
                                             color: v.recu ? "#1C1A17" : "#B0A897" }}>
                                {locFmt(v.montant)} €
                                <span className="ml-2 text-[11px]" style={{ color: "#B0A897" }}>
                                  {v.recu ? "reçu" : "annoncé"}
                                </span>
                              </span>
                              <button onClick={() => supprimerPaiement(v.id)}
                                aria-label="Supprimer ce versement"
                                style={{ color: "#C4BCA9" }}>
                                <X size={14} strokeWidth={2.5} />
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}

                      {ajoutPaiement === p.id ? (
                        <div className="flex items-center gap-2 border-t border-dashed px-4 py-3"
                             style={{ borderColor: "#E5DECD", background: "#FCFAF5" }}>
                          <ChampMontantLoc
                            centimes={montantSaisi}
                            onChange={setMontantSaisi}
                            aria-label={`Montant versé par ${p.nom}`}
                            autoFocus
                            className="w-[80px] rounded-md px-2 py-1.5 text-right text-[14px]
                                       font-bold tabular-nums focus:outline-none"
                            style={{ fontFamily: "'Roboto Mono', monospace",
                                     border: "1px solid #E0D8C7", background: "#fff" }}
                          />
                          <span className="text-[12px]" style={{ color: "#8B8578" }}>€</span>
                          <button onClick={() => ajouterPaiement(p.id, montantSaisi)}
                            disabled={montantSaisi <= 0}
                            className="ml-auto rounded-[10px] px-3 py-2 text-[12.5px] font-semibold transition-colors"
                            style={{ background: montantSaisi > 0 ? "#1C1A17" : "#E0D8C7",
                                     color: montantSaisi > 0 ? "#F7F3E8" : "#B0A897" }}>
                            Enregistrer
                          </button>
                          <button onClick={() => { setAjoutPaiement(null); setMontantSaisi(0); }}
                            className="rounded-[10px] px-2.5 py-2 text-[12.5px]"
                            style={{ color: "#8B8578" }}>
                            Annuler
                          </button>
                        </div>
                      ) : (
                        <div className="flex border-t border-dashed" style={{ borderColor: "#E5DECD" }}>
                          {p.solde < 0 && (
                            <button
                              onClick={() => soldeEnUnCoup(p.id, -p.solde)}
                              className="flex flex-1 items-center justify-center gap-1.5 py-2.5
                                         text-[12.5px] font-semibold transition-colors"
                              style={{ color: "#2E6F5E" }}>
                              <Check size={14} strokeWidth={2.5} /> Réglé — {locFmt(-p.solde)} €
                            </button>
                          )}
                          <button
                            onClick={() => { setAjoutPaiement(p.id); setMontantSaisi(Math.max(0, -p.solde)); }}
                            className="flex items-center justify-center gap-1.5 py-2.5 text-[12.5px]
                                       font-semibold transition-colors"
                            style={{ color: "#8B8578",
                                     flex: p.solde < 0 ? "0 0 auto" : "1",
                                     paddingInline: p.solde < 0 ? "1rem" : 0,
                                     borderLeft: p.solde < 0 ? "1px dashed #E5DECD" : "none" }}>
                            <Plus size={14} strokeWidth={2.5} />
                            {p.solde < 0 ? "" : "Noter un versement"}
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}

        {/* ================= SOLDES ================= */}
        {ecran === "soldes" && (
          <>
            {mouvements.length === 0 && calcul.reste <= 0 ? (
              <div className="rounded-[18px] px-6 py-12 text-center"
                   style={{ border: "1px dashed #DDD5C4" }}>
                <Check size={26} className="mx-auto mb-3" style={{ color: "#2E6F5E" }} />
                <p className="text-[14px] font-semibold">Tout est équilibré</p>
                <p className="mt-1.5 text-[12.5px] leading-relaxed" style={{ color: "#8B8578" }}>
                  Personne ne doit rien à personne.
                </p>
              </div>
            ) : (
              <>
                {calcul.reste > 0 && (
                  <div className="mb-5 rounded-[18px] p-4"
                       style={{ background: "#FDF3E6", border: "1px solid #EBD9BC" }}>
                    <p className="text-[13px] font-semibold" style={{ color: "#8A5A18" }}>
                      Reste à verser au propriétaire : {locFmt(calcul.reste)} €
                    </p>
                    <p className="mt-1.5 text-[11.5px] leading-relaxed" style={{ color: "#A07A3E" }}>
                      Chacun doit encore sa part ci-dessous. Notez les versements dans
                      l'onglet Paiements au fur et à mesure.
                    </p>
                    <ul className="mt-3 space-y-1.5">
                      {calcul.resultats.filter((p) => p.solde < 0).map((p) => (
                        <li key={p.id} className="flex items-center gap-2.5 text-[12.5px] tabular-nums"
                            style={{ fontFamily: "'Roboto Mono', monospace" }}>
                          <AvatarLoc personne={p} taille={22} />
                          <span className="min-w-0 flex-1 truncate">{p.nom}</span>
                          <span className="font-bold" style={{ color: "#8A5A18" }}>
                            {locFmt(-p.solde)} €
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {mouvements.length > 0 && (
                  <>
                    <div className="mb-3.5 flex items-center gap-3">
                      <span className="text-[10px] font-bold uppercase tracking-[0.2em]"
                            style={{ fontFamily: "'Roboto Mono', monospace", color: "#8B8578" }}>
                        Remboursements
                      </span>
                      <span className="h-px flex-1" style={{ background: "#DDD5C4" }} />
                      <span className="shrink-0 text-[11px] font-bold tabular-nums"
                            style={{ fontFamily: "'Roboto Mono', monospace",
                                     color: mouvements.length > 6 && etat.modeTransfert !== "cagnotte"
                                       ? "#C1362F" : "#8B8578" }}>
                        {etat.modeTransfert === "cagnotte"
                          ? `${mouvements.filter((m) => m.vers === null).length} versement${
                              mouvements.filter((m) => m.vers === null).length > 1 ? "s" : ""}`
                          : `${mouvements.length} virement${mouvements.length > 1 ? "s" : ""}`}
                      </span>
                    </div>

                    <div className="mb-3 flex gap-1 rounded-[12px] p-1" style={{ background: "#F0EADB" }}>
                      {[["cagnotte", "Cagnotte"], ["simple", "Au plus court"], ["prorata", "Au prorata"]]
                        .map(([v, l]) => (
                        <button key={v} onClick={() => majEtat(() => ({ modeTransfert: v }))}
                          className="flex-1 rounded-[9px] py-2 text-[11.5px] font-semibold transition-colors"
                          style={etat.modeTransfert === v
                            ? { background: "#fff", color: "#1C1A17", boxShadow: "0 1px 2px rgba(28,26,23,.1)" }
                            : { color: "#8B8578" }}>
                          {l}
                        </button>
                      ))}
                    </div>

                    {etat.modeTransfert === "cagnotte" ? (
                      <>
                        <div className="mb-3 rounded-[16px] p-4"
                             style={{ background: "#1C1A17", color: "#F7F3E8" }}>
                          <div className="flex items-baseline justify-between">
                            <span className="text-[12px] font-bold uppercase tracking-[0.14em]"
                                  style={{ fontFamily: "'Roboto Mono', monospace", opacity: .6 }}>
                              Dans la cagnotte
                            </span>
                            <span className="text-[22px] font-bold tabular-nums"
                                  style={{ fontFamily: "'Roboto Mono', monospace" }}>
                              {locFmt(potCommun.entrees)} €
                            </span>
                          </div>
                          <p className="mt-2 text-[11.5px] leading-relaxed" style={{ opacity: .65 }}>
                            {potCommun.sorties > 0
                              ? `${locFmt(potCommun.sorties)} € reviennent à ceux qui ont avancé — à reporter dans votre Tricount plutôt qu'à virer.`
                              : "Cet argent appartient au groupe, pas à celui qui le détient."}
                          </p>
                        </div>

                        {mouvements.filter((m) => m.vers === null).length > 0 && (
                          <>
                            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em]"
                               style={{ fontFamily: "'Roboto Mono', monospace", color: "#8B8578" }}>
                              Versent dans la cagnotte
                            </p>
                            <ul className="mb-4 space-y-2">
                              {mouvements.filter((m) => m.vers === null).map((m, i) => (
                                <li key={`e${i}`} className="monte flex items-center gap-2.5 rounded-[14px] p-3.5"
                                    style={{ background: "#fff", boxShadow: "0 0 0 1px #E9E2D2",
                                             animationDelay: `${i * 40}ms` }}>
                                  <AvatarLoc personne={m.de} taille={28} />
                                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">
                                    {m.de.nom}
                                  </span>
                                  <span className="shrink-0 text-[15px] font-bold tabular-nums"
                                        style={{ fontFamily: "'Roboto Mono', monospace" }}>
                                    {locFmt(m.montant)} €
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </>
                        )}

                        {mouvements.filter((m) => m.de === null).length > 0 && (
                          <>
                            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em]"
                               style={{ fontFamily: "'Roboto Mono', monospace", color: "#8B8578" }}>
                              Ont avancé — crédit dans la cagnotte
                            </p>
                            <div className="rounded-[14px] p-3.5"
                                 style={{ background: "#fff", boxShadow: "0 0 0 1px #E9E2D2" }}>
                              {mouvements.filter((m) => m.de === null).map((m, i) => (
                                <div key={`s${i}`}
                                     className={`flex items-center gap-2.5 py-1.5 ${i > 0 ? "border-t border-dashed" : ""}`}
                                     style={{ borderColor: "#E5DECD" }}>
                                  <AvatarLoc personne={m.vers} taille={22} />
                                  <span className="min-w-0 flex-1 truncate text-[13px]">{m.vers.nom}</span>
                                  <span className="shrink-0 text-[13px] font-bold tabular-nums"
                                        style={{ fontFamily: "'Roboto Mono', monospace", color: "#2E6F5E" }}>
                                    +{locFmt(m.montant)} €
                                  </span>
                                </div>
                              ))}
                              <p className="mt-2.5 border-t pt-2.5 text-[11.5px] leading-relaxed"
                                 style={{ borderColor: "#E5DECD", color: "#8B8578" }}>
                                Ces montants restent dans la cagnotte. Reportez-les dans votre
                                Tricount de vacances plutôt que de faire des virements de
                                {" "}{locFmt(Math.round(potCommun.sorties / mouvements.filter((m) => m.de === null).length))} €.
                              </p>
                            </div>
                          </>
                        )}
                      </>
                    ) : (
                      <ul className="space-y-2.5">
                        {mouvements.map((m, i) => (
                          <li key={i} className="monte flex items-center gap-2.5 rounded-[18px] p-4"
                              style={{ background: "#fff", boxShadow: "0 0 0 1px #E9E2D2",
                                       animationDelay: `${i * 45}ms` }}>
                            <AvatarLoc personne={m.de} taille={30} />
                            <span className="min-w-0 truncate text-[13.5px] font-medium">{m.de.nom}</span>
                            <ArrowRight size={15} className="shrink-0" style={{ color: "#B0A897" }} />
                            <AvatarLoc personne={m.vers} taille={30} />
                            <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{m.vers.nom}</span>
                            <span className="shrink-0 text-[15px] font-bold tabular-nums"
                                  style={{ fontFamily: "'Roboto Mono', monospace" }}>
                              {locFmt(m.montant)} €
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}

                    <p className="mt-4 flex items-start gap-2 rounded-[12px] px-3.5 py-3 text-[11.5px] leading-relaxed"
                       style={{ background: "#F2EDE0", color: "#8B8578" }}>
                      <Info size={14} className="mt-px shrink-0" />
                      {etat.modeTransfert === "cagnotte"
                        ? "Un seul versement par personne dans un pot commun. L'argent n'appartient à personne en particulier : il sert au groupe, et le reliquat se règle avec le reste des dépenses de vacances."
                        : etat.modeTransfert === "simple"
                          ? "Le nombre de virements est réduit au minimum : certains remboursent une seule personne, qui redistribue de fait."
                          : "Chaque personne rembourse tous ceux qui ont avancé, proportionnellement à leur avance. Le plus juste au centime, mais beaucoup de virements en grand groupe."}
                    </p>
                  </>
                )}
              </>
            )}

            {/* détail par personne */}
            {personnes.length > 0 && (
              <section className="mt-8">
                <div className="mb-3.5 flex items-center gap-3">
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em]"
                        style={{ fontFamily: "'Roboto Mono', monospace", color: "#8B8578" }}>
                    Détail
                  </span>
                  <span className="h-px flex-1" style={{ background: "#DDD5C4" }} />
                </div>
                <div className="rounded-[18px] p-4" style={{ background: "#fff", boxShadow: "0 0 0 1px #E9E2D2" }}>
                  {calcul.resultats.map((p, i) => (
                    <div key={p.id}
                         className={`flex items-baseline gap-2 py-2 text-[12.5px] tabular-nums ${
                           i > 0 ? "border-t border-dashed" : ""}`}
                         style={{ fontFamily: "'Roboto Mono', monospace",
                                  borderColor: "#E5DECD" }}>
                      <span className="min-w-0 flex-1 truncate">{p.nom}</span>
                      <span style={{ color: "#8B8578" }}>{p.locNuits}n</span>
                      <span className="w-[62px] text-right" style={{ color: "#8B8578" }}>{locFmt(p.part)}</span>
                      <span className="w-[62px] text-right">{locFmt(p.verse)}</span>
                      <span className="w-[66px] text-right font-bold"
                            style={{ color: p.solde === 0 ? "#2E6F5E"
                                          : p.solde > 0 ? "#B5761F" : "#C1362F" }}>
                        {p.solde > 0 ? "+" : ""}{locFmt(p.solde)}
                      </span>
                    </div>
                  ))}
                  <div className="mt-1 flex items-baseline gap-2 border-t pt-2.5 text-[11px]"
                       style={{ fontFamily: "'Roboto Mono', monospace", borderColor: "#DDD5C4",
                                color: "#B0A897" }}>
                    <span className="flex-1">locNuits · dû · versé · solde</span>
                  </div>
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {/* onglets */}
      <nav className="fixed inset-x-0 bottom-0 z-10"
           style={{ borderTop: "1px solid #E5DECD", background: "rgba(247,243,232,.95)",
                    backdropFilter: "blur(8px)" }}>
        <div className="mx-auto flex max-w-[430px] px-3 pb-5 pt-1">
          {onglet("sejour", "Séjour", <CalendarDays size={17} />)}
          {onglet("paiements", "Paiements", <Wallet size={17} />)}
          {onglet("soldes", "Soldes", <Users size={17} />)}
        </div>
      </nav>
    </div>
  );
}

/* ==================== ACCUEIL ET NAVIGATION ==================== */

const stylesGlobaux = `
  @import url('https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=Roboto+Mono:wght@400;500;700&display=swap');
  @keyframes monte { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  .monte { animation: monte .28s cubic-bezier(.2,.7,.3,1) both; }
  @media (prefers-reduced-motion: reduce) { .monte { animation: none; } }
`;

function Accueil({ onChoisir }) {
  const cartes = [
    {
      cle: "addition",
      titre: "L'addition",
      sous: "Au restaurant, article par article",
      detail: "Qui a pris quoi, parts fractionnées, service au prorata.",
      icone: <Utensils size={20} />,
      teinte: "#C1362F",
    },
    {
      cle: "location",
      titre: "La location",
      sous: "Au prorata des nuitées",
      detail: "Dates par personne, suivi des versements, cagnotte commune.",
      icone: <KeyRound size={20} />,
      teinte: "#2E6F5E",
    },
  ];

  return (
    <div className="min-h-screen antialiased"
         style={{ background: "#F7F3E8", color: "#1C1A17",
                  fontFamily: "'Archivo', system-ui, sans-serif" }}>
      <style>{stylesGlobaux}</style>
      <div className="mx-auto max-w-[430px] px-5 pb-16">
        <header className="pt-16 pb-9">
          <h1 className="text-[38px] font-bold leading-[0.92] tracking-[-0.04em]">
            Partage
          </h1>
          <p className="mt-3 text-[13.5px] leading-relaxed" style={{ color: "#8B8578" }}>
            Deux calculs, deux façons de partager.
            Personne n'a besoin d'installer quoi que ce soit.
          </p>
        </header>

        <div className="space-y-3">
          {cartes.map((c, i) => (
            <button key={c.cle} onClick={() => onChoisir(c.cle)}
              className="monte group flex w-full items-start gap-4 rounded-[20px] p-5 text-left
                         transition-transform active:scale-[.99]"
              style={{ background: "#fff", boxShadow: "0 2px 0 #E9E2D2, 0 0 0 1px #E9E2D2",
                       animationDelay: `${i * 70}ms` }}>
              <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px]"
                    style={{ background: c.teinte, color: "#F7F3E8" }}>
                {c.icone}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[19px] font-bold tracking-[-0.02em]">{c.titre}</span>
                <span className="mt-0.5 block text-[12px] font-bold uppercase tracking-[0.1em]"
                      style={{ fontFamily: "'Roboto Mono', monospace", color: c.teinte }}>
                  {c.sous}
                </span>
                <span className="mt-2 block text-[12.5px] leading-relaxed" style={{ color: "#8B8578" }}>
                  {c.detail}
                </span>
              </span>
              <ArrowRight size={17} className="mt-1 shrink-0 transition-transform
                                               group-hover:translate-x-0.5"
                          style={{ color: "#C4BCA9" }} />
            </button>
          ))}
        </div>

        <p className="mt-8 text-center text-[11.5px] leading-relaxed" style={{ color: "#B0A897" }}>
          Chaque module garde ses données de son côté.
          Vous pouvez passer de l'un à l'autre sans rien perdre.
        </p>
      </div>
    </div>
  );
}

export default function Partage() {
  const [module, setModule] = useState(null);
  const [pret, setPret] = useState(false);

  // on retient le dernier module ouvert
  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage?.get(CLE_MODULE);
        if (r?.value) setModule(JSON.parse(r.value));
      } catch { /* premier lancement */ }
      setPret(true);
    })();
  }, []);

  const choisir = (cle) => {
    setModule(cle);
    window.storage?.set(CLE_MODULE, JSON.stringify(cle)).catch(() => {});
  };

  const retour = () => {
    setModule(null);
    window.storage?.set(CLE_MODULE, JSON.stringify(null)).catch(() => {});
  };

  if (!pret) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: "#F7F3E8" }}>
        <Loader2 size={22} className="animate-spin" style={{ color: "#B0A897" }} />
      </div>
    );
  }

  if (module === "addition") return <ModuleAddition onRetour={retour} />;
  if (module === "location") return <ModuleLocation onRetour={retour} />;
  return <Accueil onChoisir={choisir} />;
}
