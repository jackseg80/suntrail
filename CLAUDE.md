# 🤖 AI Context: SunTrail Project

Ce fichier fournit le contexte technique nécessaire pour aider au développement de SunTrail v7.

## 🏗️ Architecture Technique

Le projet est une application **Vanilla JavaScript** utilisant **Vite.js**. Il est conçu pour être modulaire afin de faciliter l'export vers des plateformes natives (Capacitor/Electron).

### ⚡ Moteur d'Ombres (WebGPU)
- **Shader** : Situé dans `src/shaders/shadow.wgsl`. C'est un **Compute Shader** qui itère sur une grille d'élévation (DEM).
- **Logique** : Gérée dans `src/modules/shadows.js`.
- **Méthode** : Ray-marching sur les données de relief récupérées depuis les tuiles MapTiler (Terrain-RGB).
- **Optimisation** : Utilise une grille tampon (Storage Buffer) pour les hauteurs et les intensités d'ombre.

### 🗺️ Cartographie
- **Bibliothèque** : MapLibre GL JS v4+.
- **Coordonnées** : Utilise principalement [Longitude, Latitude].
- **Terrain** : Les tuiles `terrain-rgb-v2` de MapTiler sont utilisées pour le relief 3D visuel et pour alimenter le moteur d'ombres.

### 🌤️ Météo & Environnement
- **API** : OpenWeatherMap 2.5.
- **Visuals** : Les effets de pluie/neige sont dessinés sur un `<canvas>` superposé à la carte (`#wx-particles`).
- **Éclairage** : La lumière de la scène MapLibre (`setLight`) est synchronisée avec la position du soleil et la couverture nuageuse.

## 🔑 Variables d'État (Global State)
Toutes les variables partagées sont centralisées dans `src/modules/config.js` sous l'objet `state`. Ne jamais créer de variables globales directement dans `window`.

## 🛠️ Règles de Développement
1. **Surgical Updates** : Modifier uniquement le module concerné par une fonctionnalité.
2. **WebGPU Fallback** : Toujours maintenir la compatibilité CPU dans `shadows.js` pour les navigateurs sans WebGPU.
3. **Performance** : Utiliser le `throttle` (dans `utils.js`) pour les événements coûteux (mouvement de carte, slider d'heure).
4. **Imports** : Utiliser des imports ES6. Vite gère le chargement des fichiers `.wgsl` via le suffixe `?raw`.

## 📍 Points d'entrée pour les prochaines étapes
- **Localisation** : Remplacer la recherche texte par une API GPS native si mobile.
- **Offline** : Implémenter un Service Worker pour la mise en cache des tuiles.
- **UX** : Ajouter des graphiques d'ensoleillement sur 24h.
