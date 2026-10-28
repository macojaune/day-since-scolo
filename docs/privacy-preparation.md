# Éléments pour la confidentialité Scolo

Inventaire de préparation, pas une politique publiée ni une validation juridique.
Google demande une URL publique réelle avant le passage de l’application OAuth
au statut Production. La route `/confidentialite` est maintenant implémentée,
accessible sans connexion et liée depuis l’accueil, la connexion et l’inscription.
Sa présence locale ne constitue pas une publication : l’URL attendue est
`https://scolo.marvinl.com/confidentialite`, à vérifier après déploiement avant
de l’enregistrer dans Google.

## Traitements vérifiés

- Clerk gère la connexion par email ou Google. Google est limité à `openid`,
  `email`, `profile`. Le pseudo est obligatoire.
- Le nouveau modèle Scolo conserve un UUID joueur, l’identifiant Clerk, le
  pseudo et la date de création ; il ne copie ni l’email ni l’avatar du profil.
- Turso conserve les dates jouées, mises, instants de confirmation, manches,
  résultats, soldes et mouvements de points. Les points restent propres à Scolo.
- Le calendrier des paris actifs expose des totaux par date, sans pseudo.
  Attention : l’API publique expose déjà les détails de la dernière manche
  réglée avec pseudo, date jouée, mise, résultat, gain et bonus. Le fait que
  l’interface n’en affiche qu’un résumé ne rend pas ces détails privés.
- Le solde total et l’ensemble des tickets personnels nécessitent la session du
  joueur concerné. Les apparitions, leur date et leur moyen de défense sont publics.
- Le navigateur conserve dans `sessionStorage` un brouillon date/mise et des
  références de confirmation. Le transfert après connexion expire après trente
  minutes ; cette limite ne s’applique pas aux autres brouillons de l’onglet.
- L’annonce X prévue contient la date/heure de l’apparition, le moyen de défense
  et le lien du site, sans données personnelles des joueurs. Elle est désactivée.
- L’ajout historique conserve l’identité Clerk de l’administrateur et son instant
  d’exécution. Ce chemin ne publie pas de tweet.
- Aucun module de publicité ou de mesure d’audience n’a été trouvé dans le code.
  Cela ne décrit pas les journaux techniques des fournisseurs.

## Points de suivi opérationnel

- La page identifie Marvin (macojaune), avec le contact `hello@macojaune.com`.
  Elle décrit l’exécution du service pour les paris et l’intérêt légitime pour
  la fiabilité, la prévention des abus et la résolution des contestations.
- Durées de conservation du compte, des tickets, du journal comptable et des
  sauvegardes. Aucun mécanisme de purge automatique n’est actuellement implémenté.
- Procédure de suppression/anonymisation : supprimer le compte Clerk ne supprime
  pas automatiquement le joueur et ses opérations Turso. Aucun webhook de
  suppression n’est branché.
- Régions, sous-traitants, transferts éventuels et garanties des services utilisés.
  Le dépôt seul ne permet pas de les établir. Ne pas présenter la page comme
  une preuve de conformité intégrale : elle indique les fournisseurs américains
  et renvoie à leurs textes sans prétendre à un hébergement uniquement européen.
  Le DPA Clerk est public ; l’adoption effective du DPA Turso reste à vérifier
  dans le compte (les conditions Turso prévoient sa signature dans Documents).
- Cookies et durées réellement appliqués par Clerk dans la configuration livrée.
- Données résiduelles NextAuth : les anciennes tables sont volontairement
  préservées. Ne pas affirmer que tous les emails historiques sont chez Clerk.

La page devra être accessible sans connexion et liée depuis l’accueil et
l’inscription. Le texte doit décrire le fonctionnement livré, sans promettre
une suppression ou une durée que l’application n’assure pas encore.

## Sources

- [Exigences OAuth Google](https://developers.google.com/identity/protocols/oauth2/policies)
- [Information des personnes — CNIL](https://www.cnil.fr/fr/conformite-rgpd-information-des-personnes-et-transparence)
- Code : `src/server/game/service.ts`, `src/server/game/player.ts`,
  `src/server/db/local-migrations.ts`, `src/server/api/routers/app.ts`,
  `src/utils/game-draft.ts`, `src/server/social/tweet-outbox.ts`.
