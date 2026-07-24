# Partage — dossier de reprise

Ce document permet de reprendre le projet sans avoir suivi la conversation
qui l'a produit. Il contient les décisions, leurs raisons, les pièges déjà
rencontrés, et l'état exact du code.

---

## En deux phrases

Application de partage de frais entre amis, en deux modules : une addition
de restaurant répartie article par article, et une location répartie au
prorata des nuitées. Pas de compte, pas de paiement — l'application calcule
qui doit combien, chacun règle de son côté.

**État actuel** : l'application fonctionne intégralement en local
(`partage.jsx`, 3025 lignes, testé). Le backend Cloudflare D1 est écrit et
validé mais **jamais déployé** — l'utilisateur n'a accès qu'à un téléphone.

---

## Ce qui a été décidé, et pourquoi

Ces choix viennent d'allers-retours avec l'utilisateur. Les remettre en
question sans raison ferait perdre du temps.

### Aucun paiement dans l'application

Demandé explicitement. Chacun paie sa part directement à la caisse. Pas de
« qui a payé », pas de lien Lydia, pas d'arrondi — *« si on doit payer
23,44 on paye 23,44 »*.

### Les parts sont des fractions exactes, pas des décimaux

Stockées en `[numérateur, dénominateur]`. La raison est concrète : ⅓+⅓+⅓
doit faire exactement 1, sinon le contrôle de répartition se déclenche à
tort sur le cas le plus courant. En décimal on obtient 0,9999.

### Une part = un nombre d'exemplaires, pas une fraction abstraite

Erreur de conception corrigée en cours de route. Le vrai besoin n'était pas
« découper une bouteille » mais « combien chacun en prend ». Cas réels de
l'utilisateur :

- 5 bouteilles à 3 personnes → 1½ + 1½ + 2
- 4 bouteilles à 4, dont un couple qui en partage une → ½ + ½ + 2 + 1

La somme des parts doit égaler la **quantité**, pas 1.

### Partage égal automatique

Cocher des participants répartit les parts automatiquement. 1 bouteille à 3
→ ⅓ chacun. 3 bouteilles à 3 → 1 chacun. Toute modification de participants
ou de quantité réinitialise en parts égales. L'utilisateur n'ajuste qu'en
cas d'exception.

Si le partage égal ne tombe pas sur une fraction représentable (5 personnes
→ ⅕), on laisse le partage implicite : le calcul divise exactement, sans
afficher de fractions ni de contrôle.

### Palette de fractions limitée

`¼ ⅓ ½ ⅔ ¾ 1 1¼ 1⅓ 1½ 1⅔ 1¾ 2 3 4…` — toutes les irréductibles à
dénominateur ≤ 4, à chaque niveau entier. Appui long sur −/+ pour sauter à
l'entier suivant, sinon six taps pour passer de 1 à 2.

Une attribution de reste peut produire des fractions hors palette (⅜, ⅙) :
c'est voulu, le calcul reste exact, et les boutons rejoignent le palier le
plus proche.

### Attribution du reste

Le message « reste ¾ » est un bouton. Il ouvre la liste des participants,
on coche qui absorbe, et le reste se divise également entre eux. Leur part
est **remplacée**, pas additionnée.

### Location : nuitées, pas parts égales

Chaque personne peut avoir ses propres dates. La part est
`loyer × ses nuits ÷ total des nuitées`.

### Le retardataire se résout tout seul

Point qui inquiétait l'utilisateur. Comme on ne stocke jamais de dettes
figées mais des dépenses et des paiements séparés, l'ajout d'une personne
recalcule les parts ; les avances deviennent des crédits.

*1260 € / 7 nuits, trois personnes ayant versé 420 € chacune. Zoé arrive
pour 3 nuits :* les parts tombent à 367,50 €, Zoé doit 157,50 €, et
rembourse 52,50 € à chacun — exactement leur trop-payé.

### Mode « cagnotte » par défaut pour les remboursements

Sur un groupe de 15 personnes avec un retardataire, les modes classiques
produisaient **14 virements de 5,30 €**. Absurde.

En mode cagnotte, le retardataire verse **une fois** dans un pot commun.
Les autres ont un crédit affiché mais ne réclament rien : ils le reportent
dans leur Tricount de vacances. L'argent n'appartient à personne — première
version où une personne encaissait tout la rendait gagnante de 69 €, ce qui
était faux.

