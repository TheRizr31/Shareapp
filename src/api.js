/* ======================================================================
 *  Client API — appelle functions/api/[[chemin]].js
 *
 *  Chaque session (addition ou location) vit derrière un jeton secret.
 *  Toutes les écritures passent par ici ; rien n'est stocké en local
 *  hormis la liste des sessions déjà ouvertes sur cet appareil (voir
 *  historiqueLocal.js) et les suggestions de prénoms.
 * ==================================================================== */

import { useEffect, useRef } from "react";

export async function appeler(action, corps = {}) {
  const r = await fetch(`/api/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corps),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.erreur || `Erreur ${r.status}`);
  return d;
}

/**
 * File d'écriture sérialisée + pilotage de l'indicateur "Enregistré".
 * Même principe que la version locale (window.storage) : deux écritures
 * simultanées ne doivent jamais se chevaucher.
 */
export function creerFile(setSauvegarde) {
  let file = Promise.resolve();
  const minuteries = {};

  /** Exécute tout de suite (mise en file). Renvoie le résultat de `tache`. */
  const executer = (tache) => {
    setSauvegarde("cours");
    const p = file.then(() => tache());
    file = p.then(
      () => setSauvegarde("ok"),
      (e) => { console.error("Synchronisation impossible:", e); setSauvegarde("erreur"); }
    );
    return p;
  };

  /** Attend `delai` ms de silence sur cette clé avant d'exécuter (annule les appels précédents). */
  const differe = (cle, tache, delai = 700) => {
    clearTimeout(minuteries[cle]);
    minuteries[cle] = setTimeout(() => { executer(tache).catch(() => {}); }, delai);
  };

  return { executer, differe };
}

/* ---------- historique local (localStorage) ---------- */
/* Cet appareil garde la liste des sessions déjà ouvertes, pour l'écran
   d'accueil de chaque module. La vérité reste sur le serveur : cette
   liste n'est qu'un rattrapage si le lien est perdu. */

export function lireJSON(cle, defaut) {
  try {
    const v = localStorage.getItem(cle);
    return v ? JSON.parse(v) : defaut;
  } catch {
    return defaut;
  }
}

export function ecrireJSON(cle, valeur) {
  try {
    localStorage.setItem(cle, JSON.stringify(valeur));
  } catch { /* navigation privée, quota dépassé… tant pis */ }
}

/** Ajoute ou met à jour une entrée d'index par jeton, garde les 50 plus récentes. */
export function majIndex(cle, jeton, champs) {
  const liste = lireJSON(cle, []);
  const i = liste.findIndex((e) => e.jeton === jeton);
  const entree = { ...(i === -1 ? { jeton } : liste[i]), ...champs };
  const suite = i === -1 ? [entree, ...liste] : [entree, ...liste.slice(0, i), ...liste.slice(i + 1)];
  const bornee = suite.slice(0, 50);
  ecrireJSON(cle, bornee);
  return bornee;
}

export function retirerIndex(cle, jeton) {
  const suite = lireJSON(cle, []).filter((e) => e.jeton !== jeton);
  ecrireJSON(cle, suite);
  return suite;
}

/**
 * Marque cet appareil comme celui qui a créé une session donnée — le seul
 * moyen fiable de reconnaître le créateur sans compte : à la différence de
 * l'historique local, ce repère n'est jamais posé pour un destinataire qui
 * ouvre juste un lien reçu. Sert à rendre la navigation complète (retour à
 * l'accueil) à un créateur qui rouvre son propre lien /s/<jeton>, tout en
 * gardant le mode invité pour tout le monde d'autre.
 */
export function marquerCreateur(jeton) {
  try { localStorage.setItem(`partage:createur:${jeton}`, "1"); } catch { /* tant pis */ }
}

export function estCreateur(jeton) {
  try { return localStorage.getItem(`partage:createur:${jeton}`) === "1"; } catch { return false; }
}

/* ---------- partage du lien de session ---------- */

/**
 * Partage ou copie le lien /s/<jeton>. Renvoie "partage", "copie",
 * "annule" (l'utilisateur a fermé la feuille de partage), ou l'URL
 * elle-même si ni l'un ni l'autre n'a fonctionné (affichage manuel).
 */
export async function partagerLien(jeton, titre) {
  const url = `${location.origin}/s/${jeton}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: titre || "Partage", url });
      return "partage";
    } catch (e) {
      if (e?.name === "AbortError") return "annule";
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return "copie";
  } catch {
    return url;
  }
}

/* ---------- routage minimal ---------- */

export function jetonDeLURL() {
  const m = location.pathname.match(/^\/s\/([a-z0-9]{6,20})$/i);
  return m ? m[1] : null;
}

export function allerVersSession(jeton) {
  history.pushState({}, "", `/s/${jeton}`);
}

export function allerVersAccueil() {
  history.pushState({}, "", "/");
}

/* ---------- actualisation périodique (pour voir les autres en direct) ---------- */

/**
 * Toutes les `intervalleMs`, relit la session et transmet la réponse à
 * `onDonnees` — à charge pour l'appelant de ne l'appliquer que si
 * quelque chose a changé (comparer modifieLe), afin qu'aucun re-rendu
 * ne se produise quand rien de nouveau n'est arrivé.
 *
 * Ne relit rien : si l'onglet est en arrière-plan (économie de
 * batterie/données), si aucun jeton n'est actif, ou si un champ de
 * saisie a le focus (pour ne jamais couper quelqu'un en pleine frappe).
 */
export function useActualisationPeriodique(jeton, actif, onDonnees, intervalleMs = 2000) {
  const rappelRef = useRef(onDonnees);
  rappelRef.current = onDonnees;

  useEffect(() => {
    if (!jeton || !actif) return;
    let annule = false;

    const tick = async () => {
      if (document.hidden) return;
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      try {
        const session = await appeler("lire", { jeton });
        if (!annule) rappelRef.current(session);
      } catch { /* réseau ou session supprimée : on retentera au prochain passage */ }
    };

    const id = setInterval(tick, intervalleMs);
    return () => { annule = true; clearInterval(id); };
  }, [jeton, actif, intervalleMs]);
}
