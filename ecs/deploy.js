#!/usr/bin/env node

/* eslint-disable no-console */
/* eslint-disable consistent-return */

/**
 * Module dependencies
 */
const colors = require('colors')
const program = require('commander')
const { exec, spawn } = require('child_process')
const inquirer = require('inquirer')
const { compact, isEmpty } = require('lodash')

/**
 * Setup parameters from command line arguments
 */
program
  .version('1.0.0')
  .option('-a, --account-id [value]', 'AWS account needed to deploy')
  .option('-c, --cluster [value]', 'Name of the cluster')
  .option('-d, --task-definition [value]', 'Name of task definition to deploy')
  .option(
    '-i, --image [value]',
    'Docker image to build (e.g., rails or nginx). `rails` is used by default.'
  )
  .option('-n, --service-name [value]', 'Name of the service to deploy')
  .option(
    '-o, --timeout',
    'Timeout in milliseconds to wait for the deploy before halting the deployment. Defaults to 300 milliseconds'
  )
  .option(
    '-r, --region [value]',
    'AWS Region where ECS and ECR are currently in use.'
  )
  .option(
    '-t, --tag [value]',
    'The image tag version to use for the deployment.'
  )
  .parse(process.argv)

const { accountId, cluster, serviceName, tag, taskDefinition } = program

let gen // Set a variable for our generator
let { image, region, timeout } = program
let currentAccountId
let imageTag

/**
 * Set default values in case they were not provided
 */
image = image || 'api'
imageTag = tag || null
region = region || 'us-east-1'
timeout = timeout || 300

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
    `eval $(aws ecr get-login --no-include-email --region ${region})`
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

const getImageTagVersion = () => {
  console.log(colors.green('~> Listing image tags/versions'))
  command(`aws ecr list-images --repository-name ${image}`)
    .then(({ stderr, stdout }) => {
      if (!isEmpty(stderr)) return console.log(colors.red(stderr))

      const { imageIds } = JSON.parse(stdout)
      const tags = compact(
        imageIds.map(
          img => (typeof img.imageTag === 'undefined' ? null : img.imageTag)
        )
      )

      inquirer
        .prompt({
          type: 'list',
          name: 'tag',
          message: 'Which version do you want to deploy?',
          choices: tags,
        })
        .then(answers => {
          imageTag = answers.tag
          console.log(colors.yellow(`Selected version ${imageTag} to deploy\n`))
          gen.next()
        })
        .catch(err => console.log(colors.red(err)))
    })
    .catch(err => console.log(colors.red(err)))
}

const deployService = () => {
  const deployCmd = `ecs-deploy --cluster ${cluster} --service-name ${serviceName} --image ${accountId}.dkr.ecr.${region}.amazonaws.com/${image}:${imageTag} --timeout ${timeout}`
  console.log(colors.green(`Running: ${deployCmd}`))
  shell(`${__dirname}/ecs-deploy.sh`, [
    '--cluster',
    cluster,
    '--service-name',
    serviceName,
    '--image',
    `${accountId}.dkr.ecr.${region}.amazonaws.com/${image}:${imageTag}`,
    '--timeout',
    timeout,
  ])
    .then(({ code }) => {
      if (code === 0) {
        console.log(colors.blue(`Successfully deployed ${serviceName}.\n`))
        return gen.next()
      }
      console.log(colors.red(`Build failed with error code: ${code}`))
    })
    .catch(err => console.log(colors.red(err)))
}

const deployTask = () => {
  const deployCmd = `ecs-deploy --cluster ${cluster} --task-definition ${taskDefinition} --image ${accountId}.dkr.ecr.${region}.amazonaws.com/${image}:${imageTag} --timeout ${timeout}`
  console.log(colors.green(`Running: ${deployCmd}`))
  shell(`${__dirname}/ecs-deploy.sh`, [
    '--cluster',
    cluster,
    '--task-definition',
    taskDefinition,
    '--image',
    `${accountId}.dkr.ecr.${region}.amazonaws.com/${image}:${imageTag}`,
    '--timeout',
    timeout,
  ])
    .then(({ code }) => {
      if (code === 0) {
        console.log(colors.blue(`Successfully deployed ${taskDefinition}.\n`))
        return gen.next()
      }
      console.log(colors.red(`Build failed with error code: ${code}`))
    })
    .catch(err => console.log(colors.red(err)))
}

function* build() {
  yield signInToAwsEcr()
  yield getAwsAccountId()
  if (isEmpty(imageTag)) {
    yield getImageTagVersion()
  }
  if (isEmpty(taskDefinition)) {
    yield deployService()
  } else {
    yield deployTask()
  }
}

/**
 * Execute the shell script
 */
gen = build()
gen.next()

/* eslint-enable no-console */
/* eslint-enable consistent-return */
