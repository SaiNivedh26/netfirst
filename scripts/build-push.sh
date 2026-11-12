#!/usr/bin/env bash
# Build all 3 Docker images and push to ECR
set -euo pipefail

PROFILE="sai-nivedh-26"
REGION="us-east-1"
ACCOUNT="767397931665"
ROOT="/home/sai-nivedh-26/paypal"

# Load infra outputs if available
if [ -f "$ROOT/scripts/.infra-outputs" ]; then
  source "$ROOT/scripts/.infra-outputs"
fi

ALB_DNS="${ALB_DNS:-}"
ECR="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"

echo "Logging in to ECR..."
aws ecr get-login-password --region "$REGION" --profile "$PROFILE" | \
  docker login --username AWS --password-stdin "$ECR"

build_push() {
  local service=$1
  local context=$2
  local image="$ECR/$service:latest"
  shift 2
  echo ""
  echo "=== Building $service ==="
  docker build -t "$image" "$@" "$context"
  echo "Pushing $service..."
  docker push "$image"
  echo "Done: $image"
}

build_push netfirst-backend "$ROOT/netfirst/api"
build_push netfirst-web "$ROOT/netfirst/web" --build-arg NEXT_PUBLIC_API_URL=""
build_push netfirst-aggrid "$ROOT/hackathon-paypal-ag-grid-boilerplate" \
  --build-arg NETFIRST_API_URL="http://${ALB_DNS:-localhost:8000}"

echo ""
echo "=== All images pushed to ECR ==="
