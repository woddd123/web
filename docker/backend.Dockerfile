FROM docker.xuanyuan.run/library/node:latest
WORKDIR /app

# Install production dependencies
COPY package.json package-lock.json ./
RUN npm install --omit=dev --omit=optional

# Copy server code
COPY server ./server

# Ensure uploads directory exists
RUN mkdir -p server/uploads

EXPOSE 3001
CMD ["node", "server/index.js"]
