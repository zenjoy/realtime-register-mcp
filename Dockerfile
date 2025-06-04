
FROM node:22.12-alpine AS builder

WORKDIR /app

# Copy files required for installing dependencies
COPY package.json yarn.lock .yarnrc.yml ./
# Copy Yarn Berry specific files
COPY .yarn ./.yarn

# Install all dependencies (including devDependencies for building)
RUN corepack enable && \
    corepack prepare yarn@4.3.1 --activate && \
    yarn install --immutable

# Copy the rest of the source code and build configuration
COPY tsconfig.json ./
COPY src ./src/

# Build the application
# Ensure you have a "build" script in your package.json
RUN yarn build

FROM node:22-alpine AS release

WORKDIR /app

ENV NODE_ENV=production

# Copy files required for installing production dependencies
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn ./.yarn

RUN corepack enable && \
    corepack prepare yarn@4.3.1 --activate && \
    yarn install --immutable

# Copy the built application from the builder stage
COPY --from=builder /app/dist ./dist

# Install only production dependencies
RUN yarn install --immutable

ENTRYPOINT ["node", "dist/index.js"]