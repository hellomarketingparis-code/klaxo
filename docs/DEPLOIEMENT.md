# Mettre KLAXO en ligne

Le jeu est un site statique : le dossier `dist/` produit par `npm run build` suffit. Il n'y a ni serveur à administrer ni base de données.

Le jeu utilise des chemins relatifs. Il fonctionne donc à la racine d'un domaine comme dans un sous-dossier, sans réglage.

## Option 1 : GitHub Pages, avec mission hebdomadaire automatique

C'est la voie prévue par le projet. Les deux automatisations sont déjà écrites dans `.github/workflows/`. Elles n'ont pas encore été exécutées : surveillez la première exécution dans l'onglet Actions.

1. Créez un dépôt GitHub et poussez-y le projet sur la branche `main`.
2. Dans le dépôt : Settings → Pages → Source : **GitHub Actions**.
3. Dans Settings → Actions → General → Workflow permissions, choisissez **Read and write permissions**. Le robot hebdomadaire en a besoin pour enregistrer la mission.
4. Poussez un commit, ou lancez « Publier le jeu » à la main dans l'onglet Actions. L'adresse du jeu s'affiche à la fin du déploiement.

Ensuite, tout est automatique :

- À chaque modification de `main`, `deploy.yml` lance les tests, valide les données, compile et publie.
- Chaque lundi à 05 h 17 UTC, `weekly.yml` génère la mission de la semaine, la valide, l'enregistre dans le dépôt et republie le jeu. Vous pouvez aussi le lancer à la main (bouton « Run workflow »).

Si la génération échoue, ou si aucune actualité n'est exploitable, les fichiers ne sont pas modifiés : les joueurs gardent la dernière mission valide.

### Réécriture des textes par une IA (facultatif)

Sans réglage, les missions viennent de modèles intégrés, gratuits et déterministes. Pour qu'une IA réécrive les dialogues autour du fait de la semaine :

1. Créez une clé d'API chez Anthropic.
2. Dans le dépôt : Settings → Secrets and variables → Actions → New repository secret, nom `ANTHROPIC_API_KEY`.

La structure de la mission reste celle du modèle. Le texte réécrit repasse par la validation ; s'il est refusé, le texte du modèle est conservé. Ce service est facturé à l'usage par son fournisseur. Cette partie n'a pas pu être testée ici, faute de clé.

## Option 2 : Cloudflare Pages

1. Dans Cloudflare : Workers & Pages → Create → Pages → connectez le dépôt.
2. Build command : `npm run build`. Build output directory : `dist`.
3. Variable d'environnement : `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` = `1` (évite un téléchargement inutile pendant l'installation).

Cloudflare republie à chaque commit. Gardez `weekly.yml` sur GitHub : son commit du lundi déclenchera la publication chez Cloudflare. Dans ce cas, supprimez le job `publish` de `weekly.yml` et le fichier `deploy.yml`.

## Option 3 : n'importe quel hébergeur statique

Lancez `npm run build` et envoyez le contenu de `dist/`. Deux conditions :

- **HTTPS**, indispensable au fonctionnement hors ligne et à l'installation sur l'écran d'accueil.
- Le fichier `sw.js` ne doit pas être mis en cache longtemps par le serveur, sinon les mises à jour tardent. La plupart des hébergeurs s'en occupent.

Sans automatisation, lancez `npm run weekly` chaque semaine sur votre machine puis republiez.

## Coûts

Relevés le 13 octobre 2026. Ces offres changent : vérifiez les pages citées avant de vous engager.

| Poste | Coût | Limites à connaître |
| --- | --- | --- |
| Jeu pendant une partie | 0 € | Aucun serveur ni API appelés. Tout tourne sur l'appareil du joueur. |
| GitHub Pages | 0 € pour un dépôt **public** | Un dépôt privé exige une offre GitHub payante. Site de 1 Go au plus ; bande passante plafonnée « en douceur » à 100 Go par mois, soit environ 230 000 premiers chargements complets de 430 ko compressés (les visites suivantes viennent du cache). |
| GitHub Actions (tests, compilation, mission du lundi) | 0 € pour un dépôt public | En dépôt privé : 2 000 minutes par mois offertes ; une semaine consomme environ 5 à 10 minutes. GitHub désactive les tâches planifiées d'un dépôt public sans aucune activité pendant 60 jours ; le commit hebdomadaire du robot suffit normalement à l'éviter. |
| Cloudflare Pages (alternative) | Offre gratuite | Selon les conditions de Cloudflare au moment de l'inscription. |
| Réécriture des textes par IA (facultatif) | Environ 0,001 $ par semaine | Modèle par défaut `claude-haiku-5-5`, facturé 0,10 $ par million de jetons en entrée et 0,50 $ en sortie. Une semaine représente environ 1 500 jetons en entrée et 800 en sortie. Une carte bancaire est demandée à l'ouverture du compte API. Changez de modèle avec la variable `KLAXO_LLM_MODEL`. |
| Nom de domaine (facultatif) | Environ 10 à 15 € par an | Non nécessaire : l'adresse fournie par GitHub ou Cloudflare suffit. |

Sources : [limites de GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits), [facturation de GitHub Actions](https://docs.github.com/en/billing/concepts/product-billing/github-actions), [désactivation des tâches planifiées](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows), [tarifs de l'API Claude](https://platform.claude.com/docs/en/about-claude/pricing).

## Mises à jour et hors ligne

- À la première visite, le service worker met en cache tout le jeu, soit environ 1,7 Mo.
- Les fichiers de `data/` sont demandés au réseau d'abord, puis lus dans le cache si l'appareil est hors ligne. Une nouvelle mission arrive donc dès que la connexion revient.
- Après une nouvelle publication, les joueurs reçoivent la nouvelle version au lancement suivant.

## Vérifier après la mise en ligne

1. Ouvrez l'adresse sur un ordinateur puis sur un téléphone.
2. Démarrez une partie, puis coupez le réseau et rechargez la page : le jeu doit démarrer et proposer « Continuer ».
3. Sur téléphone, ajoutez le site à l'écran d'accueil et lancez-le en plein écran.
4. Sur iPhone, vérifiez le son, le joystick et la fluidité : c'est le point qui n'a pas pu être testé pendant le développement.
