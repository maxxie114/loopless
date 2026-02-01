#!/bin/bash
set -e

#######################################
# LoopLess - DO Droplet Deploy Script
# Run as root on a fresh Ubuntu droplet
#######################################

echo "============================================"
echo "   LoopLess Demo Deployment Script"
echo "============================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get droplet IP
DROPLET_IP=$(curl -s ifconfig.me)
echo -e "${GREEN}Detected IP: $DROPLET_IP${NC}"

#######################################
# CONFIGURATION - EDIT THESE VALUES
#######################################
REPO_URL="https://github.com/YOUR_USERNAME/self_improved_browser.git"

# Environment variables - FILL THESE IN before running
WANDB_API_KEY="${WANDB_API_KEY:-}"
WEAVE_PROJECT="${WEAVE_PROJECT:-}"
GOOGLE_API_KEY="${GOOGLE_API_KEY:-}"
BROWSERBASE_API_KEY="${BROWSERBASE_API_KEY:-}"
BROWSERBASE_PROJECT_ID="${BROWSERBASE_PROJECT_ID:-}"
REDIS_URL="${REDIS_URL:-}"
REDIS_PASSWORD="${REDIS_PASSWORD:-}"

#######################################
# Prompt for missing env vars
#######################################
prompt_env() {
    local var_name=$1
    local var_value=${!var_name}
    if [ -z "$var_value" ]; then
        read -p "Enter $var_name: " var_value
        eval "$var_name='$var_value'"
    fi
}

echo ""
echo -e "${YELLOW}Checking environment variables...${NC}"
prompt_env "WANDB_API_KEY"
prompt_env "WEAVE_PROJECT"
prompt_env "GOOGLE_API_KEY"
prompt_env "BROWSERBASE_API_KEY"
prompt_env "BROWSERBASE_PROJECT_ID"
prompt_env "REDIS_URL"
prompt_env "REDIS_PASSWORD"

# Validate required vars
if [ -z "$WANDB_API_KEY" ] || [ -z "$GOOGLE_API_KEY" ] || [ -z "$BROWSERBASE_API_KEY" ] || [ -z "$REDIS_URL" ]; then
    echo -e "${RED}Error: Missing required environment variables${NC}"
    exit 1
fi

#######################################
# Step 1: System Update & Dependencies
#######################################
echo ""
echo -e "${GREEN}[1/8] Installing system dependencies...${NC}"
apt update && apt upgrade -y
apt install -y git curl

#######################################
# Step 2: Install Node.js 20
#######################################
echo ""
echo -e "${GREEN}[2/8] Installing Node.js 20...${NC}"
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt install -y nodejs
fi
echo "Node version: $(node -v)"

#######################################
# Step 3: Install pnpm and PM2
#######################################
echo ""
echo -e "${GREEN}[3/8] Installing pnpm and PM2...${NC}"
npm install -g pnpm pm2

#######################################
# Step 4: Clone Repository
#######################################
echo ""
echo -e "${GREEN}[4/8] Cloning repository...${NC}"
APP_DIR="/root/self_improved_browser"
if [ -d "$APP_DIR" ]; then
    echo "Directory exists, pulling latest..."
    cd "$APP_DIR"
    git pull
else
    cd /root
    git clone "$REPO_URL"
    cd "$APP_DIR"
fi

#######################################
# Step 5: Create Environment Files
#######################################
echo ""
echo -e "${GREEN}[5/8] Creating environment files...${NC}"

cat > .env << EOF
# W&B Weave
WANDB_API_KEY=$WANDB_API_KEY
WEAVE_PROJECT=$WEAVE_PROJECT

# LLM Provider
LLM_PROVIDER=google
LLM_MODEL=gemini-2.0-flash
GOOGLE_API_KEY=$GOOGLE_API_KEY

# Browserbase
BROWSERBASE_API_KEY=$BROWSERBASE_API_KEY
BROWSERBASE_PROJECT_ID=$BROWSERBASE_PROJECT_ID

# Redis
REDIS_URL=$REDIS_URL
REDIS_PASSWORD=$REDIS_PASSWORD
REDIS_PREFIX=loopless
REDIS_TTL_SECONDS=604800

# App
APP_ENV=production
SERVER_PORT=3001
WEB_BASE_URL=http://$DROPLET_IP:3000
EOF

cat > apps/web/.env.local << EOF
NEXT_PUBLIC_API_URL=http://$DROPLET_IP:3001
EOF

echo "Environment files created"

#######################################
# Step 6: Install & Build
#######################################
echo ""
echo -e "${GREEN}[6/8] Installing dependencies and building...${NC}"
pnpm install
pnpm --filter @loopless/shared build
pnpm --filter server build
pnpm --filter web build

#######################################
# Step 7: Configure Firewall
#######################################
echo ""
echo -e "${GREEN}[7/8] Configuring firewall...${NC}"
ufw allow 22
ufw allow 3000
ufw allow 3001
echo "y" | ufw enable

#######################################
# Step 8: Start with PM2
#######################################
echo ""
echo -e "${GREEN}[8/8] Starting services with PM2...${NC}"
pm2 delete all 2>/dev/null || true
pm2 start "node apps/server/dist/index.js" --name loopless-server --cwd "$APP_DIR"
pm2 start "npx next start -p 3000" --name loopless-web --cwd "$APP_DIR/apps/web"
pm2 save
pm2 startup

#######################################
# Done!
#######################################
echo ""
echo "============================================"
echo -e "${GREEN}   Deployment Complete!${NC}"
echo "============================================"
echo ""
echo -e "UI:     ${GREEN}http://$DROPLET_IP:3000${NC}"
echo -e "API:    ${GREEN}http://$DROPLET_IP:3001${NC}"
echo ""
echo "Useful commands:"
echo "  pm2 status     - Check app status"
echo "  pm2 logs       - View logs"
echo "  pm2 restart all - Restart apps"
echo ""
echo "============================================"
