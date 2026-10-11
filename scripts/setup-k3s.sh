#!/bin/bash
# One-time setup of k3s on the EC2 host for CuBot ROS sandboxes.
#
#   sudo ./scripts/setup-k3s.sh
#
# Installs a single-node k3s cluster, applies k8s/sandboxes.yaml, and writes a
# kubeconfig for the backend container to /opt/cubot/kube/config. That kubeconfig
# uses the namespace-scoped `cubot-backend` service account, not cluster admin.
#
# Keep port 6443 closed in the EC2 security group: the backend reaches the API
# server through the Docker host gateway, never over the public network.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KUBE_DIR=/opt/cubot/kube
NAMESPACE=cubot-sandboxes
# Name the backend container uses for the host (see extra_hosts in docker-compose.yml)
API_HOST=host.docker.internal

# Waits for a condition, giving up after a limit so a struggling k3s fails the
# deploy with a clear message instead of hanging it.
#   wait_for <seconds> <description> <command...>
wait_for() {
  local limit=$1 what=$2
  shift 2
  local start=$SECONDS
  until "$@"; do
    if (( SECONDS - start >= limit )); then
      echo "Timed out after ${limit}s waiting for ${what}." >&2
      systemctl status k3s --no-pager 2> /dev/null | head -15 >&2 || true
      exit 1
    fi
    sleep 2
  done
}

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root (sudo)." >&2
  exit 1
fi

# ── Install k3s ─────────────────────────────────────────────
# Traefik and ServiceLB are disabled: nginx in docker compose already owns 80/443.
if ! command -v k3s > /dev/null 2>&1; then
  echo "Installing k3s..."
  curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="server \
    --disable traefik \
    --disable servicelb \
    --tls-san ${API_HOST} \
    --write-kubeconfig-mode 600" sh -
else
  echo "k3s already installed, skipping."
fi

export KUBECONFIG=/etc/rancher/k3s/k3s.yaml

node_ready() { k3s kubectl get nodes 2> /dev/null | grep -q " Ready"; }
echo "Waiting for node to be ready..."
wait_for 180 "the k3s node to be Ready" node_ready

# ── Sandbox namespace, RBAC, network policy ─────────────────
k3s kubectl apply -f "${REPO_DIR}/k8s/sandboxes.yaml"

token_ready() {
  [ -n "$(k3s kubectl -n ${NAMESPACE} get secret cubot-backend-token -o jsonpath='{.data.token}' 2> /dev/null)" ]
}
echo "Waiting for service account token..."
wait_for 60 "the cubot-backend service account token" token_ready

TOKEN=$(k3s kubectl -n ${NAMESPACE} get secret cubot-backend-token -o jsonpath='{.data.token}' | base64 -d)
CA_DATA=$(k3s kubectl -n ${NAMESPACE} get secret cubot-backend-token -o jsonpath='{.data.ca\.crt}')

# ── Kubeconfig for the backend container ────────────────────
mkdir -p "${KUBE_DIR}"
cat > "${KUBE_DIR}/config" << EOF
apiVersion: v1
kind: Config
clusters:
  - name: cubot-k3s
    cluster:
      server: https://${API_HOST}:6443
      certificate-authority-data: ${CA_DATA}
users:
  - name: cubot-backend
    user:
      token: ${TOKEN}
contexts:
  - name: cubot
    context:
      cluster: cubot-k3s
      user: cubot-backend
      namespace: ${NAMESPACE}
current-context: cubot
EOF

# Backend container runs as appuser (uid 1000)
chown -R 1000:1000 "${KUBE_DIR}"
chmod 600 "${KUBE_DIR}/config"

# ── Pre-pull the sandbox image so the first ROS project starts fast ──
# Skipped when already present; capped so a slow registry never stalls a deploy.
SANDBOX_IMAGE=docker.io/library/ros:humble-ros-base
if k3s ctr images ls -q 2> /dev/null | grep -qx "${SANDBOX_IMAGE}"; then
  echo "Sandbox image already present, skipping pull."
else
  timeout 300 k3s ctr images pull "${SANDBOX_IMAGE}" || echo "Sandbox image pull skipped or timed out; it will be pulled on first use." >&2
fi

echo ""
echo "k3s ready. Backend kubeconfig written to ${KUBE_DIR}/config"
