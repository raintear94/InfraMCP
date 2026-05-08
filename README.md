# Infra MCP

Infra MCP 是一个独立运行的 HTTP MCP Server，用于让 AI 按项目隔离访问服务端配置的 MySQL、Redis 和部署环境 Linux 命令行。

真实连接信息只保存在 Infra MCP 服务目录的 `infra-mcp.server.config.json` 中。业务项目根目录只需要放 `infra-mcp.client.config.json`，保存 `projectKey` 和给 Agent 看的 `prompt`，不要保存数据库、Redis 或 SSH 密码。

## 功能说明

- `mysql_list_databases`：列出当前 MySQL 账号可见数据库，最多返回 400 条。
- `mysql_list_tables`：列出指定数据库的表，最多返回 400 条。
- `mysql_select`：只允许执行单条 `SELECT` 查询，返回记录最多 400 条。
- `redis_query`：只允许执行 Redis 只读命令白名单。
- `linux_exec`：通过 SSH 执行部署环境 Linux Shell 命令；只读诊断命令命中白名单会直接执行，有副作用或未知命令会在服务端命令行窗口触发人工确认。

## 使用方式

1. 安装 Node.js 20 或更高版本。

2. 在 Infra MCP 服务目录编辑 `infra-mcp.server.config.json`，填写真实 MySQL、Redis 和 Linux SSH 连接。

   `http` 是 MCP HTTP 服务监听配置。`projects` 中每个项目使用 `projectKey` 匹配客户端项目配置。`linuxServers` 可以配置一台或多台 Linux 服务器；只有一台时调用 `linux_exec` 可省略 `serverName`，多台时必须传入服务器名称。

3. 启动服务端。

   Windows 双击：

   ```text
   start.bat
   ```

   或在 PowerShell 中运行：

   ```powershell
   .\start.ps1
   ```

   macOS 双击：

   ```text
   start.command
   ```

   如果 macOS 提示没有执行权限，先在终端进入服务目录执行：

   ```bash
   chmod +x start.command start.sh
   ```

   发布包不携带 `node_modules`。首次启动会自动执行 `npm install --omit=dev` 安装运行依赖，后续启动会直接复用已安装的依赖。

4. 在需要使用 MCP 的业务项目根目录创建 `infra-mcp.client.config.json`：

   ```json
   {
     "projectKey": "my-project",
     "prompt": "这里填写给 Agent 的项目查询提示词，例如常用数据库、表含义、Redis key 前缀和查询注意事项；不要填写账号密码、token 等敏感信息。"
   }
   ```

5. 在 MCP 客户端中使用 `.mcp.json` 里的 HTTP 地址连接本服务：

   ```text
   http://127.0.0.1:3120/mcp
   ```

6. 使用工具前，Agent 应先读取当前业务项目根目录的 `infra-mcp.client.config.json`，遵循其中 `prompt`，再把 `projectKey` 传给 MCP 工具。

## 发布打包

Windows 双击项目根目录的：

```text
package-release.bat
```

或在 PowerShell 中运行：

```powershell
.\package-release.ps1
```

脚本会重新构建并混淆代码，把运行版输出到 `release/infra-mcp-runtime`，不会生成压缩包。发布目录不包含 `node_modules`，首次启动由 `start.bat`、`start.ps1`、`start.command` 或 `start.sh` 自动执行 `npm install --omit=dev` 安装运行依赖。

打包脚本不会复制开发环境里的真实 `infra-mcp.server.config.json`，而是固定生成 demo 示例配置，避免把本机数据库、Redis 或 SSH 连接信息打包出去。发布后按实际环境修改 `release/infra-mcp-runtime/infra-mcp.server.config.json`。

## Codex 配置方式

在 Codex 的用户配置文件中添加 Infra MCP 服务配置。Windows 默认路径为：

```text
%USERPROFILE%\.codex\config.toml
```

示例：

```toml
[mcp_servers.infra-mcp]
type = "streamable_http"
url = "http://127.0.0.1:3120/mcp"
startup_timeout_ms = 20000
tool_timeout_sec = 60
enabled = true
```

如果 `infra-mcp.server.config.json` 中修改过 `http.port` 或 `http.path`，需要同步修改上面 `url` 的端口或路径。保存后重启 Codex，或在 Codex 中重新加载 MCP Server。使用前必须先保持服务目录的 `start.bat`、`start.ps1` 或 `start.command` 启动窗口运行。

Codex 配置文件只写 MCP 服务地址，不写数据库、Redis 或 SSH 账号密码。每个业务项目仍需要在项目根目录放置 `infra-mcp.client.config.json`，其中的 `projectKey` 必须和服务端 `projects` 中的 `projectKey` 一致。

## 服务端配置示例

`infra-mcp.server.config.json` 示例：

```json
{
  "http": {
    "host": "127.0.0.1",
    "port": 3120,
    "path": "/mcp",
    "logFullData": true
  },
  "projects": [
    {
      "projectKey": "my-project",
      "projectName": "我的项目",
      "mysql": {
        "host": "127.0.0.1",
        "port": 3306,
        "user": "root",
        "password": "password",
        "database": "",
        "connectionLimit": 5
      },
      "redis": {
        "host": "127.0.0.1",
        "port": 6379,
        "username": "",
        "password": "",
        "database": 0
      },
      "linuxServers": [
        {
          "name": "prod-1",
          "host": "127.0.0.1",
          "port": 22,
          "username": "deploy",
          "password": "",
          "privateKeyPath": ""
        }
      ]
    }
  ]
}
```

Linux SSH 登录支持密码或私钥。使用密码时填写 `password`；使用私钥时填写 `privateKeyPath`，相对路径以 Infra MCP 服务目录为基准。

## 安全说明

- MySQL 只开放数据库列表、表列表和单条 `SELECT` 查询，不允许写入或 DDL。
- Redis 只开放白名单内的只读命令。
- Linux 自动执行只允许简单命令或只读白名单命令组成的管道。
- Linux 命令包含 `sudo`、多语句、重定向、后台执行、命令替换、未知命令或疑似副作用操作时，必须在服务端命令行窗口人工确认。
- Linux 人工确认输入框会预填 `y`，直接回车会确认执行；删除 `y` 后输入其它内容会取消；最终只有输入内容为 `y` 才执行。
- 不要把 HTTP 服务监听到不可信网络。
