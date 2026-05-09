/** 页面状态。 */
const state = {
  /** 控制台事件列表。 */
  events: [],
  /** Linux 风险类型列表。 */
  riskTypes: [],
  /** Linux 审批策略。 */
  approvalPolicy: undefined,
  /** 支持命令清单。 */
  supportedCommands: { mysql: [], redis: [] },
  /** 待审批事件映射。 */
  pendingApprovals: new Map(),
  /** WebSocket 连接对象。 */
  socket: undefined,
  /** 当前选中的输出来源。 */
  activeSource: "linux",
};

/** 页面元素引用。 */
const elements = {
  /** 连接状态。 */
  connectionState: document.querySelector("#connectionState"),
  /** Linux 输出窗口。 */
  linuxStream: document.querySelector("#linuxStream"),
  /** MySQL 输出窗口。 */
  mysqlStream: document.querySelector("#mysqlStream"),
  /** Redis 输出窗口。 */
  redisStream: document.querySelector("#redisStream"),
  /** Linux 事件数量。 */
  linuxCount: document.querySelector("#linuxCount"),
  /** MySQL 事件数量。 */
  mysqlCount: document.querySelector("#mysqlCount"),
  /** Redis 事件数量。 */
  redisCount: document.querySelector("#redisCount"),
  /** 审批策略列表。 */
  riskPolicyList: document.querySelector("#riskPolicyList"),
  /** 待审批列表。 */
  approvalList: document.querySelector("#approvalList"),
  /** 待审批弹窗。 */
  approvalModal: document.querySelector("#approvalModal"),
  /** 待审批数量。 */
  pendingCount: document.querySelector("#pendingCount"),
  /** MySQL 命令列表。 */
  mysqlCommands: document.querySelector("#mysqlCommands"),
  /** Redis 命令列表。 */
  redisCommands: document.querySelector("#redisCommands"),
  /** 输出选项卡按钮列表。 */
  streamTabs: document.querySelectorAll(".stream-tab"),
  /** 输出面板列表。 */
  streamPanels: document.querySelectorAll(".stream-panel"),
};

/** 最大渲染事件数量。 */
const MAX_RENDERED_EVENTS = 120;

/** 初始化页面。 */
function init() {
  renderEmptyState();
  bindStreamTabs();
  connectSocket();
}

/** 绑定输出选项卡点击事件。 */
function bindStreamTabs() {
  for (const tab of elements.streamTabs) {
    tab.addEventListener("click", () => {
      const source = tab.dataset.source;

      if (typeof source === "string") {
        switchStreamTab(source);
      }
    });
  }
}

/** 切换当前输出选项卡。 */
function switchStreamTab(source) {
  state.activeSource = source;

  for (const tab of elements.streamTabs) {
    const active = tab.dataset.source === source;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  }

  for (const panel of elements.streamPanels) {
    panel.classList.toggle("active", panel.dataset.source === source);
  }
}

