#!/bin/sh
set -e

# Seed mon_site.games if a dataset is provided

if [ -f /docker-entrypoint-initdb.d/games.json ]; then
  echo "Importing games.json (array) into mon_site.games..."
  mongoimport --db mon_site --collection games --file /docker-entrypoint-initdb.d/games.json --jsonArray --drop
fi

if [ -f /docker-entrypoint-initdb.d/games.ndjson ]; then
  echo "Importing games.ndjson (NDJSON) into mon_site.games..."
  mongoimport --db mon_site --collection games --file /docker-entrypoint-initdb.d/games.ndjson --drop
fi

echo "Seeding complete."
