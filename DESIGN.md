---
name: BÈT a milpat
description: L’original affiné, les observations d’abord et le jeu ensuite.
colors:
  noir: "#000000"
  jaune: "#facc15"
  blanc: "#ffffff"
  ambre: "#f59e0b"
  texte-secondaire: "#bcbcbc"
  separateur: "#38342a"
  panneau: "#141414"
typography:
  display:
    fontFamily: "Geist, sans-serif"
    fontSize: "clamp(2.2rem, 5.8vw, 4.7rem)"
    fontWeight: 750
    lineHeight: 1.08
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Geist, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  counter:
    fontFamily: "Geist, sans-serif"
    fontSize: "2.9rem"
    fontWeight: 500
    lineHeight: 1.05
  body:
    fontFamily: "Geist, sans-serif"
    lineHeight: 1.65
  button:
    fontFamily: "Geist, sans-serif"
    fontSize: "0.88rem"
    fontWeight: 600
rounded:
  panel: "12px"
  tooltip: "8px"
  control: "6px"
  field: "5px"
  compact: "4px"
  selection: "0 0 11px 11px"
spacing:
  compact: "12px"
  control: "16px"
  group: "24px"
  section: "32px"
components:
  button-confirm:
    backgroundColor: "{colors.noir}"
    textColor: "{colors.blanc}"
    rounded: "{rounded.control}"
    padding: "0.75rem 1rem"
    width: "100%"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.blanc}"
    rounded: "{rounded.control}"
    padding: "0.75rem 1rem"
  stake-control:
    backgroundColor: "transparent"
    textColor: "{colors.noir}"
    height: "44px"
  calendar-selection:
    backgroundColor: "{colors.jaune}"
    textColor: "{colors.noir}"
    rounded: "{rounded.selection}"
    padding: "24px"
---

## Overview

**Creative North Star: "L’original affiné"**

Marvin a retenu une amélioration de l’original et a refusé les changements trop importants. Le fond noir, le titre créole jaune, le récit personnel, le compteur blanc et l’arme du jour sont les repères à préserver. Les informations permettant de préparer un pronostic occupent la première partie ; le calendrier réunit le choix d’une date, la mise et la confirmation.

La grille de 28 jours matérialise les choix de la communauté. Sa partie inférieure jaune reçoit la mise après sélection d’une date. `/explorations` affiche la même direction que `/`, sans sélecteur de variantes. Les contrôles publics locaux et le build de cette version passent. La revue visuelle indépendante conclut « ship » sur 12 captures du rendu ; elle ne vaut ni parcours OAuth réel ni recette humaine. Voir [docs/local-game.md](docs/local-game.md).

**Key Characteristics:**
- Fond noir et titre créole jaune.
- Compteur blanc et image de l’arme conservés.
- Observations lisibles avant la progression en trois étapes.
- Calendrier public et mise intégrée dans sa partie inférieure jaune.

## Colors

Le noir est le fond général. Le jaune porte le titre, les sélections, les données du jeu et la zone de mise intégrée ; l’ambre accompagne les remarques personnelles et les armes. Le blanc assure la lecture et les chiffres du compteur. Les gris servent seulement aux textes secondaires, surfaces et séparateurs. La palette historique reste stricte.

**The Palette historique Rule.** Le noir, le jaune, le blanc et l’ambre restent les couleurs identitaires ; aucune palette concurrente ne les remplace.

## Typography

Geist reste la famille de l’application, via l’import existant `geist/font/sans`. Le titre garde une taille forte et les nombres utilisent des chiffres tabulaires. Aucune nouvelle police n’est introduite ; Barlow et Bricolage des explorations rejetées ne font pas partie de cette direction.

Le mot-symbole place « BÈT » en blanc à 2 rem, graisse 850, avec « a milpat » jaune à 0.78 rem, graisse 650, aligné sur la ligne de base. La signature du footer est centrée, blanche et à 0.88 rem ; les mentions secondaires sont regroupées dessous.

Les rôles réutilisables sont le titre principal, les titres de section, le corps et les contrôles. Le titre du jeu atteint 2.65 rem ; la date sélectionnée 1.2 rem. La cagnotte est renforcée par une graisse et une visibilité supérieures. Le compteur adapte ses chiffres longs et sa taille aux petits écrans, sans supprimer d’unité.

**The Nombres lisibles Rule.** Durées, dates et montants utilisent des chiffres tabulaires ; les points restent accompagnés du libellé Zikak.

## Layout

Contenu limité à 1190 px, avec des marges latérales. L’ordre est fixe : récit ; run actuel avec la dernière rencontre et son arme ; liste des rencontres ; partie jeu ; paris personnels pour les personnes connectées et règles.

Sur grand écran, les marges internes sont de 40 px ; le run et la dernière rencontre sont côte à côte. Le calendrier occupe la largeur disponible. Après sélection d’une date, sa partie inférieure jaune présente la mise, le versement estimé et la confirmation en trois colonnes. Aucun bulletin latéral ou bloc fixe au défilement.

À 1050 px et moins, les marges passent à 28 px ; la mise et le versement gardent deux colonnes, la confirmation prend la ligne suivante. À 800 px et moins, les marges passent à 22 px, les observations passent en une colonne et la navigation occupe sa propre ligne. À 560 px et moins, les instructions s’empilent et chaque rencontre place son écart sous sa date, avec le moyen de défense à droite. À 380 px et moins, les marges passent à 16 px. Les sept colonnes du calendrier et les quatre unités du compteur restent présentes à chaque seuil.

