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
