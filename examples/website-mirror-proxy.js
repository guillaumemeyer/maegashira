import { start } from '../src/core.js'
// @ts-ignore
import routingTable from './routes/website-mirror-routes.json'

await start({
  clustering: 0,
  redis: {
    host: 'localhost',
    port: 6379,
    password: 'password'
  },
  port: 8080,
  api: {
    enabled: true,
    port: 8081,
    hostname: '0.0.0.0',
    key: 'secret'
  },
  // @ts-ignore
  routingTable
})
