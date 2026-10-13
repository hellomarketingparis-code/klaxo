# Jeu en ligne

KLAXO se joue seul ou en ligne. En ligne, on croise les autres joueurs dans la ville et on fait les missions ensemble. C'est gratuit et il n'y a aucun serveur de jeu.

## Ce que voient les joueurs

- Au premier lancement, le jeu demande : **Jouer en ligne** ou **Jouer seul**. Le choix se change à tout moment dans Pause → En ligne.
- Les autres joueurs apparaissent à pied ou dans leur voiture, avec une étiquette de nom. Leur position figure aussi sur la mini-carte et sur la grande carte.
- Le klaxon d'un joueur s'entend chez les autres.
- **Missions en équipe.** Quand un joueur lance une mission d'histoire ou la mission de la semaine, les joueurs de sa ville reçoivent une invitation : « Rejoindre » (touche J) ou « Non merci » (touche N). Ensuite, chaque étape réussie par l'un est validée pour tous, les objets ramassés par l'un disparaissent pour les autres, et chacun reçoit la récompense à la fin. Un échec ne concerne que celui qui échoue. Le bouton « Inviter les joueurs à ma mission » (Pause → En ligne) relance l'invitation.
- **Villes publiques.** Une ville accueille 8 joueurs. Quand elle est pleine, les derniers arrivés passent automatiquement à la ville suivante (Ville publique 2, 3…). Le nombre de villes n'est pas limité.
- **Groupes privés.** « Créer un groupe privé » donne un code de 5 caractères à partager avec ses amis en dehors du jeu ; ils le saisissent dans « Rejoindre ce groupe ».

## Aucune discussion

- Il n'existe aucun champ de discussion.
- Les noms (« Comète 47 », « Néon 12 »…) sont fabriqués par chaque appareil à partir d'un identifiant aléatoire. Le pseudonyme choisi à la création du personnage reste privé.
- Les messages échangés ne contiennent que des nombres (position, couleur, véhicule, étoiles) et des identifiants de mission vérifiés. Le titre d'une mission est toujours lu dans les fichiers du jeu, jamais dans le message reçu.
- Tout message reçu est validé avant usage (`src/net/protocol.ts`) et le débit de chaque joueur est limité.

## Comment ça marche

- Chaque appareil simule sa propre circulation, ses piétons et sa police. Seuls sont partagés : la position, l'apparence, le véhicule, les étoiles de recherche, le klaxon et la progression des missions faites ensemble. Les autres joueurs sont des silhouettes : on ne peut pas les percuter. Cela évite les chocs en décalé et les joueurs qui gênent volontairement les autres.
- Les appareils se trouvent grâce à des relais publics et gratuits du réseau Nostr, via la bibliothèque [Trystero](https://github.com/dmotz/trystero) (licence MIT, version 0.25.4 figée). Ensuite, les données circulent directement d'un appareil à l'autre, chiffrées (WebRTC).
- Le code du jeu en ligne n'est téléchargé que par les joueurs qui choisissent de jouer en ligne : environ 23 ko compressés.
- Code : `src/net/` (format des messages, transports, villes, coopération). Tests : `tests/net.test.ts` et la partie « En ligne » de `e2e/run.mjs`.

## Limites à connaître

- **Adresse internet visible.** Comme lors d'un appel vidéo, chaque appareil voit l'adresse internet des autres joueurs de sa ville. Le jeu le dit avant de proposer le jeu en ligne.
- **Certains réseaux bloquent les connexions directes**, par exemple en entreprise, dans une école ou chez certains opérateurs mobiles. Pour ces joueurs, on peut ajouter plus tard un relais TURN, payant au-delà d'un petit volume. Le jeu continue alors en solo.
- **Relais publics.** La mise en relation dépend de relais gratuits gérés par des tiers. Si tous étaient indisponibles, le jeu resterait jouable en solo.
- **Version publiée dans Claude.** Le jeu en ligne y est désactivé, car ce cadre bloque les connexions entre navigateurs. Il fonctionne sur le site du jeu.
- **Pas d'anti-triche.** Un joueur habile pourrait envoyer de fausses positions. Comme il n'y a ni classement ni échange d'argent, l'enjeu est faible.

## Tester à deux

1. Ouvrir le jeu sur deux appareils, ou dans deux fenêtres, puis choisir « Jouer en ligne » des deux côtés.
2. Vérifier que l'indicateur « En ligne · 2 joueurs » apparaît sous la mini-carte et que l'autre joueur est visible près du point de départ.
3. Sur un appareil, lancer une mission auprès d'un donneur de mission : l'autre reçoit l'invitation.
4. Pour tester sans internet pendant le développement, ajouter `?net=local` à l'adresse : les onglets d'un même navigateur jouent alors ensemble.
