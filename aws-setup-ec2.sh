#!/usr/bin/env bash
# ==============================================================================
# EventHub KCT - AWS EC2 Automated Setup Script (Ubuntu 22.04 / 24.04 LTS)
# Run with: bash aws-setup-ec2.sh
# ==============================================================================

set -e
echo "🚀 [1/5] Updating packages..."
sudo apt update && sudo apt upgrade -y

echo "📦 [2/5] Installing Node.js 20 LTS & Git..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git build-essential

echo "⚙️ [3/5] Installing PM2 process manager..."
sudo npm install -g pm2

echo "📥 [4/5] Installing project dependencies..."
npm install

echo "🛡️ [5/5] Starting EventHub with PM2..."
pm2 start backend/server.js --name "eventhub"
pm2 save
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $USER --hp $HOME

echo "=================================================================="
echo "✅ EventHub is now running 24/7 on AWS EC2!"
echo "🌐 Access via: http://<YOUR_EC2_PUBLIC_IP>:5000"
echo "=================================================================="
