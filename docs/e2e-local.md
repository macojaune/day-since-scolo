# Vérification locale Clerk et jeu — 28 octobre 2026

**Le parcours public et les refus d'accès sont vérifiés. Le parcours connecté
n'est pas validé de bout en bout.** La configuration existante de Scolo propose
uniquement **Continuer avec X / Twitter**. Aucune méthode de connexion n'a été
activée ou désactivée pour ces tests.

## Cible vérifiée

- URL : `http://localhost:3092`, worktree local `scolo-zikak`.
- Compte personnel Clerk : `contact@marvinl.com`.
- Application existante : `app_2hXOzUjmWpGGjtAWn1SEBISfJqj`.
- Instance DEV : `ins_2hXOzUH2op4wuBtsoaa6mNDQhaT`.
- Chrome for Testing déjà installé, lancé par Playwright dans un contexte séparé.
- Clés de développement lues depuis `.env.local`, jamais enregistrées dans le rapport.

## Contrôles passés

Le rapport `.local/e2e/b57321d2-0b1b-4277-adf8-a23aab1c0c67/report.json`
contient sept contrôles réussis, en mode `anonymous`, avec
`authenticatedFlowVerified: false`.

1. Identité CLI, application et instance personnelles vérifiées.
2. Page publique et données du jeu servies.
3. Composant Clerk de connexion rendu avec le bouton X / Twitter existant.
4. Appels anonymes `me`, `join`, `bet` et `previewSettlement` refusés en HTTP 401.
5. Mutation issue d'une autre origine refusée en HTTP 403.
6. Page `/admin` exigeant une connexion, sans formulaire d'apparition pour un visiteur.
7. Manche, cagnotte, nombre de pronostics et historique inchangés après les contrôles.

Les captures `clerk-connexion.png` et `admin-deconnecte.png` se trouvent dans
le même dossier local. Le navigateur de test a été fermé. Les onglets utilisés
pour la présentation visuelle n'ont pas été manipulés.

## Pourquoi le parcours connecté reste à vérifier

Les essais ont ciblé exclusivement des fixtures marquées par un `external_id`
unique et des métadonnées privées de test :

- La création d'un utilisateur avec `email_address` a été refusée :
  `form_param_unknown`. Email, téléphone et username ne sont pas activés.
- Un utilisateur sans identifiant peut être créé, mais le ticket de connexion
  Clerk est refusé avec `sign_in_no_identification_for_user`.
- L'ajout séparé d'une adresse `+clerk_test@example.com` à cette fixture est
  également refusé : `feature_not_enabled`.
- Une session active créée par le Backend API de Clerk fournit un JWT signé
  sans claim `azp`. Le middleware Scolo le refuse en HTTP 401, conformément à
  sa restriction `authorizedParties`. Cette restriction a été conservée.

Ces refus ne prouvent pas un défaut du parcours OAuth X / Twitter. Ils empêchent
l'établissement d'une session de navigateur automatisée avec une fixture
d'identifiant dans la configuration actuelle. Aucun compte réel n'a été utilisé.

Restent donc à exercer avec une vraie connexion X / Twitter : bonus de 3 Zikak
une seule fois, mise de 1 via le formulaire, solde de 2 et ticket affiché,
déconnexion via le menu, refus d'un membre sur l'administration. Les contrôles
du moteur de jeu sont distincts de cette validation HTTP et visuelle.

## Nettoyage

Toutes les fixtures Clerk créées pendant les essais ont été supprimées par CLI,
après vérification de leurs marqueurs et dry-run de chaque suppression. Une
relecture des identifiants confirme leur absence. Aucune de ces fixtures n'a
atteint l'inscription au jeu : aucune ligne joueur, portefeuille ou pronostic
n'a été créée localement pour elles.

L'audit de nettoyage est conservé dans `.local/e2e/cleanup-audit.json`.
Aucune apparition n'a été déclarée, aucune manche n'a été réglée et aucune
configuration Clerk n'a été modifiée.

## Relancer

```sh
node --env-file=.env.local --import tsx scripts/e2e-local.ts
```

Le mode par défaut vérifie seulement le parcours anonyme. Le rapport distingue
explicitement ce périmètre de la validation connectée.

Le script conserve aussi le scénario UI complet, activable avec
`SCOLO_E2E_MODE=ui`. Il exige une instance acceptant les identifiants email et
s'arrête explicitement si cette condition manque. Il ne change jamais la
configuration Clerk pour satisfaire le test. Lorsqu'il peut s'exécuter, il
crée une fixture `+clerk_test`, obtient une session réelle via le helper
officiel, teste le formulaire, puis supprime uniquement cette fixture et ses
enregistrements locaux dans un bloc `finally`.

ESLint du script et TypeScript global passent. Les rapports JSON sont locaux
et ignorés par Git ; cette note conserve le résultat utile à la reprise.

Références :
[helpers Playwright Clerk](https://clerk.com/docs/guides/development/testing/playwright/test-helpers),
[identifiants de test](https://clerk.com/docs/guides/development/testing/test-emails-and-phones),
[claims des sessions Clerk](https://clerk.com/docs/guides/sessions/session-tokens).