## Elevation & Depth

Surfaces planes et séparateurs discrets ; aucune ombre décorative.

**The Surfaces planes Rule.** La couleur, les bordures et les séparateurs structurent la page ; les ombres ne portent pas la hiérarchie.

## Shapes

Compteur et boutons arrondis à 6 px ; calendrier à 12 px ; zone de mise à angles inférieurs de 11 px ; contrôles de mise à 4 px. Les quatre unités du compteur restent distinctes et alignées. La grille à sept colonnes suit les jours de la semaine ; ses cases restent des dates et ne suggèrent pas un tirage de loto.

## Components

- Dans l’administration, `AppearanceDateTimePicker` ouvre un calendrier français noir et jaune avec React DayPicker. Le jour sélectionné devient jaune à texte noir. La date et l’heure sont séparées ; elles s’empilent sur mobile. Le choix d’un jour place le focus sur l’heure. Échap ferme le calendrier et rend le focus au bouton ; les dates hors de la manche ou futures sont désactivées.
- Le compteur conserve jours, heures, minutes et secondes. Sans apparition connue, il affiche un état explicite plutôt qu’une durée inventée.
- La dernière rencontre conserve sa date, son heure et l’image de son arme. Les fichiers `public/sandale.png`, `public/coutelas.png`, `public/digrain.png` et `public/capes.png` proviennent du dépôt existant ; aucun asset n’est généré ou emprunté aux références de conception.
- L’historique est une liste centrée de 720 px maximum, avec 8 rencontres par page. Les contrôles « Précédent », « Suivant » et « Page N sur M » apparaissent uniquement au-delà de 8 entrées. La date, le moyen de défense et l’écart avec la rencontre précédente restent visibles ; cet écart est calculé avant pagination. Aucun filtre ni graphique.
- Le mot-symbole affiche « BÈT » en fort et « a milpat » en petit, sans point jaune. Le footer commence par « barricadé entre deux coups de digrain par MarvinL.com », centré, avec un lien vers https://marvinl.com. La mention de points fictifs et le lien de confidentialité restent en dessous. La navigation relie « Le run », « Les rencontres » et « Le jeu » à leurs ancres. Les liens deviennent jaunes et soulignés au survol. Le bouton de connexion est transparent avec une bordure ; après connexion, le solde jaune et son libellé accompagnent le contrôle Clerk.
- Les instructions suivent l’action réelle : choisir sa date, choisir sa mise, se connecter pour confirmer. Le calendrier montre 28 jours ; ses flèches naviguent par fenêtres et un raccourci ramène à aujourd’hui. Le jour courant porte « Aujourd’hui » et une bordure jaune. Les cases occupées montrent le nombre de paris et la cote du jour ; la sélection devient jaune. Une pastille blanche à texte noir « Ton pari » ou « Tes paris » distingue les dates du joueur. Une date passée sans pari est désactivée.
- La zone jaune intégrée sous la grille affiche la date sélectionnée, le nombre de paris et les points déjà misés, en gras. Pour une date jouable et un solde positif, elle reçoit une mise entière ajustable uniquement avec moins/plus : le montant est un output, pas un champ de saisie. Le solde après cette mise est visible, avec le versement estimé et une confirmation noire. Aucun champ d’heure ni raccourci de mise prédéfinie. Le versement est introduit par « Si ton pari gagne, tu reçois », puis « Estimation, mise comprise ». Il inclut la mise et la cote reste variable ; le brouillon conserve la date et la mise pendant la connexion quand le stockage de session est disponible.
- À solde zéro, une bannière blanche et noire très visible précède les dates. Elle explique que les paris existants restent en jeu et propose de les consulter ; le formulaire de mise est masqué.
- Les paris personnels sont des tickets compacts blancs, triés par date prévue croissante. La date domine, puis viennent la mise et le statut. Les tickets actifs sont cliquables et ouvrent leur jour dans le calendrier ; les états gagné, perdu et remboursé restent distincts.
- Le libellé Zikak ouvre une infobulle au survol, au focus et au clic. Elle explique les points fictifs et les 3 points de départ ; Échap et le clic extérieur la ferment. Elle reste dans la fenêtre et n’ajoute aucune ombre.
- Le focus visible mesure 3 px, ambre sur fond noir et noir dans la zone de mise ; le libellé Zikak possède son propre contour de 2 px. Les changements de fond des boutons durent 150 ms ; la préférence de réduction des animations réduit ces transitions et supprime le défilement animé.

## Do's and Don'ts

### Do:

- **Do** Conserver strictement le noir, le jaune, le blanc et l’ambre.
- **Do** Conserver le titre créole, le texte personnel, le run, les rencontres et l’arme du jour avant le jeu.
- **Do** Améliorer la lisibilité et les actions sans remplacer l’identité.
- **Do** Distinguer données observées, démonstration locale et estimation de versement.

### Don't:

- **Don't** Reprendre les assets ou les règles de jeu des références d’inspiration.
- **Don't** Réintroduire les palettes vert, crème ou prune des premières propositions rejetées.
