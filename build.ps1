Param(
  [switch]$NoCache = $false,
  [switch]$Logs = $true
)

Write-Host "==> Down + cleanup des orphelins ET des volumes" -ForegroundColor Cyan
docker compose down --remove-orphans -v

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
