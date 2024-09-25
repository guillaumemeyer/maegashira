import { ProxyError, ProxyErrorCause } from './errors.js'
import { logger } from './logger.js'
import { prefetchDns } from './routing-table.js'

/**
 * @typedef {object} DockerContainerConfiguration
 * @property {string} publicHostname - The host name
 * @property {string} publicPath - The path
 * @property {string} serviceName - The service name
 * @property {number} servicePort - The port
 */

/**
 * @function discoverRoutesFromDocker
 * @description Discover routes from Docker containers
 * @returns {Promise<import('./routing-table.js').RoutingTable>} The discovered routes
 * @throws {DiscoveryError} If the discovery failed
 * @see https://docs.docker.com/reference/api/engine/sdk/examples/
 * @see https://bun.sh/docs/api/fetch#unix-domain-sockets
 */
export async function discoverRoutesFromDocker () {
  // We don't lock the API version yet
  const dockerApiVersion = '' // 'v1.47'
  const dockerApiVersionPath = dockerApiVersion ? `/${dockerApiVersion}` : ''
  const dockerUrl = `http://localhost${dockerApiVersionPath}/containers/json`
  const dockerUnixSocket = '/var/run/docker.sock'
  try {
    logger.debug('Discovering routes from Docker containers...')
    const routingTable = []
    let containersResponse
    try {
      containersResponse = await fetch(dockerUrl, {
        // TODO: Check why TypeScript is not recognizing the unix option
        // @ts-ignore
        unix: dockerUnixSocket,
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      })
    } catch (error) {
      logger.warn({ error }, 'Failed to connect to Docker API')
      return []
    }
    if (!containersResponse.ok) {
      logger.warn({
        dockerApiVersion: dockerApiVersionPath,
        dockerUrl,
        dockerUnixSocket,
        status: containersResponse.status,
        statusText: containersResponse
      }, 'Failed to fetch Docker containers')
      return []
    }
    const containers = await containersResponse.json()
    logger.debug(containers, 'Discovered Docker containers')
    for (const container of containers) {
      /** @type {DockerContainerConfiguration} */
      const containerConfiguration = {
        publicHostname: '',
        publicPath: '',
        serviceName: '',
        servicePort: 3000
      }
      if (container.Labels) {
        // Labels is an object with keys
        for (const [labelName, labelValue] of Object.entries(container.Labels)) {
          switch (labelName) {
            case 'maegashira.public.hostname':
              containerConfiguration.publicHostname = labelValue
              break
            case 'maegashira.public.path':
              containerConfiguration.publicPath = labelValue
              break
            case 'maegashira.private.service_port':
              containerConfiguration.servicePort = parseInt(labelValue)
              break
          }
        }
      }
      if (!containerConfiguration.servicePort) {
        // Use the first private port from the container Config.ExposedPorts
        // Use /containers/ID/json to get the container detailed configuration

        const containerDetailsResponse = await fetch(`http://localhost${dockerApiVersionPath}/containers/${container.Id}/json`, {
          // TODO: Check why TypeScript is not recognizing the unix option
          // @ts-ignore
          unix: dockerUnixSocket,
          method: 'GET',
          headers: {
            'Content-Type': 'application/json'
          }
        })
        if (!containerDetailsResponse.ok) {
          logger.warn({
            dockerApiVersion: dockerApiVersionPath,
            dockerUrl,
            dockerUnixSocket,
            status: containerDetailsResponse.status,
            statusText: containerDetailsResponse
          }, 'Failed to fetch Docker container details')
          continue
        }

        // TODO: Use the private port defined in Ports if available
        // if (container.Ports && container.Ports.length > 0) {
        //   containerConfiguration.privatePort = container.Ports[0].PrivatePort
        // }
      }
      if (
        containerConfiguration.publicHostname && containerConfiguration.publicPath &&
        containerConfiguration.serviceName && containerConfiguration.servicePort
      ) {
        // Create a new route
        /** @type {import('./routing-table.js').Route} */
        const newRoute = {
          hostname: containerConfiguration.publicHostname,
          path: containerConfiguration.publicPath,
          loadBalancingStrategy: {
            type: 'random'
          },
          targets: [
            {
              type: 'forward',
              url: `http://${containerConfiguration.serviceName}:${containerConfiguration.servicePort}`
            }
          ]
        }
        routingTable.push(newRoute)
      }
    }
    prefetchDns()
    return routingTable
  } catch (error) {
    logger.error(error, 'Failed to discover routes from Docker containers')
    throw new DiscoveryError('Failed to discover routes from Docker containers',
      new ProxyErrorCause('Failed to discover routes from Docker containers', {
        dockerApiVersion: dockerApiVersionPath,
        dockerUrl,
        dockerUnixSocket
      }, error)
    )
  }
}

class DiscoveryError extends ProxyError { }