Deux autres modes restent disponibles (« au plus court », « au prorata »)
pour les petits groupes.

### Fonction photo retirée

Une lecture de ticket par l'API Anthropic avait été implémentée puis
**supprimée** : erreur serveur persistante côté service d'analyse, hors du
code. Ne pas la remettre sans raison — l'utilisateur a explicitement demandé
son retrait.

### Sans compte, avec lien secret

Décision assumée : chaque session a un jeton de 12 caractères dans l'URL.
Qui a le lien peut modifier. Contrepartie acceptée : le lien perdu, la
session est perdue. L'historique local du navigateur sert de rattrapage.

### Cloudflare D1, pas Supabase

Supabase met en pause les projets gratuits après 7 jours d'inactivité.
Usage réel : vacances une fois par an, restaurants espacés — la mise en
pause serait systématique. D1 n'en a pas.

---

## Pièges déjà rencontrés

À lire avant de modifier quoi que ce soit.

### Les classes Tailwind arbitraires ne compilent pas partout

`bg-[#F7F3E8]` sur les modales était ignoré dans certains environnements :
panneaux transparents, texte de la page visible au travers. **Les fonds des
modales sont en style inline**, pas en classe. Ne pas « nettoyer » ça.

### Le grain du papier passait devant tout

Le `::before` du fond granuleux n'avait pas de `z-index` et se peignait
par-dessus les modales. Il est maintenant en `position: fixed; z-index: -1`.

### Écritures concurrentes et limitation de débit

L'indicateur affichait « Non enregistré » : l'ajout de six participants
déclenchait **sept écritures en une seconde**, la liste des prénoms étant
sauvegardée immédiatement à chaque ajout. Corrigé par écriture différée
(900 ms) et **sérialisation dans une file d'attente**. Sept écritures
ramenées à deux.

### Les identifiants par `Date.now()`

Deux duplications dans la même milliseconde produisaient le même id et
cassaient le rendu React. Remplacé par un compteur incrémental.

### Le canvas d'export mal cadré

La hauteur était estimée avec des constantes différentes de celles du
tracé : entre 67 et 109 px de vide en bas selon les cas. Corrigé en
dessinant sur une toile large puis en recadrant à la hauteur réelle.

### Le téléchargement d'image bloqué en iframe

`<a download>` ne fonctionne pas dans les aperçus. Trois niveaux de repli :
`navigator.share()` (feuille native iOS/Android), puis téléchargement par
URL d'objet, puis ouverture dans un onglet. L'appui long sur l'image
affichée reste la solution la plus fiable sur mobile.

### Champs de saisie contrôlés et reformatage

Un champ montant piloté par la valeur reformatée à chaque frappe rend la
saisie impossible (curseur qui saute, effacement bloqué). Le composant
`ChampMontant` garde un brouillon local pendant l'édition et ne reformate
qu'au `blur`.

---

## Structure du code

### `partage.jsx` — l'application (3025 lignes)

Un seul fichier, deux modules assemblés. Les fonctions homonymes du module
location ont été préfixées (`locFmt`, `locCalculer`, `AvatarLoc`…) pour
éviter les collisions.

```
├── Constantes et helpers de fractions
│   ├── pgcd, fractionDe, sommeFractions, compareCible
│   ├── reduire, attribuerReste, partsEgales, partsEquilibrees
│   └── repartirFractions      ← répartition en centimes sans perte
├── calculer()                 ← module addition
├── dessinerTicket()           ← export PNG au canvas
├── Composants partagés
│   ├── Pastille, ChampMontant, Compteur
│   └── PastilleParts          ← avatar + réglage de part
├── ModuleAddition()           ← 3 écrans : historique, saisie, résultat
├── ModuleLocation()           ← 3 onglets : séjour, paiements, soldes
│   ├── locCalculer()          ← nuitées et soldes
│   └── transferts()           ← cagnotte / simple / prorata
├── Accueil()
└── Partage()                  ← aiguillage, export par défaut
```

