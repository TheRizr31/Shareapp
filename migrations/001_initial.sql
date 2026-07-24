-- =====================================================================
--  Partage — schéma Cloudflare D1 (SQLite)
--
--  Modèle sans compte : chaque session est identifiée par un jeton
--  secret présent dans l'URL. Qui a le lien peut lire et modifier.
--
--  On stocke des LIGNES, jamais un état global sérialisé : deux
--  personnes qui modifient des choses différentes ne s'écrasent pas.
--
--  Appliquer :  npx wrangler d1 execute partage --file=./migrations/001.sql
-- =====================================================================

-- ---------------------------------------------------------------------
--  SESSIONS — une addition ou une location
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id             TEXT PRIMARY KEY,              -- uuid généré côté serveur
  jeton          TEXT UNIQUE NOT NULL,          -- clé d'accès dans l'URL
  type           TEXT NOT NULL CHECK (type IN ('addition','location')),
  titre          TEXT NOT NULL DEFAULT '',

  -- addition
  service        INTEGER NOT NULL DEFAULT 0,    -- centimes
  mode_service   TEXT    NOT NULL DEFAULT 'prorata'
                 CHECK (mode_service IN ('prorata','egal')),
  total_attendu  INTEGER NOT NULL DEFAULT 0,    -- centimes ; 0 = non renseigné

  -- location
  loyer          INTEGER NOT NULL DEFAULT 0,    -- centimes
  date_debut     TEXT,                          -- AAAA-MM-JJ
  date_fin       TEXT,
  mode_transfert TEXT NOT NULL DEFAULT 'cagnotte'
                 CHECK (mode_transfert IN ('cagnotte','simple','prorata')),

  cloturee_le    INTEGER,                       -- horodatage ms, NULL si en cours
  cree_le        INTEGER NOT NULL,
  modifie_le     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_jeton ON sessions (jeton);

-- ---------------------------------------------------------------------
--  PARTICIPANTS
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS participants (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  nom         TEXT NOT NULL,
  couleur     TEXT NOT NULL DEFAULT '#C1362F',
  position    INTEGER NOT NULL DEFAULT 0,
  date_debut  TEXT,                             -- location : arrivée propre
  date_fin    TEXT                              -- location : départ propre
);

CREATE INDEX IF NOT EXISTS idx_participants_session
  ON participants (session_id, position);

-- ---------------------------------------------------------------------
--  ARTICLES — module addition
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS articles (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  libelle     TEXT NOT NULL DEFAULT 'Article',
  montant     INTEGER NOT NULL DEFAULT 0,       -- prix UNITAIRE en centimes
  quantite    INTEGER NOT NULL DEFAULT 1,
  position    INTEGER NOT NULL DEFAULT 0,
  reglee      INTEGER NOT NULL DEFAULT 0        -- 0/1 : parts ajustées à la main
);

CREATE INDEX IF NOT EXISTS idx_articles_session
  ON articles (session_id, position);

-- ---------------------------------------------------------------------
--  PARTS — qui participe à quel article, et pour quelle fraction
--
--  Numérateur/dénominateur plutôt qu'un décimal : ⅓+⅓+⅓ doit faire
--  exactement 1, ce qu'un nombre à virgule ne garantit pas.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS parts (
  article_id     TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  numerateur     INTEGER NOT NULL DEFAULT 1,
  denominateur   INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (article_id, participant_id)
);

CREATE INDEX IF NOT EXISTS idx_parts_article ON parts (article_id);

-- ---------------------------------------------------------------------
--  VERSEMENTS — module location
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS versements (
  id             TEXT PRIMARY KEY,
  session_id     TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  montant        INTEGER NOT NULL,              -- centimes
  recu           INTEGER NOT NULL DEFAULT 0,    -- 0/1
  date_versement TEXT NOT NULL,                 -- AAAA-MM-JJ
  cree_le        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_versements_session ON versements (session_id);
