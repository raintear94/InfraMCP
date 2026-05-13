# Infra MCP

Infra MCP 是一个独立运行的 HTTP MCP Server，用于让 AI 按项目隔离访问服务端配置的 MySQL、Redis 和部署环境 Linux 命令行。

真实连接信息只保存在用户空间目录 `~/.infra-mcp/infra-mcp.server.config.json` 中。安装或首次启动时会自动生成 `~/.infra-mcp/infra-mcp.client.config.json` 模板，业务项目根目录只需要复制并维护自己的 `infra-mcp.client.config.json`，保存 `projectKey` 和给 Agent 看的 `prompt`，不要保存数据库、Redis 或 SSH 密码。

## 功能说明

- `mysql_list_databases`：列出当前 MySQL 账号可见数据库，最多返回 400 条。
- `mysql_list_tables`：列出指定数据库的表，最多返回 400 条。
- `mysql_select`：只允许执行单条 `SELECT` 查询，返回记录最多 400 条。
- `redis_query`：只允许执行 Redis 只读命令白名单。
- `linux_exec`：通过 SSH 执行结构化部署环境 Linux 命令；单命令传 `program`、`args`、`cwd`、`explanation`，多命令传 `commands` 数组，不要用 `bash -lc` 或 `sh -c` 包装多条命令。只读诊断命令命中白名单会直接执行，有副作用或未知命令会在网页控制台触发人工确认。
- 网页控制台：访问 `http://127.0.0.1:3120/console` 查看 MySQL、Redis、Linux 三类输入输出，维护 Linux 风险类型审批策略，并通过动态表单编辑保存 `~/.infra-mcp/infra-mcp.server.config.json`。

## 使用方式

1. 安装 Node.js 20 或更高版本。

2. 全局安装运行版包：

   ```powershell
   npm install -g infra-mcp-runtime
   ```

3. 直接启动服务端：

   ```powershell
   infra
   ```

   安装完成后会自动执行初始化；首次启动时如果 `~/.infra-mcp` 不存在模板文件，也会自动创建默认模板。

4. 配置文件会保存在用户空间目录 `~/.infra-mcp` 下。

   Windows 默认路径示例：

   ```text
   %USERPROFILE%\.infra-mcp\infra-mcp.server.config.json
   ```

   macOS / Linux 默认路径示例：

   ```text
   ~/.infra-mcp/infra-mcp.server.config.json
   ```

   客户端模板路径与它位于同一目录：

   ```text
   ~/.infra-mcp/infra-mcp.client.config.json
   ```

5. 打开网页控制台配置服务端：

   ```text
   http://127.0.0.1:3120/console
   ```

   网页控制台的“配置”页会通过动态表单保存 `~/.infra-mcp/infra-mcp.server.config.json`。这里配置 `http` 监听参数、`projects`、MySQL、Redis 和 Linux SSH 连接即可，不需要手动编辑服务端配置文件。

6. 首次安装或启动后，会在 `~/.infra-mcp/infra-mcp.client.config.json` 生成客户端模板。把它复制到需要使用 MCP 的业务项目根目录，再按项目实际情况修改：

   ```json
   {
     "projectKey": "my-project",
     "prompt": "这里填写给 Agent 的项目查询提示词，例如常用数据库、表含义、Redis key 前缀和查询注意事项；不要填写账号密码、token 等敏感信息。"
   }
   ```

7. 在 MCP 客户端中使用下面的 HTTP 地址连接本服务：

   ```text
   http://127.0.0.1:3120/mcp
   ```

8. 使用工具前，Agent 应先读取当前业务项目根目录的 `infra-mcp.client.config.json`，遵循其中 `prompt`，再把 `projectKey` 传给 MCP 工具。网页控制台的“配置”页只编辑服务端配置，不会替代业务项目根目录里的客户端配置。

## 发布打包

Windows 双击项目根目录的：

```text
package-release.bat
```

或在 PowerShell 中运行：

```powershell
.\package-release.ps1
```

脚本会重新构建并混淆代码，把运行版输出到 `release/infra-mcp-runtime`，不会生成压缩包。运行版包安装完成后可以直接通过 `infra` 命令启动。

运行版包安装完成后会自动执行 `node dist/index.js --init-user-home`，在用户空间生成 `~/.infra-mcp/infra-mcp.server.config.json` 与 `~/.infra-mcp/infra-mcp.client.config.json` 模板。打包脚本不会把开发环境里的真实数据库、Redis 或 SSH 连接信息复制到发布目录。

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

如果 `~/.infra-mcp/infra-mcp.server.config.json` 中修改过 `http.port` 或 `http.path`，需要同步修改上面 `url` 的端口或路径。保存后重启 Codex，或在 Codex 中重新加载 MCP Server。使用前只需要保持 `infra` 启动的服务进程正在运行。

Codex 配置文件只写 MCP 服务地址，不写数据库、Redis 或 SSH 账号密码。每个业务项目仍需要在项目根目录放置 `infra-mcp.client.config.json`，其中的 `projectKey` 必须和服务端 `projects` 中的 `projectKey` 一致。

## 安全说明

- MySQL 只开放数据库列表、表列表和单条 `SELECT` 查询，不允许写入或 DDL。
- Redis 只开放白名单内的只读命令。
- Linux 自动执行只允许结构化命令格式化后的简单命令或只读白名单命令组成的管道。
- Linux 命令包含 `sudo`、多语句、重定向、后台执行、命令替换、未知命令或疑似副作用操作时，会在网页控制台等待人工确认。
- Linux 审批弹窗会按列表显示待执行命令和 Agent 提供的 `explanation`，触发审批的命令会用红色强调。
- Linux 审批按风险类型控制，策略保存在用户空间目录的 `~/.infra-mcp/infra-mcp.approval-policy.json`。在网页取消某个风险类型的“需要审批”后，同类型命令后续会按策略免审批执行。
- 不要把 HTTP 服务监听到不可信网络。
