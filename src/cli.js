#!/usr/bin/env bun

// N.B: Multi-word options such as "--template-engine" are camel-cased, becoming program.opts().templateEngine etc.

import { file, env } from 'bun'
// @ts-ignore
import pck from '../package.json'
import { EOL } from 'node:os'
import { logger } from './libs/logger.js'
import { program, Option } from 'commander'
import { start } from './core.js'
import { checkRoutingTable } from './libs/routing-table.js'

const LOG_PREFIX = 'CLI:'

/**
 * Initialize the CLI
 * @returns {Promise<void>}
 */
async function init () {
  try {
    program
      // Main program info
      .name(pck.name)
      // Standard options
      .helpOption('-h, --help', 'Get help for a command.')
      .version(pck.version, '-v, --version', 'Output the current version')
      // Help options
      .configureHelp({
        sortSubcommands: false,
        sortOptions: false
      })
      .addHelpText('beforeAll', `${pck.description}${EOL}`)
      .addHelpText('afterAll', `${EOL}Copyright (c) 2024-${new Date().getFullYear()} ${pck.author}${EOL}`)
      .action(async (options) => {
        // Show help by default
        program.help()
      })

    program.command('start')
      .description('Start the proxy server.')
      .addOption(new Option(
        '-n, --hostname <hostname>',
        'The hostname to listen on.'
      ))
      .addOption(new Option(
        '-p, --port <port>',
        'The port to listen on.'
      ))
      .addOption(new Option(
        '-f, --file <path>',
        'The path to the routing table file.'
      ))
      .addOption(new Option(
        '-c, --clustering <clustering>',
        'The number of worker processes to start.'
      ))
      .addOption(new Option(
        '--redis-host <redisHost>',
        'The Redis host to use for clustering.'
      ))
      .addOption(new Option(
        '--redis-port <redisPort>',
        'The Redis port to use for clustering.'
      ))
      .addOption(new Option(
        '--redis-password <redisPassword>',
        'The Redis password to use for clustering.'
      ))
      .addOption(new Option(
        '--api-enabled <apiEnabled>',
        'Enable the API.'
      ))
      .addOption(new Option(
        '--api-hostname <apiHostname>',
        'The hostname to listen on for the API.'
      ))
      .addOption(new Option(
        '--api-port <apiPort>',
        'The port to listen on for the API.'
      ))
      .addOption(new Option(
        '--api-key <apiKey>',
        'The API key.'
      ))
      .action(async (options) => {
        logger.info(options)

        let routingTable = []
        if (options.file) {
          const routingTableFilePath = options.file
          const routingTableFile = file(routingTableFilePath)
          const routingTableFileExists = await routingTableFile.exists()
          if (!routingTableFileExists) {
            logger.error({ routingTableFilePath }, `${LOG_PREFIX} The routing table file "${routingTableFilePath}" does not exist.`)
            return
          }
          routingTable = await routingTableFile.json()
          const errors = checkRoutingTable(routingTable)
          if (errors && errors.length > 0) {
            logger.error(`${LOG_PREFIX} The routing table file "${routingTableFilePath}" contains errors:`)
            errors.forEach((error) => {
              logger.error(error)
            })
            return
          }
        }

        await start({
          hostname: options.hostname || env.MAEGASHIRA_HOSTNAME || '0.0.0.0',
          port: options.port || Number(env.MAEGASHIRA_PORT || 18080),
          clustering: options.clustering || env.MAEGASHIRA_CLUSTERING || 0,
          redis: {
            host: options.redisHost || env.MAEGASHIRA_REDIS_HOST || 'localhost',
            port: options.redisPort || Number(env.MAEGASHIRA_REDIS_PORT || 6379),
            password: options.redisPassword || env.MAEGASHIRA_REDIS_PASSWORD || null
          },
          api: {
            enabled: options.apiEnabled || env.MAEGASHIRA_API_ENABLED !== 'false',
            hostname: options.apiHostname || env.MAEGASHIRA_API_HOSTNAME || '0.0.0.0',
            port: options.apiPort || Number(env.MAEGASHIRA_API_PORT || 8081),
            key: options.apiKey || env.MAEGASHIRA_API_KEY || null
          },
          routingTable
        })
      })

    program.command('check')
      .description('Check a routing table file for errors.')
      .addOption(new Option(
        '-f, --file <path>',
        'The path to the routing table file to check.'
      )
        .makeOptionMandatory()
      )
      .action(async (options) => {
        const filePath = options.file
        const fileObject = file(filePath)
        const fileExists = await fileObject.exists()

        if (!fileExists) {
          logger.error({ filePath }, `${LOG_PREFIX} The file "${filePath}" does not exist.`)
          return
        }
        const routingTable = await fileObject.json()
        const errors = checkRoutingTable(routingTable)
        if (errors && errors.length > 0) {
          logger.error(`${LOG_PREFIX} The file "${filePath}" contains errors:`)
          errors.forEach((error) => {
            logger.error(error)
          })
          return
        }
        logger.info(`${LOG_PREFIX} The file "${filePath}" is valid.`)
      })

    program.parse()
  } catch (error) {
    logger.error({ error }, `${LOG_PREFIX} Error initializing CLI.`)
  }
}
init()
