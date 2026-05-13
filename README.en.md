# Infra MCP

Infra MCP is a standalone HTTP MCP server that lets AI access server-configured MySQL, Redis, and deployment Linux command lines with project isolation.

Real connection details are stored only in `~/.infra-mcp/infra-mcp.server.config.json` under the user home directory. Installation or first startup also generates `~/.infra-mcp/infra-mcp.client.config.json` as a template. Each business project root should copy and maintain its own `infra-mcp.client.config.json`, which stores `projectKey` and the agent-facing `prompt`; do not store database, Redis, or SSH passwords there.

## Features

- `mysql_list_databases`: list databases visible to the current MySQL account, limited to 400 rows.
- `mysql_list_tables`: list tables in a specified database, limited to 400 rows.
- `mysql_select`: run only a single `SELECT` query, limited to 400 returned rows.
- `redis_query`: run only Redis commands from the read-only allowlist.
- `linux_exec`: run structured deployment Linux commands over SSH; pass `program`, `args`, `cwd`, and `explanation` for a single command, or pass a `commands` array for multiple commands. Do not wrap multiple commands with `bash -lc` or `sh -c`. Read-only diagnostic commands that match the allowlist run directly, while commands with side effects or unknown commands require confirmation in the web console.
- Web console: open `http://127.0.0.1:3120/console` to view separate MySQL, Redis, and Linux input/output streams, maintain Linux risk-type approval policy, and edit `~/.infra-mcp/infra-mcp.server.config.json` through a dynamic form.

## Usage

1. Install Node.js 20 or later.

2. Edit `~/.infra-mcp/infra-mcp.server.config.json` in the user home directory and fill in the real MySQL, Redis, and Linux SSH connections.

   Default Windows path:

   ```text
   %USERPROFILE%\.infra-mcp\infra-mcp.server.config.json
   ```

   Default macOS / Linux path:

   ```text
   ~/.infra-mcp/infra-mcp.server.config.json
   ```

   `http` configures the MCP HTTP service listener. Each entry in `projects` uses `projectKey` to match a client project config. `linuxServers` can configure one or more Linux servers; when there is only one server, `linux_exec` may omit `serverName`, and when there are multiple servers, the server name is required.

3. Start the server.

   If the runtime package was installed through npm, you can start it directly with:

   ```powershell
   infra
   ```

   This command starts the packaged Node entry and is intended for direct use after a global install.

   Double-click on Windows:

   ```text
   start.bat
   ```

   Or run in PowerShell:

   ```powershell
   .\start.ps1
   ```

   Double-click on macOS:

   ```text
   start.command
   ```

   If macOS reports missing execute permission, enter the service directory in a terminal and run:

   ```bash
   chmod +x start.command start.sh
   ```

   The release package does not include `node_modules`. The first startup automatically runs `npm install --omit=dev` to install runtime dependencies, and later startups reuse the installed dependencies. If the template files are missing under `~/.infra-mcp`, installation or first startup creates both the server config template and the client config template automatically.

4. After installation or first startup, `~/.infra-mcp/infra-mcp.client.config.json` is generated as a client template. Copy it into the business project root where MCP will be used, then edit it for the actual project:

   ```json
   {
     "projectKey": "my-project",
     "prompt": "Write agent-facing project query notes here, such as common databases, table meanings, Redis key prefixes, and query cautions. Do not include accounts, passwords, tokens, or other sensitive information."
   }
   ```

5. In the MCP client, use the HTTP address from `.mcp.json` to connect to this service:

   ```text
   http://127.0.0.1:3120/mcp
   ```

6. Open the web console to view tool output:

   ```text
   http://127.0.0.1:3120/console
   ```

   The browser connects to the server through `ws://127.0.0.1:3120/console/ws`. MySQL, Redis, and Linux output is separated, and input, output, error, and approval events use different colors.

7. Before using tools, the agent should read `infra-mcp.client.config.json` from the current business project root, follow its `prompt`, and then pass `projectKey` to MCP tools. The web console's Config tab edits only the server-side config and does not replace the project-root client config.

## Release Packaging

On Windows, double-click this file in the project root:

```text
package-release.bat
```

Or run in PowerShell:

```powershell
.\package-release.ps1
```

The script rebuilds and obfuscates the code, then outputs the runtime package to `release/infra-mcp-runtime` without creating a zip file. The release directory does not include `node_modules`; first startup installs runtime dependencies with `npm install --omit=dev` through `start.bat`, `start.ps1`, `start.command`, or `start.sh`.

After installation, the runtime package automatically runs `node dist/index.js --init-user-home` and generates `~/.infra-mcp/infra-mcp.server.config.json` and `~/.infra-mcp/infra-mcp.client.config.json` in the user home directory. The packaging script does not copy real local database, Redis, or SSH connection details into the release directory.

## Codex Configuration

Add the Infra MCP service configuration to the Codex user config file. The default Windows path is:

```text
%USERPROFILE%\.codex\config.toml
```

Example:

```toml
[mcp_servers.infra-mcp]
type = "streamable_http"
url = "http://127.0.0.1:3120/mcp"
startup_timeout_ms = 20000
tool_timeout_sec = 60
enabled = true
```

If `http.port` or `http.path` is changed in `~/.infra-mcp/infra-mcp.server.config.json`, update the port or path in the `url` above as well. After saving, restart Codex or reload the MCP server in Codex. Before use, keep the service directory's `start.bat`, `start.ps1`, or `start.command` window running.

The Codex config file should contain only the MCP service address, not database, Redis, or SSH accounts and passwords. Each business project still needs `infra-mcp.client.config.json` in its project root, and its `projectKey` must match a `projectKey` under the server-side `projects`.

## Server Config Example

`~/.infra-mcp/infra-mcp.server.config.json` example:

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
      "projectName": "My Project",
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

Linux SSH login supports passwords or private keys. For password login, fill in `password`; for private-key login, fill in `privateKeyPath`. Relative paths are resolved from the `~/.infra-mcp` directory.

## Security Notes

- MySQL exposes only database listing, table listing, and single `SELECT` queries. Writes and DDL are not allowed.
- Redis exposes only commands from the read-only allowlist.
- Linux automatic execution allows only simple commands formatted from structured input or pipelines made of read-only allowlisted commands.
- Linux commands that include `sudo`, multiple statements, redirection, background execution, command substitution, unknown commands, or suspected side-effect operations wait for confirmation in the web console.
- The Linux approval dialog lists each pending command with the Agent-provided `explanation`, and commands that trigger approval are highlighted in red.
- Linux approval is controlled by risk type, and the policy is stored in `~/.infra-mcp/infra-mcp.approval-policy.json` under the user home directory. Disabling approval for a risk type in the web console lets later commands of the same type run without manual confirmation.
- Do not listen on an untrusted network.
