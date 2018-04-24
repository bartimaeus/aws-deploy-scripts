#!/usr/bin/env bash

# Setup default values for variables
VERSION="3.2.0"
CLUSTER=false
SERVICE=false
TASK_DEFINITION=false
MAX_DEFINITIONS=0
IMAGE=false
MIN=false
MAX=false
TIMEOUT=300
VERBOSE=false
TAGVAR=false
TAGONLY=""
ENABLE_ROLLBACK=false
AWS_CLI=$(which aws)
AWS_ECS="$AWS_CLI --output json ecs"

function usage() {
  USAGAE=$(cat <<EOM
##### ecs-deploy #####

Simple script for triggering blue/green deployments on Amazon Elastic Container Service
https://github.com/silinternational/ecs-deploy

One of the following is required:
    -n | --service-name     Name of service to deploy
    -d | --task-definition  Name of task definition to deploy

Required arguments:
    -k | --aws-access-key        AWS Access Key ID. May also be set as environment variable AWS_ACCESS_KEY_ID
    -s | --aws-secret-key        AWS Secret Access Key. May also be set as environment variable AWS_SECRET_ACCESS_KEY
    -r | --region                AWS Region Name. May also be set as environment variable AWS_DEFAULT_REGION
    -p | --profile               AWS Profile to use - If you set this aws-access-key, aws-secret-key and region are needed
    -c | --cluster               Name of ECS cluster
    -i | --image                 Name of Docker image to run, ex: repo/image:latest
                                 Format: [domain][:port][/repo][/][image][:tag]
                                 Examples: mariadb, mariadb:latest, silintl/mariadb,
                                           silintl/mariadb:latest, private.registry.com:8000/repo/image:tag
    --aws-instance-profile  Use the IAM role associated with this instance

Optional arguments:
    -D | --desired-count    The number of instantiations of the task to place and keep running in your service.
    -m | --min              minumumHealthyPercent: The lower limit on the number of running tasks during a deployment.
    -M | --max              maximumPercent: The upper limit on the number of running tasks during a deployment.
    -t | --timeout          Default is 90s. Script monitors ECS Service for new task definition to be running.
    -e | --tag-env-var      Get image tag name from environment variable. If provided this will override value specified in image name argument.
    -to | --tag-only        New tag to apply to all images defined in the task (multi-container task). If provided this will override value specified in image name argument.
    --max-definitions       Number of Task Definition Revisions to persist before deregistering oldest revisions.
    --enable-rollback       Rollback task definition if new version is not running before TIMEOUT
    -v | --verbose          Verbose output
         --version          Display the version

Requirements:
    aws:  AWS Command Line Interface
    jq:   Command-line JSON processor

Examples:
  Simple deployment of a service (Using env vars for AWS settings):

    ecs-deploy -c production1 -n doorman-service -i docker.repo.com/doorman:latest

  All options:

    ecs-deploy -k ABC123 -s SECRETKEY -r us-east-1 -c production1 -n doorman-service -i docker.repo.com/doorman -t 240 -e CI_TIMESTAMP -v

  Updating a task definition with a new image:

    ecs-deploy -d open-door-task -i docker.repo.com/doorman:17

  Using profiles (for STS delegated credentials, for instance):

    ecs-deploy -p PROFILE -c production1 -n doorman-service -i docker.repo.com/doorman -t 240 -e CI_TIMESTAMP -v

  Update just the tag on whatever image is found in ECS Task (supports multi-container tasks):

    ecs-deploy -c staging -n core-service -to 0.1.899 -i ignore

Notes:
  - If a tag is not found in image and an ENV var is not used via -e and a tag is not provided with -to, it will default the tag to "latest"
EOM
)
  printf "\033[90m${USAGE}\033[0m\n"
  exit 3
}

# Check requirements
function require() {
  command -v "$1" > /dev/null 2>&1 || {
    printf "   \033[91mSome of the required software is not installed:\033[0m\n"
    printf "       \033[99mplease install $1\033[0m\n" >&2;
    exit 4;
  }
}

