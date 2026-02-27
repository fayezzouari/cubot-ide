#!/usr/bin/env bash
# Manual deploy / rollback helper — run directly on EC2
# Usage:
#   ./scripts/deploy.sh                    # deploy latest
#   IMAGE_TAG=abc1234 ./scripts/deploy.sh  # deploy specific tag
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/home/ubuntu/cubot-ide}"
cd "$DEPLOY_DIR"

if [[ ! -f .env ]]; then
  echo "ERROR: .env not found in $DEPLOY_DIR — run the CD pipeline first or populate it manually." >&2
  exit 1
fi

# shellcheck disable=SC1091
source .env

ECR_REGISTRY="${ECR_REGISTRY:?ECR_REGISTRY must be set in .env}"
AWS_REGION="${AWS_REGION:?AWS_REGION must be set in .env}"

echo "==> Logging in to ECR..."
aws ecr get-login-password --region "$AWS_REGION" | \
  docker login --username AWS --password-stdin "$ECR_REGISTRY"

echo "==> Pulling latest images (IMAGE_TAG=${IMAGE_TAG:-latest})..."
docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  pull

echo "==> Starting services..."
docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  up -d --remove-orphans

echo "==> Pruning old images..."
docker system prune -f --filter "until=24h"

echo "==> Deploy complete: $(date) — ${IMAGE_TAG:-latest}"
docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  ps
