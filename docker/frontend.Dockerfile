# Stage 1: Build
FROM docker.xuanyuan.run/library/node:latest as builder
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm install

# Copy source code
COPY . .

# Download model (using curl inside the container)
# RUN echo "deb [trusted=yes] http://mirrors.aliyun.com/debian/ bookworm main non-free non-free-firmware contrib" > /etc/apt/sources.list && \
#     echo "deb [trusted=yes] http://mirrors.aliyun.com/debian-security/ bookworm-security main non-free non-free-firmware contrib" >> /etc/apt/sources.list && \
#     echo "deb [trusted=yes] http://mirrors.aliyun.com/debian/ bookworm-updates main non-free non-free-firmware contrib" >> /etc/apt/sources.list && \
#     echo "deb [trusted=yes] http://mirrors.aliyun.com/debian/ bookworm-backports main non-free non-free-firmware contrib" >> /etc/apt/sources.list && \
#     apt-get update --allow-insecure-repositories && \
#     apt-get install -y --allow-unauthenticated curl && \
#     chmod +x download_models.sh && \
#     ./download_models.sh
RUN chmod +x download_models.sh && ./download_models.sh

# Build for production with empty base URL (relative paths)
ENV VITE_API_BASE_URL=""
RUN npm run build

# Stage 2: Serve
FROM docker.xuanyuan.run/library/node:latest

# Copy built assets
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy Nginx config
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
