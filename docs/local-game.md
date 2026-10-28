# Scolo local — L’original affiné

Le chantier est dans `.worktree/scolo-zikak`, branche `scolo-zikak`, base
`52392954c6b61722a9beb7f437ffd4b2da30f895`. Aucun commit, push ou déploiement
n’est effectué pour cette étape locale.

## Ouvrir et démarrer

- Application : http://localhost:3092/
- Alias de la page choisie : http://localhost:3092/explorations
- Apparitions, pour l’administrateur connecté : http://localhost:3092/admin

Depuis ce worktree : `corepack pnpm dev`. Configuration et initialisation :
[clerk-migration.md](clerk-migration.md). Le nom `localhost` du serveur doit
rester identique à `APP_URL` ; un démarrage sur `127.0.0.1` avec une URL
`localhost` faisait boucler la réécriture du middleware Clerk.

## Règles retenues

Chaque identité Clerk reçoit une seule fois 3 Zikak de bienvenue. En fin de
manche, le joueur ayant au moins un pari perdu, aucun pari gagnant et un
**solde de 0 après gains et remboursements** reçoit **2 Zikak pour rejouer**,
une seule fois quel que soit son nombre de paris. Aucun bonus s’il reste
1 Zikak ou plus : ce n’est pas une recharge jusqu’à 2. Des paris uniquement
remboursés ne donnent pas ce bonus. Les 3 Zikak de bienvenue ne sont pas
répétés par manche.
L’attribution du bonus est atomique avec le règlement et idempotente.
Les mises entières et le nombre de pronostics sont libres, dans la limite du
solde. Chaque pronostic désigne uniquement une date de Guadeloupe, normalisée
à minuit local et conservée en UTC. Aujourd’hui est autorisé ; hier est
refusé pour une nouvelle mise. Le montant est réservé dans la même transaction
que le ticket. Aucune heure optionnelle ni bibliothèque dédiée à l’heure
n’a été ajoutée : cette évolution est différée.

Les personnes misant sur le même jour partagent la même cote indicative :
`cagnotte / total des mises sur ce jour`. Le formulaire recalcule cette
cote en incluant la mise envisagée. Le versement affiché inclut la mise ;
ce n’est pas une probabilité ni une cote garantie.

L’administrateur saisit l’instant réel de l’apparition et l’arme. Il doit voir
un aperçu des gagnants, des pertes et des remboursements avant de confirmer.
Le choix de date ouvre un calendrier français, suivi d’un champ d’heure
distinct. Le calendrier utilise le fuseau de Guadeloupe, permet le clavier
et refuse les jours futurs ou antérieurs à la manche. Les validations
de l’instant exact restent également appliquées côté serveur.
La distance entre les jours, en Guadeloupe, décide des gagnants. Les égalités
se partagent la cagnotte au prorata des mises, avec des arrondis entiers qui
conservent exactement le total. Les tickets pris à l’instant de l’apparition
ou après sont remboursés, même si la déclaration arrive plus tard.

Le règlement et la nouvelle manche sont atomiques et idempotents. La nouvelle
manche ouvre au moment de la déclaration. Les anciens endpoints de mise à jour
et les tweets ne sont pas utilisés par ce prototype.

Deux rencontres le même jour peuvent régler deux manches si la seconde
survient après l’ouverture de la suivante. En revanche, deux rencontres déjà
passées au moment de la première déclaration ne peuvent pas être saisies
successivement : la seconde précéderait l’ouverture de la nouvelle manche.
L’ajout d’une observation historique sans règlement de manche reste à réaliser.

## Points et données

La base `.local/scolo.db` est une base SQLite locale ouverte via libSQL,
pas une base Turso distante. Elle contient des données de démonstration et
des paris réellement saisis en DEV. Au dernier contrôle : **4 joueurs et
6 paris**, dont **3 paris saisis par Marvin**, une cagnotte de **63 Zikak**
et 3 rencontres locales. Les points restent fictifs,
mais les comptes, paris et timestamps de cette base doivent être conservés.