/** 连接 WebSocket。 */
function connectSocket() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${window.location.host}/console/ws`);
  state.socket = socket;
  setConnectionState("连接中", "");

  socket.addEventListener("open", () => setConnectionState("已连接", "online"));
  socket.addEventListener("close", () => {
    setConnectionState("已断开，重连中", "offline");
    setTimeout(connectSocket, 1200);
  });
  socket.addEventListener("error", () => setConnectionState("连接异常", "offline"));
  socket.addEventListener("message", (event) => handleSocketMessage(event.data));
}

/** 处理 WebSocket 消息。 */
function handleSocketMessage(rawMessage) {
  const message = parseJson(rawMessage);

  if (!message || typeof message.type !== "string") {
    return;
  }

  if (message.type === "initial_state") {
    applyInitialState(message.payload);
    return;
  }

  if (message.type === "event") {
    appendEvent(message.payload);
    return;
  }

  if (message.type === "policy_state") {
    state.approvalPolicy = message.payload;
    renderPolicy();
  }
}

/** 应用初始状态。 */
function applyInitialState(payload) {
  state.events = Array.isArray(payload?.events) ? payload.events : [];
  state.riskTypes = Array.isArray(payload?.riskTypes) ? payload.riskTypes : [];
  state.approvalPolicy = payload?.approvalPolicy;
  state.supportedCommands = payload?.supportedCommands ?? { mysql: [], redis: [] };
  state.pendingApprovals = new Map();

  for (const event of state.events) {
    collectPendingApproval(event);
  }

  renderAll();
}

/** 追加控制台事件。 */
function appendEvent(event) {
  if (!event || typeof event.source !== "string") {
    return;
  }

  state.events.push(event);

  if (state.events.length > MAX_RENDERED_EVENTS) {
    state.events.splice(0, state.events.length - MAX_RENDERED_EVENTS);
  }

  collectPendingApproval(event);
  clearResolvedApproval(event);
  renderStreams();
  renderApprovals();
}

/** 收集待审批事件。 */
function collectPendingApproval(event) {
  if (event?.source !== "linux" || event?.direction !== "approval") {
    return;
  }

  const approvalId = event.data?.approvalId;

  if (typeof approvalId === "string") {
    state.pendingApprovals.set(approvalId, event);
    switchStreamTab("linux");
  }
}

/** 清理已处理审批事件。 */
function clearResolvedApproval(event) {
  const approvalId = event?.data?.approvalId;

  if (typeof approvalId === "string" && (event.direction === "output" || event.direction === "error")) {
    state.pendingApprovals.delete(approvalId);
  }
}

/** 渲染全部区域。 */
function renderAll() {
  renderPolicy();
  renderApprovals();
  renderCommands();
  renderStreams();
}

/** 渲染空状态。 */
function renderEmptyState() {
  elements.linuxStream.replaceChildren(createEmpty("等待 Linux 输出"));
  elements.mysqlStream.replaceChildren(createEmpty("等待 MySQL 输出"));
  elements.redisStream.replaceChildren(createEmpty("等待 Redis 输出"));
  elements.approvalList.replaceChildren(createEmpty("暂无待审批命令"));
  elements.riskPolicyList.replaceChildren(createEmpty("等待策略加载"));
  elements.mysqlCommands.replaceChildren(createEmpty("等待命令加载"));
  elements.redisCommands.replaceChildren(createEmpty("等待命令加载"));
}

/** 渲染审批策略。 */
function renderPolicy() {
  const policyMap = state.approvalPolicy?.linux?.requireApprovalByRiskType ?? {};
  const items = state.riskTypes.map((riskType) => {
    const item = document.createElement("label");
    item.className = "policy-item";

    const copy = document.createElement("span");
    const title = document.createElement("span");
    title.className = "policy-label";
    title.textContent = riskType.label;
    const desc = document.createElement("span");
    desc.className = "policy-desc";
    desc.textContent = riskType.description;
    copy.append(title, desc);

    const switchWrap = document.createElement("span");
    switchWrap.className = "switch";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = policyMap[riskType.type] !== false;
    checkbox.addEventListener("change", () => updatePolicy(riskType.type, checkbox.checked));
    const visual = document.createElement("span");
    switchWrap.append(checkbox, visual);
    item.append(copy, switchWrap);
    return item;
  });

  elements.riskPolicyList.replaceChildren(...(items.length ? items : [createEmpty("暂无审批策略")]));
}

/** 渲染待审批命令。 */
function renderApprovals() {
  const approvals = [...state.pendingApprovals.values()];
  const items = approvals.map((event) => createApprovalItem(event));
  elements.pendingCount.textContent = String(approvals.length);
  elements.approvalList.replaceChildren(...(items.length ? items : [createEmpty("暂无待审批命令")]));
  setApprovalModalVisible(approvals.length > 0);
}

/** 创建待审批命令项。 */
function createApprovalItem(event) {
  const item = document.createElement("article");
  item.className = "approval-item";

  const explanation = createApprovalExplanation(event);
  const commandList = createApprovalCommandList(event);

  const meta = document.createElement("div");
  meta.className = "approval-meta";
  meta.textContent = formatApprovalMeta(event.data);

  const actions = document.createElement("div");
  actions.className = "approval-actions";
  const approve = document.createElement("button");
  approve.type = "button";
  approve.textContent = "执行";
  approve.addEventListener("click", () => sendApproval(event.data?.approvalId, true));
  const reject = document.createElement("button");
  reject.type = "button";
  reject.textContent = "拒绝";
  reject.addEventListener("click", () => sendApproval(event.data?.approvalId, false));
  actions.append(approve, reject);
  item.append(explanation, commandList, meta, actions);
  return item;
}

/** 创建审批说明。 */
function createApprovalExplanation(event) {
  const explanation = document.createElement("div");
  explanation.className = "approval-explanation";
  explanation.textContent = event.data?.explanation ?? "未提供命令说明";
  return explanation;
}

/** 创建审批命令列表。 */
function createApprovalCommandList(event) {
  const list = document.createElement("div");
  list.className = "approval-command-list";
  const commands = Array.isArray(event.data?.commands) ? event.data.commands : [createFallbackApprovalCommand(event)];
  const rows = commands.map((command) => createApprovalCommandRow(command));
  list.replaceChildren(...rows);
  return list;
}

/** 创建兜底审批命令。 */
function createFallbackApprovalCommand(event) {
  return {
    command: event.data?.command ?? event.text,
    explanation: event.data?.explanation,
    approvalRequired: true,
    reasons: event.data?.reasons,
    riskTypes: event.data?.riskTypes,
  };
}

/** 创建审批命令行。 */
function createApprovalCommandRow(command) {
  const row = document.createElement("div");
  row.className = "approval-command-row";
  row.classList.toggle("danger", command?.approvalRequired === true);

  const desc = document.createElement("div");
  desc.className = "approval-command-desc";
  desc.textContent = command?.explanation ?? "未提供命令说明";

  const commandText = document.createElement("div");
  commandText.className = "approval-command";
  const commandLines = createApprovalCommandDisplayLines(command?.command ?? "");
  const lineNodes = commandLines.map((line) => createApprovalCommandLine(line));
  commandText.replaceChildren(...lineNodes);

  row.append(desc, commandText);
  return row;
}

/** 创建审批命令显示行。 */
function createApprovalCommandLine(line) {
  const lineNode = document.createElement("div");
  lineNode.className = "approval-command-line";
  lineNode.textContent = line;
  return lineNode;
}

/** 创建审批命令显示行列表。 */
function createApprovalCommandDisplayLines(commandText) {
  const normalizedCommand = String(commandText).trim();
  const shellScript = extractShellScriptFromWrapper(normalizedCommand);
  const displayText = shellScript ?? normalizedCommand;
  const lines = splitShellScriptDisplayLines(displayText);
  return lines.length > 0 ? lines : [normalizedCommand];
}

/** 提取 bash 或 sh -c 包装的脚本正文。 */
function extractShellScriptFromWrapper(commandText) {
  const shellWrapperMatch = commandText.match(/(?:^|\s|&&\s+)(?:bash|sh)\s+-[A-Za-z]*c\s+'/);

  if (!shellWrapperMatch || !commandText.endsWith("'")) {
    return undefined;
  }

  const scriptStart = (shellWrapperMatch.index ?? 0) + shellWrapperMatch[0].length;
  return commandText.slice(scriptStart, -1).replace(/'"'"'/g, "'");
}

/** 按 Shell 顶层分隔符拆分脚本显示行。 */
function splitShellScriptDisplayLines(scriptText) {
  const lines = [];
  let currentLine = "";
  let quote = "";
  let escaped = false;

  for (const char of scriptText) {
    if (escaped) {
      currentLine += char;
      escaped = false;
      continue;
    }

    if (char === "\\" && quote !== "'") {
      currentLine += char;
      escaped = true;
      continue;
    }

    if (char === "'" && quote !== "\"") {
      quote = quote === "'" ? "" : "'";
      currentLine += char;
      continue;
    }

    if (char === "\"" && quote !== "'") {
      quote = quote === "\"" ? "" : "\"";
      currentLine += char;
      continue;
    }

    if (!quote && (char === ";" || char === "\n" || char === "\r")) {
      appendApprovalCommandLine(lines, currentLine);
      currentLine = "";
      continue;
    }

    currentLine += char;
  }

  appendApprovalCommandLine(lines, currentLine);
  return lines;
}

/** 追加非空审批命令显示行。 */
function appendApprovalCommandLine(lines, line) {
  const trimmedLine = line.trim();

  if (trimmedLine) {
    lines.push(trimmedLine);
  }
}

/** 渲染支持命令。 */
function renderCommands() {
  renderCommandList(elements.mysqlCommands, state.supportedCommands.mysql ?? [], "mysql");
  renderCommandList(elements.redisCommands, state.supportedCommands.redis ?? [], "redis");
}

/** 渲染单个命令列表。 */
function renderCommandList(container, commands, source) {
  const items = commands.map((command) => {
    const item = document.createElement("article");
    item.className = "command-item";
    const name = document.createElement("div");
    name.className = "command-name";
    name.textContent = command.name;
    const desc = document.createElement("div");
    desc.className = "command-desc";
    desc.textContent = source === "redis" ? formatRedisCommand(command) : `${command.description} ${command.args}`;
    item.append(name, desc);
    return item;
  });

  container.replaceChildren(...(items.length ? items : [createEmpty("暂无支持命令")]));
}

/** 渲染输出窗口。 */
function renderStreams() {
  renderStream("linux", elements.linuxStream, elements.linuxCount);
  renderStream("mysql", elements.mysqlStream, elements.mysqlCount);
  renderStream("redis", elements.redisStream, elements.redisCount);
}

/** 渲染单个来源输出窗口。 */
function renderStream(source, container, counter) {
  const events = state.events.filter((event) => event.source === source).slice(-MAX_RENDERED_EVENTS);
  const items = events.map((event) => createEventItem(event));
  counter.textContent = `${events.length} 条`;
  container.replaceChildren(...(items.length ? items : [createEmpty(`等待 ${source} 输出`)]));
  container.scrollTop = container.scrollHeight;
}

/** 创建事件项。 */
function createEventItem(event) {
  const item = document.createElement("article");
  item.className = `event ${event.direction}`;

  const head = document.createElement("div");
  head.className = "event-head";
  const title = document.createElement("span");
  title.textContent = event.title;
  const time = document.createElement("time");
  time.textContent = formatTime(event.time);
  head.append(title, time);

  const text = document.createElement("div");
  text.className = "event-text";
  text.textContent = event.text;
  item.append(head, text);

  const tableRows = event.data?.tableRows;

  if (Array.isArray(tableRows) && tableRows.length > 0) {
    item.append(createTable(tableRows));
  }

  return item;
}

/** 创建表格。 */
function createTable(rows) {
  const table = document.createElement("table");
  table.className = "event-table";
  const columns = collectColumns(rows);
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");

  for (const column of columns) {
    const th = document.createElement("th");
    th.textContent = column;
    headRow.append(th);
  }

  thead.append(headRow);
  const tbody = document.createElement("tbody");

  for (const row of rows.slice(0, 80)) {
    const tr = document.createElement("tr");

    for (const column of columns) {
      const td = document.createElement("td");
      td.textContent = formatCell(row?.[column]);
      tr.append(td);
    }

    tbody.append(tr);
  }

  table.append(thead, tbody);
  return table;
}

/** 更新审批策略。 */
function updatePolicy(riskType, required) {
  sendSocketMessage({
    type: "policy_update",
    riskType,
    required,
  });
}

/** 发送审批结果。 */
function sendApproval(approvalId, approved) {
  if (typeof approvalId !== "string") {
    return;
  }

  sendSocketMessage({
    type: "approval_response",
    approvalId,
    approved,
  });
}

/** 设置待审批弹窗显示状态。 */
function setApprovalModalVisible(visible) {
  elements.approvalModal.classList.toggle("open", visible);
  elements.approvalModal.setAttribute("aria-hidden", String(!visible));
  document.body.classList.toggle("modal-open", visible);
}

/** 发送 WebSocket 消息。 */
function sendSocketMessage(message) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
    return;
  }

  state.socket.send(JSON.stringify(message));
}

/** 设置连接状态。 */
function setConnectionState(text, className) {
  elements.connectionState.textContent = text;
  elements.connectionState.className = `connection ${className}`.trim();
}

/** 创建空状态节点。 */
function createEmpty(text) {
  const node = document.createElement("div");
  node.className = "empty";
  node.textContent = text;
  return node;
}

/** 解析 JSON 文本。 */
function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/** 格式化时间。 */
function formatTime(value) {
  if (!value) {
    return "";
  }

  return new Date(value).toLocaleTimeString("zh-CN", { hour12: false });
}

/** 格式化审批元信息。 */
function formatApprovalMeta(data) {
  const server = data?.serverName ? `服务器：${data.serverName}` : "服务器：默认";
  const risks = Array.isArray(data?.riskTypes) ? `风险：${data.riskTypes.join(", ")}` : "风险：未知";
  const reasons = Array.isArray(data?.reasons) ? `原因：${data.reasons.join("；")}` : "";
  return [server, risks, reasons].filter(Boolean).join(" · ");
}

/** 格式化 Redis 命令说明。 */
function formatRedisCommand(command) {
  const maxArgs = command.maxArgs === undefined ? "不限" : command.maxArgs;
  return `${command.description} 参数：最少 ${command.minArgs} 个，最多 ${maxArgs} 个。`;
}

/** 收集表格列名。 */
function collectColumns(rows) {
  const columns = new Set();

  for (const row of rows) {
    if (row && typeof row === "object" && !Array.isArray(row)) {
      Object.keys(row).forEach((key) => columns.add(key));
    }
  }

  return [...columns];
}

/** 格式化单元格文本。 */
function formatCell(value) {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(value);
}

init();
