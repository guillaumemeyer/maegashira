# Maegashira

A **fast** and **dynamic** reverse proxy based on the [Bun runtime](https://bun.sh/).  
It is designed to be easy to use, configure and extend, with:
- a simple configuration file format
- a RESTful API for managing the proxy
- a middleware system for adding custom logic

It is used to create full-featured custom reverse proxy for different apps, like [GraphShield](https://github.com/guillaumemeyer/graphshield), a reverse proxy specifically designed for the Microsoft Graph.

## Key Features

Routing:
- Hostname and path-based resolver
- HTTP Forwarding
- Customizable timeouts
- Static files serving
- Load balancing
- SSL offloading

Middlewares
- Pre-processing: Manipulating request headers, query string, and request bodies.
- Post-processing: Manipulating response headers, query string, and response bodies.

Clustering:
- Load balancing across worker process
- Load balancing across servers

Management API:
- Routing table: Defining routes and their corresponding targets.
- Proxy health checks: Monitoring the health of the proxy.
- Metrics: Collecting and exposing Prometheus metrics for monitoring and alerting.
- Protection through server name and API key.


## Quick Start

Run from npm:
```bash
bunx maegashira
```

Install globally from npm:
```bash
bun install -g maegashira
maegashira
```

Using Docker:
```bash
docker run -p 8080:8080 -p 8081:8081 maegashira
```



## Build your own reverse proxy

Look at the [custom-proxy](./examples/custom-proxy.js) example for a minimalistic example of a custom reverse proxy.

Run your proxy with:
```bash
bun myproxy.js
```

See [examples](./examples) for more details.

## Roadmap

Load balancing:
- Regular health monitoring of backend servers and rerouting traffic in case of failure
- Round-robin strategy
- Least connections strategy
- IP-hash strategy
- Sticky sessions strategy

Routing:
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

Logging:
- File transport
- OpenTelmetry integration
