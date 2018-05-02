#!/usr/bin/env node

/* eslint-disable no-console */
/* eslint-disable consistent-return */

/**
 * Module dependencies
 */
const colors = require('colors')
const program = require('commander')
const { exec, spawn } = require('child_process')
const { isEmpty } = require('lodash')

/**
 * Setup parameters from command line arguments
 */
program
  .version('0.2.0')
  .option(
    '-a, --account-id [value]',
    'AWS account needed to build, push, and deploy'
  )
  .option(
    '-f, --dockerfile [value]',
    'The path of the dockerfile to use in building image'
  )
  .option(
    '-e, --environment [value]',
    'The environment used to build the image (e.g., staging or production).'
  )
  .option(
    '-i, --image [value]',
    'Docker image to build (e.g., rails or nginx). `rails` is used by default.'
  )
  .option(
    '-p, --prefix [value]',
    'Project prefix for tagging the build locally.'
  )
  .option('--push', 'Automatically push the docker image')
  .option('--noCache', 'Build the docker image fresh and not from cache')
  .parse(process.argv)

const { accountId, push } = program

let gen // Set a variable for our generator
let { dockerfile, environment, image, noCache, prefix } = program
let currentAccountId
let accessKeyId
let secretAccessKey
let sessionToken
let imageTag

/**
 * Set default values in case they were not provided
 */
dockerfile = dockerfile || 'Dockerfile'
environment = environment || 'staging'
image = image || 'api'
noCache = noCache ? '--no-cache' : ''
prefix = prefix || 'default'
const imageName = `${prefix}/${environment}/${image}`
const repository = `${accountId}.dkr.ecr.us-east-1.amazonaws.com/${environment}/${image}`

/**
 * Execute a bash command and return the buffered response
 */
const command = (cmd, options = []) =>
  new Promise((resolve, reject) => {
    exec(cmd, options, (error, stdout, stderr) => {
      if (error) {
        const message = `error: '${error}' stdout = '${stdout}' stderr = '${stderr}'`
        console.log(colors.red(message))
        reject(message)
      }
      resolve({ stderr, stdout })
    })
  })

/**
 * Execute a bash script and console.log the streamed response
 */
const shell = (script, options = []) =>
  new Promise((resolve, reject) => {
    const cmd = spawn(script, options)
    // let stdout;
    let stderr

    cmd.stdout.on('data', data => {
      process.stdout.write(data.toString())
    })

    cmd.stderr.on('data', data => {
      stderr += data.toString()
      console.log(`stderr: ${data.toString()}`.red)
    })

    cmd.on('exit', (code, signal) => {
      // console.log('child process exited with code ' + code.toString())
      if (!isEmpty(stderr) && stderr.length > 0)
        reject(colors.red(code.toString()))
      resolve({ code, signal })
    })
  })

// Log in to AWS ECR
const signInToAwsEcr = () => {
  console.log(colors.green('~> Logging in to AWS ECR'))
  command(
    'eval $(aws ecr get-login --no-include-email --region us-east-1)'
  ).then(({ stderr, stdout }) => {
    if (
      !isEmpty(stderr) &&
      !/WARNING! Using --password via the CLI/.test(stderr)
    ) {
      console.log(colors.red(stderr))
      return
    }
    console.log(colors.yellow(stdout))
    gen.next()
  })
}

// Get AWS Account ID
const getAwsAccountId = () => {
  console.log(colors.green('~> Getting AWS Account ID'))
  command('aws sts get-caller-identity')
    .then(({ stderr, stdout }) => {
      if (!isEmpty(stderr)) {
        console.log(colors.red(stderr))
        return
      }
      currentAccountId = JSON.parse(stdout).Account
      console.log(
        colors.yellow(`Your current AWS Account ID is ${currentAccountId}\n`)
      )

      // Verify that we are on the correct account
      console.log(
        colors.green('~> Verifing AWS credentials for the docker build')
      )
      if (currentAccountId !== accountId) {
        console.log(
          colors.red(
            'Uh oh! Your AWS credentials are invalid! Please switch credentials and build again.\n'
          )
        )
        return
      }
      console.log(colors.cyan('Excellent! AWS Credentials are valid.\n'))
      gen.next()
    })
    .catch(err => console.log(colors.red(err)))
}

