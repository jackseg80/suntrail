# ☀️ SunTrail v7

SunTrail est une application web interactive de visualisation 3D avancée permettant de simuler la position du soleil, de calculer des ombres portées réalistes sur le relief en temps réel et d'explorer les sentiers de randonnée.

## 🚀 Fonctionnalités Clés

- **Ray-casting d'ombres haute performance** : Calcul des ombres portées via **WebGPU** (WGSL) avec un repli automatique sur CPU.
- **Cartographie 3D interactive** : Basé sur **MapLibre GL JS** avec les données topographiques de **MapTiler**.
- **Calculs Astronomiques Précis** : Simulation de la position solaire (azimut/élévation) via **SunCalc**.
- **Météo Dynamique** : Intégration d'**OpenWeatherMap** avec effets visuels de particules (pluie, neige, brouillard) sur Canvas 2D.
- **Sentiers de Randonnée** : Visualisation des sentiers **OpenStreetMap** (via Overpass API) avec code couleur selon la difficulté (SAC-Scale).
- **Architecture Modulaire** : Projet structuré avec **Vite.js** pour une maintenance facile et une portabilité maximale (Web, Mobile, Desktop).

## ⚡ Moteur WebGPU Avancé (WGSL)

Le moteur de calcul d'ombres de SunTrail a été conçu sur mesure pour offrir des performances maximales et une précision topographique absolue :

- **Self-Shadowing Intégral** : Le calcul de l'ombrage propre des montagnes (produit scalaire entre la normale de la pente et la direction du soleil) est exécuté nativement dans le *Compute Shader*. Cela permet un rendu immédiat et évite tout blocage (micro-freeze) du thread principal JavaScript.
- **Correction Dynamique Mercator** : La déformation inhérente à la projection cartographique Web Mercator est corrigée en temps réel. Le shader recalcule la taille physique exacte (en mètres) de chaque pixel en fonction de sa ligne de latitude, garantissant des angles d'ombres parfaits, même lors d'un dézoom massif sur plusieurs centaines de kilomètres.
- **Compression Mémoire (Bit Packing)** : La bande passante entre la carte graphique (GPU) et le processeur (CPU) est optimisée à l'extrême. Chaque thread GPU traite 4 pixels simultanément et compresse leurs valeurs d'ombre (8-bit) dans un unique entier de 32 bits (`u32`). Cela divise par 4 le temps de transfert des données et permet au CPU de lire le résultat instantanément sans aucun traitement post-réception.

## 🛠️ Installation et Lancement

### Prérequis
- [Node.js](https://nodejs.org/) (version 18 ou supérieure)
- Une clé API [MapTiler](https://cloud.maptiler.com/) (Gratuit)
- (Optionnel) Une clé API [OpenWeatherMap](https://openweathermap.org/) (Gratuit)

### Installation
```bash
# Installer les dépendances
npm install
```

### Développement
```bash
# Lancer le serveur local (http://localhost:5173)
npm run dev
```

### Production
```bash
# Générer les fichiers optimisés dans /dist
npm run build
```

## 📂 Structure du Projet

- `index.html` : Structure de l'application.
- `src/main.js` : Point d'entrée de l'application.
- `src/style.css` : Design moderne "Glassmorphism".
- `src/modules/` :
    - `config.js` : État global et configuration.
    - `shadows.js` : Moteur de calcul WebGPU/CPU.
    - `sun.js` : Logique astronomique et éclairage.
    - `map.js` : Initialisation MapLibre et sentiers OSM.
    - `weather.js` : Gestion météo et particules.
    - `ui.js` : Interface utilisateur et événements.
- `src/shaders/` :
    - `shadow.wgsl` : Shader de calcul des ombres (Compute Shader).

## 📄 Licence
Ce projet est sous licence ISC.