# Check that all required variables/combinations are set
function assertRequiredArgumentsSet() {

  # AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_DEFAULT_REGION and AWS_PROFILE can be set as environment variables
  if [ -z ${AWS_ACCESS_KEY_ID+x} ]; then unset AWS_ACCESS_KEY_ID; fi
  if [ -z ${AWS_SECRET_ACCESS_KEY+x} ]; then unset AWS_SECRET_ACCESS_KEY; fi
  if [ -z ${AWS_DEFAULT_REGION+x} ];
    then unset AWS_DEFAULT_REGION
    else
      AWS_ECS="$AWS_ECS --region $AWS_DEFAULT_REGION"
  fi
  if [ -z ${AWS_PROFILE+x} ];
    then unset AWS_PROFILE
    else
      AWS_ECS="$AWS_ECS --profile $AWS_PROFILE"
  fi

  if [ $SERVICE == false ] && [ $TASK_DEFINITION == false ]; then
    printf "   \033[91mOne of SERVICE or TASK DEFINITION is required. You can pass the value using -n / --service-name for a service, or -d / --task-definition for a task\033[0m\n"
    exit 5
  fi
  if [ $SERVICE != false ] && [ $TASK_DEFINITION != false ]; then
    printf "   \033[91mOnly one of SERVICE or TASK DEFINITION may be specified, but you supplied both\033[0m\n"
    exit 6
  fi
  if [ $SERVICE != false ] && [ $CLUSTER == false ]; then
    printf "   \033[91mCLUSTER is required. You can pass the value using -c or --cluster\033[0m\n"
    exit 7
  fi
  if [ $IMAGE == false ]; then
    printf "   \033[91mIMAGE is required. You can pass the value using -i or --image\033[0m\n"
    exit 8
  fi
  if ! [[ $MAX_DEFINITIONS =~ ^-?[0-9]+$ ]]; then
    printf "   \033[91mMAX_DEFINITIONS must be numeric, or not defined.\033[0m\n"
    exit 9
  fi
}

