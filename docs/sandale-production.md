# Livraison du mini-jeu de la sandale

Promotion ciblée depuis `main`, sans importer la synchronisation Zikak de `develop`. L’apparition de référence et les données de production restent celles de Scolo ; aucune fixture locale n’est transférée.

Le clic sur la sandale ouvre le mode survie compact. La partie est vérifiée côté serveur, conservée pendant la connexion puis associée au compte Clerk. Le classement affiche la place et le temps de la dernière partie, avec fenêtre défilante centrée sur soi. Les meilleurs historiques restent conservés. Les crédits du podium sont incrémentaux et plafonnés à trois Zikak Scolo par compte, sur toute la vie du mini-jeu. Aucun crédit vers un portefeuille global n’est ajouté dans cette promotion.

L’API hébergée exige une migration explicite. Elle ne crée pas de tables au démarrage ; les cookies de résultat sont HttpOnly, SameSite=Lax et Secure en HTTPS. Les mutations gardent le contrôle d’origine et d’identité. La limite de départs utilise le compte connecté ou l’adresse réseau transmise par Cloudflare, avec repli sur l’adresse de connexion.

La migration `2026-10-30-social-arcade-v5` ajoute trois tables arcade et autorise `arcade_bonus` dans le ledger. La sauvegarde fraîche PROD est restaurée et comparée avant répétition de la migration ; toutes les tables préexistantes sont préservées. Les fonctions de paris, annonces Buffer et fichiers de configuration de production sont conservés.

Validation avant publication : 114 tests, types, lint et build local. Le scénario hébergé vérifie la préparation obligatoire, le crédit unique et l’absence de DDL dans le runtime. La sauvegarde de la base Turso a été restaurée sur SQLite, puis migrée deux fois sans changement des données préexistantes.

L’annonce de lancement sert elle-même de test réel de l’API Buffer. La demande de Marvin vise le 30 octobre 2026 à 08:30 America/Guadeloupe, soit 12:30 UTC. Aucun tweet de test supplémentaire. Le relais ne doit programmer cette annonce qu’après preuve de livraison et recette sur `https://scolo.marvinl.com`. Texte prévu :

> J’ai ajouté une petite surprise sur le site, suite à la suggestion éclairée de @pirate_maggma 👀 Un petit easter egg vous attend… À vous de le trouver : https://scolo.marvinl.com

Les preuves servies, la PR et la référence Buffer seront ajoutées après leur vérification. Les dates et états ci-dessus décrivent la préparation ; un build local n’est pas une preuve de livraison PROD.
