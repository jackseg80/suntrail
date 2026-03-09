# ☀️ SunTrail v7

SunTrail est une application web interactive de visualisation 3D avancée permettant de simuler la position du soleil, de calculer des ombres portées réalistes sur le relief en temps réel et d'explorer les sentiers de randonnée.

## 🚀 Fonctionnalités Clés

- **Ray-casting d'ombres haute performance** : Calcul des ombres portées via **WebGPU** (WGSL) avec un repli automatique sur CPU.
- **Cartographie 3D interactive** : Basé sur **MapLibre GL JS** avec les données topographiques de **MapTiler**.
- **Calculs Astronomiques Précis** : Simulation de la position solaire (azimut/élévation) via **SunCalc**.
- **Météo Dynamique** : Intégration d'**OpenWeatherMap** avec effets visuels de particules (pluie, neige, brouillard) sur Canvas 2D.
- **Sentiers de Randonnée** : Visualisation des sentiers **OpenStreetMap** (via Overpass API) avec code couleur selon la difficulté (SAC-Scale).
- **Architecture Modulaire** : Projet structuré avec **Vite.js** pour une maintenance facile et une portabilité maximale (Web, Mobile, Desktop).

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
