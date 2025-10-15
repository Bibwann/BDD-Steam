Param(
  [switch]$NoCache = $false,
  [switch]$Logs = $true
)

Write-Host "==> Down + cleanup des orphelins" -ForegroundColor Cyan
docker compose down --remove-orphans

Write-Host "==> Build des images" -ForegroundColor Cyan
if ($NoCache) {
  docker compose build --no-cache
} else {
  docker compose build
}

Write-Host "==> Démarrage des services" -ForegroundColor Cyan
docker compose up -d

Write-Host "`n==> État des conteneurs" -ForegroundColor Cyan
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

if ($Logs) {
  Write-Host "`n==> Logs du service 'site' (Ctrl+C pour quitter)" -ForegroundColor Cyan
  docker compose logs -f site
}

Write-Host "`nTips:" -ForegroundColor Yellow
Write-Host "  - Vérif fichier: docker exec -it bdd-steam-site-1 sh -c 'ls -la /app/public/js/filters.js'"
Write-Host "  - Test HTTP:     curl http://localhost:3000/"
