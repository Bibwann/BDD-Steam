# MongoDB on Docker + one-shot import

## 1) Files
- `docker-compose.yml` : MongoDB 7 + mongo-express.
- `.env` : credentials and default db/collection.
- `import-windows.ps1` : Windows PowerShell importer.
- `import-linux.sh` : Linux/macOS importer.

## 2) Start
```
docker compose up -d
```

## 3) Import your data
- If your file is a JSON array `[{...},{...}]`:
  - Windows:
    ```powershell
    $env:MONGO_ROOT_USER="root"
    $env:MONGO_ROOT_PASS="rootpass"
    $env:MONGO_COLLECTION="games"
    .\import-windows.ps1 -JsonPath "C:\Users\basti\Desktop\IUT 2025-2026\games.json" -JsonArray
    ```
  - Linux/macOS:
    ```bash
    export MONGO_ROOT_USER=root
    export MONGO_ROOT_PASS=rootpass
    export MONGO_COLLECTION=games
    ./import-linux.sh "/absolute/path/games.json" jsonarray
    ```
- If your file is NDJSON (one document per line):
  - Windows: run the same without `-JsonArray` switch.
  - Linux/macOS: use `ndjson` as the second argument.

## 4) Connect
- Mongo shell:
  ```bash
  mongosh "mongodb://root:rootpass@localhost:27017/admin"
  ```
- Mongo Express UI:
  - http://localhost:8081  (user/pass pulls from .env)

## 5) Notes
- Do not expose port 27017 publicly in production; use private networks or VPN.
- Document limit is 16 MB. If a document is bigger, split or move large binary fields to GridFS.
- For huge files, import in chunks and avoid using Compass for the import.
