# Clerk : développement et préparation de production

Le prototype utilise le projet Clerk **Scolo existant**, dans le compte personnel
de Marvin. L'instance de développement fournit les clés `pk_test_` / `sk_test_`
de `.env.local`. Il ne crée pas une application Clerk supplémentaire.

Le mode local utilise une simulation SQLite isolée. Le mode public prépare un
solde Scolo persistant dans Turso, distinct du futur portefeuille global.
La préparation ne déploie pas le nouveau site : voir [le plan de production](production-preparation.md).

## Démarrer

Node 20.9 ou supérieur et Corepack sont nécessaires. Le dépôt fixe pnpm 9.15.2.

1. Copier les paramètres de `.env.example` dans `.env.local`.
2. Récupérer les clés de l'instance Clerk de développement Scolo via la CLI déjà
   liée au compte personnel. Ne pas remplacer les clés par des valeurs fictives.
3. Garder `APP_URL=http://localhost:3092`,
   `DATABASE_URL=file:./.local/scolo.db` et `SCOLO_WALLET_MODE=local`.
4. Exécuter `corepack pnpm install --frozen-lockfile`, `corepack pnpm db:local`,
   puis `corepack pnpm db:seed` pour les seules données fictives locales, et
   `corepack pnpm dev`.
5. Ouvrir `http://localhost:3092`. La connexion utilise `/sign-in` et
   l'inscription `/sign-up`, avec l'interface Clerk en français.

Le serveur écoute uniquement sur la boucle locale `localhost`. Utiliser le nom d'hôte `localhost`
dans le navigateur : les écritures vérifient l'origine exacte et le port
configurés par `APP_URL`. Aucune mesure d'audience n'est envoyée par le prototype.

Le mode `local` refuse les clés Production, les bases distantes et les hôtes
publics. Le mode `scolo` exige une base Turso avec token serveur, des clés Clerk
Production et une origine HTTPS exacte. Les deux configurations restent isolées.
La connexion retient un pseudo obligatoire, le code email et Google ; X est
désactivé comme connexion, indépendamment de la publication des apparitions.

## Autorisation

L'identité serveur provient de `getAuth(req)`, validée par `clerkMiddleware`.
Le contexte tRPC contient `userId: string | null`, `isAdmin: boolean` et
`req: NextApiRequest`. Aucun identifiant utilisateur fourni dans une requête
cliente n'accorde une session.

Les lectures publiques restent accessibles sans session. `protectedProcedure`
exige un utilisateur connecté. `adminProcedure` exige en plus un ID Clerk présent
dans `SCOLO_ADMIN_USER_IDS`, liste séparée par des virgules, côté serveur seulement.
Une liste vide n'accorde aucun accès administrateur.

Chaque mutation, publique ou protégée, exige un en-tête `Origin` égal à
`APP_URL`, le même Host et aucune indication `Sec-Fetch-Site: cross-site`.
Un appel sans Origin est refusé. Les clients de test doivent envoyer le véritable
Origin local ; cela ne dispense jamais d'une session pour une mutation privée.

## Données historiques

Les tables et identifiants historiques de NextAuth restent conservés. L'ancien
endpoint `/api/auth/[...nextauth]` et ses dépendances sont retirés ; les anciens
cookies NextAuth ne sont plus acceptés.

Aucune association par adresse email n'est effectuée. Une reprise future de
comptes ou de pronostics devra commencer par un export/sauvegarde des tables,
puis une association explicite et vérifiée :

```text
legacy_user_id -> clerk_user_id
```

Le mapping devra respecter l'unicité, conserver les références historiques et
être vérifié à blanc avant écriture. Les valeurs inconnues restent inconnues.
Le rapprochement d'un compte existant devra être confirmé par son titulaire ;
une même adresse affichée dans deux systèmes ne suffit pas à prouver le lien.

## Vérifications et conteneur

Les scripts `typecheck`, `lint`, `test` et `build` effectuent leurs contrôles
sans désactiver les erreurs TypeScript ou ESLint. Un build ne remplace pas un test
de connexion/déconnexion dans le navigateur avec l'instance Clerk réelle.

Le Dockerfile ne transporte plus les anciens secrets NextAuth, email ou Twitter.
Il exige le secret BuildKit `CLERK_SECRET_KEY` pendant la compilation et l'argument
public `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`. Les variables serveur nécessaires sont
à fournir au runtime. Les fichiers `.env*`, bases locales et worktrees sont exclus
du contexte Docker. Aucun build Docker ni déploiement n'est requis pour ce travail
local ; un éventuel lancement doit publier le port seulement sur 127.0.0.1.

## Références

- [Clerk avec le Pages Router](https://clerk.com/docs/getting-started/quickstart/pages-router)
- [Identité serveur avec getAuth](https://clerk.com/docs/reference/nextjs/pages-router/get-auth)
- [clerkMiddleware](https://clerk.com/docs/reference/nextjs/clerk-middleware)
