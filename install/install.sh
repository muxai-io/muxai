#!/usr/bin/env bash
set -e

BOLD="\033[1m"
CYAN="\033[36m"
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
RESET="\033[0m"

# --- Flags --------------------------------------------------------------------

YES=false
for arg in "$@"; do
  [[ "$arg" == "--yes" ]] && YES=true
done

echo ""
echo -e "${BOLD}  muxAI - Install Script${RESET}"
echo -e "  -------------------------------------"
if [ "$YES" = true ]; then
  echo -e "  ${YELLOW}Running in --yes mode (no prompts)${RESET}"
fi
echo ""

# --- Dependency helpers -------------------------------------------------------

ensure_node() {
  if command -v node &>/dev/null; then
    node -e "process.exit(parseInt(process.versions.node) < 18 ? 1 : 0)" 2>/dev/null || {
      echo -e "${RED}  Node.js 18+ required. Current: $(node -v)${RESET}"
      exit 1
    }
    echo -e "${GREEN}  node $(node -v)${RESET}"
    return
  fi

  local do_install=false
  if [ "$YES" = true ]; then
    do_install=true
  else
    read -rp "  Node.js not found. Install now via fnm? [y/N]: " yn
    [[ "$yn" =~ ^[Yy]$ ]] && do_install=true
  fi

  if [ "$do_install" = true ]; then
    echo "  Installing Node.js via fnm..."
    curl -fsSL https://fnm.vercel.app/install | bash -s -- --skip-shell
    export PATH="$HOME/.fnm:$PATH"
    eval "$(fnm env 2>/dev/null)" || true
    fnm install --lts
    fnm default lts-latest
    eval "$(fnm env 2>/dev/null)" || true
    echo -e "${GREEN}  node $(node -v)${RESET}"
  else
    echo -e "${RED}  Install Node.js from https://nodejs.org (v18+) and re-run.${RESET}"
    exit 1
  fi
}

ensure_pnpm() {
  if command -v pnpm &>/dev/null; then
    echo -e "${GREEN}  pnpm $(pnpm -v)${RESET}"
    return
  fi

  local do_install=false
  if [ "$YES" = true ]; then
    do_install=true
  else
    read -rp "  pnpm not found. Install now? [y/N]: " yn
    [[ "$yn" =~ ^[Yy]$ ]] && do_install=true
  fi

  if [ "$do_install" = true ]; then
    echo "  Installing pnpm..."
    npm i -g pnpm --quiet
    echo -e "${GREEN}  pnpm $(pnpm -v)${RESET}"
  else
    echo -e "${RED}  Install pnpm with: npm i -g pnpm${RESET}"
    exit 1
  fi
}

ensure_claude() {
  if command -v claude &>/dev/null; then
    echo -e "${GREEN}  claude CLI${RESET}"
    return
  fi

  local do_install=false
  if [ "$YES" = true ]; then
    do_install=true
  else
    read -rp "  Claude CLI not found. Install now? [y/N]: " yn
    [[ "$yn" =~ ^[Yy]$ ]] && do_install=true
  fi

  if [ "$do_install" = true ]; then
    echo "  Installing Claude CLI..."
    curl -fsSL https://claude.ai/install.sh | bash
    echo -e "${GREEN}  Claude CLI installed${RESET}"
  else
    echo -e "${RED}  Install Claude CLI from https://claude.ai/code and re-run.${RESET}"
    exit 1
  fi
}

echo -e "${BOLD}Checking dependencies...${RESET}"
ensure_node
ensure_pnpm
ensure_claude
echo ""

# --- .env setup ---------------------------------------------------------------

if [ ! -f .env ]; then
  cp .env.example .env
  echo -e "${BOLD}Created .env from .env.example${RESET}"
else
  echo -e "${YELLOW}  .env already exists - skipping copy${RESET}"
fi
echo ""

# --- Database choice ----------------------------------------------------------

echo -e "${BOLD}Database setup${RESET}"
echo ""

