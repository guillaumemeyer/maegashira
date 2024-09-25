import { start } from '../src/core.js'

await start({
  clustering: 0,
  redis: {
    host: 'localhost',
    port: 6379
  },
  port: 8080,
  api: {
    enabled: false,
    port: 8081,
    hostname: '0.0.0.0',
    key: 'secret'
  },
  middlewares: {
    preProcessing: [
      {
        key: 'microsoftGraphPreProcessing',
        handler: (state) => {
          console.log('Pre-processing', state)
          return state
        }
      }
    ],
    postProcessing: [
      {
        key: 'microsoftGraphPostProcessing',
        handler: (state) => {
          console.log('Post-processing', state)
          return state
        }
      }
    ]
  },
  routingTable: [
    {
      hostname: 'mk-api-debug-gme.majora.agency',
      path: '',
      middlewares: {
        preProcessing: [
          'microsoftGraphPreProcessing'
        ],
        postProcessing: [
          'microsoftGraphPostProcessing'
        ]
      },
      targets: [
        {
          type: 'forward',
          url: 'https://graph.microsoft.com'
        }
      ]
    }
  ]
})
