#!/usr/bin/env bash
# Register ECS task definition and force new deployment
set -euo pipefail

PROFILE="sai-nivedh-26"
REGION="us-east-1"
ACCOUNT="767397931665"
ROOT="/home/sai-nivedh-26/paypal"

source "$ROOT/scripts/.infra-outputs"

aws_cmd() { aws "$@" --region "$REGION" --profile "$PROFILE"; }

ECR="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"
LOG_GROUP="/ecs/netfirst"

# Ensure CloudWatch log group exists
aws_cmd logs create-log-group --log-group-name "$LOG_GROUP" 2>/dev/null || true

# Retrieve secrets ARNs
API_SECRET_ARN=$(aws_cmd secretsmanager describe-secret --secret-id netfirst/api \
  --query 'ARN' --output text)
AGGRID_SECRET_ARN=$(aws_cmd secretsmanager describe-secret --secret-id netfirst/aggrid \
  --query 'ARN' --output text)

# Get env key names from each secret
get_secret_keys() {
  local arn=$1
  aws_cmd secretsmanager get-secret-value --secret-id "$arn" \
    --query 'SecretString' --output text | python3 -c "import json,sys; d=json.load(sys.stdin); print('\n'.join(d.keys()))"
}

# Build secrets injection JSON for backend
build_secrets_json() {
  local arn=$1
  python3 -c "
import json, subprocess, sys
result = subprocess.run(
    ['aws', 'secretsmanager', 'get-secret-value', '--secret-id', '$arn',
     '--query', 'SecretString', '--output', 'text', '--region', '$REGION', '--profile', '$PROFILE'],
    capture_output=True, text=True, check=True
)
keys = list(json.loads(result.stdout).keys())
entries = [{'name': k, 'valueFrom': f'$arn:{k}::'} for k in keys]
print(json.dumps(entries))
"
}

echo "Building secrets JSON..."
BACKEND_SECRETS=$(build_secrets_json "$API_SECRET_ARN")
AGGRID_SECRETS=$(build_secrets_json "$AGGRID_SECRET_ARN")

# Task definition
TASK_DEF=$(python3 -c "
import json
backend_secrets = $BACKEND_SECRETS
aggrid_secrets = $AGGRID_SECRETS

# Remove DEMO_MODE from secrets if present (it's set as a plain env var below)
backend_secrets = [s for s in backend_secrets if s['name'] not in ('DEMO_MODE', 'DATABASE_URL')]

task = {
    'family': 'netfirst-demo',
    'networkMode': 'awsvpc',
    'requiresCompatibilities': ['FARGATE'],
    'cpu': '2048',
    'memory': '4096',
    'executionRoleArn': '$ROLE_ARN',
    'taskRoleArn': '$ROLE_ARN',
    'volumes': [{
        'name': 'efs-data',
        'efsVolumeConfiguration': {
            'fileSystemId': '$EFS_ID',
            'transitEncryption': 'ENABLED'
        }
    }],
    'containerDefinitions': [
        {
            'name': 'backend',
            'image': '$ECR/netfirst-backend:latest',
            'portMappings': [{'containerPort': 8000, 'protocol': 'tcp'}],
            'environment': [{'name': 'DEMO_MODE', 'value': '1'}, {'name': 'DATABASE_URL', 'value': 'sqlite:////data/netfirst.db'}],
            'secrets': backend_secrets,
            'mountPoints': [{'sourceVolume': 'efs-data', 'containerPath': '/data', 'readOnly': False}],
            'logConfiguration': {
                'logDriver': 'awslogs',
                'options': {
                    'awslogs-group': '/ecs/netfirst',
                    'awslogs-region': '$REGION',
                    'awslogs-stream-prefix': 'backend'
                }
            },
            'healthCheck': {
                'command': ['CMD-SHELL', 'curl -f http://localhost:8000/api/summary || exit 1'],
                'interval': 30, 'timeout': 5, 'retries': 3
            }
        },
        {
            'name': 'web',
            'image': '$ECR/netfirst-web:latest',
            'portMappings': [{'containerPort': 3000, 'protocol': 'tcp'}],
            'environment': [{'name': 'PORT', 'value': '3000'}],
            'logConfiguration': {
                'logDriver': 'awslogs',
                'options': {
                    'awslogs-group': '/ecs/netfirst',
                    'awslogs-region': '$REGION',
                    'awslogs-stream-prefix': 'web'
                }
            }
        },
        {
            'name': 'aggrid',
            'image': '$ECR/netfirst-aggrid:latest',
            'portMappings': [{'containerPort': 3001, 'protocol': 'tcp'}],
            'environment': [{'name': 'PORT', 'value': '3001'}],
            'secrets': aggrid_secrets,
            'logConfiguration': {
                'logDriver': 'awslogs',
                'options': {
                    'awslogs-group': '/ecs/netfirst',
                    'awslogs-region': '$REGION',
                    'awslogs-stream-prefix': 'aggrid'
                }
            }
        }
    ]
}
print(json.dumps(task, indent=2))
")

TMP=$(mktemp /tmp/task-def-XXXXXX.json)
echo "$TASK_DEF" > "$TMP"

echo "Registering task definition..."
TASK_DEF_ARN=$(aws_cmd ecs register-task-definition \
  --cli-input-json "file://$TMP" \
  --query 'taskDefinition.taskDefinitionArn' --output text)
rm -f "$TMP"
echo "Task definition: $TASK_DEF_ARN"

# ECS Service
SERVICE_EXISTS=$(aws_cmd ecs describe-services --cluster netfirst-demo --services netfirst-demo \
  --query 'services[0].status' --output text 2>/dev/null | grep -v INACTIVE || echo "")

if [ -z "$SERVICE_EXISTS" ]; then
  echo "Creating ECS service..."
  aws_cmd ecs create-service \
    --cluster netfirst-demo \
    --service-name netfirst-demo \
    --task-definition netfirst-demo \
    --desired-count 1 \
    --launch-type FARGATE \
    --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS_CSV],securityGroups=[$ECS_SG],assignPublicIp=ENABLED}" \
    --load-balancers \
      "targetGroupArn=$BACKEND_TG,containerName=backend,containerPort=8000" \
      "targetGroupArn=$WEB_TG,containerName=web,containerPort=3000" \
      "targetGroupArn=$AGGRID_TG,containerName=aggrid,containerPort=3001" \
    > /dev/null
  echo "ECS service created"
else
  echo "Updating ECS service..."
  aws_cmd ecs update-service \
    --cluster netfirst-demo \
    --service netfirst-demo \
    --task-definition "$TASK_DEF_ARN" \
    --force-new-deployment > /dev/null
  echo "Deployment triggered"
fi

echo ""
echo "=== Deployment complete ==="
echo "Monitor: aws ecs describe-services --cluster netfirst-demo --services netfirst-demo --region $REGION --profile $PROFILE"
