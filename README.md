# Guide rapide - Projet Node.js + MongoDB (BDD-Steam)

## 1. Prérequis
- Docker Desktop installé et lancé (mode Linux + WSL2 activé)
- WSL2 avec Ubuntu installé et intégré à Docker

## 2. Lancer le projet
```bash
# Aller dans le dossier du projet
cd /mnt/c/Users/basti/Desktop/IUT\ 2025-2026/BDD\ Project\ CORONA-NIETO/BDD-Steam

# Copier les variables d'environnement
cp .env.example .env

# Build et lancer les conteneurs
docker compose up --build -d

# Voir les logs de l'app
docker compose logs -f site

# Stopper les conteneurs
docker compose down
```

Accès :
- Site : http://localhost:3000
- API : http://localhost:3000/api/items (ou /api/games)
- Healthcheck : http://localhost:3000/health

## 3. Importer un fichier JSON (games.json)
### Avec Compass (simple)
1. Ouvrir Compass et se connecter à `mongodb://localhost:27017`
2. Sélectionner la base `mon_site`
3. Bouton **Add Data > Import JSON**
4. Choisir `games.json`
5. Collection cible : `games`

### Avec CLI (Docker)
```bash
# Copier le fichier dans le conteneur Mongo
docker cp games.json mongo:/data/db/games.json

# Importer dans la base "mon_site", collection "games"
docker exec -i mongo mongoimport   --db mon_site --collection games   --file /data/db/games.json --jsonArray
```

## 4. API REST
- `GET /health` → test API
- `GET /api/items` ou `/api/games` → liste les documents
- `POST /api/items` ou `/api/games` → ajoute un document

Exemple POST :
```json
{
  "name": "The Witcher 3",
  "genre": "RPG"
}
```

## 5. Frontend
- Accessible via http://localhost:3000
- Sert `public/index.html` (statique)
- `main.js` communique avec l'API :
  - `GET` → affiche les items/games
  - `POST` → ajoute un nouvel item/game

---
Mémo : tout se gère avec `docker compose` (API + Mongo), Compass pour voir la base, et le front parle directement à l’API Express.
