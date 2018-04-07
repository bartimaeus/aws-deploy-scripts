# aws-deploy-scripts
A collection of scripts I use to deploy ECS services and S3 static websites

This repository is for my sanity in managing multiple AWS accounts on the same machine. I have made the occational mistake of pushing resources to the wrong AWS account. I also want to manage these shared scripts in one place rather than updating each respository individually.

Currently I use `yarn` to run these scripts. I'll include a sample **package.json** in each of the sections below.

## Setup

1. Install the latest [aws cli](https://docs.aws.amazon.com/cli/latest/userguide/installing.html) command line tools

        pip install --upgrade awscli

2. Next, setup [named profiles](https://docs.aws.amazon.com/cli/latest/userguide/cli-multiple-profiles.html) for each of our AWS accounts

3. *(Optional)* Sometimes it's nice to test commands in a REPL environment. Amazon's [aws-shell](https://github.com/awslabs/aws-shell) is great for that

        pip install --upgrade aws-shell

4. Add thisrepository as a submodule in the project you want to deploy

        git submodule add https://github.com/bartimaeus/aws-deploy-scripts.git

5. Install **[jq](https://stedolan.github.io/jq/download/)** for parsing JSON responses from AWS CLI

        brew install jq

6. Install the **npm** dependencies

        cd aws-deploy-scripts && yarn install && cd ..

7. *(Optional)* Use an AWS credential management library to switch the **[default]** AWS credentials in your `~/.aws/credentials`. Personally, I'm using [switcher](https://github.com/ivarrian/switcher).

        git clone https://github.com/ivarrian/switcher
        cd switcher
        npm install -g

## S3

Back in the day I used [gulp and grunt scripts](yeoman-s3-example) to sync assets with S3 for a number os static websites.

Now, in addition to syncing with S3, I use CloudFront to serve the assets. Because of this I have changed my deployment process to use the `aws cli` in combination with a few bash scripts.

See this [blog post](https://medium.com/@omgwtfmarc/deploying-create-react-app-to-s3-or-cloudfront-48dae4ce0af) on how to setup and deploy your React app to Amazon Web Services S3 and CloudFront.

#### Setup

1. Install all npm dependencies. I've switched to using yarn for a few reasons. One of my favorite is that I don't have to specify run like I do with npm. `npm run deploy` is now `yarn deploy`.

        yarn install

2. Add a `"deploy"` script to your **package.json** in your main repository with the **accountId**, **bucket**, **distributionId**, **profile**, and **path** set.

    ```json
    "scripts": {
      "start": "gatsby develop",
      "build": "gatsby build",
    + "postbuild": "find public -name '*.map' -type f -delete",
    + "deploy": "./aws-deploy-scripts/s3/deploy.sh --account-id 14234234 --bucket www.mysite.com --path public --profile mysite",
      "test": "echo \"Error: no test specified\" && exit 1"
    },
    ```

    > **Slack Notifications** are available. Add `--slack-webhook-url [environment_variable]` to the deploy command to enable Slack notifications to the **#general** channel.

    If I'm deploying a `react-create-app` single page app, then I add the following `"prebuild"` script:

    ```json
    "scripts": {
      "start": "react-scripts start",
    + "prebuild": "rm -fR build/*",
      "build": "react-scripts build",
    + "postbuild": "find build -name '*.map' -type f -delete",
    + "deploy": "./aws-deploy-scripts/s3/deploy.sh --account-id 14234234 --bucket www.mysite.com --path build --profile mysite",
      "test": "react-scripts test --env=jsdom",
      "eject": "react-scripts eject"
    },
    ```

    In most cases I remove the source maps using `postbuild`. I know source maps are only requested when the dev tools are opened, but with some static sites I don't want the source code visible. It's easy enough to build and deploy with the source maps if you need to track down a bug.

    > **CloudFront** caching is tricky. The way to clear the cache is to create an invalidation for the CloudFront distribution after you sync assets with S3.

    The S3 deploy script will automatically create an invalidation if the CloudFront distribution id `--distribution-id [distribution id]` is added to the `"deploy"` script.

    ```json
    "deploy": "./aws-deploy-scripts/s3/deploy.sh --account-id 14234234 --bucket www.mysite.com --distribution-id E245GA45256 --path build --profile mysite",
    ```

    > **Security** is important and you should not store any sensitive values in your repository. I personally feel that the **account id**, **bucket name**, and **distribution id** are more helpful to keep in the repository when collaberating with other developers. If anyone feels differently, I'd be interested to get your feedback.

#### Permissions

There are lots of ways to handle permissions, but here is how I set things up.

I setup my git to use the **develop** branch for the main branch. All pull requests merge in to the **develop** branch. I specify the development or staging S3 bucket and AWS account id in the **package.json** on the **develop** branch. Then I create the following IAM policy:

**IAM Policy Name**: `DevelopmentS3[SiteName]Deploy`

```
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "s3:ListBucket"
            ],
            "Resource": [
                "arn:aws:s3:::mysite.dev"
            ]
        },
        {
            "Effect": "Allow",
            "Action": [
                "s3:PutObject",
                "s3:GetObject",
                "s3:DeleteObject"
            ],
            "Resource": [
                "arn:aws:s3:::mysite.dev/*"
            ]
        },
        {
            "Effect": "Allow",
            "Action": [
                "cloudfront:CreateInvalidation",
                "cloudfront:GetDistribution",
                "cloudfront:GetStreamingDistribution",
                "cloudfront:GetDistributionConfig",
                "cloudfront:GetInvalidation",
                "cloudfront:ListInvalidations",
                "cloudfront:ListStreamingDistributions",
                "cloudfront:ListDistributions"
            ],
            "Resource": "*"
        }
    ]
}
```

I can create a developers group and assign this policy to the group. Or assign the policy to users individually. This allows developers to push their code to development or staging for feedback or QA. It's also nice to have a site for clients to view your progress before you make things live!

> **NOTE**: At the time of writing I don't believe that CloudFront supports specifying the resource. When it does support this, then I'll update the example policy.

Finally, I use the **master** git branch for production. I update the **package.json** to use the production **AWS account id**, **S3 bucket** and **path**. I also make sure that I have an IAM Policy for production deploys and that is assigned to the right groups and users.

The IAM policy is almost identical for production:

**IAM Policy Name**: `ProductionS3[SiteName]Deploy`

```
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "s3:ListBucket"
            ],
            "Resource": [
                "arn:aws:s3:::mysite.com"
            ]
        },
        {
            "Effect": "Allow",
            "Action": [
                "s3:PutObject",
                "s3:GetObject",
                "s3:DeleteObject"
            ],
            "Resource": [
                "arn:aws:s3:::mysite.com/*"
            ]
        },
        {
            "Effect": "Allow",
            "Action": [
                "cloudfront:CreateInvalidation",
                "cloudfront:GetDistribution",
                "cloudfront:GetStreamingDistribution",
                "cloudfront:GetDistributionConfig",
                "cloudfront:GetInvalidation",
                "cloudfront:ListInvalidations",
                "cloudfront:ListStreamingDistributions",
                "cloudfront:ListDistributions"
            ],
            "Resource": "*"
        }
    ]
}
```

#### Deployment

Deploying is pretty straight forward:

##### Build the static assets:

    yarn build


##### Deploy to S3:

    yarn deploy


##### Or do it all in one go:

    yarn build && yarn deploy

> **NOTE**: You can always add your own script to either run tests or lint your code before you deploy.
