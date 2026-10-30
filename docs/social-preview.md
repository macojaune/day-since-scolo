# Image de partage dynamique

La carte 1200 × 630 met « Parie sur la prochaine rencontre » au premier plan,
conserve la dernière arme du crime et affiche le nombre de paris validés pour
la manche ouverte. La durée sans scolo reste secondaire. Noir, jaune et Geist
reprennent l’identité du site ; les images des armes sont les assets existants.

`GET /api/og` utilise `next/og` (Vercel OG) en runtime Node. Les polices et images
sont chargées localement, sans requête externe ni dépendance supplémentaire.
Les quatre moyens de défense connus sont pris en charge ; une valeur inconnue
reste « Non renseignée », sans image inventée.

Le compteur provient de `GameService.getPublicGame()` : nombre de tickets actifs
de la manche courante, distinct du nombre de joueurs, du montant des mises et
du total historique. Le service est utilisé sans `initialize()` : la lecture
ne crée ni manche, ni joueur, ni tables. Les données personnelles ne sont pas
transmises à la carte ou aux métadonnées. En cas d’indisponibilité, la carte
affiche une invitation générique sans inventer un compteur à zéro.

L’accueil et `/explorations` exposent les balises OG et Twitter dans le HTML
initial via `getServerSideProps`. Les URL absolues utilisent `APP_URL`. L’URL
d’image change avec le compteur, l’arme ou le nombre de jours écoulés ; son
paramètre ne permet pas de modifier les données affichées. Les pixels sont
mis en cache en mémoire pour une même combinaison de données et la réponse
publique peut être conservée une minute, puis servie temporairement pendant
sa revalidation. Une réponse de secours n’est pas mise en cache.

Les réseaux sociaux gardent aussi leurs propres aperçus : un ancien partage
peut conserver son image même après une mise à jour du site.

## Vérification

Les tests contrôlent le nombre de tickets pour plusieurs joueurs, le passage
à une nouvelle manche, l’absence de mutation, les variantes d’arme, le repli
sans données, la version des URL et les PNG 1200 × 630. Le runtime construit est
contrôlé en HTTP avec un user-agent de robot et dans le navigateur. Les lectures
OG et SSR sont comparées à une empreinte de toutes les tables locales.
