# Préparation de Scolo en production

Cette préparation ne constitue pas un déploiement. Le site public conserve son
ancienne version jusqu'à une livraison explicitement demandée.

## Périmètre retenu

- Zikak persistants propres à Scolo, dans la base Turso existante. Le futur
  portefeuille global Zikak est un service distinct : aucun transfert actuel.
- Pseudo obligatoire, connexion par code email ou Google. X ne sert plus à
  connecter les joueurs. Les identifiants de publication X sont indépendants.
- Date seule, paris définitifs, 3 Zikak à l'inscription. Bonus de 2 uniquement
  aux participants perdants sans ticket gagnant et dont le solde final est zéro.
- L'ajout historique complète le journal sans toucher une cagnotte ni les
  soldes. Une observation postérieure à l'ouverture de la manche doit passer
  par le règlement normal. Les rattrapages historiques ne publient pas de tweet.

## Configuration

`SCOLO_WALLET_MODE=local` conserve les gardes SQLite/localhost/Clerk Development.
`SCOLO_WALLET_MODE=scolo` exige une base Turso avec token serveur, une origine
HTTPS exacte et les clés de l'instance Clerk Production de Scolo.

L'application Clerk personnelle est `app_2hXOzUjmWpGGjtAWn1SEBISfJqj` ; son
instance PROD est `ins_3LJbNlRdcLGS3BaRfJU3hqyzga5`. Les administrateurs sont
explicitement listés dans `SCOLO_ADMIN_USER_IDS` côté serveur. Un compte Clerk
n'accorde pas automatiquement un rôle administrateur.

Le conteneur écoute sur le port 3000. Les secrets de compilation passent par
BuildKit, les secrets d'exécution par Coolify. `SOURCE_COMMIT` identifie le code
construit. Les secrets et les données locales sont exclus du contexte Docker.

## Données et rapprochement futur

Ne jamais déployer le fichier SQLite de développement : il contient des fixtures
et des essais. Conserver les 57 rencontres historiques vérifiées, les anciennes
tables et leurs identifiants. La migration du nouveau jeu est additive et
explicite ; le runtime public refuse un schéma non préparé.

Le provisionnement du joueur administrateur attribue une seule fois ses 3 points
avec la même fonction que l'inscription. Il n'ouvre aucune manche. La première
manche publique commencera au démarrage du jeu, pas lors de sa préparation.

Le rapprochement futur partira du UUID interne `scolo_players.id`, de l'identité
Clerk qualifiée par l'instance, et du journal `scolo_wallet_entries`. L'email et
le pseudo ne sont pas des clés de fusion. Une reprise globale devra associer
explicitement le membre Zikak et le joueur Scolo, puis importer le solde validé
avec une référence unique par joueur et un contrôle de conservation. Ni les
fixtures ni un second bonus de bienvenue ne doivent entrer dans cette reprise.

## Publications X

`SCOLO_TWEETS_ENABLED=false` par défaut ; l'activation exige les quatre secrets
OAuth 1.0a et le mode public. Une nouvelle apparition issue d'un règlement met
son annonce dans une file durable au sein de la transaction. L'envoi se fait
après validation du règlement et son échec n'annule pas les gains.

Une seule annonce est créée par apparition. En cas de timeout ou de résultat
incertain, aucune nouvelle tentative automatique : vérifier X avant toute
reprise, pour éviter un doublon. Un processus arrêté avant l'envoi laisse une
annonce `pending` ; l'opérateur peut reprendre le dispatch après vérification.
Les anciennes rencontres ne sont jamais annoncées rétroactivement.

Les credentials actuellement présents dans Coolify ont été refusés par deux
lectures X (401). Aucune publication réelle n'a été tentée. Cette intégration
reste désactivée jusqu'à réparation de l'accès et validation du compte cible.

## Livraison ultérieure

1. Publier une véritable page de confidentialité Scolo, la renseigner dans
   Google Auth Platform puis passer l'application Google de Testing à Production.
   Les DNS/SSL Clerk et les identifiants Google sont déjà configurés. Le parcours
   connecté complet et la première connexion administrateur restent à exercer.
