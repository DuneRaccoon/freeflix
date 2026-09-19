# Build stage
FROM node:19-alpine AS build

WORKDIR /app

# Copy package files and install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy the rest of the code
COPY . .

# next build resolves next.config.ts's rewrites() and BAKES the destinations into
# .next/routes-manifest.json, so this has to be set at BUILD time, not just at runtime.
# Without it the /api/* proxy is frozen at the localhost fallback and every API call
# from the browser fails with ECONNREFUSED inside the container.
ARG BACKEND_INTERNAL_URL=http://backend:8000
ENV BACKEND_INTERNAL_URL=$BACKEND_INTERNAL_URL

# Build the application
RUN npm run build

# Production stage
FROM node:19-alpine AS runner

WORKDIR /app

# Environment variables
ENV NODE_ENV=production

# Copy necessary files from build stage
COPY --from=build /app/next.config.ts ./
COPY --from=build /app/public ./public
COPY --from=build /app/.next ./.next
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json

# Expose the port
EXPOSE 3000

# Run the application
CMD ["npm", "start"]