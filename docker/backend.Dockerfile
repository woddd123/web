FROM node:20-alpine
WORKDIR /app

# Install production dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy server code
COPY server ./server

# Ensure uploads directory exists
RUN mkdir -p server/uploads

EXPOSE 3001
CMD ["node", "server/index.js"]
