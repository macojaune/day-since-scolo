# Publications X via Buffer

Les annonces de nouvelles apparitions utilisent l’API GraphQL Buffer. Le projet
n’appelle plus l’API X directement et ne possède aucun mécanisme de repli payant.
La connexion Clerk avec X reste indépendante de la publication.

## Périmètre

Une nouvelle apparition, déclarée par le règlement normal d’une manche, produit
au plus une demande de publication. Le texte existant garde la date de Guadeloupe,
le moyen de défense et le lien vers Scolo. Elle ajoute la durée du run, les gagnants et les Zikak effectivement versés, puis annonce la nouvelle manche. Les ajouts historiques ne produisent
aucune annonce. Les paliers de participation ci-dessous sont déclenchés par de nouveaux paris validés.

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

La version `2026-10-30-social-milestones-v4` ajoute les reçus Buffer et les tables de progression, d’annonces et de reçus de participation.
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

La connexion réelle à Buffer a été vérifiée en lecture seule sur le canal X
configuré. L’essai de publication reste réservé à l’annonce de la feature,
après réception du signal de l’autre agent demandé par Marvin. Une réponse de création réussie ne suffira pas : vérifier
ensuite le statut Buffer et le tweet réellement servi avec son lien.

Références : [API et accès gratuit](https://buffer.com/api),
[première publication et découverte des canaux](https://developers.buffer.com/guides/your-first-post.html),
[schéma GraphQL](https://developers.buffer.com/reference.html),
[mode shareNow](https://developers.buffer.com/guides/rest-migration.html).

Vérifications de la première version du 30 octobre 2026 : 93 tests passaient, TypeScript et ESLint
passaient, et `next build` réussissait. Le build émet un avertissement d’import
`useContext` dans la chaîne Clerk/React ; il n’a pas bloqué le démarrage vérifié.
Sur le serveur construit, l’accueil et `app.game` répondent en 200 ; les appels
anonymes à `app.me` et `app.settleRound` sont refusés en 401. La base de QA est
une SQLite locale jetable ; les files de tweets et de reçus Buffer restent vides.
Aucun essai connecté à Buffer ni tweet réel n’est couvert par ces résultats.


## Paliers de participation

Par manche, les paliers sont 10, 25, 50 et 100 joueurs distincts, ainsi que 25,
50, 100 et 250 pronostics. Les paliers de pronostics exigent au moins cinq
joueurs. Une mise de plusieurs Zikak reste un seul pronostic. Les inscriptions
sans pari ne comptent pas. Un rejeu de confirmation ne déclenche rien.

La progression et l’annonce sont enregistrées dans la transaction du pari.
Plusieurs paliers en attente sont regroupés dans une seule annonce. Les paliers
franchis avant l’activation ne sont pas rattrapés : seul un nouveau franchissement
peut déclencher une annonce. Les chiffres et le run sont relus avant l’envoi.
Une annonce encore en attente est abandonnée à la clôture de sa manche.

Le projet autorise une seule annonce de participation par tranche de 24 heures,
toutes manches confondues. Le contrôle et la prise en charge sont atomiques entre
processus. Le délai prend en compte la tentative et la publication confirmée ;
un post toujours en attente chez Buffer ou au résultat inconnu bloque la suite
jusqu’au rapprochement. Les annonces d’apparition restent indépendantes.

Modèle de participation :

> {durée} sans croiser de scolo. Le run tient encore.
>
> On est déjà à {joueurs} joueurs et {pronostics} pronostics, pour une cagnotte de {cagnotte} zikak.
>
> Viens parier des zikak sur mon malheur https://scolo.marvinl.com

Le run reprend le temps écoulé depuis la dernière apparition observée, comme le
compteur public, avec la précision de `formatDistance`. Si le point de départ
manque, la durée reste explicitement inconnue. Le run terminé d’une apparition
est mesuré entre cette observation et la précédente, pas depuis la création de
la manche ou la date de déclaration.

Pour une apparition, les gains sont agrégés par joueur distinct à partir des
versements du règlement. Les remboursements et les bonus de reprise sont exclus
du prix annoncé. Jusqu’à deux pseudos peuvent apparaître sous forme de texte
simple, sans mention automatique ni lien fourni par un joueur. Si les noms sont
trop longs, identiques ou trop nombreux, le nombre de gagnants et le total sont
conservés. Les manches vides ou remboursées n’inventent pas de gagnant.

Tous les textes sont vérifiés avec `twitter-text`, la bibliothèque recommandée
par X. Le comptage est pondéré, normalisé en NFC, et chaque URL compte pour 23.
Le connecteur refuse un texte invalide avant tout appel réseau. Les modèles
utilisent une formulation compacte si nécessaire, sans couper un chiffre, un
nom ou un lien en plein milieu.

Exemples synthétiques vérifiés : participation avec 12 jours, 25 joueurs,
42 pronostics et 84 Zikak, 187 caractères X ; apparition avec un run de
12 jours, une sandale, Alice et Bob se partageant 84 Zikak, 192 caractères X.
Aucun de ces exemples n’a été publié.

Source du comptage : [Counting Characters, X](https://docs.x.com/fundamentals/counting-characters).

Validation de la mécanique de paliers : 108 tests passent, TypeScript et ESLint
passent, et le build Next réussit. La connexion réelle à Buffer a été revérifiée
en lecture seule. La publication automatique reste désactivée.


## Promotion PROD ciblée

La branche de promotion part de `main` et transporte uniquement les deux commits
sociaux, avec les adaptations nécessaires au garde d’environnement et au
bootstrap Turso. Elle n’ajoute aucune synchronisation Zikak, aucun job de points,
ni les modifications d’affichage propres à DEV. Les fichiers d’interface de
`main` restent inchangés.

Cette variante passe 96 tests, TypeScript, ESLint et le build Next. La sauvegarde
Turso PROD a été restaurée dans une SQLite locale ; toutes les tables sources
correspondent à leurs empreintes. La migration a ensuite été appliquée deux fois
sur cette copie, avec conservation des données et intégrité contrôlées. Les
quatre tables sociales sont les seules nouvelles tables attendues.
