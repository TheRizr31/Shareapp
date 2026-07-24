# Partage

Application de partage de frais entre amis, en deux modules : une addition
de restaurant répartie article par article, et une location répartie au
prorata des nuitées. Pas de compte, pas de paiement — l'application calcule
qui doit combien, chacun règle de son côté.

Voir [`REPRISE.md`](./REPRISE.md) pour l'état du projet, les décisions
prises et ce qu'il reste à faire (adaptation au backend, écran d'accueil,
routage, déploiement Cloudflare).

## Structure

```
partage.jsx              application complète (frontend), testée en local
migrations/001_initial.sql  schéma Cloudflare D1
functions/api/[[chemin]].js API Cloudflare Pages Functions
index.html                page de vérification du déploiement
manifest.json, sw.js, icone.svg   PWA
```
