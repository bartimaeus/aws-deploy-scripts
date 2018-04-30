#!/bin/bash

# Setup default values for variables
VERSION="1.0.0"
NOTIFY="/bin/bash ./node_modules/aws-deploy-scripts/lib/slack-notify.sh"

AWS_ACCOUNT_ID=""
AWS_PROFILE=""
DEPLOY_PATH=""
DISTRIBUTION_ID=""
S3_BUCKET=""
SLACK_WEBHOOK_URL=""

function usage() {
  USAGE=$(cat <<EOM
##### deploy #####

A simple script for deploying a static website to S3 and CloudFront.

Required arguments:
    -a | --account-id       AWS account id
    -b | --bucket           Name of the S3 bucket
    -i | --profile          AWS profile name found in your local ~/.aws/credentials
    -p | --path             Path of the assets to sync with S3
                              * 'public' for gastby apps
                              * 'build' fore react-create-app

Optional arguments:
    -d | --distribution-id  CloudFront distribution id used to create invalidation
    -s | --slack-webhook-url  Environment variable name for the Slack webhook URL

Example:

    deploy --account-id 14234234 --bucket example.com --distribution-id E245GA45256 --profile myproject --path public --slack-webhook PROJECT_NAME_SLACK_WEBHOOK_URL

EOM
)
  printf "\033[90m${USAGE}\033[0m\n"
  exit 3
}

function validateCredentials() {
  CURRENT_ACCOUNT_ID=$(aws sts get-caller-identity | jq -r .Account)

  if [[ $CURRENT_ACCOUNT_ID != $AWS_ACCOUNT_ID ]]; then
    printf "\n\033[91mUh oh! Your AWS credentials are invalid! Please switch credentials and try again.\033[0m\n\n"
    exit 0
  fi
}

# PROFILE is not required since we are already checking the AWS account id, but I'm
# adding it to be sure since I have accidentally deploying using the wrong profile!
function deploy() {
  # Sync all files in $DEPLOY_PATH and delete those on s3 that are not in the $DEPLOY_PATH
  aws s3 sync $DEPLOY_PATH s3://$S3_BUCKET --cache-control max-age=31536000,public --profile $AWS_PROFILE

  # Update cache for react-create-app's service-worker.js
  aws s3 cp s3://$S3_BUCKET/service-worker.js s3://$S3_BUCKET/service-worker.js --metadata-directive REPLACE --cache-control max-age=0,no-cache,no-store,must-revalidate --content-type application/javascript --acl public-read --profile $AWS_PROFILE

  # Update cache for index.html
  aws s3 cp s3://$S3_BUCKET/index.html s3://$S3_BUCKET/index.html --metadata-directive REPLACE --cache-control max-age=0,no-cache,no-store,must-revalidate --content-type text/html --acl public-read --profile $AWS_PROFILE

  # Create invalidation for cloudfront distribution
  if [[ $DISTRIBUTION_ID != "" ]]; then
    aws cloudfront create-invalidation --distribution-id $DISTRIBUTION_ID --paths '/*'
  fi
}

function beginDeployment() {
  printf "\n\033[93mStarting $S3_BUCKET deployment...\033[0m\n\n"

  if [[ $SLACK_WEBHOOK_URL != "" ]]; then
    $NOTIFY $SLACK_WEBHOOK_URL "#general" "Deployment Webhook" "Starting $S3_BUCKET deployment..." "#439FE0" >> /dev/null
  fi
}

function deploymentComplete() {
  printf "\033[92m$S3_BUCKET deployment complete!\033[0m\n\n"

  if [[ $SLACK_WEBHOOK_URL != "" ]]; then
    $NOTIFY $SLACK_WEBHOOK_URL "#general" "Deployment Webhook" "$S3_BUCKET deployment complete!" "good" >> /dev/null
  fi
}

function deploymentError() {
  printf "\033[91m$S3_BUCKET deployment failure!\033[0m\n\n"

  if [[ $SLACK_WEBHOOK_URL != "" ]]; then
    $NOTIFY $SLACK_WEBHOOK_URL "#general" "Deployment Webhook" "$S3_BUCKET deployment failure!" "#e32072" >> /dev/null
  fi

  exit 1
}

set -o errexit
set -o pipefail
set -u
# Don't exit the script. We want to send a message in Slack instead
# set -e

if [ $# == 0 ]; then usage; fi

# Loop through arguments, two at a time for key and value
while [[ $# -gt 0 ]]
do
  key="$1"

  case $key in
    -a|--account-id)
      AWS_ACCOUNT_ID="$2"
      shift
      ;;
    -b|--bucket)
      S3_BUCKET="$2"
      shift
      ;;
    -d|--distribution-id)
      DISTRIBUTION_ID="$2"
      shift
      ;;
    -i|--profile)
      AWS_PROFILE="$2"
      shift
      ;;
    -p|--path)
      DEPLOY_PATH="$2"
      shift
      ;;
    -s|--slack-webhook-url)
      if [[ $2 != "" ]]; then
        SLACK_WEBHOOK_URL=$(eval echo "\$$2")
      fi
      shift
      ;;
    *)
      usage
      exit 2
    ;;
  esac
  shift
done

# Verify required parameters are present
if [[ $AWS_ACCOUNT_ID == "" ]]; then
  printf "\033[91mERROR: Failed to supply AWS account id (-a | --account-id [aws_account_id])\033[0m\n\n"
  exit 1
fi

if [[ $S3_BUCKET == "" ]]; then
  printf "\033[91mERROR: Failed to supply S3 bucket name (-b | --bucket [bucket_name])\033[0m\n\n"
  exit 1
fi

if [[ $AWS_PROFILE == "" ]]; then
  printf "\033[91mERROR: Failed to supply AWS profile (-i | --profile [profile_name])\033[0m\n\n"
  exit 1
fi

if [[ $DEPLOY_PATH == "" ]]; then
  printf "\033[91mERROR: Failed to supply deployment path (-p | --path [path_to_static_site_build_directory])\033[0m\n\n"
  exit 1
fi

# Validate current AWS CLI profile with supplied ACCOUNT_ID
validateCredentials

# Deploy!
beginDeployment
deploy || deploymentError
deploymentComplete

exit 0
