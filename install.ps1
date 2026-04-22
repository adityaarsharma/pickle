# ============================================================
# make-my-clickup — Windows Installer (PowerShell)
# Built by Aditya Sharma · github.com/adityaarsharma/make-my-clickup
# ============================================================

$ErrorActionPreference = "Stop"

$SkillName  = "make-my-clickup"
$Repo       = "adityaarsharma/make-my-clickup"
$Branch     = "main"
$InstallDir = Join-Path $env:USERPROFILE ".claude\skills\$SkillName"

Write-Host ""
Write-Host "════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  make-my-clickup · by Aditya Sharma"   -ForegroundColor Cyan
Write-Host "  Installer for Windows"                 -ForegroundColor Cyan
Write-Host "════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# Check Claude Code
if (-not (Get-Command "claude" -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Claude Code not found." -ForegroundColor Red
    Write-Host "   Install it first: https://code.claude.com"
    exit 1
}
Write-Host "✓ Claude Code found" -ForegroundColor Green

# Check existing install
if (Test-Path $InstallDir) {
    Write-Host "⚠  Already installed at $InstallDir" -ForegroundColor Yellow
    $update = Read-Host "   Update to latest? [y/N]"
    if ($update -notmatch "^[Yy]$") { exit 0 }
    Remove-Item -Recurse -Force $InstallDir
}

# Create skills dir
New-Item -ItemType Directory -Force -Path (Split-Path $InstallDir) | Out-Null

# Download
Write-Host "📥 Downloading from GitHub..."
$ZipUrl  = "https://github.com/$Repo/archive/refs/heads/$Branch.zip"
$TmpZip  = Join-Path $env:TEMP "make-my-clickup.zip"
$TmpDir  = Join-Path $env:TEMP "mmc-extract"

Invoke-WebRequest -Uri $ZipUrl -OutFile $TmpZip -UseBasicParsing
Expand-Archive -Path $TmpZip -DestinationPath $TmpDir -Force
Move-Item (Join-Path $TmpDir "$SkillName-$Branch") $InstallDir
Remove-Item $TmpZip, $TmpDir -Recurse -Force

if (-not (Test-Path (Join-Path $InstallDir "SKILL.md"))) {
    Write-Host "❌ Install failed — SKILL.md missing." -ForegroundColor Red; exit 1
}

Write-Host "✓ Installed to: $InstallDir" -ForegroundColor Green
Write-Host ""
Write-Host "════════════════════════════════════════" -ForegroundColor Green
Write-Host "  ✅ Done! Next steps:"                  -ForegroundColor Green
Write-Host "════════════════════════════════════════" -ForegroundColor Green
Write-Host ""
Write-Host "  1. Connect ClickUp MCP → https://claude.ai/settings/connectors"
Write-Host "  2. Open Claude Code → /make-my-clickup"
Write-Host "  3. Custom range  → /make-my-clickup 7d"
Write-Host "  4. Auto follow-up → /make-my-clickup 24h followup"
Write-Host ""
Write-Host "  📖 Docs: https://github.com/$Repo"
Write-Host ""
