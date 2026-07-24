/* ======================================================================
 *  Client API — appelle functions/api/[[chemin]].js
 *
 *  Chaque session (addition ou location) vit derrière un jeton secret.
 *  Toutes les écritures passent par ici ; rien n'est stocké en local
 *  hormis la liste des sessions déjà ouvertes sur cet appareil (voir
 *  historiqueLocal.js) et les suggestions de prénoms.
 * ==================================================================== */

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
