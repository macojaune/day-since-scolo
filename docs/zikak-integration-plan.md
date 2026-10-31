# Raccordement de BÈT a milpat au moteur Zikak

Contrôle du 29 octobre 2026 UTC. Ce document décrit la cible de portefeuille
central, différée. La première version demandée depuis par Marvin synchronise
les mouvements au règlement d’une manche : voir
[le contrat V1](zikak-settlement-sync-v1.md), qui décrit aussi la promotion
Scolo PROD vers Zikak DEV autorisée le 31 octobre 2026. Le présent document
conserve l’audit initial et la cible ultérieure de portefeuille central.

## État vérifié

Le dépôt personnel `macojaune/zikak` a pour dernière branche distante
`develop=a219a59e36132209aada9c386491271af94608ee`. L’API DEV
`https://api-zikak-dev.marvinl.com` sert le commit
`4aac02dff602271b89f17988d55c118c80ede1c3` ; la différence est documentaire.
Santé HTTP 200 et routes membres/règles HTTP 401 sans credential.

Zikak gère les membres d’audience, leurs identités, les mouvements de points et
les soldes. Le vocabulaire reste celui de son `CONTEXT.md`. Le joueur du jeu
sera rattaché à un membre d’audience ; son identité Clerk n’est pas ce membre.
Le nom affiché BÈT a milpat ne change pas les références techniques `scolo`.

Le raccordement est encore limité par le contrat API :

- `cmd/api/router.go:41` expose `POST /api/members/{id}/points` derrière le
  Bearer métier. Dans `internal/handlers/handlers.go:417`, cette route crée
  une nouvelle référence à chaque appel, insère un mouvement puis met le solde
  à jour séparément. Elle n’a ni clé d’idempotence, ni réservation, ni débit
  conditionnel sur un solde suffisant. Les erreurs de mise à jour du solde ne
  sont pas contrôlées. Le champ `notes` reçu n’est pas persisté par l’insertion.
- L’index événement/règle de la migration 003 ne protège que les mouvements
  ayant ces deux références ; il ne protège pas les commandes directes.
- Les identités sont uniques par `(source_type, external_id)`, mais il n’existe
  pas de commande atomique de résolution/création depuis une identité applicative
  vérifiée. L’email n’est pas une clé unique de membre.
- Les membres et mouvements ne sont pas isolés par organisation. Les espaces
  sociaux ne constituent pas une isolation du ledger. Le premier raccord vise
  l’instance personnelle de Marvin, pas un moteur SaaS multi-organisation déjà prêt.

## Contrat recommandé

Zikak tient le solde global et les mouvements de points. BÈT a milpat conserve
les rencontres, pronostics, règles de classement et références des opérations.
Une recopie périodique de deux soldes ne protège pas les mises simultanées.

Le serveur vérifie la session Clerk puis transmet une identité qualifiée par
l’application et l’instance. Zikak retourne le même membre au nouvel essai et le
jeu conserve ce rattachement. Lier un ancien membre social exige une preuve ou
une association administrative explicite ; aucun rapprochement automatique
par email ou pseudo. Le canal applicatif doit recevoir un credential serveur
limité aux opérations du jeu, distinct de l’accès d’administration complet.

Les nouvelles commandes Zikak doivent permettre de :

1. Résoudre/créer le membre depuis l’identité vérifiée et lire ses points
   disponibles et engagés.
2. Réserver une mise positive dans la cagnotte d’une manche, avec contrôle
   atomique du disponible et retour de l’instant réel d’acceptation.
3. Geler cette cagnotte, puis relire toutes ses réservations.
4. Régler en une transaction remboursements, versements et bonus conditionnels.
   Les paiements et remboursements conservent la somme des mises, hors bonus
   explicitement autorisés.
5. Relire une commande après panne et importer une reprise identifiée une fois.

Les routes ne sont pas encore implémentées. Chaque commande doit porter une
référence unique par application et une empreinte de son contenu. Un nouvel
essai rend le même résultat ; une référence réutilisée autrement est un conflit.
Une correction crée un nouveau mouvement, sans réécrire ceux déjà validés.
Tous les chemins Zikak qui dépensent des points doivent respecter les engagements,
y compris les récompenses et les opérations manuelles existantes.

## Reprise après panne

Une transaction Turso ne couvre pas l’API Zikak. Le jeu doit conserver une
commande durable avant l’appel distant, puis sa confirmation.

Pour une mise : conserver l’intention, réserver dans Zikak, confirmer le ticket.
Une réponse perdue laisse une opération à rapprocher avec la même référence.
Le ticket ne compte comme pari validé qu’après confirmation. L’heure réelle
d’acceptation de la réservation sert au contrôle des paris tardifs ; l’intention
locale ne doit pas permettre d’antidater une mise.

Pour un règlement : fermer les nouvelles mises localement, geler la cagnotte
Zikak, rapprocher les réservations, calculer le classement, puis faire appliquer
le règlement une fois par Zikak. Le jeu finalise ensuite le résultat, ouvre la
manche suivante et prépare l’annonce X. Un redémarrage reprend l’étape incomplète.
Les ajouts historiques restent sans effet sur les points. Si Zikak est indisponible,
un solde local périmé ne doit pas permettre de confirmer une nouvelle mise.

## Bonus et reprise des points

Les crédits de bienvenue déjà accordés dans Scolo seront repris comme des points
existants, sans nouveau +3 à la migration. Le futur bonus de bienvenue doit
avoir une référence globale par membre, commune aux projets.

Le +2 reste réservé au participant perdant sans ticket gagnant ni points restants
après règlement. Zikak doit contrôler ce solde global dans la transaction des
paiements, car le membre peut avoir gagné des points ailleurs entre-temps.
À confirmer avant activation : si une autre mise est encore engagée, compte-t-elle
comme des points restants ? Recommandation : oui, pour respecter la règle
« un joueur qui a encore des Zikak ne doit pas avoir de bonus ».

La reprise finale exige sauvegardes, rapprochement à blanc et gel bref des
mutations. Importer une fois les points disponibles et les mises actives de
Turso PROD, avec leurs références et heures d’acceptation originales. Conserver
les points déjà détenus dans Zikak. Contrôler les totaux disponibles/engagés et
l’absence de mouvement supplémentaire lors d’une répétition. Les fixtures DEV
ne font pas partie de la reprise. L’ancien journal reste consultable pour l’audit.

Après les premiers mouvements globaux, revenir au mode local ne peut pas
réactiver les anciens soldes : il faut arrêter les mises et rapprocher les points.
La production du jeu doit viser un Zikak PROD vérifié, pas le service DEV actuel.

## Cible ultérieure : portefeuille central

Après la V1 au règlement, construire le contrat de portefeuille idempotent avec
tests HTTP et base jetable : deux mises concurrentes pour les derniers points,
réponse perdue, solde insuffisant, fermeture concurrente, conservation de cagnotte
et bonus global conditionnel. Puis raccorder le jeu et répéter l’import à blanc.

L’état vérifié plus haut est celui de l’audit initial ; il ne vaut pas preuve
de livraison du raccordement. Les essais de la V1 utilisent des bases jetables.
