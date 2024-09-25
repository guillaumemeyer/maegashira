import { test, expect } from 'bun:test'
import { start, stop } from '../src/core.js'

test('forward', async () => {
  start({
    clustering: 1,
    port: 18083,
    redis: {
      host: 'localhost',
      port: 6379
    },
    routingTable: [{
      hostname: 'localhost',
      path: '',
      targets: [
        {
          type: 'forward',
          url: 'https://graph.microsoft.com'
        }
      ]
    }]
  })
  const graphResponse = await fetch('http://localhost:18083/v1.0')
  expect(graphResponse.status).toBe(200)
  const graphApiMetadata = graphResponse.json()
  expect(graphApiMetadata).toHaveProperty('@odata.context')
  expect(graphApiMetadata['@odata.context']).toBe('https://graph.microsoft.com/v1.0/$metadata')
  stop()
})
