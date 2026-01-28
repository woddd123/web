# YaSo Docker 部署指南

本指南说明如何使用 Docker 部署 YaSo 应用程序。部署包含三个容器：
1.  **前端 (Frontend)**: Nginx 服务，用于托管 React 静态文件并代理 API 请求。
2.  **后端 (Backend)**: Node.js Express 服务器。
3.  **数据库 (Database)**: MySQL。

## 前置条件

-   已安装 Docker
-   已安装 Docker Compose

## 快速开始

1.  进入项目根目录。
2.  运行以下命令构建并启动服务：

    ```bash
    docker-compose up -d --build
    ```

3.  访问 `http://localhost` 使用应用。

## 架构说明

-   **前端 (端口 80)**:
    -   使用 `docker/frontend.Dockerfile` 构建。
    -   采用多阶段构建 (Node 构建 -> Nginx 服务)。
    -   Nginx 通过 `docker/nginx.conf` 进行配置。
    -   将 `/api` 和 `/uploads` 请求代理到后端服务。

-   **后端 (内部端口 3001)**:
    -   使用 `docker/backend.Dockerfile` 构建。
    -   使用 `docker-compose.yml` 中定义的环境变量连接 `db` 服务。
    -   将上传的文件持久化存储到 `./server/uploads` (映射到宿主机)。

-   **数据库 (内部端口 3306)**:
    -   使用官方 `mysql:8.0` 镜像。
    -   将数据持久化存储到命名卷 `db_data`。

## 配置说明

-   **环境变量**: 数据库凭证和名称在 `docker-compose.yml` 中定义。
-   **API 基础 URL**: 前端配置为在生产环境中使用相对路径 (`/api`) (通过 `VITE_API_BASE_URL=""`)，允许 Nginx 处理路由。

## 故障排查

-   **数据库连接**: 如果后端最初无法连接到数据库，可能是因为数据库正在初始化。Docker Compose 会处理启动顺序，但如果需要，应用程序逻辑应重试连接。
-   **重建**: 如果修改了代码，需要重建镜像：
    ```bash
    docker-compose up -d --build
    ```
