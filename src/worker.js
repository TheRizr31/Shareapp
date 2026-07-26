/* =====================================================================
 *  Worker Partage — sert les fichiers statiques (dist/) et l'API D1.
 *
 *  Une seule route API attrape-tout : /api/<action>
 *  Toutes les opérations exigent le jeton de session, sauf la création.
 *
 *  Le jeton fait office de mot de passe : 12 caractères pris dans un
 *  alphabet sans ambiguïté visuelle, soit ~10^18 combinaisons.
 * ===================================================================== */

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function jetonAleatoire(longueur = 12) {
  const octets = new Uint8Array(longueur);
  crypto.getRandomValues(octets);
  return Array.from(octets, (o) => ALPHABET[o % ALPHABET.length]).join("");
}

const uuid = () => crypto.randomUUID();
const maintenant = () => Date.now();

const json = (donnees, statut = 200) =>
  new Response(JSON.stringify(donnees), {
    status: statut,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });

const erreur = (message, statut = 400) => json({ erreur: message }, statut);

/**
 * Retrouve une session par un jeton quelconque — celui de l'organisateur
 * (accès complet) ou, pour une cagnotte, celui des contributeurs (lecture
 * restreinte). Renvoie { session, estOrganisateur } ou null.
 */
async function sessionParJetonQuelconque(db, jetonFourni) {
  if (!jetonFourni || typeof jetonFourni !== "string") return null;
  const session = await db.prepare(
    "SELECT * FROM sessions WHERE jeton = ? OR jeton_contributeurs = ?"
  ).bind(jetonFourni, jetonFourni).first();
  if (!session) return null;
  return { session, estOrganisateur: session.jeton === jetonFourni };
}

/** Marque la session comme modifiée — sert au tri de l'historique. */
const toucher = (db, id) =>
  db.prepare("UPDATE sessions SET modifie_le = ? WHERE id = ?")
    .bind(maintenant(), id).run();

/* ---------------------------------------------------------------------
 *  Lecture complète d'une session
 *
 *  Pour une cagnotte ouverte avec le lien contributeurs (pas celui de
 *  l'organisateur), les versements sont réduits à leur somme : chacun
 *  voit l'avancement vers l'objectif, personne ne voit qui a mis quoi
 *  à part l'organisateur.
 * ------------------------------------------------------------------- */
async function lireTout(db, session, estOrganisateur) {
  const [participants, articles, parts, versements] = await Promise.all([
    db.prepare(
      "SELECT * FROM participants WHERE session_id = ? ORDER BY position, rowid"
    ).bind(session.id).all(),
    db.prepare(
      "SELECT * FROM articles WHERE session_id = ? ORDER BY position, rowid"
    ).bind(session.id).all(),
    db.prepare(
      `SELECT p.* FROM parts p
         JOIN articles a ON a.id = p.article_id
        WHERE a.session_id = ?`
    ).bind(session.id).all(),
    db.prepare(
      "SELECT * FROM versements WHERE session_id = ? ORDER BY cree_le"
    ).bind(session.id).all(),
  ]);

  // regroupement des parts par article
  const parArticle = {};
  for (const p of parts.results) {
    (parArticle[p.article_id] ||= []).push({
      participantId: p.participant_id,
      numerateur: p.numerateur,
      denominateur: p.denominateur,
    });
  }

  const detailRestreint = session.type === "cagnotte" && !estOrganisateur;

  return {
    id: session.id,
    jeton: estOrganisateur ? session.jeton : session.jeton_contributeurs,
    ...(session.type === "cagnotte" && estOrganisateur
      ? { jetonContributeurs: session.jeton_contributeurs }
      : {}),
    estOrganisateur,
    type: session.type,
    titre: session.titre,
    service: session.service,
    modeService: session.mode_service,
    totalAttendu: session.total_attendu,
    loyer: session.loyer,
    dateDebut: session.date_debut,
    dateFin: session.date_fin,
    modeTransfert: session.mode_transfert,
    objectif: session.objectif,
    dateLimite: session.date_limite,
    clotureeLe: session.cloturee_le,
    modifieLe: session.modifie_le,

    participants: participants.results.map((p) => ({
      id: p.id,
      nom: p.nom,
      couleur: p.couleur,
      position: p.position,
      dateDebut: p.date_debut,
      dateFin: p.date_fin,
    })),

    articles: articles.results.map((a) => ({
      id: a.id,
      libelle: a.libelle,
      montant: a.montant,
      quantite: a.quantite,
      position: a.position,
      reglee: !!a.reglee,
      parts: parArticle[a.id] || [],
    })),

    ...(detailRestreint
      ? { totalVerse: versements.results.reduce((a, v) => a + v.montant, 0) }
      : {
          versements: versements.results.map((v) => ({
            id: v.id,
            participantId: v.participant_id,
            montant: v.montant,
            recu: !!v.recu,
            date: v.date_versement,
          })),
        }),
  };
}

