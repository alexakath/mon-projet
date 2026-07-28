# MonProjet — Dolibarr

Application React + Vite connectée à l'API REST Dolibarr.
Même structure que `NewApp-dolibarr`, réduite au socle : authentification,
menu latéral, styles partagés et couche d'accès à l'API.

## Démarrage

```bash
npm install   # installe aussi les dépendances de server/ (postinstall)
npm start     # lance le backend et Vite ensemble
```

| Service | Adresse |
| --- | --- |
| Frontend Vite | http://localhost:5173 |
| Backend SQLite | http://localhost:3001 |

Les deux processus tournent dans le même terminal, préfixés `[backend]` et
`[vite]`. `Ctrl+C` les arrête tous les deux, et si l'un s'arrête seul l'autre
suit (`concurrently -k`) — pas de processus orphelin qui bloquerait le port au
redémarrage suivant.

Pour ne lancer qu'un seul service : `npm run start:backend` ou `npm run start:vite`.

Le backend reste optionnel : sans lui, l'import vers Dolibarr fonctionne
toujours, seule la copie locale des données est ignorée. Vite redirige
`/backend` vers `http://localhost:3001`.

L'authentification se fait avec le mot de passe défini dans `.env`
(`VITE_ADMIN_PASSWORD`). Le champ est pré-rempli en développement.

## Configuration

Le fichier `.env` (non versionné, voir `.env.example`) :

| Variable | Rôle |
| --- | --- |
| `VITE_DOLIBARR_API_URL` | URL de base de l'API REST Dolibarr |
| `VITE_DOLAPIKEY` | Clé API envoyée dans l'en-tête `DOLAPIKEY` |
| `VITE_ADMIN_LOGIN` | Login administrateur affiché |
| `VITE_ADMIN_PASSWORD` | Mot de passe de connexion à l'application |

## Structure

L'application a deux faces, servies par la même base de code.

| | Back office | Front office |
| --- | --- | --- |
| Adresse | `/dashboard`, `/import`, … | `/front`, `/front/factures`, … |
| Accès | authentifié, redirige vers `/` sinon | libre |
| Navigation | menu latéral | barre horizontale |
| Identification | mot de passe administrateur | nom du client |
| Rôle | piloter : importer, réinitialiser, analyser | consulter |

### Connexion client (front office)

Le client saisit son nom. S'il correspond à un tiers existant dans Dolibarr, il
est reconnu ; sinon le tiers est **créé automatiquement**. La comparaison ignore
la casse, les accents et les espaces, donc `rakoto`, `RAKOTO` et `  Rakoto  `
mènent tous au même compte — et une reconnexion après auto-inscription ne crée
pas de doublon.

Une fois connecté, le client ne voit **que ses propres factures** : le filtrage
se fait sur le `socid` de la facture.

> L'identification repose sur le seul nom, sans mot de passe. C'est suffisant
> pour une démonstration en local, mais pas pour une mise en ligne : saisir le
> nom d'un autre client donnerait accès à ses factures.

```
src/
├── App.jsx                  routes : login, back office, front office
├── main.jsx                 point d'entrée (BrowserRouter)
├── index.css                variables CSS + styles partagés
├── layouts/
│   └── BackLayout.jsx       coquille back office (menu latéral + garde d'accès)
├── front/
│   ├── FrontApp.jsx         session client + routes du front office
│   ├── components/
│   │   └── FrontLayout.jsx  coquille front office (barre horizontale)
│   └── pages/
│       ├── FrontLoginPage.jsx     connexion par nom + auto-inscription
│       ├── FrontHomePage.jsx      espace du client connecté
│       ├── FrontProductsPage.jsx  catalogue + ajout au panier
│       ├── FrontCartPage.jsx      panier, date de règlement, validation
│       ├── FrontPaymentPage.jsx   saisie du règlement
│       └── FrontInvoicesPage.jsx  factures du client uniquement
├── components/
│   ├── Sidebar.jsx          menu dérivé de modulesRegistry
│   └── icons.jsx            composant <Icon name="..." />
├── pages/                   back office
│   ├── LoginPage.jsx        écran de connexion
│   ├── DashboardPage.jsx    facturation par mois + ventes par produit
│   ├── SystemPage.jsx       état de la connexion et des modules
│   └── UsersPage.jsx        exemple de page module
└── services/
    ├── dolibarrApi.js       fetch/post/put/delete + ping
    ├── authService.js       session (sessionStorage)
    ├── modulesRegistry.js   source de vérité des modules
    ├── backend.js           client du backend SQLite
    ├── clientAuthService.js session client + auto-inscription
    ├── productService.js    catalogue produits
    ├── cartService.js       panier (sessionStorage par client)
    ├── orderService.js      validation du panier -> facture au prix plein
    ├── invoiceOps.js        écritures Dolibarr partagées import / panier
    ├── remiseService.js     barème de remise + application
    ├── historiqueService.js historique SQLite des règlements remisés
    ├── invoiceService.js    facturation + agrégats mois / produits
    ├── resetService.js      réinitialisation Dolibarr + SQLite
    ├── userService.js       exemple de service module
    └── import/
        ├── csvUtils.js      lecture CSV, conversions, totaux
        ├── detectModules.js reconnaissance du type de fichier
        ├── validateImport.js contrôles avant import
        └── importService.js écriture vers Dolibarr

server/
├── index.js                 serveur Express
├── db.js                    ouverture SQLite + création des tables
├── modules/index.js         source de vérité des tables SQLite
└── routes/
    ├── resource.js          GET / GET count / DELETE par table
    ├── sync.js              upsert générique
    └── factures.js          vue consolidée facture → lignes → règlements
```

