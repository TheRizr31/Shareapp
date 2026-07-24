-- =====================================================================
--  Ajoute le module "cagnotte cadeau" :
--   - un troisième type de session
--   - un second jeton (jeton_contributeurs), à lecture restreinte —
--     l'organisateur voit le détail par personne, les contributeurs
--     ne voient que le total collecté par rapport à l'objectif
--   - objectif (montant cible) et date_limite optionnelle
--
--  SQLite ne permet pas de modifier un CHECK constraint par ALTER TABLE :
--  on recrée la table et on recopie les lignes existantes.
--
--  Appliquer :
--    npx wrangler d1 execute partage --remote --file=./migrations/002_cagnotte.sql
-- =====================================================================

CREATE TABLE sessions_new (
  id                   TEXT PRIMARY KEY,
  jeton                TEXT UNIQUE NOT NULL,
  jeton_contributeurs  TEXT UNIQUE,                -- cagnotte uniquement ; NULL sinon
  type                 TEXT NOT NULL CHECK (type IN ('addition','location','cagnotte')),
  titre                TEXT NOT NULL DEFAULT '',

  -- addition
  service        INTEGER NOT NULL DEFAULT 0,
  mode_service   TEXT    NOT NULL DEFAULT 'prorata'
                 CHECK (mode_service IN ('prorata','egal')),
  total_attendu  INTEGER NOT NULL DEFAULT 0,

  -- location
  loyer          INTEGER NOT NULL DEFAULT 0,
  date_debut     TEXT,
  date_fin       TEXT,
  mode_transfert TEXT NOT NULL DEFAULT 'cagnotte'
                 CHECK (mode_transfert IN ('cagnotte','simple','prorata')),

  -- cagnotte
  objectif       INTEGER NOT NULL DEFAULT 0,       -- centimes ; 0 = pas d'objectif fixé
  date_limite    TEXT,                             -- AAAA-MM-JJ, optionnelle

  cloturee_le    INTEGER,
  cree_le        INTEGER NOT NULL,
  modifie_le     INTEGER NOT NULL
);

INSERT INTO sessions_new
  (id, jeton, type, titre, service, mode_service, total_attendu, loyer,
   date_debut, date_fin, mode_transfert, cloturee_le, cree_le, modifie_le)
SELECT
  id, jeton, type, titre, service, mode_service, total_attendu, loyer,
  date_debut, date_fin, mode_transfert, cloturee_le, cree_le, modifie_le
FROM sessions;

DROP TABLE sessions;
ALTER TABLE sessions_new RENAME TO sessions;

CREATE INDEX IF NOT EXISTS idx_sessions_jeton ON sessions (jeton);
CREATE INDEX IF NOT EXISTS idx_sessions_jeton_contributeurs ON sessions (jeton_contributeurs);
