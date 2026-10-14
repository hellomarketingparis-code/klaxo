# Faire connaître KLAXO

Personne ne peut garantir qu'un jeu devienne viral. Ce qui marche, ce sont des partages faciles, un rendez-vous régulier et une première vague de joueurs qui en entraîne d'autres. Ce document rassemble ce qui est déjà dans le jeu, les visuels prêts à publier et un plan pour les premières semaines.

Adresse du jeu : **https://hellomarketingparis-code.github.io/klaxo/**

## Ce que le jeu fait déjà pour être partagé

| Levier | Où | Effet |
| --- | --- | --- |
| Aperçu du lien | Partout où l'adresse est collée (WhatsApp, Messenger, X, Facebook, LinkedIn, Discord) | Une image de la ville néon avec le logo et l'accroche, au lieu d'un lien nu. |
| « Partager le jeu » | Écran d'accueil | Ouvre le menu de partage du téléphone, ou copie le lien sur ordinateur. |
| « Inviter des amis » | Pause → En ligne | Crée un groupe privé et partage un lien. L'ami qui l'ouvre arrive directement dans la partie, sans recopier de code. C'est la boucle la plus forte : chaque joueur en amène d'autres pour jouer avec lui. |
| Carte de victoire | Après chaque mission réussie, bouton « Partager » | Une image 1080×1350 au format des stories : la ville à l'écran, la chute humoristique, le personnage du joueur et l'adresse du jeu. |
| Mission de la semaine | Chaque lundi, automatiquement | Une raison de revenir, et un nouveau sujet de publication chaque semaine. |

## Les visuels

Générés à partir du vrai jeu (`npm run build`, puis `node tools/make-og.mjs` et `node tools/make-trailer.mjs`). Les fichiers sont créés dans `marketing/`.

- `klaxo-bande-annonce-9x16.mp4` : 30 secondes, vertical, pour TikTok, Instagram Reels et YouTube Shorts. La vidéo est muette : ajoutez un son tendance depuis l'application, c'est ce que les algorithmes favorisent.
- `visuel-zombies-1080x1080.png` : publication carrée (Instagram, Facebook, X).
- `carte-victoire-zombies-1080x1350.png` : exemple de carte de victoire, pour une story.
- `apercu-lien-1200x630.png` : l'image d'aperçu des liens.
- `klaxo-itch.zip` : le jeu prêt à déposer sur itch.io.

## Textes prêts à publier

**TikTok, Reels, Shorts** (avec la bande-annonce)

> Une ville néon où les zombies veulent juste du café ☕🧟 Courses-poursuites, police, missions entre amis… et chaque lundi, une nouvelle mission inspirée de l'actualité. Gratuit, dans le navigateur, sans téléchargement. Lien en bio.
> #jeuvideo #pixelart #indiegame #jeugratuit #gamedev #zombies #retrogaming

**Instagram, publication carrée**

> Ils veulent du café. Klaxonne. 🚗💨
> KLAXO, un jeu d'action en ville néon, gratuit et jouable dans le navigateur, seul ou avec tes amis. Nouvelle mission chaque semaine, tirée de l'actualité.
> 👉 Lien en bio

**WhatsApp, Messenger, SMS** (à envoyer avec son lien d'invitation, depuis Pause → En ligne → Inviter des amis)

> Viens jouer avec moi à KLAXO : on conduit dans une ville néon et on fait les missions ensemble. C'est gratuit, ça marche sur téléphone, rien à installer. Clique ici, tu arrives direct dans mon groupe :

**Reddit** (en anglais pour r/WebGames et r/playmygame ; lire les règles de chaque forum avant de publier)

> Title: I made a free browser game: a neon top-down city where zombies just want coffee (and a new mission every week based on real news)
> Body: KLAXO is a free top-down action game that runs in the browser, on desktop and mobile. You drive around a pixel-art city, escape the police, fight off coffee-craving zombies with your horn, and team up with friends online (no chat, just honking). Every Monday a new satirical mission is generated from the week's headlines. It's in French for now. Feedback welcome! [lien]

**Message à un créateur de contenu** (YouTube, Twitch, TikTok gaming)

> Bonjour [prénom], je suis le créateur de KLAXO, un jeu gratuit dans le navigateur : une ville néon en pixel art, des poursuites, des zombies qui veulent du café, et une mission satirique inspirée de l'actualité chaque lundi. On peut y jouer à plusieurs avec un simple lien. Ça pourrait faire une bonne vidéo courte ou un live entre amis. Le jeu : [lien]. Je peux vous préparer un groupe privé pour votre communauté. Merci pour votre temps !

## Où publier

| Où | Pourquoi | À savoir |
| --- | --- | --- |
| TikTok, Reels, Shorts | Le plus gros potentiel de diffusion gratuite | Publier la bande-annonce, puis un extrait court de la mission de chaque semaine. |
| Groupes WhatsApp, amis | Les premiers joueurs, et ceux qui en invitent d'autres | Envoyer un lien d'invitation, pas seulement le lien du jeu. |
| itch.io | Vitrine gratuite des jeux indépendants | Déposer `klaxo-itch.zip` (projet « HTML », cocher « This file will be played in the browser »). Limites : 1 000 fichiers, 500 Mo ; le jeu en fait 23 et 2 Mo. |
| CrazyGames | Portail de jeux web à très forte audience | Le « Basic Launch » accepte un jeu sans leur outil intégré (SDK), jusqu'à 50 Mo, sans publicité extérieure. KLAXO remplit ces conditions ; le jeu est en français, ce qui limitera l'audience internationale. |
| Poki | Autre grand portail | Exige l'intégration de leur outil et de leurs publicités : à envisager plus tard. |
| Reddit | Retours de joueurs et premiers fans | Chaque forum a ses règles sur l'autopromotion. |

## Plan des quatre premières semaines

1. **Jour 1.** Tester le jeu en ligne à deux sur deux téléphones. Publier la bande-annonce sur TikTok, Reels et Shorts. Envoyer des liens d'invitation à 10 amis.
2. **Jours 2 à 7.** Déposer le jeu sur itch.io. Publier sur Reddit. Répondre à tous les commentaires.
3. **Chaque lundi.** La nouvelle mission arrive toute seule : publier une courte vidéo « La mission de la semaine : … » qui reprend le sujet d'actualité. C'est le rendez-vous qui distingue KLAXO.
4. **Semaine 3 ou 4.** Contacter 10 à 20 petits créateurs de contenu gaming francophones avec le message ci-dessus.

## Ce qui aiderait le plus ensuite

- **Une version anglaise** : elle multiplie l'audience possible, surtout sur les portails et Reddit.
- **Une mesure d'audience** respectueuse de la vie privée (par exemple GoatCounter, qui a une offre gratuite sous conditions), pour savoir quelles publications amènent des joueurs. Elle demande un compte et, en France, une mention dans la page d'information du jeu.
- **Un nom de domaine court** (par exemple klaxo.fr, environ 10 à 15 € par an), plus facile à dire et à retenir qu'une adresse GitHub.
- **Ne pas citer de marques de jeux existants** dans les publications officielles, pour éviter tout litige.
