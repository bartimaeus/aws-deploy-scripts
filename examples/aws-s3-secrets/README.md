# aws-s3-secrets Example

This example comes from [How to Manage Secrets for Amazon EC2 Container Service–Based Applications by Using Amazon S3 and Docker](https://aws.amazon.com/blogs/security/how-to-manage-secrets-for-amazon-ec2-container-service-based-applications-by-using-amazon-s3-and-docker/)

## Setup

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
