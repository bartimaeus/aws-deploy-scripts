#!/usr/bin/env node

/* eslint-disable no-console */
/* eslint-disable consistent-return */

// Adding relative path to node_modules because of issue finding
// colors and commander in the docker container when building the image
const colors = require('colors')
const program = require('commander')
const { exec } = require('child_process')
const readline = require('readline')
const fs = require('fs')

/**
 * Sync .env environment variables with AWS Parameter Store
 */
program
  .version('0.2.0')
  .option(
    '-a, --action [value]',
    'Action can be either get or put; defaults to get.'
  )
  .option(
    '--debug',
    'Flag that prints out the keys rather than actually writing them to disk.'
  )
  .option(
    '-e, --environment [value]',
    'The environment used to build the environment variables (e.g., staging or production).'
  )
  .option(
    '-k, --key [value]',
    'Key id (or key alias) used by the parameter store to encrypt and decrypt parameters'
  )
  .option(
    '-l, --location [value]',
    'Location to write our environment variables (e.g., --location /etc/profile.d/env.sh)'
  )
  .option(
    '-p, --profile [value]',
    'Project prefix for classifying the build more than just environment.'
  )
  .option('-r, --region [value]', 'AWS region. Defaults to us-east-1')

program.parse(process.argv)

let { action, debug, environment, key, location, profile, region } = program

/**
 * Set default values in case they were not provided
 */
action = action || 'get'
debug = debug || false
environment = environment || 'staging'
key = key || 'default'
location = location || '/etc/profile.d/env.sh'
profile = profile || 'default'
region = region || 'us-east-1'

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

const getParameters = () => {
  console.log(colors.green(`~> Fetching [${environment}] environment keys...`))
  aws(
    `aws ssm get-parameter --name "${environment}.environment_keys" --with-decryption --region ${region}`
  ).then(({ stderr, stdout }) => {
    if (stderr) {
      console.log(colors.red(`stderr: ${stderr}`))
      return stderr
    }
    const response = JSON.parse(stdout)
    console.log(colors.yellow('KEYS:'), response.Parameter.Value)

    // Now read in each key/pair
    console.log(colors.green('\n~> Fetching individual variables...'))
    const keys = JSON.parse(response.Parameter.Value)
    const interval = 200 // delay api calls;
    for (let i = 0; i < keys.length; i += 1) {
      setTimeout(
        () => {
          aws(
            `aws ssm get-parameter --name "${environment}.${
              keys[i]
            }" --with-decryption --region ${region}`
          ).then(({ stderr: err, stdout: out }) => {
            if (err) {
              console.log(colors.red(`stderr: ${err}`))
              return err
            }
            const value = JSON.parse(out).Parameter.Value
            if (debug) {
              console.log(`${colors.blue(keys[i])}=${colors.cyan(value)}`)
            } else {
              console.log(
                `(${i}/${keys.length}) Downloaded ${colors.cyan(keys[i])}`
              )
              // Verify that location exists
              if (fs.existsSync(location)) {
                exec(`echo 'export ${keys[i]}=${value}' >> ${location}`)
              } else {
                // Create location and write environment variables to file
                fs.closeSync(fs.openSync(location, 'w', '0755'))
                exec(`echo 'export ${keys[i]}=${value}' >> ${location}`)
              }
            }
          })
        },
        interval * i,
        i
      )
    }
  })
}

const putParameters = () => {
  // Profile is manditory. We don't want to write variable(s) to the wrong AWS account
  if (typeof profile === 'undefined' || profile === null) {
    throw new Error('Missing aws profile!')
  }

  const variables = []
  const filename =
    environment === 'development' ? '.env' : `.env.${environment}`

  const rd = readline.createInterface({
    input: fs.createReadStream(filename),
    console: false,
  })

  rd.on('line', line => {
    if (line[0] !== '#' && line.length > 0) {
      const parts = line.split('=')
      variables.push({
        key: parts.slice(0, 1).join(' '),
        value: parts.slice(1) || null,
      })
    }
  })

  rd.on('close', () => {
    const keys = variables.map(variable => variable.key)
    console.log(
      colors.green(`~> Uploading [${environment}] environment keys...`)
    )
    aws(
      `aws ssm put-parameter --name "${environment}.environment_keys" --value '${JSON.stringify(
        keys
      )}' --type "SecureString" --overwrite --key-id ${key} --region ${region} --profile ${profile}`
    )
      .then(({ stderr }) => {
        if (stderr) {
          console.log(
            `Error uploading '${environment}.environment_keys' to Parameter Store. ERROR: ${stderr}`
          )
          return stderr
        }
        console.log(
          colors.yellow('UPLOADED:'),
          `"${environment}.environment_keys": ${JSON.stringify(keys)}`
        )
      })
      .then(() => {
        // Upload each environment variable
        console.log(colors.green('\n--> Uploading individual variables...'))
        const interval = 500 // delay api calls by 0.5 seconds;
        for (let i = 0; i < variables.length; i += 1) {
          setTimeout(
            () => {
              const variable = variables[i]

              aws(
                `aws ssm put-parameter --name '${environment}.${
                  variable.key
                }' --value '${
                  variable.value
                }' --type "SecureString" --overwrite --key-id ${key} --region ${region} --profile ${profile}`
              ).then(({ stderr }) => {
                if (stderr) {
                  console.log(
                    `Error uploading '${environment}.${
                      variable.key
                    }' to Parameter Store. ERROR: ${stderr}`
                  )
                  return stderr
                }
                console.log(
                  colors.yellow('UPLOADED:'),
                  `{ key: '${colors.cyan(variable.key)}', value: '${colors.cyan(
                    variable.value
                  )}' }`
                )
              })
            },
            interval * i,
            i
          )
        }
      })
  })
}

/**
 * Execute the script
 */
if (action === 'put') {
  putParameters()
} else {
  getParameters()
}

/* eslint-enable no-console */
/* eslint-enable consistent-return */