/* ---------------------------------------------------------------------
 *  API : /api/<action>
 * ------------------------------------------------------------------- */
async function traiterApi(request, env, action) {
  const db = env.DB;

  if (request.method === "OPTIONS") return new Response(null, { status: 204 });

  let corps = {};
  if (request.method === "POST") {
    try { corps = await request.json(); } catch { corps = {}; }
  }
  const url = new URL(request.url);
  const jeton = corps.jeton || url.searchParams.get("jeton");

  try {
    /* --- création : seule action sans jeton préalable --------------- */
    if (action === "creer") {
      const type = corps.type;
      if (!["addition", "location", "cagnotte"].includes(type)) return erreur("type inconnu");

      const id = uuid();
      const nouveauJeton = jetonAleatoire();
      const jetonContributeurs = type === "cagnotte" ? jetonAleatoire() : null;
      const t = maintenant();
      const aujourdhui = new Date().toISOString().slice(0, 10);
      const dansSeptJours = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

      await db.prepare(
        `INSERT INTO sessions
           (id, jeton, jeton_contributeurs, type, titre, date_debut, date_fin, objectif, cree_le, modifie_le)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        id, nouveauJeton, jetonContributeurs, type, corps.titre || "",
        type === "location" ? aujourdhui : null,
        type === "location" ? dansSeptJours : null,
        corps.objectif || 0,
        t, t
      ).run();

      return json({
        id, jeton: nouveauJeton, type,
        ...(jetonContributeurs ? { jetonContributeurs } : {}),
      });
    }

    /* --- toutes les autres actions exigent un jeton valide ---------- */
    const trouve = await sessionParJetonQuelconque(db, jeton);
    if (!trouve) return erreur("Session introuvable", 404);
    const { session, estOrganisateur } = trouve;

    switch (action) {
      case "lire":
        return json(await lireTout(db, session, estOrganisateur));

      /* --- session ------------------------------------------------- */
      case "maj-session": {
        const c = corps.champs || {};
        const colonnes = {
          titre: "titre", service: "service", modeService: "mode_service",
          totalAttendu: "total_attendu", loyer: "loyer",
          dateDebut: "date_debut", dateFin: "date_fin",
          modeTransfert: "mode_transfert",
          objectif: "objectif", dateLimite: "date_limite",
        };
        const sets = [], valeurs = [];
        for (const [cle, colonne] of Object.entries(colonnes)) {
          if (c[cle] !== undefined) { sets.push(`${colonne} = ?`); valeurs.push(c[cle]); }
        }
        if (c.cloturee !== undefined) {
          sets.push("cloturee_le = ?");
          valeurs.push(c.cloturee ? maintenant() : null);
        }
        if (sets.length === 0) return json({ ok: true });
        sets.push("modifie_le = ?"); valeurs.push(maintenant());
        valeurs.push(session.id);
        await db.prepare(`UPDATE sessions SET ${sets.join(", ")} WHERE id = ?`)
          .bind(...valeurs).run();
        return json({ ok: true });
      }

      case "supprimer-session":
        await db.prepare("DELETE FROM sessions WHERE id = ?").bind(session.id).run();
        return json({ ok: true });

      /* --- participants -------------------------------------------- */
      case "ajouter-participant": {
        const rang = await db.prepare(
          "SELECT COALESCE(MAX(position), -1) + 1 AS r FROM participants WHERE session_id = ?"
        ).bind(session.id).first();
        const id = uuid();
        await db.prepare(
          `INSERT INTO participants (id, session_id, nom, couleur, position)
           VALUES (?, ?, ?, ?, ?)`
        ).bind(id, session.id, corps.nom || "?", corps.couleur || "#C1362F", rang.r).run();
        await toucher(db, session.id);
        return json({ id });
      }

      case "maj-participant": {
        const c = corps.champs || {};
        const colonnes = { nom: "nom", couleur: "couleur",
                           dateDebut: "date_debut", dateFin: "date_fin" };
        const sets = [], valeurs = [];
        for (const [cle, colonne] of Object.entries(colonnes)) {
          if (c[cle] !== undefined) {
            sets.push(`${colonne} = ?`);
            valeurs.push(c[cle] === "" ? null : c[cle]);
          }
        }
        if (sets.length === 0) return json({ ok: true });
        valeurs.push(corps.id, session.id);
        await db.prepare(
          `UPDATE participants SET ${sets.join(", ")} WHERE id = ? AND session_id = ?`
        ).bind(...valeurs).run();
        await toucher(db, session.id);
        return json({ ok: true });
      }

      case "supprimer-participant":
        await db.prepare("DELETE FROM participants WHERE id = ? AND session_id = ?")
          .bind(corps.id, session.id).run();
        await toucher(db, session.id);
        return json({ ok: true });

      /* --- articles ------------------------------------------------- */
      case "ajouter-article": {
        const rang = await db.prepare(
          "SELECT COALESCE(MAX(position), -1) + 1 AS r FROM articles WHERE session_id = ?"
        ).bind(session.id).first();
        const id = uuid();
        await db.prepare(
          `INSERT INTO articles (id, session_id, libelle, montant, quantite, position)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(id, session.id, corps.libelle || "Article",
               corps.montant || 0, Math.max(1, corps.quantite || 1), rang.r).run();

        // parts initiales éventuelles
        if (Array.isArray(corps.parts) && corps.parts.length) {
          const lot = corps.parts.map((p) =>
            db.prepare(
              `INSERT INTO parts (article_id, participant_id, numerateur, denominateur)
               VALUES (?, ?, ?, ?)`
            ).bind(id, p.participantId, p.numerateur ?? 1, p.denominateur ?? 1)
          );
          await db.batch(lot);
        }
        await toucher(db, session.id);
        return json({ id });
      }

      case "maj-article": {
        const c = corps.champs || {};
        const colonnes = { libelle: "libelle", montant: "montant",
                           quantite: "quantite", reglee: "reglee" };
        const sets = [], valeurs = [];
        for (const [cle, colonne] of Object.entries(colonnes)) {
          if (c[cle] !== undefined) {
            sets.push(`${colonne} = ?`);
            valeurs.push(cle === "reglee" ? (c[cle] ? 1 : 0) : c[cle]);
          }
        }
        if (sets.length === 0) return json({ ok: true });
        valeurs.push(corps.id, session.id);
        await db.prepare(
          `UPDATE articles SET ${sets.join(", ")} WHERE id = ? AND session_id = ?`
        ).bind(...valeurs).run();
        await toucher(db, session.id);
        return json({ ok: true });
      }

      case "supprimer-article":
        await db.prepare("DELETE FROM articles WHERE id = ? AND session_id = ?")
          .bind(corps.id, session.id).run();
        await toucher(db, session.id);
        return json({ ok: true });

      /* --- parts : remplacement atomique ---------------------------- */
      /* `champs` (quantite/reglee) est optionnel et rejoint le même lot :  */
      /* un seul aller-retour, pour qu'aucune lecture concurrente ne voie  */
      /* jamais le drapeau "reglee" à jour sans les parts qui vont avec.   */
      case "definir-parts": {
        const appartient = await db.prepare(
          "SELECT 1 FROM articles WHERE id = ? AND session_id = ?"
        ).bind(corps.articleId, session.id).first();
        if (!appartient) return erreur("Article introuvable", 404);

        const lot = [];
        const c = corps.champs || {};
        const colonnes = { quantite: "quantite", reglee: "reglee" };
        const sets = [], valeurs = [];
        for (const [cle, colonne] of Object.entries(colonnes)) {
          if (c[cle] !== undefined) {
            sets.push(`${colonne} = ?`);
            valeurs.push(cle === "reglee" ? (c[cle] ? 1 : 0) : c[cle]);
          }
        }
        if (sets.length > 0) {
          lot.push(db.prepare(
            `UPDATE articles SET ${sets.join(", ")} WHERE id = ? AND session_id = ?`
          ).bind(...valeurs, corps.articleId, session.id));
        }
        lot.push(db.prepare("DELETE FROM parts WHERE article_id = ?").bind(corps.articleId));
        lot.push(...(corps.parts || []).map((p) =>
          db.prepare(
            `INSERT INTO parts (article_id, participant_id, numerateur, denominateur)
             VALUES (?, ?, ?, ?)`
          ).bind(corps.articleId, p.participantId, p.numerateur ?? 1, p.denominateur ?? 1)
        ));
        await db.batch(lot);
        await toucher(db, session.id);
        return json({ ok: true });
      }

      /* --- versements ----------------------------------------------- */
      case "ajouter-versement": {
        const id = uuid();
        await db.prepare(
          `INSERT INTO versements
             (id, session_id, participant_id, montant, recu, date_versement, cree_le)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(id, session.id, corps.participantId, corps.montant,
               corps.recu ? 1 : 0,
               corps.date || new Date().toISOString().slice(0, 10),
               maintenant()).run();
        await toucher(db, session.id);
        return json({ id });
      }

      case "basculer-versement":
        await db.prepare(
          "UPDATE versements SET recu = 1 - recu WHERE id = ? AND session_id = ?"
        ).bind(corps.id, session.id).run();
        await toucher(db, session.id);
        return json({ ok: true });

      case "supprimer-versement":
        await db.prepare("DELETE FROM versements WHERE id = ? AND session_id = ?")
          .bind(corps.id, session.id).run();
        await toucher(db, session.id);
        return json({ ok: true });

      default:
        return erreur("Action inconnue", 404);
    }
  } catch (e) {
    return erreur(e.message || "Erreur interne", 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      const action = url.pathname.slice("/api/".length).split("/")[0];
      return traiterApi(request, env, action);
    }
    // fichiers statiques (build Vite) ; le repli SPA est géré par
    // `not_found_handling` dans la config des assets (wrangler.toml).
    return env.ASSETS.fetch(request);
  },
};
