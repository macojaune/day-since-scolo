# Portefeuille Zikak et jeu local

La V1 DEV synchronise désormais les mouvements à la déclaration d’une nouvelle
apparition, sans appel Zikak à chaque pari. Elle est désactivée par défaut et
activée sur le service DEV avec sa propre source. Le local reste un outil de
développement rapide, avec envois désactivés par défaut. Voir
[le contrat et l’exploitation V1](zikak-settlement-sync-v1.md).
Les réservations centrales décrites ci-dessous sont la cible ultérieure.

Scolo prépare deux modes : des points de test locaux en DEV, et des Zikak
persistants propres à Scolo en PROD. Le futur portefeuille global n’est pas
pas encore utilisé pour dépenser dans le jeu. Les mouvements sont répliqués après
rapprochement d'identité ; le solde global n'est pas importé dans le portefeuille
de paris. Voir [la préparation de production](production-preparation.md)
pour la migration et le rapprochement ultérieur.

Le [plan de raccordement au moteur Zikak](zikak-integration-plan.md) reprend
le contrôle du code et du runtime du 29 octobre 2026 UTC, les limites de l’API
actuelle et le contrat nécessaire avant d’activer le solde global.

## État du service global vérifié

Le dépôt `macojaune/zikak`, branche `develop` à `a219a59e`, fournit des membres,
des identités externes, des soldes et des écritures de points. Son endpoint
`POST /api/members/{id}/points` n'offre pas de réservation, de clé d'idempotence,
de contrôle atomique du solde ou de règlement de cagnotte. L'index
`event_id/rule_id` ne protège pas ces écritures directes. L'API métier est privée,
protégée par `BUSINESS_API_TOKEN`, jamais destiné au navigateur.

L'identifiant global doit être celui du membre Zikak. Un identifiant Clerk,
qualifié par son instance, est une identité rattachée. Il ne faut pas fusionner
automatiquement des membres par adresse email, ni considérer des identifiants
Clerk de plusieurs applications comme une identité universelle.

## Contrat nécessaire au raccordement

- Résoudre ou créer atomiquement un membre à partir d'une identité externe
  vérifiée côté serveur, avec une portée dédiée à Scolo.
- Attribuer le bonus global de trois points une fois par membre, jamais une
  fois par projet, appareil ou reconnexion.
- Réserver une mise entière positive dans une cagnotte identifiée par la manche,
  avec débit conditionnel empêchant un solde disponible négatif.
- Libérer une réservation, puis régler une manche en un transfert cohérent.
  La somme des paiements et remboursements doit égaler les réservations.
- Accepter une clé d'idempotence et vérifier le corps de la commande lors d'un
  retry. Une clé réutilisée pour une autre commande est un conflit.
- Permettre la reprise après panne et le rapprochement des opérations entre les
  services. Une transaction SQLite dans Scolo ne couvre pas un service distant.
- Produire une correction par écritures compensatoires, sans réécrire le journal.

Le mode `SCOLO_WALLET_MODE=local` refuse toute base distante. L'environnement
`local` impose un hôte loopback ; `dev` permet le domaine HTTPS du service DEV
avec sa propre base SQLite persistante et Clerk Development.
Le mode `scolo` prépare un portefeuille dédié dans Turso avec migration explicite,
origine HTTPS exacte et clés Clerk Production. Il ne contacte pas le service global. `NODE_ENV=production` reste compatible avec un
build et un démarrage de vérification sur la machine locale.

## Persistance locale

Les nouvelles tables `scolo_*` sont distinctes des anciennes tables `user`,
`account`, `session`, `bets`, `credits` et `scolo-data`. Le bootstrap est additif,
réexécutable et ne supprime aucune table ni ligne. Les anciens crédits ne sont
jamais interprétés comme des fonds disponibles dans le nouveau jeu.

Chaque joueur de test reçoit trois points, une seule fois. La mise débite son
solde disponible et apparaît dans la cagnotte dans la même transaction. Les
mutations sont sérialisées dans le processus, les transactions SQLite et les
conditions SQL protègent les écritures. Le journal conserve chaque attribution,
réservation, remboursement et versement.

Les pronostics choisissent une date, à partir du jour courant en Guadeloupe,
et sont normalisés à minuit dans ce fuseau puis enregistrés en UTC. Le nombre de tickets et les mises n'ont pas de plafond métier ; la mise
doit tenir dans le solde disponible et la précision entière du stockage. Le
montant total pris en charge ne dépasse pas `Number.MAX_SAFE_INTEGER`.

Le score est la distance en jours civils en Guadeloupe entre le pronostic et
la rencontre. L’heure réellement observée sert à exclure les paris tardifs. Les tickets enregistrés à cet instant ou après sont remboursés et
exclus du pot. Tous les tickets à distance minimale gagnent au prorata de leur
mise. Les arrondis entiers utilisent les plus grands restes, puis l'ordre de
création et l'identifiant de ticket en cas d'égalité. La cote n'intervient jamais
dans le choix du gagnant.

La clôture est unique par manche. Une seconde requête identique renvoie le même
résultat sans payer à nouveau ; une date ou une arme différente est refusée. La
prochaine manche commence à l'instant de déclaration. La date historique de
l'apparition reste l'instant réellement observé. Aucun tweet ni email n'est
envoyé par le moteur.

## Données de démonstration

`scripts/seed-local.ts` ajoute des profils et tickets explicitement fictifs dans
une base vide. Les dotations de démonstration sont journalisées avec le type
`fixture`. Il refuse de peupler une base déjà utilisée et ne réinitialise jamais
un compte ou une manche. Une seconde exécution ne change rien.

Les tests utilisent chacun un fichier SQLite temporaire supprimé après le test.
Ils vérifient les bonus, écritures concurrentes, clés d'idempotence, limites de
date, égalités, arrondis, remboursements, conservation des points et tables
historiques.
