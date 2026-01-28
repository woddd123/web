# YaSo Docker 部署指南

本指南说明如何使用 Docker 部署 YaSo 应用程序。由于您选择使用云服务器本地的 MySQL，部署仅包含前端和后端容器。

## 架构说明

-   **前端 (端口 80)**: Nginx 服务，托管 React 静态文件并代理 API 请求。
-   **后端**: Node.js Express 服务器，连接到宿主机的 MySQL 数据库。
-   **数据库**: 使用宿主机本地运行的 MySQL。

## 前置条件

1.  **MySQL 数据库**: 确保您的服务器上已安装并运行 MySQL。
2.  **数据库配置**:
    -   创建一个名为 `yaso` 的数据库。
    -   确保数据库用户（默认为 `root`）有权限从 Docker 容器访问（建议允许 `root` 从任意主机 `%` 或特定网段访问，或者创建一个专用用户）。
    -   导入初始 Schema（如果有）：位于 `server/schema.sql`。

## 快速开始

1.  **配置数据库连接**:
    打开 `docker-compose.yml`，修改 backend 服务的环境变量以匹配您的本地 MySQL 配置：
    ```yaml
    environment:
      - DB_HOST=host.docker.internal # 指向宿主机
      - DB_USER=root                 # 修改为您的数据库用户名
      - DB_PASSWORD=root1234         # 修改为您的数据库密码
      - DB_NAME=yaso
    ```

2.  **启动服务**:
    在项目根目录下运行：
    ```bash
    docker-compose up -d --build
    ```

3.  **访问应用**:
    浏览器访问 `http://localhost` 或服务器 IP。

## 注意事项

-   **host.docker.internal**: 我们在 `docker-compose.yml` 中配置了 `extra_hosts`，使得容器可以通过 `host.docker.internal` 访问宿主机网络。
-   **防火墙/权限**: 如果后端无法连接数据库，请检查 MySQL 用户权限是否允许远程连接，以及服务器防火墙是否开放了 3306 端口（虽然 Docker 容器访问宿主机通常走内部网桥，但 MySQL 权限验证视来源 IP 而定）。

## 故障排查

-   **数据库连接失败**:
    -   检查 MySQL 是否运行。
    -   检查 `docker-compose.yml` 中的密码是否正确。
    -   尝试进入后端容器 ping 宿主机：`docker-compose exec backend ping host.docker.internal`。
