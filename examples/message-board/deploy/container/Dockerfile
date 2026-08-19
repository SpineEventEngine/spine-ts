ARG BASE_IMAGE=node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d
FROM ${BASE_IMAGE} AS packages

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY tarballs/ ./tarballs/
COPY pnpm-store.tgz /tools/pnpm-store.tgz
COPY pnpm.tgz /tools/pnpm.tgz
RUN mkdir /pnpm-store \
  && tar -xzf /tools/pnpm-store.tgz -C /pnpm-store \
  && corepack install -g --cache-only /tools/pnpm.tgz \
  && corepack pnpm install --offline --frozen-lockfile --prod --ignore-scripts --store-dir /pnpm-store \
  && rm -rf /pnpm-store tarballs /tools

FROM ${BASE_IMAGE} AS runtime

WORKDIR /app
ENV NODE_ENV=production
COPY --from=packages /app/node_modules ./node_modules
RUN find ./node_modules -type f \( -name '*.ts' -o -name '*.map' -o -name '*.tsbuildinfo' \) -delete \
  && find ./node_modules -type f -name '*.proto' ! -path '*/@google-cloud/datastore/build/protos/*' -delete \
  && find ./node_modules -type d \( -name test -o -name tests \) -prune -exec rm -rf {} +
ENTRYPOINT ["node"]

FROM runtime AS message-board
CMD ["node_modules/@spine-event-engine/example-message-board-app/dist/src/combined-entry.js"]

FROM runtime AS standalone-gateway
CMD ["node_modules/@spine-event-engine/example-message-board-app/dist/src/gateway-entry.js"]

FROM runtime AS simple-delivery-server
CMD ["node_modules/@spine-event-engine/delivery-server/dist/bin/spine-delivery-server.js"]

FROM runtime AS message-board-web
CMD ["node_modules/@spine-event-engine/example-message-board-web/scripts/static-server.mjs"]
