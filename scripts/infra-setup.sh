#!/usr/bin/env bash
# Idempotent AWS infrastructure setup for NetFirst demo
# Creates: ECR repos, EFS, ECS cluster, IAM role, security groups, ALB, CloudFront
set -euo pipefail

PROFILE="sai-nivedh-26"
REGION="us-east-1"
ACCOUNT="767397931665"
VPC="vpc-0961515e52cd3279d"
SUBNETS="subnet-02b74011224b9069c subnet-00b626fdd7ddcb9ae subnet-09cb42989f599dab7"
SUBNETS_CSV="subnet-02b74011224b9069c,subnet-00b626fdd7ddcb9ae,subnet-09cb42989f599dab7"

aws_cmd() { aws "$@" --region "$REGION" --profile "$PROFILE"; }

echo "=== NetFirst Demo Infrastructure Setup ==="

# 1. ECR Repositories
for repo in netfirst-backend netfirst-web netfirst-aggrid; do
  if ! aws_cmd ecr describe-repositories --repository-names "$repo" &>/dev/null; then
    echo "Creating ECR repo: $repo"
    aws_cmd ecr create-repository --repository-name "$repo" --image-scanning-configuration scanOnPush=true > /dev/null
  else
    echo "ECR repo exists: $repo"
  fi
done

# 2. EFS file system
EFS_ID=$(aws_cmd efs describe-file-systems --query "FileSystems[?Tags[?Key=='Name'&&Value=='netfirst-efs']].FileSystemId" --output text 2>/dev/null | tr -d '[:space:]')
if [ -z "$EFS_ID" ]; then
  echo "Creating EFS file system..."
  EFS_ID=$(aws_cmd efs create-file-system \
    --performance-mode generalPurpose \
    --tags Key=Name,Value=netfirst-efs \
    --query 'FileSystemId' --output text)
  echo "EFS created: $EFS_ID"
  sleep 5
else
  echo "EFS exists: $EFS_ID"
fi

# ECS Security Group
ECS_SG=$(aws_cmd ec2 describe-security-groups \
  --filters "Name=group-name,Values=netfirst-ecs-sg" "Name=vpc-id,Values=$VPC" \
  --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null | grep -v None || echo "")
if [ -z "$ECS_SG" ] || [ "$ECS_SG" = "None" ]; then
  echo "Creating ECS security group..."
  ECS_SG=$(aws_cmd ec2 create-security-group \
    --group-name netfirst-ecs-sg \
    --description "NetFirst ECS tasks" \
    --vpc-id "$VPC" \
    --query 'GroupId' --output text)
  echo "ECS SG: $ECS_SG"
fi

# ALB Security Group
ALB_SG=$(aws_cmd ec2 describe-security-groups \
  --filters "Name=group-name,Values=netfirst-alb-sg" "Name=vpc-id,Values=$VPC" \
  --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null | grep -v None || echo "")
if [ -z "$ALB_SG" ] || [ "$ALB_SG" = "None" ]; then
  echo "Creating ALB security group..."
  ALB_SG=$(aws_cmd ec2 create-security-group \
    --group-name netfirst-alb-sg \
    --description "NetFirst ALB" \
    --vpc-id "$VPC" \
    --query 'GroupId' --output text)
  # Allow inbound 80/443 from anywhere
  aws_cmd ec2 authorize-security-group-ingress --group-id "$ALB_SG" --protocol tcp --port 80 --cidr 0.0.0.0/0 > /dev/null || true
  aws_cmd ec2 authorize-security-group-ingress --group-id "$ALB_SG" --protocol tcp --port 443 --cidr 0.0.0.0/0 > /dev/null || true
  echo "ALB SG: $ALB_SG"
fi

# Allow ECS SG to receive from ALB SG on ports 8000, 3000, 3001
for PORT in 8000 3000 3001; do
  aws_cmd ec2 authorize-security-group-ingress \
    --group-id "$ECS_SG" --protocol tcp --port "$PORT" \
    --source-group "$ALB_SG" > /dev/null 2>&1 || true
done
# Allow EFS from ECS
aws_cmd ec2 authorize-security-group-ingress \
  --group-id "$ECS_SG" --protocol tcp --port 2049 \
  --source-group "$ECS_SG" > /dev/null 2>&1 || true

