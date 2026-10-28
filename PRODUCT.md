# Scolo

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

La communauté de Marvin et les personnes qui le suivent. Le jeu doit aussi être compréhensible par une personne qui le découvre. Le tutoiement, l'humour et le titre créole font partie de son identité.

## Product Purpose

Suivre les apparitions de scolopendres chez Marvin et pronostiquer la date de la prochaine apparition avec des points fictifs, les Zikak.

La direction retenue par Marvin est **« L’original affiné »**. Le site explique d’abord pourquoi il existe et donne les observations nécessaires pour préparer un pronostic. Le jeu vient ensuite, avec trois étapes visibles : choisir sa date, choisir sa mise, se connecter pour confirmer.

## Capabilities and Constraints

- La page présente, dans cet ordre : le récit personnel ; le run actuel et la dernière rencontre avec l’arme du jour ; la liste des rencontres ; le jeu. Le run correspond au temps écoulé depuis la dernière apparition connue.
- L’historique présente 8 rencontres par page, dans une liste centrée de 720 px maximum. Les contrôles « Précédent », « Suivant » et « Page N sur M » apparaissent uniquement au-delà de 8 entrées. Chaque ligne conserve la date, le moyen de défense et le temps depuis la rencontre précédente. Aucun filtre ni graphique ; les entrées anciennes et les doublons restent accessibles.
- Le calendrier public montre une fenêtre de 28 jours, les paris existants et leur cote par jour. Il démarre à la dernière rencontre si elle remonte à moins de 14 jours, sinon à aujourd’hui ; le retour dans le passé est borné à la dernière rencontre. Aujourd’hui est nommé. Une pastille blanche « Ton pari » ou « Tes paris » distingue les paris du joueur de l’activité publique. La sélection, la mise et la connexion pour confirmer sont réunies sous la grille, sans bulletin latéral. La cagnotte est mise en évidence ; le versement porte « Si ton pari gagne, tu reçois » puis « Estimation, mise comprise ».
- Chaque joueur choisit uniquement une date et le montant entier de sa mise, dans la limite de son solde. Aujourd’hui est autorisé, les jours passés refusés pour une nouvelle mise. Il peut faire autant de pronostics qu’il le souhaite. Aucune heure, même optionnelle, n’est demandée. La mise se règle uniquement avec moins/plus ; son montant n’est pas un champ de saisie et le solde restant après ce pari est affiché. À solde zéro, une bannière blanche au texte noir explique la situation et le formulaire de mise est masqué.
- Le jour le plus proche de la date réelle de la rencontre gagne. Les tickets gagnants à égalité se partagent la cagnotte au prorata des mises. Les cotes mutualisées sont variables et les versements incluent la mise. L’instant réel observé reste la référence pour rembourser les paris pris à cet instant ou après.
- Les 3 Zikak de bienvenue sont accordés une seule fois par identité. À la fin d’une manche, un joueur ayant au moins un pari perdu, aucun pari gagnant et un solde de 0 après gains et remboursements reçoit 2 Zikak pour rejouer, une seule fois quel que soit le nombre de paris. Des paris uniquement remboursés ne donnent pas ce bonus. Aucun bonus si le solde après règlement est de 1 Zikak ou plus ; ce n’est pas une recharge jusqu’à 2. Aucun crédit de 3 Zikak n’est accordé à chaque manche. Le portefeuille global appartient au projet Zikak distinct.
- Le mode local utilise SQLite via libSQL ; le mode public prépare des Zikak propres à Scolo dans Turso, sans liaison actuelle avec le service global. Les points restent fictifs, mais la base contient aussi les paris réellement saisis par Marvin en DEV : 4 joueurs et 6 paris au dernier contrôle, dont 3 paris de Marvin. Ces données sont à préserver. Le contrat transactionnel requis n’existe pas encore dans l’API Zikak actuelle.
- Les paris personnels sont présentés en tickets compacts, triés par date prévue croissante. Un ticket actif ouvre sa date dans le calendrier ; le récapitulatif des paris et mises est mis en gras.
- Clerk remplace NextAuth. L'application Clerk existante `scolo` appartient au compte personnel `contact@marvinl.com`. Utiliser son instance de développement en local et son instance Production dans le mode public préparé. Pseudo obligatoire, connexion par code email et Google ; X ne sert plus à se connecter.
- Les mutations d'apparition et règlements sont réservés à l'administrateur. La date d'observation et la date de déclaration sont distinctes.
- Le fuseau de référence du jeu est America/Guadeloupe. Les nouveaux pronostics sont normalisés à minuit dans ce fuseau, puis conservés en UTC ; le classement compare les jours. Les anciens timestamps et les paris saisis restent conservés, sans reseed. La migration ciblée du ledger pour le bonus de fin de manche a été appliquée après sauvegarde, sans modifier les lignes existantes. La manche locale reste ouverte : aucun bonus de fin de manche n’y a été crédité avant clôture.
- Le nouveau code reste local, sans livraison sur le domaine public. Les rencontres manquantes ont été reportées séparément en production. La préparation du schéma et du compte administrateur est distincte du lancement. La publication X est préparée mais désactivée ; aucun tweet réel n’est envoyé pendant les tests.

## Brand Commitments

Conserver strictement les couleurs d’origine : fond noir, jaune #facc15, blanc et ambre. Marvin a explicitement refusé le changement de palette et demande une amélioration mesurée. Conserver « Jou san bèt a mil pat », sa traduction française, l’explication personnelle, le compteur et l’arme du jour. Le calendrier apporte le côté jeu sans masquer les informations historiques. Ton simple, familier et didactique. Les Zikak sont des points de jeu gratuits et fictifs ; une infobulle accessible l’explique au moment du choix de mise.

## Evidence on Hand

Code existant sur develop, commit de départ 52392954c6b61722a9beb7f437ffd4b2da30f895. Images existantes de sandale, coutelas, Digrain et CAPES dans public/, conservées sans génération de nouveaux assets. Geist reste la police existante. La page choisie est servie par `/` et `/explorations`, qui est désormais son alias ; les trois variantes ne sont plus proposées.

Le GET public de production `/api/trpc/app.getLatest` a retourné 52 enregistrements du 8 février 2024 au 5 février 2026, répartis sur 39 dates distinctes. Les doublons sont conservés ; cette lecture n’a importé aucune donnée dans la base locale.

Les références de conception et les revues Impeccable sont consignées dans [docs/local-game.md](docs/local-game.md). Les observations historiques éclairent le choix du joueur ; elles ne sont pas présentées comme une probabilité calculée.

## Open Decisions

La direction visuelle et la règle « date seule » sont choisies. Les 27 tests, types, lint, build et contrôles publics locaux passent ; la migration préserve les données. La revue visuelle indépendante de cette version conclut « ship » sur le rendu, pas sur une authentification réelle. La recette humaine reste distincte. Le parcours connecté Clerk avec X/Twitter reste à valider. L’intégration au vrai portefeuille Zikak et la migration des identités historiques nécessiteront un lot distinct avec un contrat vérifié. Aucun de ces travaux locaux ne constitue une livraison sur scolo.marvinl.com.

## Accessibility & Inclusion

Parcours utilisable au clavier et sur mobile, focus visibles, erreurs explicites, contraste lisible et réduction des animations selon la préférence du système.

## Préparation de production

Le plan et les limites actuelles sont dans [docs/production-preparation.md](docs/production-preparation.md). Le cas d’une deuxième apparition déjà passée dispose d’un ajout historique séparé du règlement. Les tests locaux utilisent des données jetables ; aucun résultat local ne prouve une connexion Google ou une publication X en production.