## Tableau de bord (back office)

Deux analyses, chacune dépliable au clic.

**Facturation par mois** — une ligne par mois avec le nombre de factures, le
total TTC, le montant réglé, le reste à percevoir et une barre d'avancement.
Cliquer un mois déplie la liste de ses factures : client, dates, montants et
état de règlement.

**Ventes par produit** — quantité vendue, chiffre HT et TTC, part du total.
Cliquer un produit déplie chaque vente : la facture, le client, la quantité et
le prix unitaire pratiqué. Utile quand un même produit est vendu à des prix
différents selon la facture.

Une seule requête `/invoices` alimente les deux : Dolibarr y renvoie déjà
`totalpaid`, `remaintopay` et les lignes avec leur `product_ref`, ce qui évite
d'interroger les règlements facture par facture. Les avoirs, qui portent des
montants négatifs, viennent naturellement en déduction.

## Panier et commande (front office)

Le client ajoute des produits au catalogue, ajuste les quantités, puis choisit
**quand il réglera** : maintenant, ou dans un nombre de jours qu'il saisit
lui-même. Ce délai détermine la remise via le barème ci-dessous, et le
récapitulatif se recalcule à chaque changement.

Le panier vit dans `sessionStorage`, séparé par client — rien n'est envoyé à
Dolibarr tant qu'il n'est pas validé, il n'existe donc pas d'objet « panier »
côté serveur. Ajouter deux fois le même produit incrémente sa quantité au lieu
de créer une seconde ligne, et passer une quantité à zéro retire la ligne.

À la validation, l'application crée la facture au nom du client **au prix
plein** — chaque ligne au tarif catalogue, sans `remise_percent` —, puis
**valide la facture** : la validation remplace la référence provisoire
`(PROVxx)` par la définitive et fige le document. Le client arrive ensuite sur
la page de règlement.

### Où vit la remise

C'est le point qui demande le plus d'attention, parce que la remise change
d'endroit selon le moment.

Une commande de 1 000 TTC remisée à 30 % **entre dans Dolibarr pour 1 000**. La
remise n'est pas portée par les lignes : un `remise_percent` sur chacune
donnerait une facture de 700, et le montant réellement facturé disparaîtrait du
document. Or c'est lui qu'on veut y lire.

La remise n'entre dans Dolibarr qu'**au règlement**, sous la forme que Dolibarr
prévoit pour cela : le client verse les 700, puis la facture est classée
« payée » avec le motif `discount_vat` — l'**escompte de règlement**
(`POST /invoices/{id}/settopaid`, cf. `invoiceOps.setInvoicePaid`). Dolibarr
conserve alors les trois montants séparément : 1 000 facturés, 700 encaissés,
300 abandonnés en escompte, 0 restant.

Entre les deux, Dolibarr ne connaît pas encore le taux consenti — il n'a pas de
champ pour cela tant que rien n'est encaissé. Il est donc écrit à deux endroits :