La migration ciblée du `CHECK` du ledger ajoute le type `round_bonus`.
Elle a été appliquée deux fois sur la base locale après la sauvegarde
`.local/backups/before-replay-bonus-apply.db` : les empreintes de toutes les
lignes restent identiques, l’intégrité est correcte et les clés étrangères
ne présentent aucune erreur. Voir `.local/bonus-migration-report.json`.
Aucun reseed, conversion de compte NextAuth ou ancien crédit.

Une répétition sur une copie de la sauvegarde
`.local/backups/before-replay-bonus-20261028-033023.db` a aussi validé la
migration et le règlement : cagnotte de 63, bonus de 2 pour un seul joueur,
répétition idempotente et ouverture de la manche suivante. Voir
`.local/replay-bonus-check-report.json`. **La manche de la base utilisée
par Marvin n’a pas été clôturée et aucun bonus de fin de manche n’y a été
crédité à l’avance.**

Le portefeuille Zikak global reste non raccordé ; son contrat de réservation,
remboursement et règlement reste à réaliser dans le projet Zikak. Voir
[zikak-contract.md](zikak-contract.md).

Le GET public [app.getLatest](https://scolo.marvinl.com/api/trpc/app.getLatest)
a retourné **52 enregistrements**, du **8 février 2024 au 5 février 2026**,
répartis sur **39 dates distinctes**. Les doublons sont conservés. Cette
lecture n’a importé aucune donnée de production dans la base locale.

## Direction retenue et parcours

Marvin a choisi **« L’original affiné »**. Le fond noir, le jaune #facc15,
le blanc, l’ambre et Geist sont conservés. Le logo ne porte plus de point jaune. Le tutoiement, le titre créole,
sa traduction et l’histoire personnelle restent les repères du site.
`/explorations` est désormais un alias de cette page ; les trois variantes
ne sont plus proposées.

La page suit cet ordre :

1. Le récit : pourquoi le site existe et ce que Marvin y observe.
2. Le run actuel, puis la date et l’heure de la dernière rencontre avec
   l’arme du jour. Sans apparition connue, aucune durée n’est inventée.
3. La liste centrée des rencontres, limitée à 720 px, affiche 8 lignes
   par page. « Précédent », « Suivant » et « Page N sur M » apparaissent
   seulement au-delà de 8 entrées. Chaque ligne conserve sa date, son moyen de défense et
   l’écart avec la rencontre précédente, calculé avant pagination. Les
   filtres et le graphique ont été retirés.
4. Le jeu : choisir une date, choisir sa mise, se connecter pour confirmer.
   Le calendrier montre 28 jours et les cases occupées affichent les paris
   et leur cote par jour. « Ton pari » ou « Tes paris », dans une pastille
   blanche, distingue les dates du joueur. La zone jaune sous la grille réunit la date
   sélectionnée, la mise et le versement estimé ; aucun bulletin latéral.
   La cagnotte est plus visible. « Si ton pari gagne, tu reçois » introduit
   le montant, suivi de « Estimation, mise comprise ». Le montant de la mise
   se règle avec moins/plus, sans champ de saisie ; le solde après mise est
   indiqué. Le récapitulatif des paris et mises est en gras.

La fenêtre commence à la dernière rencontre si elle remonte à moins de
14 jours, sinon à aujourd’hui. Le retour dans le passé ne dépasse pas le
jour de la dernière rencontre ; sans rencontre connue, l’ouverture de la
manche sert de borne. Aujourd’hui est nommé dans sa case et possède un
raccourci. Les dates passées portant des paris restent consultables.
L’infobulle Zikak explique les points et fonctionne au clavier comme au clic.

À solde zéro, une bannière blanche et noire très visible explique la
situation ; le formulaire de mise est masqué. Les tickets personnels
compacts suivent, triés par date prévue croissante ; cliquer un ticket
actif ouvre sa date dans le calendrier. Les règles suivent. Le lien Telegram est
conservé. L’historique donne des observations à comparer ; il ne prétend
pas calculer la probabilité d’une nouvelle apparition.

## Revue Impeccable et références

Les annotations de Marvin ont confirmé la règle « date seule », la liste
centrée et paginée des rencontres et la mise intégrée au calendrier. La palette et les
repères de l’original sont conservés. Le système décrit dans
[DESIGN.md](../DESIGN.md) et `.impeccable/design.json` suit cette itération.

La nouvelle revue visuelle indépendante conclut **« ship » sur 12 captures
du rendu actuel**. Elle couvre la présentation de l’interface, pas une
authentification réelle. L’infobulle ouverte a été testée en interaction,
mais ne figure pas dans ces captures. La documentation suit le protocole
Impeccable avec un agent générique ; la recette humaine reste distincte.

Les références servent de principes, sans reprise d’assets, de règles ou
de modèle économique :

- [Metaculus — Question writing](https://www.metaculus.com/question-writing/) :
  donner le contexte, préciser l’événement à prévoir, le fuseau et les
  conditions de résolution. Application à Scolo : informations historiques
  avant le jeu, instant observé distinct de la déclaration.
- [Détrak — Gigamic](https://www.gigamic.com/jeux-de-voyage/511-detrak-3421271117919.html) :
  une grille lisible et des actions courtes peuvent rendre une règle simple
  attrayante. Application à Scolo : choisir une case de calendrier, puis
  sa mise ; aucune mécanique de dés ni de combinaison n’est reprise.
- [Manifold — FAQ](https://docs.manifold.markets/faq) :
  rendre la mise et le versement compréhensibles avant l’action, avec une
  résolution explicite. Application à Scolo : sélection et mise intégrées, avec
  cote indicative mutualisée ; aucun marché à parts ou pourcentage de
  probabilité n’est ajouté.

Les images d’armes proviennent des fichiers déjà présents dans le dépôt :
`public/sandale.png`, `public/coutelas.png`, `public/digrain.png` et
`public/capes.png`. Le favicon et la police Geist sont également conservés.
Aucun asset n’a été généré ni téléchargé depuis ces références.

## Évolutions envisagées, non implémentées

Proposition à confirmer selon la participation réelle : introduire l’heure
vers **5 à 10 joueurs actifs réguliers**, les moyens de défense vers
**10 à 15**, puis les pièces. Ces seuils ne sont pas des déblocages
codés. Toute nouvelle dimension devrait être annoncée avec ses règles et
sa cagnotte, puis activée uniquement au début d’une nouvelle manche.
Aucun automatisme n’est prévu dans cette itération.

## État de validation

Les **27 tests passent** : 23 tests moteur et 4 tests de brouillon.
TypeScript, lint et `git diff --check` passent. Le build Next réussit ;
`.local/date-only-build.log` conserve les deux avertissements `useContext`
Next/Clerk déjà connus.

Les neuf contrôles publics et les rendus à 1440, 390 et 320 px passent.
Sept scénarios de composants ont été vérifiés avec des données simulées,
sans POST local. Ces scénarios ne prouvent pas une connexion X/Twitter
réelle ni une mutation de pari authentifiée.

Le runtime temporaire du build sur 3094 a répondu HTTP 200 : calendrier
à 28 jours, réglage moins/plus puis redirection Clerk vérifiés avec
Playwright, sans erreur JavaScript ni tentative de mutation. Rapport :
`.local/built-runtime-check-report.json`.

Le serveur de développement 3092 a été redémarré avec le nouveau moteur.
Le GET public répond 200 avec la cagnotte de 63, les 6 paris, les 4 joueurs
et les 3 rencontres conservés ; la lecture privée anonyme est refusée
avec HTTP 401. La migration et le règlement sur copie sont validés comme
précisé dans « Points et données ».

La recette humaine de Marvin et le parcours connecté Clerk avec X/Twitter
restent à valider. Les protections n’ont pas été assouplies pour les tests.
Le portefeuille Zikak global reste non raccordé. Le chantier demeure local,
sans commit, push ni déploiement, sans publication sur scolo.marvinl.com.
Les résultats antérieurs restent dans [e2e-local.md](e2e-local.md).
