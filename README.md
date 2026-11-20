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

## Comptes de démonstration

En développement local seulement, la page de connexion propose quatre comptes fictifs (`@demo.dsq.test`) si `VITE_DEMO_PASSWORD` est renseigné dans `.env.local`. Ils n'apparaissent jamais dans la version compilée.

## À faire avant d'ouvrir à de vraies personnes

- Recréer le projet Supabase dans la région Canada (Central), puis rejouer les migrations.
- Configurer un service d'envoi de courriels (le service intégré de Supabase n'écrit qu'aux membres de l'équipe du projet).
- Supprimer les comptes de démonstration de la base.
- Brancher le fournisseur de paiement et confirmer le traitement des taxes (`settings.gst_rate`, `settings.qst_rate`).
