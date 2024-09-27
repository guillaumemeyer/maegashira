```
  __  __                                        _       _                
 |  \/  |   __ _    ___    __ _    __ _   ___  | |__   (_)  _ __    __ _ 
 | |\/| |  / _` |  / _ \  / _` |  / _` | / __| | '_ \  | | | '__|  / _` |
 | |  | | | (_| | |  __/ | (_| | | (_| | \__ \ | | | | | | | |    | (_| |
 |_|  |_|  \__,_|  \___|  \__, |  \__,_| |___/ |_| |_| |_| |_|     \__,_|
                          |___/                                          
```
A **fast** and **dynamic** reverse proxy based on the [Bun runtime](https://bun.sh/), designed to be easy to use, configure and extend.  
Use it off-the-shelf from Docker, a CLI or build your own custom reverse proxy.

## Key Features
Routing:
- Hostname and path-based resolver
- HTTP Forwarding and static files serving
- Upstreams load balancing

Middlewares
- Write custom logic with JavaScript or TypeScript
- Pre-processing: Manipulating request headers, query string, and request body.
- Post-processing: Manipulating response headers, query string, and response body.

Clustering:
- Distribute workload across worker process
- Distribute workload across servers
- Centralized state with Redis

Management API:
- Routing table: Defining routes and their corresponding targets.
- Proxy health checks: Monitoring the health of the proxy.
- Metrics: Collecting and exposing Prometheus metrics for monitoring and alerting.

## Quick Start
The easieat way to get started is to use Docker:
```bash
docker run -p 8080:8080 -p 8081:8081 maegashira
```

Alternatively, if you have bun installed, you can run it directly:
```bash
bunx maegashira
```

Or install it globally:
```bash
bun install -g maegashira
maegashira
```

## Build your own reverse proxy
Look at the [custom-proxy](./examples/custom-proxy.js) example for a minimalistic example of a custom reverse proxy.

## Roadmap
Load balancing:
- Regular health monitoring of backend servers and rerouting traffic in case of failure
- Round-robin strategy
- Least connections strategy
- IP-hash strategy
- Sticky sessions strategy

Routing:
- SSL offloading
- Custom resolver middleware
- Host header rewriting
- "redirect" target type
- Retry strategies
- Rate limiting strategies
- Configurable caching strategies

Proxy:
- Support for websockets
- Support for HTTP/2
- Support for gRPC
- Support for HTTP/3

Discovery:
- Routes discovery from config file
- Routes discovery from config url
- Services and routes discovery from Docker
- Routes discovery from Kubernetes

Security:
- Support for forward targets basic authentication strategy
- Support for files-based TLS certificates
- Automatic certificate renewal via [Let's Encrypt](https://letsencrypt.org/)
- Web Application Firewall (WAF): Protection against common web vulnerabilities (e.g., SQL injection, XSS).
- IP filtering
- Rate limiting

Monitoring:
- File transport
- Prometheus metrics
- OpenTelmetry integration