# EFS mount targets
for SUBNET in $SUBNETS; do
  if ! aws_cmd efs describe-mount-targets --file-system-id "$EFS_ID" --query "MountTargets[?SubnetId=='$SUBNET'].MountTargetId" --output text | grep -q mt-; then
    echo "Creating EFS mount target in $SUBNET..."
    aws_cmd efs create-mount-target \
      --file-system-id "$EFS_ID" \
      --subnet-id "$SUBNET" \
      --security-groups "$ECS_SG" > /dev/null || true
  fi
done

# 3. ECS Cluster
if ! aws_cmd ecs describe-clusters --clusters netfirst-demo --query 'clusters[0].status' --output text 2>/dev/null | grep -q ACTIVE; then
  echo "Creating ECS cluster: netfirst-demo"
  aws_cmd ecs create-cluster --cluster-name netfirst-demo > /dev/null
else
  echo "ECS cluster exists: netfirst-demo"
fi

# 4. IAM Role
ROLE_ARN="arn:aws:iam::${ACCOUNT}:role/netfirst-ecs-task-role"
if ! aws iam get-role --role-name netfirst-ecs-task-role --profile "$PROFILE" &>/dev/null; then
  echo "Creating IAM role: netfirst-ecs-task-role"
  aws iam create-role --role-name netfirst-ecs-task-role --profile "$PROFILE" \
    --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole"}]}' > /dev/null
  aws iam attach-role-policy --role-name netfirst-ecs-task-role --profile "$PROFILE" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy > /dev/null
  aws iam put-role-policy --role-name netfirst-ecs-task-role --profile "$PROFILE" \
    --policy-name netfirst-secrets \
    --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"secretsmanager:GetSecretValue\"],\"Resource\":\"arn:aws:secretsmanager:${REGION}:${ACCOUNT}:secret:netfirst/*\"}]}" > /dev/null
  echo "IAM role created: $ROLE_ARN"
else
  echo "IAM role exists: netfirst-ecs-task-role"
fi

# 5. ALB
ALB_ARN=$(aws_cmd elbv2 describe-load-balancers --names netfirst-alb \
  --query 'LoadBalancers[0].LoadBalancerArn' --output text 2>/dev/null | grep -v None || echo "")
if [ -z "$ALB_ARN" ] || [ "$ALB_ARN" = "None" ]; then
  echo "Creating ALB: netfirst-alb..."
  ALB_ARN=$(aws_cmd elbv2 create-load-balancer \
    --name netfirst-alb \
    --subnets $SUBNETS \
    --security-groups "$ALB_SG" \
    --scheme internet-facing \
    --type application \
    --query 'LoadBalancers[0].LoadBalancerArn' --output text)
  echo "ALB created: $ALB_ARN"
else
  echo "ALB exists: $ALB_ARN"
fi

ALB_DNS=$(aws_cmd elbv2 describe-load-balancers --load-balancer-arns "$ALB_ARN" \
  --query 'LoadBalancers[0].DNSName' --output text)
echo "ALB DNS: $ALB_DNS"

# Target groups
get_or_create_tg() {
  local name=$1; local port=$2; local hc=$3
  local arn
  arn=$(aws_cmd elbv2 describe-target-groups --names "$name" \
    --query 'TargetGroups[0].TargetGroupArn' --output text 2>/dev/null | grep -v None || echo "")
  if [ -z "$arn" ] || [ "$arn" = "None" ]; then
    echo "Creating target group: $name" >&2
    arn=$(aws_cmd elbv2 create-target-group \
      --name "$name" --protocol HTTP --port "$port" \
      --vpc-id "$VPC" --target-type ip \
      --health-check-path "$hc" \
      --health-check-interval-seconds 30 \
      --healthy-threshold-count 2 \
      --unhealthy-threshold-count 3 \
      --query 'TargetGroups[0].TargetGroupArn' --output text)
    echo "  Created: $arn" >&2
  else
    echo "Target group exists: $name" >&2
  fi
  echo "$arn"
}

BACKEND_TG=$(get_or_create_tg netfirst-backend-tg 8000 /api/summary)
WEB_TG=$(get_or_create_tg netfirst-web-tg 3000 /)
AGGRID_TG=$(get_or_create_tg netfirst-aggrid-tg 3001 /analytics)

# Listener + rules
LISTENER_ARN=$(aws_cmd elbv2 describe-listeners --load-balancer-arn "$ALB_ARN" \
  --query 'Listeners[?Port==`80`].ListenerArn' --output text 2>/dev/null | grep -v None || echo "")
