#!/bin/bash

# Setup default values for variables
VERSION="1.0.0"
AWS_ACCOUNT_ID=""
CLUSTER="Staging"
DOCKER_IMAGE=""
ECS_SERVICE_NAME=""
ENVIRONMENT="staging"
SERVICE=""
MIGRATE=true
DEPLOY="/bin/bash ./node_modules/aws-deploy-scripts/ecs/ecs-deploy.sh"
NOTIFY="/bin/bash ./node_modules/aws-deploy-scripts/lib/slack-notify.sh"

function usage() {
  USAGE=$(cat <<EOM
##### deploy #####

A simple script for triggering blue/green deployments on Amazon Elastic Container Service. You will need
your Slack webhook_url environment variable (SLACK_WEBHOOK_URL) set to send notifications to Slack.
This script calls ecs-deploy (https://github.com/silinternational/ecs-deploy).

Required arguments:
    -e | --environment      Name of environment

Optional arguments:
    -s | --service          Name of the service to update; when not passed, all services will be updated
    --skip-migrate          Skip running migrations task before updating ECS services


Examples:

  Simple deployment of a service (Using env vars for AWS settings):

    deploy -e production -s sidekiq

  All options:

    deploy -e production -s api --skip-migrate

EOM
)
  printf "\033[90m${USAGE}\033[0m\n"
  exit 3
}

function setCluster() {
  CLUSTER="$(echo "$ENVIRONMENT" | sed 's/.*/\u&/')"
}

function setDockerImage() {
  DOCKER_IMAGE="$AWS_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/$ENVIRONMENT/rails-api:latest"
}

function updateService() {
  if [[ $ENVIRONMENT == "production" ]]; then
    case $1 in
      api)
        ECS_SERVICE_NAME=Production-ApiService
        ;;
      sidekiq)
        ECS_SERVICE_NAME=Production-SidekiqService
        ;;
    esac
  else
    case $1 in
      api)
        ECS_SERVICE_NAME=Staging-ApiService
        ;;
      sidekiq)
        ECS_SERVICE_NAME=Staging-SidekiqService
        ;;
    esac
  fi
  $DEPLOY -c $CLUSTER -n $ECS_SERVICE_NAME -i $DOCKER_IMAGE --max-definitions 10
}

function beginDeployment() {
  printf "\n\033[93mStarting $CLUSTER deployment...\033[0m\n\n"
  $NOTIFY $SLACK_WEBHOOK_URL "#general" "Deployment Webhook" "Starting $CLUSTER deployment..." "#439FE0" >> /dev/null
}

function migrateDatabase() {
  printf "~> \033[34mRunning $CLUSTER database migrations.\033[0m\n"
  # $NOTIFY $SLACK_WEBHOOK_URL "#general" "Deployment Webhook" "~> Running $CLUSTER database migrations" "#439FE0" >> /dev/null

  printf "   \033[36maws ecs run-task --cluster $CLUSTER --task-definition "$ENVIRONMENT-db-migrate" --count 1\033[0m\n\n"
  # aws ecs run-task --cluster $CLUSTER --task-definition "$ENVIRONMENT-db-migrate" --count 1 >> /dev/null
}

function updateAllServices() {
  printf "~> \033[34mDeploying $CLUSTER all services.\033[0m\n"
  # $NOTIFY $SLACK_WEBHOOK_URL "#general" "Deployment Webhook" "~> Deploying all $CLUSTER services" "#439FE0" >> /dev/null

  updateService api
  updateService sidekiq
}

function updateSidekiqService() {
  printf "~> \033[34mDeploying $CLUSTER sidekiq service.\033[0m\n"
  # $NOTIFY $SLACK_WEBHOOK_URL "#general" "Deployment Webhook" "~> Deploying $CLUSTER sidekiq service" "#439FE0" >> /dev/null
  updateService sidekiq
}

function updateApiService() {
  printf "~> \033[34mDeploying $CLUSTER api service.\033[0m\n"
  # $NOTIFY $SLACK_WEBHOOK_URL "#general" "Deployment Webhook" "~> Deploying $CLUSTER api service" "#439FE0" >> /dev/null
  updateService api
}

function deploymentComplete() {
  printf "\033[92m$CLUSTER deployment complete!\033[0m\n\n"
  $NOTIFY $SLACK_WEBHOOK_URL "#general" "Deployment Webhook" "$CLUSTER deployment complete!" "good" >> /dev/null
}

function deploymentError() {
  printf "\033[91m$CLUSTER deployment failure!\033[0m\n\n"
  $NOTIFY $SLACK_WEBHOOK_URL "#general" "Deployment Webhook" "$CLUSTER deployment failure!" "#e32072" >> /dev/null
  exit 1
}

set -o errexit
set -o pipefail
set -u
# Don't exit the script. We want to send a message in Slack instead
# set -e

# If no args are provided, display usage information
if [ $# == 0 ]; then usage; fi

# Loop through arguments, two at a time for key and value
while [[ $# -gt 0 ]]
do
  key="$1"

  case $key in
    -e|--environment)
      ENVIRONMENT="$2"
      shift
      ;;
    -s|--service)
      SERVICE="$2"
      shift
      ;;
    --skip-migrate)
      MIGRATE=false
      ;;
    *)
      usage
      exit 2
    ;;
  esac
  shift
done

setCluster
setDockerImage
beginDeployment

# run migrations
if [ $MIGRATE == true ]; then
  migrateDatabase || deploymentError
fi

# update service if needed
if [[ $SERVICE == "" ]]; then
  updateAllServices || deploymentError
else
  if [[ $SERVICE == "website" ]]; then
    updateApiService || deploymentError
  fi

  if [[ $SERVICE == "sidekiq" ]]; then
    updateSidekiqService || deploymentError
  fi
fi

deploymentComplete

exit 0