// Get temporary AWS credentials for the docker build
const createTmpAwsCredentials = () => {
  console.log(
    colors.green('~> Creating temporary AWS credentials for the docker build')
  )
  command('aws sts get-session-token --duration-seconds 3600')
    .then(({ stderr, stdout }) => {
      if (!isEmpty(stderr)) return console.log(colors.red(stderr))
      const tmpCredentials = JSON.parse(stdout).Credentials
      accessKeyId = tmpCredentials.AccessKeyId
      secretAccessKey = tmpCredentials.SecretAccessKey
      sessionToken = tmpCredentials.SessionToken
      console.log(
        colors.yellow('Temporary AWS Credentials have been generated.\n')
      )
      gen.next()
    })
    .catch(err => console.log(colors.red(err)))
}

const getNextImageTagVersion = () => {
  console.log(colors.green('~> Generating docker image tag'))
  command(`aws ecr list-images --repository-name ${imageTag}`)
    .then(({ stderr, stdout }) => {
      JSON.parse(stdout).map(image => {
        console.log(colors.cyan('imageTag = image.imageTag'))
      })
    })
    .catch(err => console.log(colors.red(err)))
}

// Build the docker image
const buildDockerImage = () => {
  console.log(colors.green('~> Building docker image'))
  const buildCmd = `docker build -t ${imageTag} --build-arg AWS_ACCESS_KEY_ID=${accessKeyId} --build-arg AWS_SECRET_ACCESS_KEY=${secretAccessKey} --build-arg AWS_SESSION_TOKEN=${sessionToken} --build-arg ENVIRONMENT=${environment} -f ${dockerfile} ${noCache}`
  console.log(buildCmd)
  shell('docker', [
    'build',
    '-t',
    imageTag,
    '--build-arg',
    `AWS_ACCESS_KEY_ID=${accessKeyId}`,
    '--build-arg',
    `AWS_SECRET_ACCESS_KEY=${secretAccessKey}`,
    '--build-arg',
    `AWS_SESSION_TOKEN=${sessionToken}`,
    '--build-arg',
    `ENVIRONMENT=${environment}`,
    '-f',
    dockerfile,
    '.',
    '--no-cache',
  ])
    .then(({ code }) => {
      if (code === 0) {
        console.log(colors.blue('Successfully built docker image.\n'))
        return gen.next()
      }
      console.log(colors.red(`Build failed with error code: ${code}`))
    })
    .catch(err => console.log(colors.red(err)))
}

const tagDockerImage = () => {
  console.log(colors.green('~> Tagging docker image'))
  shell('docker', ['tag', imageTag, repository])
    .then(({ code }) => {
      if (code === 0) {
        console.log(colors.yellow('Successfully tagged docker image.\n'))
        return gen.next()
      }
      console.log(colors.red(`Tag failed with error code: ${code}`))
    })
    .catch(err => console.log(colors.red(err)))
}

const pushDockerImage = () => {
  console.log(colors.green('~> Pushing docker image'))
  shell('docker', ['push', repository])
    .then(({ code }) => {
      if (code === 0) {
        console.log(colors.yellow('Successfully pushed docker image.\n'))
        return
      }
      console.log(colors.red(`Push failed with error code: ${code}`))
    })
    .catch(err => console.log(colors.red(err)))
}

function* build() {
  yield signInToAwsEcr()
  yield getAwsAccountId()
  yield createTmpAwsCredentials()
  yield getNextImageTagVersion()
  yield buildDockerImage()
  yield tagDockerImage()
  if (push) {
    yield pushDockerImage()
  }
}

/**
 * Execute the shell script
 */
gen = build()
gen.next()

/* eslint-enable no-console */
/* eslint-enable consistent-return */
