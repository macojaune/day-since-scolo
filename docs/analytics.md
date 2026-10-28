# Mesure d’audience et des paris

Umami : `https://analytics.marvinl.com`, site Scolo
`e5e9b232-675e-4172-b463-32c56e9dc567` (identifiant public existant).

Le script ne se charge que sur `scolo.marvinl.com`. Seules `/` et
`/confidentialite` sont mesurées ; connexion, administration, explorations,
localhost et domaines DEV sont exclus. Les parties simulées n’émettent pas
d’événements de jeu. Aucun changement de configuration Coolify n’est nécessaire.

| Événement | Déclenchement | Propriétés possibles |
| --- | --- | --- |
| `bet_date_selected` | Nouvelle date jouable choisie | `stake`, `days_ahead`, `source` |
| `bet_stake_changed` | Mise modifiée | `stake`, `days_ahead` |
| `game_sign_in_requested` | Clic de connexion dans l’en-tête ou le pari | `source`, `stake`, `days_ahead` |
| `game_joined` | Premier joueur créé, confirmé par le serveur | Aucune |
| `bet_submitted` | Formulaire valide envoyé | `stake`, `days_ahead` |
| `bet_confirmed` | Ticket retourné avec succès par le serveur | `stake`, `days_ahead` |
| `bet_rejected` | Refus explicite de la mutation | `stake`, `days_ahead`, `reason` |
| `bet_failed` | Erreur réseau ou serveur, issue incertaine | `stake`, `days_ahead`, `reason` |
| `wallet_empty` | Solde nul affiché pour un joueur inscrit | `committed`, `tickets` |

`days_ahead` est l’écart en jours civils de Guadeloupe entre la date choisie et
le jour de l’action. `reason` est une catégorie bornée (`invalid_bet`,
`signed_out`, `forbidden`, `rate_limited`, `server_error`, `unavailable`). Une
erreur réseau peut masquer une opération déjà enregistrée : `bet_failed`
décrit la réponse observée par le navigateur, pas une preuve d’absence en base.

La conversion principale est `bet_confirmed`, pas le clic ni `bet_submitted`.
Les confirmations sont dédoublonnées par ticket dans l’onglet ; le solde nul
par joueur et manche. Les références restent en mémoire/sessionStorage et ne
sont jamais transmises. `game_joined` n’est pas émis à chaque reconnexion :
le serveur retourne `created` dans la transaction de création du joueur.

La liste de propriétés autorisées exclut emails, pseudos, identifiants de
compte, tickets, messages d’erreur et soldes totaux. Les paramètres et fragments
d’URL sont supprimés ; le référent ne conserve que son origine. Les pages de
connexion sont exclues pour éviter de transmettre les paramètres Clerk.

Le suivi reste facultatif : bloqueur, préférence `umami.disabled`, absence de
script ou panne réseau ne doivent jamais empêcher de jouer. Il ne remplace pas
le journal des paris en base et ne garantit pas un comptage exhaustif.

## Vérification

- `pnpm test` : nettoyage des payloads, domaines/routes, jours de Guadeloupe,
  file initiale, déduplication, panne du tracker et création unique d’un joueur.
- Parcours navigateur avec le vrai script Umami et collecte interceptée :
  choix, refus, succès après écriture dans une SQLite jetable, réponse rejouée,
  solde nul, rechargement, exclusion admin et localhost.
- Recette sur le domaine servi : intercepter `/api/send` pour contrôler les
  payloads sans ajouter de faux votes ou de statistiques de test à la production.
