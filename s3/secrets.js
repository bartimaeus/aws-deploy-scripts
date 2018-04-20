#!/usr/bin/env node

/* eslint-disable no-console */
/* eslint-disable consistent-return */

// Adding relative path to node_modules because of issue finding
// colors and commander in the docker container when building the image
const colors = require('colors')
const program = require('commander')
const { exec } = require('child_process')

/**
 * Sync .env.$ENVIRONMENT file with an AWS encrypted S3 bucket
 */
program
  .version('0.0.1')
  .option(
    '-a, --action [value]',
    'Action can be either get or put; defaults to get.'
  )
  .option(
    '-b, --bucket [value]',
    'S3 bucket name used to keep secure environment files'
  )
  .option(
    '-e, --environment [value]',
    'The environment used to sync the environment variables (e.g., staging, beta, or production).'
  )
  .option('-p, --profile [value]', 'AWS CLI profile used to sync with S3')

program.parse(process.argv)

const { bucket, profile } = program
let { action, environment } = program

/**
 * Set default values in case they were not provided
 */
action = action || 'get'
environment = environment || 'staging'

if (typeof bucket === 'undefined' || bucket === null) {
  throw new Error('Missing s3 `--bucket` parameter.')
}
if (typeof profile === 'undefined' || profile === null) {
  throw new Error('Missing awscli `--profile` parameter.')
}

// AWS CLI function to call AWS commands
const aws = (execCommand, execOptions = {}) =>
  new Promise((resolve, reject) => {
    exec(execCommand, execOptions, (error, stdout, stderr) => {
      if (error) {
        const message = `error: '${error}' stdout = '${stdout}' stderr = '${stderr}'`
        console.error(colors.red(message))
        reject(message)
      }
      // console.log(`stdout: ${stdout}`)
      resolve({ stderr, stdout })
    })
  })

const getSecretsFile = () => {
  console.log(
    colors.green(
      `\n~> Fetching .env.${environment} secrets file to ${bucket}...`
    )
  )
  aws(
    `aws s3 cp s3://${bucket}/.env.${environment} s3.env.${environment}`
  ).then(({ stderr, stdout }) => {
    if (stderr) {
      console.log(colors.red(`stderr: ${stderr}`))
      return stderr
    }
    console.log('stdout', stdout)
    // const value = JSON.parse(stdout).Parameter.Value
  })
}

const putSecretsFile = () => {
  console.log(
    colors.green(
      `\n~> Pushing .env.${environment} secrets file from ${bucket}...`
    )
  )
  aws(
    `aws s3 cp ".env.${environment}" s3://${bucket}/.env.${environment} --sse`
  ).then(({ stderr, stdout }) => {
    if (stderr) {
      console.log(colors.red(`stderr: ${stderr}`))
      return stderr
    }
    console.log('stdout', stdout)
    // const value = JSON.parse(stdout).Parameter.Value
  })
}

/**
 * Execute the script
 */
if (action === 'put') {
  putSecretsFile()
} else {
  getSecretsFile()
}

/* eslint-enable no-console */
/* eslint-enable consistent-return */
