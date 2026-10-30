# Mini-jeu de la sandale, intégré au compteur

Historique de la recette locale. La préparation de la promotion publique est décrite dans [sandale-production.md](sandale-production.md). Les limites local-only ci-dessous décrivent les prototypes antérieurs, pas la cible de livraison publique.

Prototype LOCAL de BÈT a milpat. Dans l'accueil, cliquer sur la sandale de la dernière rencontre remplace son image par le mini-jeu, à côté du compteur. L'emplacement garde ses dimensions, de 164 à 200 px de large et 224 px de haut. Le reste de la page continue de fonctionner. La croix restaure la sandale ; l'ancien lien `/sandale` redirige vers `/#run`.

## Essayer

Préparer les variables locales habituelles du projet : SQLite de test, Clerk Development, `SCOLO_ENVIRONMENT=local`, `APP_URL=http://localhost:3104`, tweets et synchronisation Zikak désactivés. Puis :

```sh
corepack pnpm db:local
corepack pnpm db:seed
corepack pnpm dev:sandale
```

Ouvrir <http://localhost:3104/#run> et cliquer sur l'image de la sandale. Le seed existant fournit trois apparitions fictives, dont la plus récente à la sandale, trois joueurs de démonstration et trois pronostics. Il exige SQLite, refuse une base contenant déjà des données et ne remplace rien lors d'une nouvelle exécution. Ces données de test ne doivent pas être copiées vers une base réelle.

## Jeu

Le clic d'ouverture lance un bref décompte. Cliquer ou taper sur un scolo avant qu'il atteigne le pied ; le premier franchissement termine la partie avec « Perdu » et « Rejouer ». Touches 1, 2 et 3 pour les passages haut, milieu et bas ; Échap ou Pause pour suspendre. Un onglet inactif suspend aussi la partie, avec reprise explicite. Fermer abandonne la partie et restaure l'image.

Le temps de survie détermine le record ; les écrasements départagent une durée identique. Chaque partie tire au hasard entre 3 et 7 scolos d’approche, puis la vitesse et la cadence changent nettement. Les intervalles varient aussi de ±15 % pour éviter un rythme mécanique. Après la rupture, le temps de traversée passe d’environ 3 s à 1,65 s, puis tend vers 0,75 s ; l’intervalle moyen descend de 750 ms à 530 ms, puis vers 280 ms. L’alternance jour/nuit reste toutes les 25 secondes. La simulation utilise le temps écoulé et donne le même temps de traversée sur les différents formats d'écran. La récupération de la sandale dure 190 ms. Une seule cible par passage préserve la lisibilité et les zones tactiles de 68 × 44 px dans ce petit emplacement.

