import { start } from '../src/core.js'
// @ts-ignore
import routingTable from './routes/microsoft-graph-routes.json'

await start({
  clustering: 0,
  redis: {
    host: 'localhost',
    port: 6379
  },
  port: 8080,
  api: {
    enabled: false
  },
  middlewares: {
    preProcessing: [
      {
        key: 'microsoftGraphPreProcessing',
        /**
         * @type {Function} handler
         * @param {import('../src/worker-process.js').PreProcessingMiddlewareState} state - The state object
         */
        handler: function microsoftGraphPreProcessingHandler (state) {
          console.log('Pre-processing', state)
          return state
        }
      }
    ],
    postProcessing: [
      {
        key: 'microsoftGraphPostProcessing',
        /**
         * @type {Function} handler
         * @param {import('../src/worker-process.js').PostProcessingMiddlewareState} state - The state object
         */
        handler: function microsoftGraphPostProcessingHandler (state) {
          console.log('Post-processing', state)
          return state
        }
      }
    ]
  },
  // @ts-ignore
  routingTable
})