function parseImageName() {

  # Define regex for image name
  # This regex will create groups for:
  # - domain
  # - port
  # - repo
  # - image
  # - tag
  # If a group is missing it will be an empty string
  if [[ "x$TAGONLY" == "x" ]]; then
      imageRegex="^([a-zA-Z0-9\.\-]+):?([0-9]+)?/([a-zA-Z0-9\._\-]+)(/[\/a-zA-Z0-9\._\-]+)?:?([a-zA-Z0-9\._\-]+)?$"
  else
      imageRegex="^:?([a-zA-Z0-9\._-]+)?$"
  fi

  if [[ $IMAGE =~ $imageRegex ]]; then
    # Define variables from matching groups
    if [[ "x$TAGONLY" == "x" ]]; then
      domain=${BASH_REMATCH[1]}
      port=${BASH_REMATCH[2]}
      repo=${BASH_REMATCH[3]}
      img=${BASH_REMATCH[4]/#\//}
      tag=${BASH_REMATCH[5]}

      # Validate what we received to make sure we have the pieces needed
      if [[ "x$domain" == "x" ]]; then
        printf "   \033[91mImage name does not contain a domain or repo as expected. See usage for supported formats.\033[0m\n"
        exit 10;
      fi
      if [[ "x$repo" == "x" ]]; then
        printf "   \033[91mImage name is missing the actual image name. See usage for supported formats.\033[0m\n"
        exit 11;
      fi

      # When a match for image is not found, the image name was picked up by the repo group, so reset variables
      if [[ "x$img" == "x" ]]; then
        img=$repo
        repo=""
      fi
    else
      tag=${BASH_REMATCH[1]}
    fi
  else
    # check if using root level repo with format like mariadb or mariadb:latest
    rootRepoRegex="^([a-zA-Z0-9\-]+):?([a-zA-Z0-9\.\-]+)?$"
    if [[ $IMAGE =~ $rootRepoRegex ]]; then
      img=${BASH_REMATCH[1]}
      if [[ "x$img" == "x" ]]; then
        printf "   \033[91mInvalid image name. See usage for supported formats.\033[0m\n"
        exit 12
      fi
      tag=${BASH_REMATCH[2]}
    else
      printf "   \033[91mUnable to parse image name: $IMAGE, check the format and try again\033[0m\n"
      exit 13
    fi
  fi

  # If tag is missing make sure we can get it from env var, or use latest as default
  if [[ "x$tag" == "x" ]]; then
    if [[ $TAGVAR == false ]]; then
      tag="latest"
    else
      tag=${!TAGVAR}
      if [[ "x$tag" == "x" ]]; then
        tag="latest"
      fi
    fi
  fi

  # Reassemble image name
  if [[ "x$TAGONLY" == "x" ]]; then

    if [[ ! -z ${domain+undefined-guard} ]]; then
      useImage="$domain"
    fi
    if [[ ! -z ${port} ]]; then
      useImage="$useImage:$port"
    fi
    if [[ ! -z ${repo+undefined-guard} ]]; then
      if [[ ! "x$repo" == "x" ]]; then
      useImage="$useImage/$repo"
      fi
    fi
    if [[ ! -z ${img+undefined-guard} ]]; then
      if [[ "x$useImage" == "x" ]]; then
        useImage="$img"
      else
        useImage="$useImage/$img"
      fi
    fi
    imageWithoutTag="$useImage"
    if [[ ! -z ${tag+undefined-guard} ]]; then
      useImage="$useImage:$tag"
    fi

  else
    useImage="$TAGONLY"
  fi

  # If in test mode output $useImage
  if [ "$BASH_SOURCE" != "$0" ]; then
    echo $useImage
  fi
}

function getCurrentTaskDefinition() {
  if [ $SERVICE != false ]; then
    # Get current task definition name from service
    TASK_DEFINITION_ARN=`$AWS_ECS describe-services --services $SERVICE --cluster $CLUSTER | jq -r .services[0].taskDefinition`
    TASK_DEFINITION=`$AWS_ECS describe-task-definition --task-def $TASK_DEFINITION_ARN`
  fi
}

function createNewTaskDefJson() {
    # Get a JSON representation of the current task definition
    # + Update definition to use new image name
    # + Filter the def
    if [[ "x$TAGONLY" == "x" ]]; then
      DEF=$( echo "   $TASK_DEFINITION" \
            | sed -e "s|\"image\": *\"${imageWithoutTag}:.*\"|\"image\": \"${useImage}\"|g" \
            | sed -e "s|\"image\": *\"${imageWithoutTag}\"|\"image\": \"${useImage}\"|g" \
            | jq '.taskDefinition' )
    else
      DEF=$( echo "   $TASK_DEFINITION" \
            | sed -e "s|\(\"image\": *\".*:\)\(.*\)\"|\1${useImage}\"|g" \
            | jq '.taskDefinition' )
    fi

    # Default JQ filter for new task definition
    NEW_DEF_JQ_FILTER="family: .family, volumes: .volumes, containerDefinitions: .containerDefinitions, placementConstraints: .placementConstraints"

    # Some options in task definition should only be included in new definition if present in
    # current definition. If found in current definition, append to JQ filter.
    CONDITIONAL_OPTIONS=(networkMode taskRoleArn placementConstraints)
    for i in "${CONDITIONAL_OPTIONS[@]}"; do
      re=".*${i}.*"
      if [[ "$DEF" =~ $re ]]; then
        NEW_DEF_JQ_FILTER="${NEW_DEF_JQ_FILTER}, ${i}: .${i}"
      fi
    done

    # Build new DEF with jq filter
    NEW_DEF=$(echo $DEF | jq "{${NEW_DEF_JQ_FILTER}}")

    # If in test mode output $NEW_DEF
    if [ "$BASH_SOURCE" != "$0" ]; then
      echo $NEW_DEF
    fi
}

function registerNewTaskDefinition() {
    # Register the new task definition, and store its ARN
    NEW_TASKDEF=`$AWS_ECS register-task-definition --cli-input-json "$NEW_DEF" | jq -r .taskDefinition.taskDefinitionArn`
}

function rollback() {
    echo "   \033[93mRolling back to ${TASK_DEFINITION_ARN}\033[0m\n"
    $AWS_ECS update-service --cluster $CLUSTER --service $SERVICE --task-definition $TASK_DEFINITION_ARN > /dev/null
}

function updateService() {
  UPDATE_SERVICE_SUCCESS="false"
  DEPLOYMENT_CONFIG=""
  if [ $MAX != false ]; then
    DEPLOYMENT_CONFIG=",maximumPercent=$MAX"
  fi
  if [ $MIN != false ]; then
    DEPLOYMENT_CONFIG="$DEPLOYMENT_CONFIG,minimumHealthyPercent=$MIN"
  fi
  if [ ! -z "$DEPLOYMENT_CONFIG" ]; then
    DEPLOYMENT_CONFIG="--deployment-configuration ${DEPLOYMENT_CONFIG:1}"
  fi

  DESIRED_COUNT=""
  if [ ! -z ${DESIRED+undefined-guard} ]; then
    DESIRED_COUNT="--desired-count $DESIRED"
  fi

  # Update the service
  UPDATE=`$AWS_ECS update-service --cluster $CLUSTER --service $SERVICE $DESIRED_COUNT --task-definition $NEW_TASKDEF $DEPLOYMENT_CONFIG`

  # Only excepts RUNNING state from services whose desired-count > 0
  SERVICE_DESIREDCOUNT=`$AWS_ECS describe-services --cluster $CLUSTER --service $SERVICE | jq '.services[]|.desiredCount'`
  if [ $SERVICE_DESIREDCOUNT -gt 0 ]; then
    # See if the service is able to come up again
    every=10
    i=0
    while [ $i -lt $TIMEOUT ]
    do
      # Scan the list of running tasks for that service, and see if one of them is the
      # new version of the task definition

      RUNNING_TASKS=$($AWS_ECS list-tasks --cluster "$CLUSTER"  --service-name "$SERVICE" --desired-status RUNNING \
          | jq -r '.taskArns[]')

      if [[ ! -z $RUNNING_TASKS ]] ; then
        RUNNING=$($AWS_ECS describe-tasks --cluster "$CLUSTER" --tasks $RUNNING_TASKS \
            | jq ".tasks[]| if .taskDefinitionArn == \"$NEW_TASKDEF\" then . else empty end|.lastStatus" \
            | grep -e "RUNNING") || :

        if [ "$RUNNING" ]; then
          printf "   \033[36mService updated successfully, new task definition running.\033[0m\n";

          if [[ $MAX_DEFINITIONS -gt 0 ]]; then
            FAMILY_PREFIX=${TASK_DEFINITION_ARN##*:task-definition/}
            FAMILY_PREFIX=${FAMILY_PREFIX%*:[0-9]*}
            TASK_REVISIONS=`$AWS_ECS list-task-definitions --family-prefix $FAMILY_PREFIX --status ACTIVE --sort ASC`
            NUM_ACTIVE_REVISIONS=$(echo "$TASK_REVISIONS" | jq ".taskDefinitionArns|length")
            if [[ $NUM_ACTIVE_REVISIONS -gt $MAX_DEFINITIONS ]]; then
              LAST_OUTDATED_INDEX=$(($NUM_ACTIVE_REVISIONS - $MAX_DEFINITIONS - 1))
              for i in $(seq 0 $LAST_OUTDATED_INDEX); do
                OUTDATED_REVISION_ARN=$(echo "$TASK_REVISIONS" | jq -r ".taskDefinitionArns[$i]")

                printf "   \033[90mDeregistering outdated task revision: $OUTDATED_REVISION_ARN\033[0m\n"

                $AWS_ECS deregister-task-definition --task-definition "$OUTDATED_REVISION_ARN" > /dev/null
              done
            fi

          fi
          UPDATE_SERVICE_SUCCESS="true"
          break
        fi
      fi

      sleep $every
      i=$(( $i + $every ))
    done

    if [[ "${UPDATE_SERVICE_SUCCESS}" != "true" ]]; then
      # Timeout
      printf "   \033[91mERROR: New task definition not running within $TIMEOUT seconds\033[0m\n"
      if [[ "${ENABLE_ROLLBACK}" != "false" ]]; then
        rollback
      fi
      exit 1
    fi
  else
    printf "   \033[90mSkipping check for running task definition, as desired-count <= 0\033[0m\n"
  fi
}

function waitForGreenDeployment {
  DEPLOYMENT_SUCCESS="false"
  every=2
  i=0
  printf "   \033[90mWaiting for service deployment to complete...\033[0m\n"
  while [ $i -lt $TIMEOUT ]
  do
    NUM_DEPLOYMENTS=$($AWS_ECS describe-services --services $SERVICE --cluster $CLUSTER | jq "[.services[].deployments[]] | length")

    # Wait to see if more than 1 deployment stays running
    # If the wait time has passed, we need to roll back
    if [ $NUM_DEPLOYMENTS -eq 1 ]; then
      printf "   \033[92mService deployment successful.\033[0m\n\n"
      DEPLOYMENT_SUCCESS="true"
      # Exit the loop.
      i=$TIMEOUT
    else
      sleep $every
      i=$(( $i + $every ))
    fi
  done

  if [[ "${DEPLOYMENT_SUCCESS}" != "true" ]]; then
    if [[ "${ENABLE_ROLLBACK}" != "false" ]]; then
      rollback
    fi
    exit 1
  fi
}

######################################################
# When not being tested, run application as expected #
######################################################
if [ "$BASH_SOURCE" == "$0" ]; then
  set -o errexit
  set -o pipefail
  set -u
  set -e
  # If no args are provided, display usage information
  if [ $# == 0 ]; then usage; fi

  # Check for AWS, AWS Command Line Interface
  require aws
  # Check for jq, Command-line JSON processor
  require jq

  # Loop through arguments, two at a time for key and value
  while [[ $# -gt 0 ]]
  do
    key="$1"

    case $key in
      -k|--aws-access-key)
        AWS_ACCESS_KEY_ID="$2"
        shift # past argument
        ;;
      -s|--aws-secret-key)
        AWS_SECRET_ACCESS_KEY="$2"
        shift # past argument
        ;;
      -r|--region)
        AWS_DEFAULT_REGION="$2"
        shift # past argument
        ;;
      -p|--profile)
        AWS_PROFILE="$2"
        shift # past argument
        ;;
      --aws-instance-profile)
        printf "   \033[93m--aws-instance-profile is not yet in use\033[0m\n"
        AWS_IAM_ROLE=true
        ;;
      -c|--cluster)
        CLUSTER="$2"
        shift # past argument
        ;;
      -n|--service-name)
        SERVICE="$2"
        shift # past argument
        ;;
      -d|--task-definition)
        TASK_DEFINITION="$2"
        shift
        ;;
      -i|--image)
        IMAGE="$2"
        shift
        ;;
      -t|--timeout)
        TIMEOUT="$2"
        shift
        ;;
      -m|--min)
        MIN="$2"
        shift
        ;;
      -M|--max)
        MAX="$2"
        shift
        ;;
      -D|--desired-count)
        DESIRED="$2"
        shift
        ;;
      -e|--tag-env-var)
        TAGVAR="$2"
        shift
        ;;
      -to|--tag-only)
        TAGONLY="$2"
        shift
        ;;
      --max-definitions)
        MAX_DEFINITIONS="$2"
        shift
        ;;
      --enable-rollback)
        ENABLE_ROLLBACK=true
        ;;
      -v|--verbose)
        VERBOSE=true
        ;;
      --version)
        echo ${VERSION}
        exit 0
        ;;
      *)
        usage
        exit 2
      ;;
    esac
    shift # past argument or value
  done

  if [ $VERBOSE == true ]; then
    set -x
  fi

  # Check that required arguments are provided
  assertRequiredArgumentsSet

  # Determine image name
  parseImageName
  printf "   \033[90mUsing image name: $useImage\033[0m\n"

  # Get current task definition
  getCurrentTaskDefinition
  printf "   \033[90mCurrent task definition: $TASK_DEFINITION_ARN\033[0m\n";

  # create new task definition json
  createNewTaskDefJson

  # register new task definition
  registerNewTaskDefinition
  printf "   \033[90mNew task definition: $NEW_TASKDEF\033[0m\n";

  # update service if needed
  if [ $SERVICE == false ]; then
    printf "   \033[90mTask definition updated successfully\033[0m\n"
  else
    updateService

    waitForGreenDeployment
  fi

  exit 0

fi
#############################
# End application run logic #
#############################
