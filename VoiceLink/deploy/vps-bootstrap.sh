#!/usr/bin/env bash
# One-time setup on a fresh VPS-1 (Ubuntu 24.04, DigitalOcean droplet).
# Idempotent: safe to re-run.
#
# Run as root:
#   bash /root/vps-bootstrap.sh

set -euo pipefail

OPS_USER="voiceplatform"
APP_DIR="/opt/voiceplatform"

# --- packages ---
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y \
  curl ca-certificates gnupg git \
  ufw fail2ban unattended-upgrades

# --- ops user (idempotent) ---
if ! id "$OPS_USER" &>/dev/null; then
  adduser --disabled-password --gecos "" "$OPS_USER"
  usermod -aG sudo "$OPS_USER"
  echo "$OPS_USER ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/90-$OPS_USER"
  chmod 440 "/etc/sudoers.d/90-$OPS_USER"
fi

# Copy root's authorized_keys so SSH works as the ops user too
install -d -m 700 -o "$OPS_USER" -g "$OPS_USER" "/home/$OPS_USER/.ssh"
if [ -f /root/.ssh/authorized_keys ]; then
  install -m 600 -o "$OPS_USER" -g "$OPS_USER" \
    /root/.ssh/authorized_keys "/home/$OPS_USER/.ssh/authorized_keys"
fi

# --- Docker ---
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
usermod -aG docker "$OPS_USER"
systemctl enable --now docker

# --- Firewall: only 22, 80, 443 inbound ---
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# --- fail2ban with default sshd jail ---
systemctl enable --now fail2ban

# --- unattended-upgrades for security patches ---
dpkg-reconfigure -fnoninteractive unattended-upgrades || true
systemctl enable --now unattended-upgrades

# --- 2 GB swap on a 4 GB droplet smooths builds ---
if ! swapon --show | grep -q '/swapfile'; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# --- App directory tree ---
mkdir -p "$APP_DIR"/{config,data,logs}
chown -R "$OPS_USER:$OPS_USER" "$APP_DIR"

# --- Done ---
echo
echo "==========================================="
echo "VPS bootstrap complete."
echo "  ops user: $OPS_USER   (SSH with the same key as root)"
echo "  app dir : $APP_DIR"
echo "  docker  : $(docker --version)"
echo
echo "Next: scp deploy/Caddyfile deploy/docker-compose.prod.yml $OPS_USER@<IP>:$APP_DIR/"
echo "      then drop .env.api / .env.ui / .env.engine into $APP_DIR/"
echo "==========================================="