Les scolos ont un corps long en quinze segments, des pattes bilatérales, deux antennes et des pattes terminales plus longues. Les cinq variantes noir, bleu, jaune, rouge et doré ont le même comportement. Dessin vectoriel plat et mouvements de pattes statiques, sans texture réaliste, gros plan ou gore. Références morphologiques consultées : [galerie Scolopendra de Wikimedia Commons](https://commons.wikimedia.org/wiki/Category:Scolopendra) et [observation de Ryan Tippett](https://www.inaturalist.org/observations/191677205). Les photographies ne sont pas intégrées au site.

## Limites du prototype

Le déclencheur est actif seulement pour une dernière rencontre à la sandale et `environment=local`. Aucun déploiement DEV ou PROD. Les pronostics gardent leurs propres règles ; le podium arcade peut désormais créditer le portefeuille local de test, dans la limite décrite ci-dessous. La connexion réutilise Clerk et l’identité serveur existants. Le composant du jeu se charge à l'ouverture. Le record est propre à ce navigateur, sous `scolo:sandale:personal-best:v3`, et modifiable depuis celui-ci. La version change avec les règles de l'espace compact ; les records v1 et v2 sont conservés sous leurs anciennes clés et ne sont pas importés dans cette courbe plus rapide.

## Classement et reprise après connexion

Après « Perdu », le bouton « Classement » ouvre une modale au-dessus de la page. L’agencement choisi présente la place et le temps de la partie qui vient de finir, puis le tableau et les boutons Rejouer/Partager. Les positions sont plus grosses ; le tableau a une hauteur bornée et défile au clavier, à la souris et au tactile. Une fenêtre de vingt joueurs s’ouvre autour de sa ligne, même à la 40e place ; les boutons « places précédentes/suivantes » permettent de parcourir le reste du classement. Les règles des gains sont repliées.

La vue privée remplace temporairement le meilleur résultat de ce compte par la partie courante pour calculer sa position, sans dupliquer le joueur. Le meilleur résultat permanent reste conservé et sert toujours aux autres joueurs et aux gains. Un meilleur historique classé 3e ne masque donc plus une partie actuelle classée 40e. Ordre : durée, écrasements, puis première obtention du résultat. Aucun identifiant technique d’un autre joueur n’est renvoyé.

Le serveur crée la partie et sa seed. À la défaite, il rejoue les coups pour calculer lui-même la durée et les écrasements ; le temps ne peut pas dépasser le temps réel depuis le départ. Il refuse les coups impossibles, la récupération contournée et les résultats modifiés. Cela limite les scores inventés ; ce prototype ne prétend pas empêcher les bots qui reproduisent des actions valides.

Avant d’inviter à la connexion, le résultat est enregistré dans `scolo_arcade_runs`. Un journal local conserve les envois sans réponse sous `scolo:sandale-pending:v3` ; un reçu confirmé remplace les coups une fois durable. Un cookie HttpOnly et SameSite=Lax permet de retrouver le meilleur résultat à attribuer ; un second cookie `scolo_arcade_latest` conserve la dernière partie pour son affichage, même si elle est moins bonne. Cela permet de retrouver le résultat après une redirection OAuth ou un rechargement, y compris sans ce journal JavaScript. La connexion s’ouvre avec Clerk au-dessus de la page ; son éventuel retour redirige vers `/#run`. La modale retrouve la partie et l’associe automatiquement à l’identité vérifiée côté serveur. Les erreurs gardent une action de reprise, et les retries sont idempotents. Le reçu reste récupérable même si la réponse à l’enregistrement sur le compte n’arrive pas.

Une partie commencée avec un compte ne peut pas être attribuée à un autre. Pour une partie anonyme, la première attribution est définitive et transactionnelle. Le serveur ne fait confiance ni à un identifiant de joueur ni à un pseudo fournis par le navigateur. Les mutations exigent l’Origin et le Host exacts, et les lectures personnalisées vérifient le viewer pour éviter une confusion de cache après un changement de compte. Les cookies restent en HTTP uniquement sur ce prototype localhost, qui refuse DEV/PROD.

Les tables des parties et records sont ajoutées seulement à SQLite local, de façon répétable. Un backup est pris avant leur première création. La passe podium ajoute une troisième table arcade pour le plafond de gains et autorise le mouvement `arcade_bonus` dans le portefeuille existant. La migration conserve les lignes, index et triggers existants ; elle ne reseed pas la base. Un second backup précède cette migration. Limite locale : 40 départs par minute et adresse réseau vue par le serveur ; elle devra être adaptée à la frontière proxy si le prototype est ouvert à plusieurs personnes en DEV. Les parties sont reçues en blocs bornés à 10 000 coups pour limiter les requêtes.

## Gains du podium

Le classement local attribue au maximum **3 Zikak par compte Clerk pour ce mini-jeu**, sur toute sa durée de vie : troisième = 1, deuxième = 2 au total, premier = 3 au total. Passer troisième puis deuxième puis premier ajoute donc 1 à chaque étape. Commencer premier donne 3 une fois. Rejouer, perdre puis reprendre sa place ou changer de version du jeu ne réinitialise pas le plafond. Les 3 points de bienvenue habituels restent distincts.

Le serveur calcule le rang et crédite uniquement la différence avec le meilleur palier déjà récompensé. Attribution du score, écriture du mouvement et incrément du portefeuille sont transactionnels ; les appels concurrents et retries ne doublent pas les gains. Un joueur déjà classé peut récupérer son palier disponible en ouvrant le classement. Aucun point n’est retiré lorsqu’il descend. Le plafond est lié au compte, pas à une personne physique : ce prototype ne bloque pas la création de comptes multiples.

**Ces gains restent dans la base locale de test.** La synchronisation vers Zikak global est désactivée. Le mouvement utilise le ledger existant ; le déclenchement de synchronisation existant reste lié aux apparitions, sans nouveau dispatch immédiat pour l’arcade. L’activation et la vérification des points globaux restent à traiter avant une livraison utilisant cette intégration.

## Partager le classement

La modale donne la priorité à la place et au temps de la partie, au tableau, puis aux boutons Rejouer et Partager. Un nouveau gain réel apparaît près de la place dans un label animé pendant huit secondes, seulement pour son bénéficiaire. Le label ne rejoue pas lors d’une réouverture ou d’un rechargement ; la préférence de réduction des animations est respectée. Aucun total de gain permanent ne surcharge la modale. Le bouton Partager ouvre X/Twitter et WhatsApp avec un message préparé, ou copie ce message. Le rang y est écrit « Je suis top 1 », « Je suis top 40 », etc., sans dièse ni hashtag. Les durées nomment leurs unités, par exemple « 10,5 secondes » ou « 1 minute et 12 secondes ». Le partage reste volontaire : aucun message externe n’est envoyé automatiquement.

« Story 9:16 » génère un PNG de **1080 × 1920 px**, avec les trois meilleurs joueurs, le temps et la place de la partie courante si disponibles et le lien public `https://scolo.marvinl.com`. Rang, pseudo et durée proviennent du serveur ; les paramètres de requête ne peuvent pas les remplacer. L’image exclut identifiants techniques et soldes. Le prototype porte la mention « Aperçu local ». La création télécharge le PNG et conserve un lien visible « Télécharger l’image » pour relancer le téléchargement par un clic direct si le navigateur a bloqué le premier. Le partage natif ne se lance plus pendant la génération : un bouton « Partager l’image » distinct apparaît si le navigateur l’annonce compatible. Même si ce partage ne répond pas, le téléchargement reste accessible. La requête de génération est interrompue après 20 secondes et peut être retentée. Le fichier est conservé en mémoire dans cette page ; son URL temporaire est libérée lors du remplacement du fichier ou du démontage du composant. L’ouverture directe d’Instagram et la publication sur téléphone physique ne sont pas validées.

Documentation Clerk utilisée : [modale et retours de connexion](https://clerk.com/docs/nextjs/reference/components/unstyled/sign-in-button), [helpers de test Playwright](https://clerk.com/docs/guides/development/testing/playwright/overview).

## Vérifications

Tests : `corepack pnpm test`, types : `corepack pnpm typecheck`, lint : `corepack pnpm lint`, build : `corepack pnpm build`. Utiliser un `SCOLO_BUILD_DIR` distinct si le serveur local tourne déjà pour ne pas remplacer ses assets.

Les tests du moteur couvrent le franchissement à temps égal à 30/60/120 Hz, la récupération, la progression, les cinq couleurs, une cible maximum par passage, le record et une durée supérieure à six heures. La recette navigateur du deuxième jet vérifie l'accueil avec ses fixtures, le clic sur la sandale, l'absence de déplacement de la page, les coups souris/tactiles/clavier, nuit, pause/reprise, défaite « Perdu », revanche, fermeture, record persistant et l'ancien lien. Les formats cibles sont 1440, 900, 390 et 320 px ; le tactile est simulé, pas une preuve sur téléphone physique.

Validation du deuxième jet le 30 octobre 2026 : 93 tests réussis, types et lint sans erreur, build terminé. Le build conserve l’avertissement d’import `useContext` dans les dépendances Clerk/Next déjà observé au premier jet. Les parcours ci-dessus passent aux quatre largeurs, sans erreur JavaScript observée. Les 15 tables de la base synthétique restent identiques au backup après recette. Revue visuelle indépendante : `ship` sur les fichiers et captures de ce prototype local.

Validation du troisième jet : la recette utilise un compte Clerk Development jetable et de vraies requêtes locales. Elle coupe la réponse après écriture du résultat, recharge la page, retire le journal JavaScript pour vérifier le cookie de secours, puis se connecte et revient sur l’accueil. Le même résultat est associé une seule fois au bon compte. Le tactile 390 px, la modale 320 px, son focus clavier et sa fermeture sont vérifiés. Les identités et données QA identifiées sont retirées après les essais ; les données historiques locales sont conservées. Les tests ciblés couvrent aussi le changement de compte, les doubles attributions concurrentes, les égalités, les délais impossibles et les écritures depuis une origine étrangère. La recette n’utilise pas de connexion Google réelle ni de téléphone physique.

Bilan du troisième jet : 99 tests réussis, types et lint sans erreur, build local terminé avec l’avertissement Clerk/Next `useContext` déjà présent. Les 15 tables historiques restent identiques au backup ; les deux tables arcade sont additives ; seules les lignes identifiées comme appartenant aux essais QA ont été supprimées. Toute partie sans attribution certaine à QA est conservée.

Validation de la passe podium/partage : **103 tests réussis**, types et lint sans erreur, build local terminé avec le même avertissement Clerk/Next. La recette réelle Clerk Development vérifie le crédit correspondant au rang courant, le plafond, les retries après connexion, les liens X/WhatsApp, la copie du message et le téléchargement PNG 1080 × 1920. Les formats 390 et 320 px sont vérifiés. Seules les fixtures QA identifiées sont retirées ; les parties et le compte local de Marvin sont conservés. Aucun moteur ni paramètre de gameplay modifié dans cette passe.

Correction du téléchargement signalé sur Arc desktop : la réponse PNG locale était valide, mais le code attendait la fin du partage natif avant de proposer le téléchargement. Une simulation d’API native restant en attente reproduit l’état « Création… ». Le parcours corrigé sépare génération, téléchargement et partage. Le navigateur utilisé pour la vérification est Chromium automatisé, pas la session Arc de Marvin.

Régression rejouable, sans écriture de partie, de compte ou de portefeuille : `node --import tsx scripts/verify-story-download.ts` contre le serveur local déjà lancé. `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` permet de désigner le Chromium installé si celui attendu par Playwright diffère. La fixture de résultat est uniquement une réponse de lecture simulée dans le navigateur. Le PNG, lui, vient du véritable endpoint. Le script vérifie le PNG 1080 × 1920, les téléchargements automatique et manuel, l’absence de Web Share, le partage natif en attente, l’erreur serveur et le délai dépassé. Les captures couvrent desktop et 390 px. Validation de cette correction : 104 tests réussis, types et lint sans erreur, build terminé avec le même avertissement Clerk/Next déjà connu.

Validation de l’agencement choisi : 105 tests réussis, types/lint/build passent avec l’avertissement Clerk/Next déjà connu. Le test serveur sur SQLite jetable place une partie en 40e position tout en préservant le meilleur historique à la première place et vérifie la pagination, le refus d’un autre compte et l’absence d’identifiants privés dans les lignes publiques. La recette navigateur utilise Clerk Development ; le classement long est une réponse de lecture simulée, pas des joueurs ajoutés à la base. Aucun changement de gameplay ni de schéma dans cette passe.

## Relais Buffer après la livraison PROD

Consigne explicite de Marvin : attendre que le mini-jeu soit bouclé **et** livré en production à sa demande. Cette consigne ne déclenche aucune promotion ni publication maintenant.

- Après la demande de promotion PROD, terminer la livraison et vérifier le commit servi ainsi que le parcours du mini-jeu sur <https://scolo.marvinl.com>.
- Une fois cette livraison vérifiée, relire puis contacter le thread Buffer `c47caf1d-b9aa-477f-8e1d-87028ef8bff4`, lien : <t3-thread://v2/c7230bb5-63b1-4db3-bf3d-5d77231907e5/c47caf1d-b9aa-477f-8e1d-87028ef8bff4>. Lui transmettre le commit livré, les vérifications utiles et l’autorisation de Marvin pour tester la publication Buffer **en postant directement cette annonce**, en une seule opération.
- L’annonce doit dire qu’une petite surprise a été ajoutée au site sous forme d’easter egg, grâce à la suggestion éclairée de **@pirate_maggma**, avec sa mention effective, **👀** et le lien **https://scolo.marvinl.com**. Garder la surprise : ne pas expliquer le déclencheur dans le tweet.
- Utiliser cette annonce comme publication réelle de validation, sans tweet de test supplémentaire. Demander au thread le résultat Buffer et le lien du tweet ; en cas de réponse ambiguë, vérifier le statut avant tout nouvel envoi pour éviter un doublon.

Proposition de texte à transmettre au relais :

> J’ai ajouté une petite surprise sur le site, suite à la suggestion éclairée de @pirate_maggma 👀 Un petit easter egg vous attend… À vous de le trouver : https://scolo.marvinl.com

État de ce relais : en attente de la demande explicite de livraison PROD et de sa vérification. Aucun message au thread ni tweet envoyé au moment de cette préparation.