if [ "$YES" = true ]; then
  DB_CHOICE="1"
  echo -e "${GREEN}  Embedded PostgreSQL selected (--yes default).${RESET}"
  echo "  The API will auto-start the embedded database on first run."
else
  echo "  How would you like to run PostgreSQL?"
  echo ""
  echo "  1) Embedded  - zero setup, auto-starts with muxAI (recommended)"
  echo "  2) Docker    - spin up a container (requires Docker)"
  echo "  3) External  - connect to your own PostgreSQL instance"
  echo ""
  read -rp "  Enter choice [1/2/3] (default: 1): " DB_CHOICE
  DB_CHOICE=${DB_CHOICE:-1}

  case $DB_CHOICE in
    1)
      echo -e "${GREEN}  Embedded PostgreSQL selected.${RESET}"
      sed -i 's|^DATABASE_URL=.*|DATABASE_URL=embedded|' .env
      echo "  The API will auto-start the embedded database on first run."
      ;;
    2)
      if ! command -v docker &>/dev/null; then
        echo -e "${RED}  docker not found. Install from https://docs.docker.com/get-docker/${RESET}"
        exit 1
      fi
      echo -e "${BOLD}Starting PostgreSQL via Docker...${RESET}"
      docker compose up -d db
      echo -e "${GREEN}  Docker PostgreSQL started${RESET}"
      sed -i 's|^DATABASE_URL=.*|DATABASE_URL="postgresql://muxai_user:muxai_password@localhost:5432/muxai"|' .env
      echo "  Waiting for database to be ready..."
      sleep 3
      ;;
    3)
      echo "  Example: postgresql://user:password@localhost:5432/muxai"
      read -rp "  Enter your DATABASE_URL: " CUSTOM_DB_URL
      sed -i "s|^DATABASE_URL=.*|DATABASE_URL=\"$CUSTOM_DB_URL\"|" .env
      echo -e "${GREEN}  External database configured${RESET}"
      ;;
    *)
      echo -e "${RED}  Invalid choice${RESET}"
      exit 1
      ;;
  esac
fi

if [ "$DB_CHOICE" = "1" ]; then
  sed -i 's|^DATABASE_URL=.*|DATABASE_URL=embedded|' .env
fi

echo ""

# --- API key ------------------------------------------------------------------

CURRENT_KEY=$(grep '^API_KEY=' .env | cut -d'=' -f2 | tr -d '"\r')
if [ "$CURRENT_KEY" = "your-secret-key-change-me" ]; then
  GENERATED_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  sed -i "s|^API_KEY=.*|API_KEY=$GENERATED_KEY|" .env
  echo -e "${GREEN}  API key generated${RESET}"
fi

# --- Secrets ------------------------------------------------------------------

CURRENT_INTERNAL=$(grep '^MUXAI_INTERNAL_SECRET=' .env | cut -d'=' -f2 | tr -d '\r')
if [ "$CURRENT_INTERNAL" = "muxai-internal-secret-change-me" ]; then
  GENERATED_INTERNAL=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  sed -i "s|^MUXAI_INTERNAL_SECRET=.*|MUXAI_INTERNAL_SECRET=$GENERATED_INTERNAL|" .env
  echo -e "${GREEN}  Internal secret generated${RESET}"
fi

CURRENT_WALLET=$(grep '^WALLET_ENCRYPTION_KEY=' .env | cut -d'=' -f2 | tr -d '\r')
if [ "$CURRENT_WALLET" = "change-me-64-hex-chars" ]; then
  GENERATED_WALLET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  sed -i "s|^WALLET_ENCRYPTION_KEY=.*|WALLET_ENCRYPTION_KEY=$GENERATED_WALLET|" .env
  echo -e "${GREEN}  Wallet encryption key generated${RESET}"
fi
echo ""

# --- Install deps -------------------------------------------------------------

echo -e "${BOLD}Installing dependencies...${RESET}"
pnpm install
echo ""

# --- Database schema ----------------------------------------------------------

