# Portail des membres — Données Souveraines Québec

Lot 1 : comptes, invitations, adhésion en ligne, paiement simulé, approbation par le conseil d'administration.

## Démarrer

```
npm install
cp .env.example .env.local   # puis renseigner l'adresse et la clé publique du projet Supabase
npm run dev                  # http://localhost:3000
```

Le port 3000 est voulu : c'est l'adresse de retour par défaut des liens de connexion Supabase.

## Organisation du code

| Dossier | Contenu |
|---|---|
| `supabase/migrations/` | Tout le schéma : tables, règles d'accès (RLS), fonctions. C'est la seule source de vérité de la base. |
| `src/lib/` | Client Supabase, session, types et formats. |
| `src/ui.tsx`, `src/styles.css` | Système de design : jetons de couleur, boutons, champs, états. |
| `src/layouts/` | Coquilles d'écran (hors session, portail). |
| `src/pages/` | Un fichier par écran. |

## Principes à respecter

- **Aucune écriture directe sur les tables sensibles.** Le navigateur appelle des fonctions de la base (`submit_membership`, `staff_decide`, etc.) qui vérifient qui appelle. Les lectures sont filtrées par les politiques RLS.
- **L'accès se déduit de l'adhésion de l'organisation**, jamais d'un champ du compte. Un invité devient membre sans changer de compte.
- **Paiement simulé.** `settings.payment_mode = 'simulation'` active le faux guichet. Pour brancher un vrai fournisseur : ajouter sa fonction de confirmation à côté de `pay_invoice_simulated` (elle appelle `private.settle_invoice`), puis changer ce réglage. Le reste du parcours ne bouge pas.
- **Portabilité.** Netlify ne sert que des fichiers statiques (voir `netlify.toml`) ; côté base, uniquement du Postgres standard. Le portail doit pouvoir déménager chez un hébergeur québécois sans réécriture.

## Courriels

Tout courriel du portail passe par la table `email_outbox`, visible dans Administration > Courriels. La fonction `supabase/functions/courriels` rédige et envoie ce que la base y dépose (reçu, confirmation, refus, facture) et envoie les invitations, avec un lien qui connecte la personne en un clic.

**Tant qu'aucun fournisseur n'est branché, l'envoi est simulé** : chaque courriel est rédigé et consigné, mais rien ne part.

Pour passer à l'envoi réel, il faut un relais SMTP joignable sur le port 465 ou 2525 (Supabase bloque les ports 25 et 587 depuis ses fonctions) :

1. Chez le fournisseur : créer le compte, puis authentifier le domaine d'envoi par les enregistrements DNS qu'il indique (SPF, DKIM), et ajouter un enregistrement DMARC.
2. Secrets de la fonction (tableau de bord Supabase, Edge Functions > Secrets) : `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`, et `SITE_URL` (adresse publique du portail).
3. Liens de connexion (tableau de bord Supabase, Authentication) : brancher le même relais dans SMTP Settings, coller `supabase/templates/connexion.html` dans les gabarits « Magic Link » et « Confirm signup », et relever la limite de 30 courriels par heure dans Rate Limits.
4. Durée du lien de connexion : une heure par défaut. La porter à 24 heures évite qu'une invitation ouverte le lendemain demande un second courriel.

Les adresses en `.test` ne reçoivent jamais de vrai courriel, même une fois le relais branché.

La file est vidée quand quelqu'un agit dans le portail. Avant l'ouverture, ajouter un déclenchement régulier (pg_cron et pg_net) pour qu'un courriel ne dépende jamais d'une visite.

## Comptes de démonstration

En développement local seulement, la page de connexion propose quatre comptes fictifs (`@demo.dsq.test`) si `VITE_DEMO_PASSWORD` est renseigné dans `.env.local`. Ils n'apparaissent jamais dans la version compilée.

## À faire avant d'ouvrir à de vraies personnes

- Recréer le projet Supabase dans la région Canada (Central), puis rejouer les migrations.
- Brancher un relais SMTP (voir Courriels) : sans lui, les liens de connexion ne partent que vers les membres de l'équipe du projet Supabase.
- Supprimer les comptes de démonstration de la base.
- Brancher le fournisseur de paiement et confirmer le traitement des taxes (`settings.gst_rate`, `settings.qst_rate`).