if [ -z "$LISTENER_ARN" ] || [ "$LISTENER_ARN" = "None" ]; then
  echo "Creating ALB listener..."
  LISTENER_ARN=$(aws_cmd elbv2 create-listener \
    --load-balancer-arn "$ALB_ARN" \
    --protocol HTTP --port 80 \
    --default-actions Type=forward,TargetGroupArn="$WEB_TG" \
    --query 'Listeners[0].ListenerArn' --output text)
  # Rules
  aws_cmd elbv2 create-rule --listener-arn "$LISTENER_ARN" --priority 10 \
    --conditions '[{"Field":"path-pattern","Values":["/api/*"]}]' \
    --actions "[{\"Type\":\"forward\",\"TargetGroupArn\":\"$BACKEND_TG\"}]" > /dev/null
  aws_cmd elbv2 create-rule --listener-arn "$LISTENER_ARN" --priority 20 \
    --conditions '[{"Field":"path-pattern","Values":["/analytics*"]}]' \
    --actions "[{\"Type\":\"forward\",\"TargetGroupArn\":\"$AGGRID_TG\"}]" > /dev/null
  echo "ALB listener + rules created"
else
  echo "ALB listener exists"
fi

# 6. CloudFront distribution
CF_ID=$(aws_cmd cloudfront list-distributions \
  --query "DistributionList.Items[?Comment=='netfirst-demo'].Id" --output text 2>/dev/null | tr -d '[:space:]')
if [ -z "$CF_ID" ]; then
  echo "Creating CloudFront distribution..."
  CF_ID=$(aws_cmd cloudfront create-distribution --distribution-config "{
    \"CallerReference\": \"netfirst-demo-$(date +%s)\",
    \"Comment\": \"netfirst-demo\",
    \"Origins\": {\"Quantity\": 1, \"Items\": [{
      \"Id\": \"alb-origin\",
      \"DomainName\": \"$ALB_DNS\",
      \"CustomOriginConfig\": {\"HTTPPort\": 80, \"HTTPSPort\": 443, \"OriginProtocolPolicy\": \"http-only\"}
    }]},
    \"DefaultCacheBehavior\": {
      \"TargetOriginId\": \"alb-origin\",
      \"ViewerProtocolPolicy\": \"redirect-to-https\",
      \"CachePolicyId\": \"4135ea2d-6df8-44a3-9df3-4b5a84be39ad\",
      \"AllowedMethods\": {\"Quantity\": 7, \"Items\": [\"GET\",\"HEAD\",\"OPTIONS\",\"PUT\",\"PATCH\",\"POST\",\"DELETE\"], \"CachedMethods\": {\"Quantity\": 2, \"Items\": [\"GET\",\"HEAD\"]}},
      \"ForwardedValues\": {\"QueryString\": true, \"Cookies\": {\"Forward\": \"all\"}, \"Headers\": {\"Quantity\": 0}}
    },
    \"Enabled\": true,
    \"PriceClass\": \"PriceClass_100\"
  }" --query 'Distribution.Id' --output text 2>/dev/null || echo "")

  if [ -n "$CF_ID" ]; then
    CF_DOMAIN=$(aws_cmd cloudfront get-distribution --id "$CF_ID" --query 'Distribution.DomainName' --output text)
    echo "CloudFront created: https://$CF_DOMAIN"
  else
    echo "CloudFront creation may have failed - check console"
  fi
else
  CF_DOMAIN=$(aws_cmd cloudfront get-distribution --id "$CF_ID" --query 'Distribution.DomainName' --output text)
  echo "CloudFront exists: https://$CF_DOMAIN"
fi

# Save outputs
cat > /home/sai-nivedh-26/paypal/scripts/.infra-outputs <<EOF
ALB_ARN=$ALB_ARN
ALB_DNS=$ALB_DNS
BACKEND_TG=$BACKEND_TG
WEB_TG=$WEB_TG
AGGRID_TG=$AGGRID_TG
EFS_ID=$EFS_ID
ECS_SG=$ECS_SG
ROLE_ARN=$ROLE_ARN
EOF

echo ""
echo "=== Infrastructure ready ==="
echo "ALB DNS: $ALB_DNS"
echo "EFS ID:  $EFS_ID"
echo "Outputs saved to scripts/.infra-outputs"