if [ "$DB_CHOICE" != "1" ]; then
  echo -e "${BOLD}Setting up database schema...${RESET}"
  pnpm --filter @muxai/api db:push
  echo -e "${GREEN}  Schema ready${RESET}"
  echo ""
fi

# --- Build --------------------------------------------------------------------

echo -e "${BOLD}Building API...${RESET}"
pnpm --filter @muxai/api build
echo ""

echo -e "${BOLD}Building web app...${RESET}"
pnpm --filter @muxai/web build
echo ""

# --- Run mode -----------------------------------------------------------------

echo -e "${BOLD}How would you like to run muxAI?${RESET}"
echo ""

RUN_MODE="2"

if [ "$YES" = true ]; then
  RUN_MODE="2"
else
  echo "  1) PM2       - background service, auto-restart, logs (recommended for servers)"
  echo "  2) Manual    - start and stop yourself with pnpm commands (recommended for dev)"
  echo ""
  read -rp "  Enter choice [1/2] (default: 2): " RUN_MODE
  RUN_MODE=${RUN_MODE:-2}
fi

if [ "$RUN_MODE" = "1" ]; then
  # --- PM2 setup --------------------------------------------------------------

  echo -e "${BOLD}Setting up PM2...${RESET}"
  if ! command -v pm2 &>/dev/null; then
    npm i -g pm2 --quiet
  fi
  echo -e "${GREEN}  PM2 ready${RESET}"

  cat > ecosystem.config.js << 'ECOSYSTEM'
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
ECOSYSTEM

  echo -e "${BOLD}Starting muxAI with PM2...${RESET}"
  pm2 start ecosystem.config.js
  pm2 save

  # --- Health check -----------------------------------------------------------

  echo -e "${BOLD}Waiting for API to be ready...${RESET}"
  healthy=false
  for i in $(seq 1 10); do
    sleep 2
    if curl -sf http://localhost:3001/api/health > /dev/null 2>&1; then
      healthy=true
      break
    fi
    echo "  Waiting... ($i/10)"
  done

  if [ "$healthy" = true ]; then
    echo -e "${GREEN}  API is healthy${RESET}"
    echo ""
    echo ""
    echo -e "${BOLD}${GREEN}  muxAI is running!${RESET}"
    echo ""
    echo -e "  Portal:  ${CYAN}http://localhost:3000${RESET}"
    echo -e "  API:     ${CYAN}http://localhost:3001${RESET}"
    echo ""
    echo -e "  PM2 commands:"
    echo -e "    ${YELLOW}pm2 logs${RESET}              View logs"
    echo -e "    ${YELLOW}pm2 list${RESET}              Process status"
    echo -e "    ${YELLOW}pm2 stop all${RESET}          Stop everything"
    echo -e "    ${YELLOW}pm2 restart all${RESET}       Restart everything"
    echo -e "    ${YELLOW}pm2 startup${RESET}           Auto-start on reboot"
    echo ""
  else
    echo ""
    echo -e "${RED}  API did not respond after 20 seconds.${RESET}"
    echo ""
    echo -e "  Check logs:"
    echo -e "    ${YELLOW}pm2 logs muxai-api${RESET}"
    echo -e "    ${YELLOW}pm2 logs muxai-web${RESET}"
    echo ""
  fi
else
  # --- Manual mode ------------------------------------------------------------

  echo ""
  echo ""
  echo -e "${BOLD}${GREEN}  muxAI is ready!${RESET}"
  echo ""
  echo -e "  Start:"
  echo -e "    ${YELLOW}pnpm start${RESET}            Run API + web (production build)"
  echo ""
  echo -e "  Or for development:"
  echo -e "    ${YELLOW}pnpm dev${RESET}              Run API + web with hot reload (no build needed)"
  echo ""
  echo -e "  Portal:  ${CYAN}http://localhost:3000${RESET}"
  echo -e "  API:     ${CYAN}http://localhost:3001${RESET}"
  echo ""
  echo -e "  To switch to PM2 later, run:"
  echo -e "    ${YELLOW}npm i -g pm2 && pm2 start ecosystem.config.js${RESET}"
  echo ""
fi
