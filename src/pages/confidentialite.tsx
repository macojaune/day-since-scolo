import Head from 'next/head'
import Link from 'next/link'

export default function PrivacyPage() {
  return (
    <div className="scolo-app">
      <Head>
        <title>Confidentialité · Scolo</title>
        <meta name="description" content="Les données utilisées par Scolo, ce qui est public et comment exercer tes droits." />
      </Head>
      <main className="privacy-page">
        <Link href="/" className="button">← Retour à Scolo</Link>
        <header>
          <p className="privacy-date">Politique de confidentialité · 28 octobre 2026</p>
          <h1>Tes données sur Scolo</h1>
          <p>
            Scolo est le jeu de pronostics de Marvin (macojaune), responsable
            des données du site. Pour toute question ou demande concernant tes
            données, écris à <a href="mailto:hello@macojaune.com">hello@macojaune.com</a>.
          </p>
          <p>
            Tu joues avec des Zikak fictifs, sans argent réel. Ton solde reste
            propre à Scolo : il n’est pas partagé avec d’autres projets.
          </p>
        </header>

        <section aria-labelledby="privacy-account">
          <h2 id="privacy-account">Ton compte et tes paris</h2>
          <p>
            Pour jouer, il faut un compte, une adresse email vérifiée et un
            pseudo. Clerk gère la connexion et les informations de ton compte.
            Si tu choisis Google, Google transmet à Clerk ton identifiant, ton
            email et les informations de ton profil, comme ton nom et ta photo.
            Scolo ne demande pas l’accès à tes emails, tes contacts ou tes fichiers Google.
          </p>
          <p>
            Scolo enregistre l’identifiant de ton compte, ton pseudo, tes dates
            jouées, tes mises, l’instant de leur validation, leurs résultats et
            les mouvements de ton solde. Ces données servent à enregistrer tes
            paris et calculer les gains : c’est l’exécution du service de jeu
            que tu demandes. Sans compte, tu peux consulter le site mais pas miser.
          </p>
          <p>
            Les références de confirmation et les traces d’administration
            permettent de vérifier les opérations et d’éviter les doublons ou
            les abus. Ce traitement repose sur l’intérêt légitime de garder un
            jeu fiable et de résoudre les contestations.
          </p>
        </section>

        <section aria-labelledby="privacy-public">
          <h2 id="privacy-public">Ce que les autres peuvent voir</h2>
          <p>
            Le calendrier présente les totaux des paris en cours par date,
            sans nommer les joueurs. Les résultats de la dernière manche sont
            publics : ton pseudo, la date jouée, ta mise, ton résultat, tes gains
            et un éventuel bonus peuvent être consultés. Choisis un pseudo que
            tu souhaites rendre public.
          </p>
          <p>
            Ton email, ton solde total et l’ensemble de tes tickets ne sont pas
            publiés. L’administrateur peut accéder aux données nécessaires pour
            gérer le jeu et répondre à tes demandes. Le journal des rencontres
            est public. Une annonce de rencontre sur X ne contient aucune
            donnée de joueur.
          </p>
        </section>

        <section aria-labelledby="privacy-providers">
          <h2 id="privacy-providers">Les services utilisés</h2>
          <p>
            Clerk assure l’authentification et Turso stocke les données du jeu.
            Ces fournisseurs et les services d’hébergement traitent les données
            nécessaires au fonctionnement et à la sécurité du site, notamment
            des informations de connexion et des journaux techniques.
          </p>
          <p>
            Clerk et Turso sont des fournisseurs américains ; leurs services
            peuvent impliquer des traitements hors de l’Union européenne.
            Clerk décrit les garanties de transfert dans son{' '}
            <a href="https://clerk.com/legal/dpa">accord sur le traitement des données</a>.
            Tu peux aussi consulter les informations de{' '}
            <a href="https://clerk.com/legal/privacy">Clerk</a>, de{' '}
            <a href="https://turso.tech/privacy-policy">Turso</a> et, si tu l’utilises
            pour te connecter, de{' '}
            <a href="https://policies.google.com/privacy?hl=fr">Google</a>.
            Pour obtenir des précisions sur les prestataires et les garanties
            applicables à tes données Scolo, utilise le contact indiqué plus haut.
          </p>
        </section>

        <section aria-labelledby="privacy-browser">
          <h2 id="privacy-browser">Dans ton navigateur</h2>
          <p>
            Clerk utilise des cookies pour reconnaître ta session et sécuriser
            ta connexion. Le stockage de l’onglet garde aussi ta date et ta mise
            en cours, pour les retrouver après la connexion, ainsi qu’une
            référence qui évite de confirmer deux fois le même pari.
          </p>
          <p>
            Scolo n’intègre pas de publicité ni d’outil de suivi marketing.
            Tu peux effacer les cookies et les données du site depuis ton
            navigateur ; cela peut te déconnecter et supprimer ton brouillon.
            Tes paris déjà validés restent enregistrés dans le jeu.
          </p>
        </section>

        <section aria-labelledby="privacy-retention">
          <h2 id="privacy-retention">Conservation et suppression</h2>
          <p>
            Ton profil et tes opérations sont conservés pour permettre
            l’utilisation de ton compte et le suivi de tes Zikak. Pour les
            tickets et les mouvements de points, la conservation dépend aussi
            du règlement des manches et de la résolution d’une éventuelle
            contestation. Les traces nécessaires à une demande ou à un incident
            sont conservées le temps de son traitement.
          </p>
          <p>
            Il n’y a pas de suppression automatique après une période
            d’inactivité. Pour fermer ton compte ou demander l’effacement de
            tes données, écris à{' '}
            <a href="mailto:hello@macojaune.com">hello@macojaune.com</a> : la demande
            est traitée manuellement, pour prendre en compte à la fois le compte
            de connexion et les données du jeu. Supprimer seulement ton compte
            de connexion n’efface pas automatiquement l’historique Scolo.
          </p>
          <p>
            Si tu utilisais l’ancienne version du site, des informations de
            compte et de connexion peuvent encore figurer dans son historique.
            Elles font également partie des données à examiner lors de ta demande.
          </p>
        </section>

        <section aria-labelledby="privacy-rights">
          <h2 id="privacy-rights">Tes droits</h2>
          <p>
            Tu peux demander l’accès à tes données, leur correction, leur
            effacement ou la limitation de leur traitement. Selon le traitement
            concerné, tu peux aussi exercer ton droit d’opposition ou demander
            la portabilité de tes données. Contacte{' '}
            <a href="mailto:hello@macojaune.com">hello@macojaune.com</a> en précisant
            ton pseudo et l’adresse de ton compte ; une vérification de ton
            identité peut être nécessaire pour protéger tes données.
          </p>
          <p>
            Tu peux également adresser une réclamation à la{' '}
            <a href="https://www.cnil.fr/fr/plaintes">CNIL</a>.
          </p>
        </section>
      </main>
      <style jsx>{`
        .privacy-page {
          width: min(100%, 820px);
          margin: 0 auto;
          padding: 36px 28px 80px;
        }
        header { margin: 40px 0; }
        .scolo-app .privacy-date {
          color: var(--muted);
          font-size: 0.8rem;
          margin-bottom: 12px;
        }
        h1 {
          color: var(--accent);
          font-size: clamp(2.1rem, 6vw, 3.6rem);
          line-height: 1.08;
          font-weight: 750;
          letter-spacing: -0.04em;
        }
        section { border-top: 1px solid var(--line); padding-top: 28px; margin-top: 30px; }
        .scolo-app p { margin-top: 16px; color: #d1d1d1; }
        a:not(.button) { color: var(--accent); text-decoration: underline; overflow-wrap: anywhere; }
        @media (max-width: 480px) {
          .privacy-page { padding: 24px 20px 56px; }
          header { margin-top: 32px; }
        }
      `}</style>
    </div>
  )
}