- dans la **note publique** de la facture, sous une forme relue par
  `invoiceService.remiseRateFromNote` — ce qui rend la facture Dolibarr
  auto-suffisante ;
- dans la table SQLite **`historique_remises`**, écrite dès la commande puis
  complétée au règlement : montant facturé, taux, remise, net, encaissé, reste.
  C'est l'historique de ce qui a réellement été payé, et il fait autorité sur le
  taux quand le backend est joignable.

`invoiceService.decomposeInvoice()` rassemble les deux sources et rend les trois
montants. **`netRemaining` est ce que le client doit réellement** : c'est lui qui
borne un règlement, jamais `remaining`, qui porte encore la remise.

Le tableau de bord affiche ces trois montants — *Montant facture réel*,
*Remise règlement*, *Reste à payer* — par mois, par facture, et dans la section
« Historique des règlements remisés » alimentée par SQLite.

Une facture arrivée **en brouillon** (celles de l'import CSV, par exemple) reste
accessible depuis « Mes factures » : la page de règlement propose alors une
première étape de validation, puis le formulaire de règlement.

> À noter : l'API REST accepte un règlement sur un brouillon, contrairement à
> l'interface de Dolibarr qui ne propose « Saisir règlement » qu'après
> validation. L'application suit l'interface, pas l'API : un paiement rattaché à
> un document encore modifiable et sans référence définitive n'a pas de sens
> comptable.

Cette page reprend les champs de la saisie règlement de Dolibarr : date,
mode de règlement, compte à créditer et montant, pré-rempli avec le **net
restant, remise déduite** — 700 sur une facture de 1 000 remisée à 30 %, et non
le restant dû de Dolibarr, qui vaut encore 1 000. Un montant inférieur est
accepté — la facture reste alors partiellement réglée, et se solde au règlement
suivant. Un montant supérieur à ce net est refusé avant l'envoi : au-delà, le
client paierait une remise qui lui a été accordée.

Si la clôture en escompte échoue alors que le règlement est déjà enregistré,
elle est signalée comme telle et le règlement n'est **pas** rejoué : la facture
reste ouverte pour le montant de la remise, à solder depuis Dolibarr.

### Champ TVA

Un champ **TVA (%)** complète la saisie, pré-rempli avec le taux de la facture
réglée. Le montant saisi étant TTC — c'est ce que le client verse —, ce taux le
ventile en HT et TVA, affichés sous le formulaire et recalculés à chaque frappe.

**Le taux proposé se lit sur la facture telle qu'elle est, remise comprise.**
Dolibarr applique la remise au HT, puis la TVA sur ce HT réduit : le rapport
`total_tva / total_ht` donne donc directement le taux effectif. Repartir du taux
catalogue du produit reviendrait à ignorer la remise. Vérifié sur F002, remisée
à 15,5 % : le taux proposé est bien 20 %, et un règlement de 150 se ventile en
125,00 HT + 25,00 TVA.

Une facture peut mêler plusieurs taux — F001 porte du 14,5 % et du 20 %. Il
n'existe alors pas de « taux de la facture » : l'application propose le taux
moyen **pondéré par les montants remisés** (15,88 % pour F001) et le signale
sous le champ, plutôt que de retenir arbitrairement celui de la première ligne.
Le champ reste modifiable.

> `POST /invoices/paymentsdistributed` n'accepte qu'un montant : Dolibarr
> enregistre le règlement TTC, sans ventilation. Celle-ci est donc écrite dans
> le **commentaire** du règlement — seul champ libre de l'endpoint — où elle
> reste lisible depuis Dolibarr : `… — 125,00 HT + 25,00 TVA (20 %)`.

Les écritures vers Dolibarr (ligne, validation, règlement) sont mutualisées dans
`src/services/invoiceOps.js`, partagé avec l'import CSV : les contraintes de
l'API n'existent qu'à un seul endroit.

## Barème de remise (back office)

La remise accordée dépend du délai entre la date de facture et la date de
règlement. Le barème est stocké en SQLite et se règle depuis `/remises` —
**le nombre de paliers est libre**, on en ajoute et on en retire sans toucher au
code.

Un palier est un **intervalle de jours fermé aux deux bouts** : `jours_min` et
`jours_max` sont tous deux inclus.

| Libellé | Du jour | Au jour | Remise |
| --- | --- | --- | --- |
| Règlement immédiat | 0 | 0 | 30 % |
| Moins d'une semaine | 1 | 7 | 15 % |
| Moins d'un mois | 8 | 30 | 10 % |
| Au-delà d'un mois | 31 | *(sans fin)* | 0 % |

### Pourquoi deux bornes plutôt qu'un seuil

Une version précédente ne stockait que `jours_max` et faisait commencer chaque
palier au lendemain du précédent. Deux défauts : un palier ne se lisait qu'en
regardant son voisin, et déplacer un seuil décalait silencieusement le suivant.
Passer « moins d'une semaine » de 7 à 3 jours déplaçait du même coup le début de
« moins d'un mois ».

Avec les deux bornes saisies, **« du jour 3 au jour 7 » se lit sur sa seule
ligne**, et modifier un palier ne touche que lui.

La contrepartie, c'est qu'un barème peut désormais se contredire ou laisser des
manques. Deux garde-fous :

- **Le chevauchement est refusé** (409). Un même délai ne peut pas relever de
  deux paliers — sinon la remise obtenue dépendrait de l'ordre de lecture, donc
  du hasard. Le message nomme le palier en conflit et sa plage : *« Chevauchement
  avec « Moins d'une semaine » (1 à 7 j) »*. Cette garde couvre aussi le cas du
  second palier laissé sans fin : deux intervalles ouverts se recouvrent
  forcément.
- **Le trou est signalé, pas interdit.** Un barème commençant au jour 3 laisse
  les jours 0 à 2 sans remise ; c'est un choix légitime, mais il doit être
  délibéré. La page affiche les intervalles non couverts, et `findGaps()` les
  calcule.

Restent refusés comme avant : une fin antérieure au début, un taux hors de
0–100, un libellé vide.

Le palier applicable est celui qui **contient** le délai. Comme les intervalles
ne se recouvrent pas, il est unique, et le résultat ne dépend plus de l'ordre de
parcours. Un règlement en avance (délai négatif) est ramené au jour 0.

> Les bases créées avant ce changement sont migrées au démarrage du backend :
> la colonne `jours_min` est ajoutée et remplie avec la borne que l'ancien code
> déduisait — chaque palier démarrant au lendemain du précédent. Le barème en
> place est donc conservé tel quel, bornes désormais explicites.

Ce barème est une **configuration, pas une donnée importée** : la page de
réinitialisation l'ignore volontairement. Pour revenir aux valeurs livrées, la
page propose « Restaurer le barème par défaut ».

Un aperçu en bas de page montre, pour chaque facture encore due, l'ancienneté,
le palier qui s'appliquerait si le client réglait aujourd'hui, et le net à payer.

## Import CSV (série 4)

Trois fichiers, reconnus par leurs en-têtes — l'ordre de sélection est
indifférent, l'ordre d'import est imposé par le registre.

| Fichier | Type reconnu | Score obtenu |
| --- | --- | --- |
| `facture.csv` | Factures | 22 (seuil 10) |
| `detail_facture.csv` | Lignes de facture | 31 (seuil 12) |
| `paiement.csv` | Règlements | 16 (seuil 10) |

Ordre d'import : `factures → detail_factures → paiements`.

### Les règlements désignent leur facture

Dans `paiement.csv`, `num_facture` référence directement la facture réglée —
c'est-à-dire exactement le niveau auquel Dolibarr enregistre les règlements. Un
règlement se pose donc sur sa facture sans transformation.

Le montant partiel, lui, reste une contrainte de l'API :
`POST /invoices/paymentsdistributed` est le seul endpoint qui l'accepte, là où
`/invoices/{id}/payments` solderait tout le restant dû.

Une facture peut recevoir **plusieurs règlements** — F001 en reçoit deux. Elle
n'est validée qu'une fois : l'import collecte d'abord les factures concernées,
les valide, puis enregistre les règlements.

| Facture | Total HT | Total TTC | Réglé | Reste | Statut |
| --- | --- | --- | --- | --- | --- |
| F001 | 4 800,00 | 5 562,00 | 4 122,00 | 1 440,00 | Partiellement réglée |
| F002 | 1 352,00 | 1 622,40 | 150,00 | 1 472,40 | Partiellement réglée |

> Une version précédente de `paiement.csv` désignait la **ligne** de facture
> (`ref_detail`) et non la facture. L'import devait alors remonter chaque
> règlement à la facture parente de sa ligne — un détour qui n'a plus lieu
> d'être. La table SQLite `paiements` est migrée automatiquement au démarrage
> du backend : colonne `ref_detail` retirée, clé d'idempotence reconstruite sur
> `num_facture`.

### Contrôles avant import

L'import est bloqué si une colonne obligatoire manque, si une quantité ou un
prix est invalide, ou si une référence croisée est introuvable (ligne pointant
une facture absente, règlement pointant une facture absente).

Deux avertissements non bloquants remontent sur ce jeu de données : les
règlements datés du **22/07/2006** et **23/07/2006** sont antérieurs à la facture
F001 (21/07/2026) — l'année est vraisemblablement une faute de frappe.

### Ce que l'import crée dans Dolibarr

Les tiers (`Rakoto`, `Rabe`) et les produits (`P1`, `P2`) sont cherchés avant
d'être créés, afin de ne pas dupliquer à chaque import. Les factures sont créées
en brouillon, puis validées avant l'enregistrement des règlements.

Sur ce jeu de données, **les deux factures reçoivent un règlement** : toutes
deux sont donc validées et repartent partiellement réglées. Une facture qui
n'aurait aucun règlement resterait en brouillon — elle serait alors validable et
réglable depuis le front office, qui propose dans ce cas une étape de validation
avant le formulaire de règlement.

### Contraintes de l'API vérifiées sur le serveur (Dolibarr 23.0.3)

Quatre écarts entre la documentation et le comportement réel, tous constatés en
testant la chaîne complète sur l'instance :

| Point | Comportement réel |
| --- | --- |
| `code_client` | Obligatoire **et** soumis au masque de `mod_codeclient_monkey`. Les codes `C1`/`C2` du CSV sont rejetés (`ErrorBadCustomerCodeSyntax`), et l'omettre l'est aussi (`ErrorCustomerCodeRequired`). L'import envoie `auto` et conserve le code métier dans `ref_ext`, qui sert de clé de rapprochement. |
| Réponses polluées | Avec `display_errors` actif, l'API préfixe ses réponses de warnings PHP en HTML. `JSON.parse` échoue. `dolibarrApi.js` repart de la première accolade, ou du nombre en fin de corps pour les POST. |
| `closepaidinvoices` | Attend littéralement `"yes"`/`"no"`. `"1"` renvoie une 400. |
| Types de règlement | Les identifiants varient d'une instance à l'autre : ici **VIR = 2** et **LIQ = 4**, et non 4 et 3. L'import les résout par code via `/setup/dictionary/payment_types`. |
| Avertissements PHP | `api_invoices.class.php` lit une vingtaine de propriétés facultatives sans vérifier leur existence. Avec `display_errors` actif, chaque propriété absente écrit un avertissement HTML dans la réponse : **4 471 octets et 25 avertissements** pour un corps minimal, contre **1 octet et aucun** quand toutes les propriétés sont fournies (`EMPTY_LINE_PROPS`). |
| Listes vides | Dolibarr n'est pas homogène : `/invoices` et `/products` renvoient `[]` avec un 200, mais **`/thirdparties` renvoie un 404** « No third parties found ». Ce 404 est sans ambiguïté puisqu'une route inexistante renvoie un **501** « API not found ». `dolibarrList()` le traduit donc en tableau vide, et laisse passer le reste. |

### Pourquoi Dolibarr passe par le proxy Vite

Ces avertissements ne cassaient pas seulement le JSON. Écrits avant la
compression, ils corrompaient le flux gzip — le navigateur rejetait alors la
réponse en `ERR_CONTENT_DECODING_FAILED`. Et un `header()` appelé après eux
échoue, ce qui pouvait faire sauter les en-têtes CORS et produire des
« Failed to fetch » apparemment inexplicables. Ces deux symptômes ne se
manifestaient pas en `curl` sans en-tête `Origin`, uniquement depuis le
navigateur.

L'application appelle donc `/dolibarr`, redirigé par Vite : les requêtes
deviennent same-origin (plus de CORS) et le proxy impose
`Accept-Encoding: identity` (plus de gzip à corrompre). `dolibarrApi.js`
conserve par ailleurs un parseur tolérant qui sait retrouver la valeur utile
dans un corps pollué, avertissements avant **comme après**.

Vérifié également : la remise en pourcentage est bien appliquée
(1 600 × 1 − 15,5 % = 1 352,00 HT → 1 622,40 TTC), et un règlement partiel via
`paymentsdistributed` laisse la facture au statut Impayée, comme attendu.

## Réinitialisation

La page `/reset` couvre les deux bases. Côté Dolibarr, l'ordre est imposé —
**règlements → factures → produits → tiers** — car un enregistrement encore
référencé n'est pas supprimable ; les échecs sont comptés et détaillés plutôt
que masqués.

Le premier maillon compte : une facture ayant reçu un règlement renvoie
`Invoice not erasable`, même repassée en brouillon. Le règlement se supprime par
`DELETE /paiements/{id}` — `/invoices` n'expose aucune suppression de règlement.
Une fois le règlement retiré, la facture s'efface, y compris validée.

Et une facture **entièrement** soldée (statut 2) verrouille son règlement :
la suppression renvoie une 500. Le reset repasse donc au préalable ces factures
en « impayée » via `POST /invoices/{id}/settounpaid`. Vérifié sur une facture
soldée créée pour l'occasion : suppression directe → 500, réouverture puis
suppression → 200.

### L'ordre des factures entre elles compte aussi

Une facture **validée** n'est supprimable que si elle est la **dernière de sa
séquence de numérotation** — la loi interdit les trous dans la numérotation, et
Dolibarr renvoie sinon `403 Invoice not erasable`. Les factures sont donc
supprimées de la plus récente à la plus ancienne : chacune est la dernière au
moment où son tour vient.

Dans l'ordre naturel renvoyé par l'API, `IN2607-0001` était tentée en premier
alors que `IN2607-0002` existait encore, et échouait. Les produits et les tiers
échouaient ensuite en `409 Conflict`, non pas pour une raison propre, mais
simplement parce que la facture restée en place les référençait encore.

Côté SQLite, les tables sont découvertes auprès du backend : ajouter un module
dans `server/modules/index.js` suffit à le rendre réinitialisable.

La suppression exige de saisir `SUPPRIMER` et n'effectue aucune sauvegarde.

## SQLite

La base locale (`server/data/monprojet.db`, non versionnée) sert à deux choses :
conserver les lignes CSV telles qu'importées pour la traçabilité, et offrir une
vue consolidée facture → lignes → règlements calculée en SQL, sans réinterroger
Dolibarr. Les écritures sont idempotentes : réimporter le même fichier met à jour
les lignes existantes au lieu de les dupliquer.

## Ajouter un module

1. Déclarer le module dans `src/services/modulesRegistry.js` en renseignant sa `route`.
2. Créer `src/services/<module>Service.js` qui appelle `dolibarrFetch`.
3. Créer la page dans `src/pages/`.
4. Ajouter la route dans `src/App.jsx`.

Le menu latéral et le tableau de bord se mettent à jour automatiquement à
partir du registre.

## État de l'instance Dolibarr 23.0.3 (vérifié le 26/07/2026)

Modules activés d'après `GET /setup/modules` : `accounting`, `agenda`,
`api`, `banque`, `expensereport`, `export`, `facture`, `fckeditor`,
`holiday`, `import`, `product`, `salaries`, `societe`, `stock`, `tax`,
`user`.

### Module Financier

| Module | Activé | Endpoint REST | État |
| --- | --- | --- | --- |
| Comptabilité double | oui | `/accountancy/exportdata` | 200, mais grand livre vide — export seul, pas de CRUD |
| Banque et caisse | oui | `/bankaccounts` | 200 — 2 comptes (1 banque, 1 caisse) |
| Salaires | oui | `/salaries`, `/salaries/payments` | 200 — 9 salaires, 1 paiement |
| Taxes et dépenses spéciales | oui | aucun | pas d'API REST dans Dolibarr |
| Factures et avoirs | oui | `/invoices` | 200 — 2 factures dont 1 avoir (`type: 2`) |

Un module activé dans Dolibarr n'expose pas forcément d'API REST : c'est
le cas de **Taxes et dépenses spéciales**, qu'il faut attaquer par la base
ou par l'interface Dolibarr.

### Modules non activés

Réponse 403 ou 501 : propositions, commandes, factures fournisseurs,
projets, tâches, catégories, expéditions, contrats, tickets. Il faut les
activer dans Dolibarr avant de pouvoir les utiliser.

La liste complète des ressources exposées est consultable via
`GET /explorer/swagger.json`.
