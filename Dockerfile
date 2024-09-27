FROM oven/bun AS base
# use the official Bun image
# see all versions at https://hub.docker.com/r/oven/bun/tags
WORKDIR /maegashira

FROM base AS install
# install dependencies into temp directory
# this will cache them and speed up future builds
RUN mkdir -p /temp/dev
COPY package.json /temp/dev/
RUN cd /temp/dev && bun install
# install with --production (exclude devDependencies)
RUN mkdir -p /temp/prod
COPY package.json /temp/prod/
RUN cd /temp/prod && bun install --production

FROM base AS prerelease
# copy node_modules from temp directory
# then copy all (non-ignored) project files into the image
COPY --from=install /temp/dev/node_modules node_modules
COPY . .
# build
ENV NODE_ENV=production
RUN bun run build:cli

FROM base AS release
# copy production dependencies and source code into final image
COPY --from=install /temp/prod/node_modules node_modules
COPY --from=prerelease /maegashira/dist dist
COPY --from=prerelease /maegashira/package.json .
# install wget for healthcheck
RUN apt update && apt install -y wget && rm -rf /var/lib/apt/lists/*
# run the app
USER bun
EXPOSE 8080/tcp
ENTRYPOINT [ "bun", "run", "dist/build/maegashira-cli.js", "start" ]
