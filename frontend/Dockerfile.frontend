# Build stage
FROM node:19-alpine AS build

WORKDIR /app

# Copy package files and install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy the rest of the code
COPY . .

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