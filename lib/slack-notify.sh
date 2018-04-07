#!/bin/bash

# Usage: slack-notify "<webhook_url>" "<channel>" "<username>" "<message>" "<color>"

# ------------
webhook_url=$1
if [[ $webhook_url == "" ]]
then
  printf "\033[91mMissing webhook_url. (slack-notify \"<webhook_url>\" \"<channel>\" \"<username>\" \"<message>\" \"<color>\")\033[0m\n"
  exit 1
fi

# ------------
shift
channel=$1
if [[ $channel == "" ]]
then
  printf "\033[91mNo channel specified! (slack-notify \"<webhook_url>\" \"<channel>\" \"<username>\" \"<message>\" \"<color>\")\033[0m\n"
  exit 1
fi

# ------------
shift
username=$1
if [[ $username == "" ]]
then
  printf "\033[91mPlease provide your slack username (slack-notify \"<webhook_url>\" \"<channel>\" \"<username>\" \"<message>\" \"<color>\")\033[0m\n"
  exit 1
fi

# ------------
shift
message=$1
if [[ $message == "" ]]
then
  printf "\033[91mMissing message! (slack-notify \"<webhook_url>\" \"<channel>\" \"<username>\" \"<message>\" \"<color>\")\033[0m\n"
  exit 1
fi

# ------------
shift
color=$1


escapedText=$(echo $message | sed 's/"/\"/g' | sed "s/'/\'/g" )

json="{\"channel\": \"$channel\", \"username\":\"$username\", \"icon_emoji\":\":rocket:\", \"attachments\":[{\"color\":\"$color\" , \"text\": \"$escapedText\"}]}"

curl -s -d "payload=$json" "$webhook_url"
