param(
  [switch]$Yes
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Header { param($msg) Write-Host "`n  $msg" -ForegroundColor White }
function Write-Ok     { param($msg) Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn   { param($msg) Write-Host "  [!]  $msg" -ForegroundColor Yellow }
function Write-Fail   { param($msg) Write-Host "  [X]  $msg" -ForegroundColor Red }

Write-Host ""
Write-Host "  muxAI - Install Script" -ForegroundColor White
Write-Host "  -------------------------------------"
if ($Yes) {
  Write-Host "  Running in -Yes mode (no prompts)" -ForegroundColor Yellow
}
Write-Host ""

# --- Dependency helpers -------------------------------------------------------

function Refresh-Path {
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" +
              [System.Environment]::GetEnvironmentVariable("Path","User")
}

function Ensure-Node {
  if (Get-Command "node" -ErrorAction SilentlyContinue) {
    $exitCode = 0
    node -e "process.exit(parseInt(process.versions.node) < 18 ? 1 : 0)" 2>&1 | Out-Null
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
      Write-Fail "Node.js 18+ required. Current: $(node -v)"
      exit 1
    }
    Write-Ok "node $(node -v)"
    return
  }

  $doInstall = $false
  if ($Yes) {
    $doInstall = $true
  } else {
    $ans = Read-Host "  Node.js not found. Install now via winget? [y/N]"
    if ($ans -match '^[Yy]') { $doInstall = $true }
  }

  if ($doInstall) {
    Write-Host "  Installing Node.js via winget..."
    winget install OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements --silent
    Refresh-Path
    if (!(Get-Command "node" -ErrorAction SilentlyContinue)) {
      Write-Warn "Node installed but not yet on PATH. Restart your terminal and re-run."
      exit 1
    }
    Write-Ok "node $(node -v)"
  } else {
    Write-Fail "Install Node.js from https://nodejs.org (v18+) and re-run."
    exit 1
  }
}

function Ensure-Pnpm {
  if (Get-Command "pnpm" -ErrorAction SilentlyContinue) {
    Write-Ok "pnpm $(pnpm -v)"
    return
  }

  $doInstall = $false
  if ($Yes) {
    $doInstall = $true
  } else {
    $ans = Read-Host "  pnpm not found. Install now? [y/N]"
    if ($ans -match '^[Yy]') { $doInstall = $true }
  }

  if ($doInstall) {
    Write-Host "  Installing pnpm..."
    npm i -g pnpm --quiet | Out-Null
    Write-Ok "pnpm $(pnpm -v)"
  } else {
    Write-Fail "Install pnpm with: npm i -g pnpm"
    exit 1
  }
}

function Ensure-Claude {
  if (Get-Command "claude" -ErrorAction SilentlyContinue) {
    Write-Ok "claude CLI"
    return
  }

  $doInstall = $false
  if ($Yes) {
    $doInstall = $true
  } else {
    $ans = Read-Host "  Claude CLI not found. Install now? [y/N]"
    if ($ans -match '^[Yy]') { $doInstall = $true }
  }

  if ($doInstall) {
    Write-Host "  Installing Claude CLI..."
    if (Get-Command "bash" -ErrorAction SilentlyContinue) {
      bash -c "curl -fsSL https://claude.ai/install.sh | bash"
      Refresh-Path
      if (Get-Command "claude" -ErrorAction SilentlyContinue) {
        Write-Ok "Claude CLI installed"
        return
      }
    }
    Write-Warn "Could not auto-install Claude CLI. Visit https://claude.ai/code to install manually."
    Write-Warn "muxAI will still install - you can add Claude CLI later."
  } else {
    Write-Fail "Install Claude CLI from https://claude.ai/code and re-run."
    exit 1
  }
}

Write-Header "Checking dependencies..."
Ensure-Node
Ensure-Pnpm
Ensure-Claude
Write-Host ""

# --- .env setup ---------------------------------------------------------------

if (!(Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Header "Created .env from .env.example"
} else {
  Write-Warn ".env already exists - skipping copy"
}
Write-Host ""

# --- Database choice ----------------------------------------------------------

Write-Header "Database setup"
Write-Host ""

$dbChoice = "1"

if ($Yes) {
  Write-Ok "Embedded PostgreSQL selected (-Yes default)."
  Write-Host "  The API will auto-start the embedded database on first run."
} else {
  Write-Host "  How would you like to run PostgreSQL?"
  Write-Host ""
  Write-Host "  1) Embedded  - zero setup, auto-starts with muxAI (recommended)"
  Write-Host "  2) Docker    - spin up a container (requires Docker)"
  Write-Host "  3) External  - connect to your own PostgreSQL instance"
  Write-Host ""
  $dbChoice = Read-Host "  Enter choice [1/2/3] (default: 1)"
  if ([string]::IsNullOrWhiteSpace($dbChoice)) { $dbChoice = "1" }
}

$envContent = Get-Content ".env" -Raw

switch ($dbChoice) {
  "1" {
    if (!$Yes) { Write-Ok "Embedded PostgreSQL selected." }
    $envContent = $envContent -replace '(?m)^DATABASE_URL=.*', 'DATABASE_URL=embedded'
    Write-Host "  The API will auto-start the embedded database on first run."
  }
  "2" {
    if (!(Get-Command "docker" -ErrorAction SilentlyContinue)) {
      Write-Fail "docker not found. Install from https://docs.docker.com/get-docker/"
      exit 1
    }
    Write-Header "Starting PostgreSQL via Docker..."
    docker compose up -d db
    Write-Ok "Docker PostgreSQL started"
    $dockerUrl = 'DATABASE_URL="postgresql://muxai_user:muxai_password@localhost:5432/muxai"'
    $envContent = $envContent -replace '(?m)^DATABASE_URL=.*', $dockerUrl
    Write-Host "  Waiting for database to be ready..."
    Start-Sleep -Seconds 3
  }
  "3" {
    Write-Host "  Example: postgresql://user:password@localhost:5432/muxai"
    $customUrl = Read-Host "  Enter your DATABASE_URL"
    $escapedUrl = "DATABASE_URL=`"$customUrl`""
    $envContent = $envContent -replace '(?m)^DATABASE_URL=.*', $escapedUrl
    Write-Ok "External database configured"
  }
  default {
    Write-Fail "Invalid choice"
    exit 1
  }
}

[System.IO.File]::WriteAllText((Resolve-Path ".env"), $envContent)
Write-Host ""

# --- API key ------------------------------------------------------------------

$envContent = Get-Content ".env" -Raw
$currentKey = if ($envContent -match '(?m)^API_KEY=(.+)') { $matches[1].Trim().Trim('"') } else { "" }
if ($currentKey -eq "your-secret-key-change-me") {
  $generatedKey = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  $envContent = $envContent -replace '(?m)^API_KEY=.*', "API_KEY=$generatedKey"
  Write-Ok "API key generated"
}

# --- Secrets ------------------------------------------------------------------

$currentInternal = if ($envContent -match '(?m)^MUXAI_INTERNAL_SECRET=(.+)') { $matches[1].Trim() } else { "" }
if ($currentInternal -eq "muxai-internal-secret-change-me") {
  $generatedInternal = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  $envContent = $envContent -replace '(?m)^MUXAI_INTERNAL_SECRET=.*', "MUXAI_INTERNAL_SECRET=$generatedInternal"
  Write-Ok "Internal secret generated"
}

$currentWallet = if ($envContent -match '(?m)^WALLET_ENCRYPTION_KEY=(.+)') { $matches[1].Trim() } else { "" }
if ($currentWallet -eq "change-me-64-hex-chars") {
  $generatedWallet = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  $envContent = $envContent -replace '(?m)^WALLET_ENCRYPTION_KEY=.*', "WALLET_ENCRYPTION_KEY=$generatedWallet"
  Write-Ok "Wallet encryption key generated"
}

[System.IO.File]::WriteAllText((Resolve-Path ".env"), $envContent)
Write-Host ""

# --- Install deps -------------------------------------------------------------

Write-Header "Installing dependencies..."
pnpm install
Write-Host ""

# --- Database schema ----------------------------------------------------------

if ($dbChoice -ne "1") {
  Write-Header "Setting up database schema..."
  pnpm --filter @muxai/api db:push
  Write-Ok "Schema ready"
  Write-Host ""
}

# --- Build --------------------------------------------------------------------

Write-Header "Building API..."
pnpm --filter @muxai/api build
Write-Host ""

Write-Header "Building web app..."
pnpm --filter @muxai/web build
Write-Host ""

# --- Run mode -----------------------------------------------------------------

Write-Header "How would you like to run muxAI?"
Write-Host ""

$runMode = "2"

if ($Yes) {
  $runMode = "2"
} else {
  Write-Host "  1) PM2       - background service, auto-restart, logs (recommended for servers)"
  Write-Host "  2) Manual    - start and stop yourself with pnpm commands (recommended for dev)"
  Write-Host ""
  $runMode = Read-Host "  Enter choice [1/2] (default: 2)"
  if ([string]::IsNullOrWhiteSpace($runMode)) { $runMode = "2" }
}

if ($runMode -eq "1") {
  # --- PM2 setup --------------------------------------------------------------

  Write-Header "Setting up PM2..."
  if (!(Get-Command "pm2" -ErrorAction SilentlyContinue)) {
    npm i -g pm2 --quiet | Out-Null
  }
  Write-Ok "PM2 ready"

  $ecosystem = @'
const path = require("path");
module.exports = {
  apps: [
    {
      name: "muxai-api",
      script: "dist/index.js",
      cwd: path.join(__dirname, "apps", "api"),
      env_file: path.join(__dirname, ".env"),
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
    },
    {
      name: "muxai-web",
      script: "node_modules/next/dist/bin/next",
      args: "start",
      cwd: path.join(__dirname, "apps", "web"),
      env_file: path.join(__dirname, ".env"),
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
    },
  ],
};
'@

  [System.IO.File]::WriteAllText((Join-Path (Get-Location) "ecosystem.config.js"), $ecosystem)

  Write-Header "Starting muxAI with PM2..."
  pm2 start ecosystem.config.js
  pm2 save

  # --- Health check -----------------------------------------------------------

  Write-Header "Waiting for API to be ready..."
  $healthy = $false
  for ($i = 1; $i -le 10; $i++) {
    Start-Sleep -Seconds 2
    try {
      $res = Invoke-WebRequest -Uri "http://localhost:3001/api/health" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
      if ($res.StatusCode -eq 200) { $healthy = $true; break }
    } catch {}
    Write-Host "  Waiting... ($i/10)"
  }

  if ($healthy) {
    Write-Ok "API is healthy"
    Write-Host ""
    Write-Host ""
    Write-Host "  muxAI is running!" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Portal:  http://localhost:3000" -ForegroundColor Cyan
    Write-Host "  API:     http://localhost:3001" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  PM2 commands:" -ForegroundColor White
    Write-Host "    pm2 logs              " -NoNewline -ForegroundColor Yellow; Write-Host "View logs"
    Write-Host "    pm2 list              " -NoNewline -ForegroundColor Yellow; Write-Host "Process status"
    Write-Host "    pm2 stop all          " -NoNewline -ForegroundColor Yellow; Write-Host "Stop everything"
    Write-Host "    pm2 restart all       " -NoNewline -ForegroundColor Yellow; Write-Host "Restart everything"
    Write-Host "    pm2 startup           " -NoNewline -ForegroundColor Yellow; Write-Host "Auto-start on reboot"
    Write-Host ""
  } else {
    Write-Host ""
    Write-Fail "API did not respond after 20 seconds."
    Write-Host ""
    Write-Host "  Check logs:" -ForegroundColor White
    Write-Host "    pm2 logs muxai-api" -ForegroundColor Yellow
    Write-Host "    pm2 logs muxai-web" -ForegroundColor Yellow
    Write-Host ""
  }
} else {
  # --- Manual mode ------------------------------------------------------------

  Write-Host ""
  Write-Host ""
  Write-Host "  muxAI is ready!" -ForegroundColor Green
  Write-Host ""
  Write-Host "  Start:" -ForegroundColor White
  Write-Host "    pnpm start            " -NoNewline -ForegroundColor Yellow; Write-Host "Run API + web (production build)"
  Write-Host ""
  Write-Host "  Or for development:" -ForegroundColor White
  Write-Host "    pnpm dev              " -NoNewline -ForegroundColor Yellow; Write-Host "Run API + web with hot reload (no build needed)"
  Write-Host ""
  Write-Host "  Portal:  http://localhost:3000" -ForegroundColor Cyan
  Write-Host "  API:     http://localhost:3001" -ForegroundColor Cyan
  Write-Host ""
  Write-Host "  To switch to PM2 later, run:" -ForegroundColor White
  Write-Host "    npm i -g pm2 && pm2 start ecosystem.config.js" -ForegroundColor Yellow
  Write-Host ""
}
