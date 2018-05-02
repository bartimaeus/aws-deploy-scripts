# aws-deploy-scripts
A collection of scripts I use to deploy ECS services and S3 static websites

> **[aws cli](https://docs.aws.amazon.com/cli/latest/userguide/installing.html) and [jq](https://stedolan.github.io/jq/download/) are required in order to use aws-deploy-scripts**

This repository is for my sanity in managing multiple AWS accounts on the same machine. I have made the occational mistake of pushing resources to the wrong AWS account. I also want to manage these shared scripts in one place rather than updating each respository individually.

## Scripts

* aws-ecs-build
* aws-ecs-deploy
* aws-parameter-store
* aws-s3-deploy
* aws-s3-secrets

## Setup

1. Add **aws-deploy-scripts** to your project

        yarn add aws-deploy-scripts --dev

2. Install the latest [aws cli](https://docs.aws.amazon.com/cli/latest/userguide/installing.html) command line tools

        pip install --upgrade awscli

3. Install **[jq](https://stedolan.github.io/jq/download/)** for parsing JSON responses from AWS CLI

        brew install jq

4. Next, setup [named profiles](https://docs.aws.amazon.com/cli/latest/userguide/cli-multiple-profiles.html) for each of your AWS accounts

5. *(Optional)* Sometimes it's nice to test commands in a REPL environment. Amazon's [aws-shell](https://github.com/awslabs/aws-shell) is great for that

        pip install --upgrade aws-shell

6. *(Optional)* Use an AWS credential management library to switch the **[default]** AWS credentials in your `~/.aws/credentials`. Personally, I'm using [switcher](https://github.com/ivarrian/switcher).

        git clone https://github.com/ivarrian/switcher
        cd switcher
        npm install -g

## S3 Deploy

Back in the day I used [gulp and grunt scripts](yeoman-s3-example) to sync assets with S3 for a number of static websites I manage.

Now, in addition to syncing with S3, I use CloudFront to serve the assets. Because of this I have changed my deployment process to use the `aws cli` in combination with a few bash scripts--slowly converting them to node scripts.

See this [blog post](https://medium.com/@omgwtfmarc/deploying-create-react-app-to-s3-or-cloudfront-48dae4ce0af) on how to setup and deploy your React app to Amazon Web Services S3 and CloudFront.

#### Examples

Example `gatsby` and `create-react-app` projects can be found in the `examples` directory.

#### Setup

1. Install **aws-deploy-scripts** to your dev dependencies. I've switched to using yarn for a few reasons. One of my favorite is that I don't have to specify run like I do with npm. `npm run deploy` is now `yarn deploy`.

        yarn add aws-deploy-scripts --dev

2. Add a `"deploy"` script to your **package.json** in your main repository with the AWS `account-id`, S3 `bucket` name, CloudFront `distribution-id`, AWS CLI `profile` name, and the build `path` of the minified assets.

    ```diff
    "scripts": {
      "start": "gatsby develop",
      "build": "gatsby build",
    + "postbuild": "find public -name '*.map' -type f -delete",
    + "deploy": "aws-s3-deploy --account-id 14234234 --bucket www.mysite.com --path public --profile mysite",
      "test": "echo \"Error: no test specified\" && exit 1"
    },
    ```

    > **Slack Notifications** are available. Add `--slack-webhook-url [environment_variable_name]` to the deploy command to enable Slack notifications to the **#general** channel.

    If I'm deploying a `react-create-app` single page app, then I add the following `"prebuild"` script to remove previous builds:

    ```diff
    "scripts": {
      "start": "react-scripts start",
    + "prebuild": "rm -fR build/*",
      "build": "react-scripts build",
    + "postbuild": "find build -name '*.map' -type f -delete",
    + "deploy": "aws-s3-deploy --account-id 14234234 --bucket www.mysite.com --path build --profile mysite",
      "test": "react-scripts test --env=jsdom",
      "eject": "react-scripts eject"
    },
    ```

    In most cases I remove the source maps using the `"postbuild"` script. I know source maps are only requested when the dev tools are opened, but with some static sites I don't want the source code visible. It's easy enough to build and deploy with the source maps if you need to track down a bug.

    > **CloudFront** caching can be invalidated by specifying the `distribution id` as an additional argument the deploy command.

    The S3 deploy script will automatically create an invalidation if the CloudFront distribution id `--distribution-id [distribution id]` as soon as all of the minified assets are synced with S3.

    ```json
    "deploy": "aws-s3-deploy --account-id 14234234 --bucket www.mysite.com --distribution-id E245GA45256 --path build --profile mysite",
    ```

    > **Security** is important and you should not store any sensitive values in your repository. I personally feel that the AWS **account id**, S3 **bucket** name, and CloudFront **distribution id** are more helpful to keep in the repository when collaborating with a team then requiring each person to set up environment variables. I'd be interested to get your feedback.

#### Permissions

There are lots of ways to handle permissions, but here is how I set things up.

I setup git to use the **develop** branch for the main branch. All pull requests merge in to the **develop** branch. I specify the development or staging S3 bucket and AWS account id in the **package.json** on the **develop** branch. Then I create the following IAM policy:

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
                "s3:PutObjectAcl",
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

Finally, I use the **master** git branch for production. I update the **package.json** to use the production AWS **account id**, S3 **bucket** name, and build **path**. I also make sure that I have an IAM Policy for production deploys and that the policy is assigned to the right groups and users.

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
                "s3:PutObjectAcl",
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


## S3 Secrets

The script concept comes from [How to Manage Secrets for Amazon EC2 Container Service–Based Applications by Using Amazon S3 and Docker](https://aws.amazon.com/blogs/security/how-to-manage-secrets-for-amazon-ec2-container-service-based-applications-by-using-amazon-s3-and-docker/)

> Once setup run `yarn env-vars` to send your secret file to S3

#### Setup

1. Create an S3 bucket of your choice. My preference is to do `[project]-[environment]-secrets`.

2. Attach either the `bucket-policy.json` or `vpc-only-bucket-policy.json` to the newly created bucket.

3. Install `aws-deploy-scripts` in your project--if not already installed

        yarn add aws-deploy-scripts --dev

4. Add `env-vars` and `get-env-vars` scripts to your `package.json`

    ```json
    "scripts": {
      "start": "node index.js",
      "env-vars": "aws-s3-secrets --action put --environment staging --bucket blog-staging-secrets --profile default",
      "get-env-vars": "aws-s3-secrets --action get --environment staging --bucket blog-staging-secrets --profile default"
    },
    ```
5. Send your local secrets file to S3 (NOTE: if you used the VPC policy on your s3 bucket, then you'll need to connect to the VPN before you can send your secret file)

        yarn env-vars

6. Testing the file on S3 requires you to download the file

        yarn get-env-vars

  I've added prefix of `s3.` to the file being downloaded so that it doesn't overwrite your original file.