**Stockage actuel** : `window.storage` (API de l'environnement Claude).
À remplacer par `localStorage` ou par l'API D1 selon la cible.

Clés utilisées : `addition:encours`, `addition:historique`,
`addition:noms`, `location:encours`, `location:noms`, `partage:module`.

### Backend écrit mais non déployé

| Fichier | Rôle | État |
|---|---|---|
| `001_initial.sql` | 5 tables SQLite/D1 | validé sur SQLite réel |
| `api-chemin.js` | API Pages Functions | écrit, non testé en ligne |
| `index.html` | page de vérification | JSX validé |
| `manifest.json`, `sw.js`, `icone.svg` | PWA | prêts |

Le fichier `api-chemin.js` doit être placé en
`functions/api/[[chemin]].js` — la notation à doubles crochets est la route
attrape-tout de Cloudflare.

---

## Schéma de données

Principe : **stocker des lignes, jamais un état global sérialisé**. Deux
personnes qui modifient des choses différentes ne s'écrasent pas.

```
sessions      id, jeton, type, titre, service, mode_service,
              total_attendu, loyer, date_debut, date_fin,
              mode_transfert, cloturee_le, cree_le, modifie_le

participants  id, session_id, nom, couleur, position,
              date_debut, date_fin        ← dates propres (location)

articles      id, session_id, libelle, montant, quantite,
              position, reglee            ← montant = prix UNITAIRE

parts         article_id, participant_id,
              numerateur, denominateur    ← fraction exacte

versements    id, session_id, participant_id, montant,
              recu, date_versement        ← recu = pointage
```

Tous les montants sont des **entiers en centimes**. Aucun flottant.

---

## Ce qui reste à faire

### 1. Adapter `partage.jsx` au backend

Le gros du travail. Actuellement chaque action modifie un état local ; il
faut la faire passer par l'API. Points d'attention :

- Les ids passent de nombres à des UUID
- `parts` devient un tableau `[{participantId, numerateur, denominateur}]`
  côté API, mais l'UI attend un objet indexé — conversion nécessaire
- Le partage égal automatique doit être recalculé côté client puis envoyé
  via `definir-parts`

### 2. Écran d'accueil listant les sessions

L'historique local (`localStorage`) garde les jetons ouverts sur cet
appareil. Il faut l'afficher, avec bouton de partage du lien.

### 3. Routage

`/s/<jeton>` doit ouvrir la session correspondante. Cloudflare Pages sert
`index.html` pour toute route inconnue si on ajoute un `_redirects` avec
`/* /index.html 200`.

### 4. Déploiement

```bash
npx wrangler login
npx wrangler d1 create partage
# reporter le database_id dans wrangler.toml
npx wrangler d1 execute partage --remote --file=./migrations/001_initial.sql
npx wrangler pages deploy .
```

Puis dans le tableau de bord : **Settings → Bindings → D1 database**,
variable `DB`, base `partage`. **Cette étape ne se fait pas en ligne de
commande et sans elle l'API renvoie 500.**

---

## Vérifications à ne pas casser

Ces cas ont été testés et doivent le rester :

| Cas | Attendu |
|---|---|
| ⅓+⅓+⅓ sur 32 € | 10,67 / 10,66 / 10,67 = 32,00 |
| ¼×4 sur 32 € | 8,00 chacun |
| ⅓ + ⅔ sur 30 € | 10,00 / 20,00 |
| 5 bouteilles, 1½+1½+2 | 45 / 45 / 60 = 150 € |
| 20 000 répartitions aléatoires | somme = total, toujours |
| Location, retardataire | parts recalculées, crédits automatiques |
| 15 pers., mode cagnotte | 1 versement au lieu de 14 |

---

## Contexte utilisateur

- **Sur mobile uniquement**, pas d'accès à un ordinateur
- Compte GitHub existant
- Compte Cloudflare créé, connecteur MCP actif, **aucune base créée**
- Usage réel : groupe d'environ 15 personnes pour les locations,
  restaurants en plus petit comité
- Utilise déjà **Tricount** pour les dépenses courantes de vacances —
  l'application ne doit pas empiéter dessus

---

## Ton et style du code

Le code est en français : noms de variables, commentaires, libellés. Les
commentaires expliquent **pourquoi**, pas quoi — ils sont là où un lecteur
se poserait une question, pas au-dessus de chaque ligne.

L'interface suit une direction visuelle précise : le ticket de caisse.
Papier ivoire `#F7F3E8`, encre `#1C1A17`, accent rouge tampon `#C1362F`,
typographie Archivo pour les libellés et Roboto Mono à chiffres tabulaires
pour tous les montants — l'alignement des colonnes de prix est le vrai
enjeu de lisibilité.