2. Avant la livraison, reprendre une sauvegarde et vérifier le schéma attendu :
   la migration additive et le provisionnement admin ont déjà été appliqués,
   après répétition idempotente sur une copie restaurée de la sauvegarde.
3. Réexercer les accès admin/non-admin et le parcours connecté sur le runtime
   livré. Les mises concurrentes, le règlement, les remboursements et le bonus
   ont été contrôlés sur une base de test isolée.
4. Préparer la promotion Git sans publier accidentellement `develop` : au dernier
   contrôle, l'application Coolify publique suit encore cette branche avec
   déploiement automatique. La cible attendue pour PROD est `main`.
5. Après autorisation de mise en ligne, vérifier l'image distante, le commit
   réellement servi et le parcours connecté. Un build ou un push ne suffit pas.

Aucun environnement DEMO supplémentaire n'est nécessaire.

## État vérifié le 28 octobre 2026

- Cloudflare : profil `default` de la CLI `~/.bun/bin/cf`, compte personnel.
  Les cinq CNAME Clerk sont en DNS seul et ont été relus via l’API, les deux
  serveurs DNS faisant autorité et un résolveur public. Le site conserve son routage.
- Clerk : pseudo obligatoire, code email, X désactivé ; Google DEV et PROD activés.
  La CLI indique DNS, SSL, mail et configuration OAuth complets. Ce statut
  concerne Clerk : il ne prouve ni le déploiement de Scolo ni un parcours connecté.
  Le compte administrateur PROD demandé est créé, avec adresse réservée avant
  vérification à la connexion. L’allowlist serveur est préparée dans le fichier
  privé des variables de livraison, sans modification des variables Coolify.
- Google : projet personnel `scolo-macojaune`, sans facturation, client Web
  « Scolo production », origine `https://scolo.marvinl.com` et callback
  `https://clerk.scolo.marvinl.com/v1/oauth_callback`. Les seuls scopes sont
  `openid`, `email`, `profile`. Google refuse encore le passage au statut
  Production sans URL publique de confidentialité ; aucune URL fictive n’a été
  renseignée. Le statut reste Testing. Avec ces seuls scopes d’identité, Google
  documente une exception à la liste de testeurs, mais le parcours réel reste
  non testé : https://developers.google.com/identity/protocols/oauth2/production-readiness/overview.
- Incident OAuth résolu : le secret du premier client était contenu dans le
  libellé ARIA d’un bouton et a été exposé dans une sortie de l’outil navigateur.
  Ce client a été supprimé avant usage dans Clerk, sa révocation vérifiée
  (`deleted_client`) et ses copies locales effacées. Le nouveau client est celui
  configuré dans Clerk ; son fichier privé est ignoré par Git, permissions 0600.
- Turso : migration additive appliquée et joueur administrateur provisionné
  à 3 Zikak. Contrôle après écriture : 57 rencontres, anciennes données intactes,
  zéro manche du nouveau jeu, zéro nouveau pari, zéro annonce à publier.
- Les anciens essais locaux restent locaux. Après sauvegarde, la migration
  locale a conservé exactement toutes les lignes précédentes.
- Builds local et public réussis. Les deux avertissements existants Next/Clerk
  concernant `useContext` persistent ; le serveur compilé a été démarré et les
  parcours publics/administration déconnectée/écran Google n’ont pas levé
  d’erreur navigateur. Aucun parcours connecté PROD n’est encore validé.
- Types et lint validés. 59 tests de la suite complète ont réussi ; le test
  supplémentaire sur la migration HTTP/Turso a ensuite réussi avec les cinq
  tests de provisionnement existants (60 tests distincts validés). Le formulaire
  historique a aussi été exercé sur trois largeurs et avec un fuseau navigateur
  différent, avec session/API simulées. Aucun tweet réel ni email de test envoyé.
- Aucun commit, push ou déploiement du nouveau code. Le build public actuellement
  servi reste `OpRvTEs05xqbbf70Tt0PP` ; la branche configurée reste `develop`.
