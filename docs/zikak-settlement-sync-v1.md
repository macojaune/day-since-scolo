# Synchronisation Zikak à la clôture d’une manche — V1 DEV

Décision de Marvin : synchroniser lors de la déclaration d’une nouvelle
apparition, pas à chaque pari. Scolo conserve pour cette version son portefeuille
de jeu. La gestion centralisée des mises est un chantier ultérieur, décrit dans
`zikak-integration-plan.md` et `zikak-contract.md`.

## Contrat partagé avec le moteur

API serveur uniquement, credential dédié à une application et un environnement.
Le credential détermine la source autorisée ; le corps ne choisit ni cette source,
ni un membre Zikak arbitraire. Ne pas utiliser le token d’administration métier.

`POST /api/integrations/v1/point-batches`

```json
{
  "batch_id": "identifiant-persistant-du-lot",
  "entries": [{
    "reference": "identifiant-immuable-du-mouvement",
    "subject_id": "identifiant-stable-du-joueur-dans-la-source",
    "display_name": "Pseudo facultatif",
    "amount": 3,
    "reason": "welcome",
    "occurred_at": "2026-10-29T00:00:00Z"
  }]
}
```

`amount` est un entier signé non nul dans la plage sûre JavaScript. Les raisons
sont génériques et bornées : le moteur ne contient aucune règle propre à Scolo.
Limites : 500 mouvements et 1 Mio par lot, identifiants de 128 caractères maximum,
pseudo de 80 caractères maximum. Les mouvements gardent leur ordre.

Réponse de référence, conservée et relisible avec
`GET /api/integrations/v1/point-batches/{batch_id}` :

```json
{
  "batch_id": "identifiant-persistant-du-lot",
  "application_id": "scolo-dev",
  "applied": true,
  "entries_count": 1,
  "applied_at": "2026-10-29T00:01:00Z"
}
```

Un même lot au contenu identique renvoie le même reçu. Un contenu différent pour
la même référence de lot donne 409. Une référence de mouvement est unique par
application, y compris entre lots : un chevauchement donne 409 sans écriture.
Les doublons au sein d’un lot sont refusés. Toute validation, résolution des
membres, écriture du journal et mise à jour des soldes se fait atomiquement.
Un échec ne laisse aucun crédit ni reçu partiel.

L’identité est qualifiée par application + `subject_id`. Aucun rapprochement
automatique par email ou pseudo. Le journal garde source, référence, lot, raison
et instant d’origine. Un débit ne doit pas rendre le solde négatif ni soustraire
la contribution d’une autre application ; les calculs doivent refuser les
dépassements d’entiers. Les protections existantes des autres routes demeurent.

## Responsabilité de Scolo

La transaction de règlement prépare des lots immuables de mouvements encore
inédits : bienvenue, mises, remboursements, gains et bonus de remise en jeu.
Le premier envoi DEV reprend le journal local existant une seule fois. Les
fixtures ne peuvent sortir que vers une source DEV isolée et identifiée.
Les ajouts à l’historique ne déclenchent aucun transfert de points.

Les lots suivent l’ordre réel du journal, fractionnés à 500 mouvements. Leur
contenu et leur appartenance sont figés avant l’appel HTTP, dans la même
transaction que le règlement. L’appel réseau se fait après commit. Une file
durable conserve les envois et reçus ; une reprise renvoie le même lot, jamais un
nouvel identifiant destiné à contourner un échec. Les anciens lots partent avant
les nouveaux. Les refus d’authentification, conflits et erreurs métier restent
visibles et ne sont pas considérés comme des succès.

La synchronisation est désactivée par défaut. Pour ce chantier, activation DEV
uniquement, vers Zikak DEV avec une source distincte. Aucune reprise des données
PROD et aucune mutation de configuration PROD.

Cette V1 remonte les mouvements d’un portefeuille encore local. Elle ne rend
pas le solde global immédiatement dépensable sur tous les sites et ne garantit
pas la prévention des dépenses simultanées entre plusieurs portefeuilles locaux.
Cela demandera les commandes centrales de réservation et de règlement.

## Configuration et reprise DEV

Côté Scolo : `SCOLO_ZIKAK_SYNC_ENABLED=true`, `ZIKAK_API_ORIGIN`,
`ZIKAK_APPLICATION_ID` et `ZIKAK_INTEGRATION_TOKEN` sont des variables serveur.
Le garde-fou actuel exige le mode `local`, une application `scolo-dev` (suffixe
DEV facultatif) et l’origine `https://api-zikak-dev.marvinl.com` ou HTTP loopback
pour les essais jetables. Le mode public `scolo` refuse cette activation.
La DB conserve l’application à laquelle ses lots appartiennent et refuse un
changement d’application sur la même file, même après confirmation des lots.

Côté moteur : `ZIKAK_INTEGRATION_ENVIRONMENT=dev` et
`ZIKAK_INTEGRATION_CLIENTS` avec un client JSON contenant `application_id`,
`environment=dev` et son `token` dédié. L’absence de clients désactive ce canal.
Provisionner le même credential en privé sur les deux serveurs ; ne jamais
réutiliser celui du métier ou un credential de test local.

Avant activation, conserver une sauvegarde cohérente de la base source et
contrôler son journal : le premier règlement exporte aussi les mouvements
antérieurs encore inédits. Une base de démonstration contient des fixtures ;
elle doit viser exclusivement une source DEV isolée. Ne pas changer de source
pour contourner une file bloquée. Ne pas restaurer une ancienne file en
supprimant les reçus du moteur.

Le worker Node reprend les lots en attente toutes les 15 secondes et au
démarrage du service de jeu. Un envoi possède un bail de 30 secondes ; un crash
est repris avec le même identifiant et le même corps. Les échecs réseau/5xx/429
sont retentés avec délai croissant. Les refus métier/auth/conflits bloquent la
file, visibles dans `/admin`, où l’administrateur peut relancer après correction.
Les routes de lecture et relance sont protégées côté serveur ; la relance exige
aussi l’origine de l’application. Aucun endpoint public de déclenchement.

Vérification reproductible, sans données distantes : lancer dans le checkout
Zikak `scripts/run-integration-e2e.py` avec `E2E_ZIKAK_PORT=18088`,
`E2E_APPLICATION_ID=scolo-dev-e2e-scolo` et `E2E_INTEGRATION_TOKEN` égal à la
valeur synthétique locale définie dans `scripts/verify-zikak-sync.ts`. Puis lancer
`node --import tsx scripts/verify-zikak-sync.ts` dans Scolo. Les deux bases sont
jetables ; arrêter le lanceur Zikak après l’essai pour nettoyer sa base.

Validation du 29 octobre 2026 UTC : 85 tests Scolo, types, lint et build réussis.
Le test HTTP avec le vrai binaire Go a vérifié les soldes 6/2 après une réponse
perdue et plusieurs rejeux. Le parcours `/admin` avec session Clerk DEV a vérifié
un refus 401, l’état bloqué visible, une relance par le bouton et la persistance
du reçu, avec soldes 3/3 côté jeu et moteur. Bases jetables et compte de test
Clerk supprimés après vérification. L’activation distante reste distincte.
