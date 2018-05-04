#!/usr/bin/env node

/* eslint-disable no-console */
/* eslint-disable consistent-return */

/**
 * Module dependencies
 */
const colors = require('colors')
const program = require('commander')
const { exec, spawn } = require('child_process')
const { isEmpty, isNumber } = require('lodash')
const fs = require('fs')

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
  .option('-t, --tag [value]', 'Docker image tag to use for this build.')
  .option('--push', 'Automatically push the docker image')
  .option('--noCache', 'Build the docker image fresh and not from cache')
  .parse(process.argv)

const { accountId, push, tag } = program

let gen // Set a variable for our generator
let { dockerfile, environment, image, noCache, prefix } = program
let accessKeyId
let currentAccountId
let currentBuildVersion
let imageTag
let secretAccessKey
let sessionToken

/**
 * Set default values in case they were not provided
 */
dockerfile = dockerfile || 'Dockerfile'
environment = environment || 'staging'
image = image || 'api'
imageTag = tag || null
noCache = noCache ? '--no-cache' : ''
prefix = prefix || 'default'
let buildVersionExists = false
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

// Generate the next image tag based on the .buildversion file previous version for the current image
const generateNextImageTagFromFile = () => {
  console.log(
    colors.green('~> Checking .buildversion for previous build version')
  )
  fs.readFile('.buildversion', 'utf8', (err, data) => {
    if (err) {
      console.log(
        colors.magenta(
          'Could not find .buildversion in your project directory.\n'
        )
      )
      return gen.next()
    }

    // .buildversion is empty; create a version
    if (isEmpty(data)) {
      imageTag = 1
      console.log(colors.yellow(`Using image tag version: ${imageTag}\n`))
      return gen.next()
    }

    try {
      data
        .toString()
        .trim()
        .split('\n')
        .forEach(line => {
          if (line === '') return

          // Split on ':' and then remove any spaces
          //
          // line => staging/service:204
          //
          // [0] === 'staging/service' // build image name
          // [1] === 204               // previous build version
          const [key, value] = line
            .split(':')
            .map(buildImage => buildImage.replace(' ', ''))

          if (key === `${environment}/${image}`) {
            currentBuildVersion = line
            buildVersionExists = true
            imageTag = Number(value) + 1
          }
        })

      // Return next build imageTag
      if (isNumber(imageTag)) {
        console.log(colors.yellow(`Using image tag version: ${imageTag}\n`))
        return gen.next()
      }

      // Image not found in .buildversion
      imageTag = 1
      console.log(colors.yellow(`Using image tag version: ${imageTag}\n`))
      gen.next()
    } catch (error) {
      console.log(colors.red(`${error}\n`))
      gen.next()
    }
  })
}

// Generate the next image tag based on the previous build tags on ECR
const generateNextImageTagFromPreviousBuilds = () => {
  console.log(
    colors.green(
      '~> Generating docker image tag based on previous builds on ECR'
    )
  )
  command(
    `aws ecr list-images --repository-name ${environment}/${image} --filter '{"tagStatus": "TAGGED"}'`
  )
    .then(({ stderr, stdout }) => {
      if (!isEmpty(stderr)) return console.log(colors.red(stderr))

      const { imageIds } = JSON.parse(stdout)
      const currentImageTagVersion = imageIds
        .map(
          img => (Number.isNaN(Number(img.imageTag)) ? 0 : Number(img.imageTag))
        )
        .reduce((max, cur) => Math.max(max, cur))

      if (Number.isNaN(currentImageTagVersion)) {
        imageTag = 1
      } else {
        imageTag = currentImageTagVersion + 1
      }

      console.log(colors.yellow(`Using image tag version: ${imageTag}\n`))
      gen.next()
    })
    .catch(err => console.log(colors.red(err)))
}

// Build the docker image
const buildDockerImage = () => {
  console.log(colors.green(`~> Building docker image ${imageName}:${imageTag}`))
  const buildCmd = `docker build -t ${imageName}:latest -t ${imageName}:${imageTag} --build-arg AWS_ACCESS_KEY_ID=${accessKeyId} --build-arg AWS_SECRET_ACCESS_KEY=${secretAccessKey} --build-arg AWS_SESSION_TOKEN=${sessionToken} --build-arg ENVIRONMENT=${environment} -f ${dockerfile} ${noCache}`
  console.log(colors.cyan(`Running: ${buildCmd}`))
  shell('docker', [
    'build',
    '-t',
    `${imageName}:latest`,
    '-t',
    `${imageName}:${imageTag}`,
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
    noCache,
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
  console.log(
    colors.green(
      `~> Tagging docker image: ${imageName}:${imageTag} ${repository}:${imageTag}`
    )
  )
  shell('docker', [
    'tag',
    `${imageName}:${imageTag}`,
    `${repository}:${imageTag}`,
  ])
    .then(({ code }) => {
      if (code === 0) {
        console.log(
          colors.yellow(
            `Successfully tagged docker image with version: ${imageTag}\n`
          )
        )
        return gen.next()
      }
      console.log(colors.red(`Tag failed with error code: ${code}`))
    })
    .catch(err => console.log(colors.red(err)))
}

const saveBuildVersion = () => {
  console.log(colors.green('Saving build version to .buildversion'))
  if (buildVersionExists) {
    fs.readFile('.buildversion', 'utf8', (err, content) => {
      if (err) {
        return console.log(colors.red(`${err}\n`))
      }
      const result = content.replace(
        currentBuildVersion,
        `${environment}/${image}:${imageTag}`
      )

      fs.writeFile('.buildversion', result, 'utf8', writeErr => {
        if (writeErr) {
          return console.log(colors.red(`${writeErr}\n`))
        }
        console.log(
          colors.yellow(`Updated ${environment}/${image}:${imageTag}.\n`)
        )
        gen.next()
      })
    })
  } else {
    fs.appendFile(
      '.buildversion',
      `${environment}/${image}:${imageTag}\n`,
      'utf8',
      err => {
        if (err) {
          return console.log(colors.red(`${err}\n`))
        }
        console.log(
          colors.yellow(`Added ${environment}/${image}:${imageTag}.\n`)
        )
        gen.next()
      }
    )
  }
}

const pushDockerImage = () => {
  console.log(colors.green('~> Pushing docker image'))
  shell('docker', ['push', `${repository}:${imageTag}`])
    .then(({ code }) => {
      if (code === 0) {
        console.log(
          colors.yellow(
            `Successfully pushed docker image: ${repository}:${imageTag}.\n`
          )
        )
        return gen.next()
      }
      console.log(colors.red(`Push failed with error code: ${code}`))
    })
    .catch(err => console.log(colors.red(err)))
}

function* build() {
  yield signInToAwsEcr()
  yield getAwsAccountId()
  yield createTmpAwsCredentials()

  // Generate the next image tag using the .buildversion file
  if (isEmpty(imageTag) && !isNumber(imageTag)) {
    yield generateNextImageTagFromFile()
  }

  // Generate the next image tag based on the previous build tags
  if (isEmpty(imageTag) && !isNumber(imageTag)) {
    yield generateNextImageTagFromPreviousBuilds()
  }

  yield buildDockerImage()
  yield tagDockerImage()
  yield saveBuildVersion()

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
