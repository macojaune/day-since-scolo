# Publications X via Buffer

Les annonces de nouvelles apparitions utilisent l’API GraphQL Buffer. Le projet
n’appelle plus l’API X directement et ne possède aucun mécanisme de repli payant.
La connexion Clerk avec X reste indépendante de la publication.

## Périmètre

Une nouvelle apparition, déclarée par le règlement normal d’une manche, produit
au plus une demande de publication. Le texte existant garde la date de Guadeloupe,
le moyen de défense et le lien vers Scolo. Les ajouts historiques ne produisent
aucune annonce. Aucun palier Zikak n’est ajouté sans définition des seuils métier.

La publication réelle est désactivée par défaut. Local et DEV la refusent même
avec une clé Buffer. Ils permettent les tests automatisés avec des fixtures et
la vérification de connexion en lecture seule. PROD reste une activation séparée.

## Préparer la connexion

1. Connecter le compte X souhaité dans Buffer, puis créer une clé personnelle
   dans Settings > API. Le plan Free inclut actuellement cet accès.
2. Relever l’identifiant du canal X via les requêtes `account` puis `channels`
   du guide officiel. Ne pas utiliser le nom du compte comme identifiant.
3. Renseigner `BUFFER_API_KEY` et `BUFFER_CHANNEL_ID` dans les variables serveur.
   Conserver `SCOLO_TWEETS_ENABLED=false` pendant la préparation.
4. Exécuter `pnpm buffer:check` depuis un `.env.local` propre à la cible. Cette
   commande vérifie la clé et le canal, sans créer de post ni ouvrir la base.
   Elle refuse un autre réseau, un canal déconnecté, verrouillé ou en pause.

`pnpm buffer:check --post-id <id>` relit également le statut d’un post existant.
Le résultat ne contient pas la clé, les réponses brutes ni les erreurs du fournisseur.

## Migration et activation

La version `2026-10-30-buffer-publication-v3` ajoute `scolo_buffer_posts`.
La table de tweets existante et ses identifiants X sont préservés. Une référence
Buffer est distincte d’un identifiant de tweet ; elle n’est jamais stockée comme
si X avait déjà publié.

Avant une migration distante, prendre un point de retour et vérifier la cible.
Le script existant permet une préparation à blanc, puis une application explicite :

```sh
node --env-file=.env.local --import tsx scripts/prepare-game-db.ts
node --env-file=.env.local --import tsx scripts/prepare-game-db.ts --apply
```

Le script contrôle la préservation des données et l’intégrité. Le runtime PROD
exige la nouvelle version avant d’ouvrir le jeu. Le déploiement de cette branche
n’active pas les tweets : il faut toujours `SCOLO_TWEETS_ENABLED=true`, la
configuration Buffer et un environnement PROD. Aucune activation PROD n’est
effectuée par ce changement.

## Confirmation et erreurs

Après commit du règlement, la demande est envoyée à Buffer avec `shareNow`.
Une vérification du canal précède chaque création. Le jeu et ses gains restent
valides si Buffer refuse ou ne répond pas.

- `pending` : apparition inscrite dans la transaction, pas encore prise en charge.
- `sending` sans reçu Buffer : tentative en cours ou interrompue ; ne pas republier.
- `sending` avec reçu Buffer : exposé comme `queued`, en attente de confirmation X.
- `sent` : Buffer confirme `sent` et fournit une URL X contenant l’identifiant réel.
- `failed` : rejet explicite ou échec de publication chez Buffer.
- `unknown` : résultat de création incertain. Aucune nouvelle création automatique.

Le worker reprend les demandes encore `pending` et vérifie les reçus après
l’initialisation du jeu, puis toutes les minutes. Les vérifications d’un même
post sont espacées d’au moins cinq minutes et limitées à douze. Elles continuent
après un redémarrage grâce à la base. Plusieurs processus partagent les mêmes
prises en charge atomiques.

Après douze lectures sans confirmation, le post reste à vérifier. Relire son état
avec `buffer:check --post-id`, puis rapprocher le reçu et la ligne concernée avant
toute correction manuelle. La commande ne réinitialise pas la file. Une perte de
réponse après création ou un échec de sauvegarde du reçu ne relance jamais
`createPost`. Ce choix évite les doublons au prix d’une intervention en cas
d’incertitude. Aucun historique n’est rattrapé implicitement.

## Validation

`pnpm test` couvre le connecteur, l’isolation local/DEV/PROD, les destinations
invalides, les rejets HTTP/GraphQL, les réponses perdues, la concurrence et les
reçus différés. Un scénario utilise le moteur réel, SQLite et un serveur HTTP
local simulant Buffer jusqu’au statut publié, sans modifier les gains.
Ces tests ne prouvent pas une publication réelle sur X.

L’essai réel reste à faire avec un compte Buffer connecté et un contenu de test
explicitement autorisé. Une réponse de création réussie ne suffira pas : vérifier
ensuite le statut Buffer et le tweet réellement servi avec son lien.

Références : [API et accès gratuit](https://buffer.com/api),
[première publication et découverte des canaux](https://developers.buffer.com/guides/your-first-post.html),
[schéma GraphQL](https://developers.buffer.com/reference.html),
[mode shareNow](https://developers.buffer.com/guides/rest-migration.html).

Vérifications locales du 30 octobre 2026 : 93 tests passent, TypeScript et ESLint
passent, et `next build` réussit. Le build émet un avertissement d’import
`useContext` dans la chaîne Clerk/React ; il n’a pas bloqué le démarrage vérifié.
Sur le serveur construit, l’accueil et `app.game` répondent en 200 ; les appels
anonymes à `app.me` et `app.settleRound` sont refusés en 401. La base de QA est
une SQLite locale jetable ; les files de tweets et de reçus Buffer restent vides.
Aucun essai connecté à Buffer ni tweet réel n’est couvert par ces résultats.
