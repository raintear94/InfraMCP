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
  /** 当前选中的工作区。 */
  activeSource: "linux",
  /** 当前配置状态。 */
  configState: undefined,
  /** 当前配置是否有未保存变更。 */
  configDirty: false,
};

/** 页面元素引用。 */
const elements = {
  /** 连接状态。 */
  connectionState: document.querySelector("#connectionState"),
  /** 配置保存状态。 */
  configSaveState: document.querySelector("#configSaveState"),
  /** 配置路径列表。 */
  configPathList: document.querySelector("#configPathList"),
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
  /** 配置面板提示。 */
  configPanelHint: document.querySelector("#configPanelHint"),
  /** 配置编辑容器。 */
  configEditor: document.querySelector("#configEditor"),
  /** 配置保存按钮。 */
  saveConfigButton: document.querySelector("#saveConfigButton"),
};

/** 最大渲染事件数量。 */
const MAX_RENDERED_EVENTS = 120;

/** 初始化页面。 */
function init() {
  renderEmptyState();
  bindStreamTabs();
  bindConfigActions();
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

/** 绑定配置保存事件。 */
function bindConfigActions() {
  elements.saveConfigButton.addEventListener("click", () => {
    saveServerConfig();
  });
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
    return;
  }

  if (message.type === "config_state") {
    applyConfigState(message.payload, false);
    return;
  }

  if (message.type === "config_save_result") {
    applyConfigSaveResult(message.payload);
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

  applyConfigState(payload?.configState, true);
  renderAll();
}

/** 应用当前配置状态。 */
function applyConfigState(configState, resetDirty) {
  state.configState = cloneJson(configState);

  if (resetDirty) {
    state.configDirty = false;
    setConfigSaveState("配置已同步", "success");
  }

  renderConfigPaths();
  renderConfigEditor();
}

/** 应用配置保存结果。 */
function applyConfigSaveResult(payload) {
  const success = payload?.success === true;
  const message = typeof payload?.message === "string" ? payload.message : success ? "配置已保存" : "配置保存失败";
  state.configDirty = !success;
  setConfigSaveState(message, success ? "success" : "error");
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
  renderConfigPaths();
  renderConfigEditor();
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
  elements.configPathList.replaceChildren(createEmpty("等待配置路径加载"));
  elements.configEditor.replaceChildren(createEmpty("等待配置加载"));
  setConfigSaveState("等待配置加载", "");
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

/** 渲染配置路径信息。 */
function renderConfigPaths() {
  const configState = state.configState;

  if (!configState) {
    elements.configPathList.replaceChildren(createEmpty("等待配置路径加载"));
    elements.configPanelHint.textContent = "修改后会写入用户空间配置文件";
    return;
  }

  const items = [
    createPathCard("服务端配置", configState.serverConfigPath),
    createPathCard("客户端模板", configState.clientConfigPath),
  ];

  elements.configPathList.replaceChildren(...items);
  elements.configPanelHint.textContent = `服务端配置保存路径：${configState.serverConfigPath}`;
}

/** 渲染配置编辑器。 */
function renderConfigEditor() {
  const serverConfig = state.configState?.serverConfig;

  if (!serverConfig) {
    elements.configEditor.replaceChildren(createEmpty("等待配置加载"));
    elements.saveConfigButton.disabled = true;
    return;
  }

  elements.saveConfigButton.disabled = false;

  const stack = document.createElement("div");
  stack.className = "config-stack";
  stack.append(
    createConfigIntroCard(),
    createHttpConfigCard(serverConfig.http ?? {}),
    createProjectsConfigCard(serverConfig.projects ?? []),
    createClientTemplateCard(state.configState?.clientConfig),
  );

  elements.configEditor.replaceChildren(stack);
}

/** 创建配置说明卡片。 */
function createConfigIntroCard() {
  const card = document.createElement("section");
  card.className = "config-card";

  const title = document.createElement("h3");
  title.textContent = "编辑说明";
  const subtitle = document.createElement("p");
  subtitle.className = "card-subtitle";
  subtitle.textContent = "服务端配置保存后立即落盘到用户空间；如修改 HTTP 监听地址、端口或路径，需要重启服务后才会实际生效。";

  card.append(title, subtitle);
  return card;
}

/** 创建 HTTP 配置卡片。 */
function createHttpConfigCard(httpConfig) {
  const card = document.createElement("section");
  card.className = "config-card";

  const head = document.createElement("div");
  head.className = "section-head";
  const title = document.createElement("h3");
  title.textContent = "HTTP 服务";
  const hint = document.createElement("span");
  hint.textContent = "启动参数";
  head.append(title, hint);

  const grid = document.createElement("div");
  grid.className = "form-grid";
  grid.append(
    createTextField("监听主机", httpConfig.host, "例如 127.0.0.1", (value) => updateHttpField("host", value)),
    createNumberField("监听端口", httpConfig.port, "1-65535", (value) => updateHttpField("port", value)),
    createTextField("MCP 路径", httpConfig.path, "例如 /mcp", (value) => updateHttpField("path", value)),
    createToggleField("记录完整请求和返回", httpConfig.logFullData === true, (value) => updateHttpField("logFullData", value)),
  );

  card.append(head, grid);
  return card;
}

/** 创建项目配置卡片。 */
function createProjectsConfigCard(projects) {
  const card = document.createElement("section");
  card.className = "config-card";

  const head = document.createElement("div");
  head.className = "section-head";
  const title = document.createElement("h3");
  title.textContent = "项目列表";
  const actions = document.createElement("div");
  actions.className = "section-actions";
  actions.append(createButton("新增项目", "secondary-button", () => addProject()));
  head.append(title, actions);

  const list = document.createElement("div");
  list.className = "config-project-list";
  const cards = projects.map((project, index) => createProjectCard(project, index));
  list.replaceChildren(...(cards.length ? cards : [createEmpty("暂无项目配置，点击“新增项目”开始配置")]));

  card.append(head, list);
  return card;
}

/** 创建单个项目配置卡片。 */
function createProjectCard(project, projectIndex) {
  const card = document.createElement("section");
  card.className = "config-card";

  const head = document.createElement("div");
  head.className = "section-head";
  const title = document.createElement("h3");
  title.textContent = `项目 ${projectIndex + 1}`;
  const actions = document.createElement("div");
  actions.className = "card-actions";
  actions.append(createButton("删除项目", "danger-button", () => removeProject(projectIndex)));
  head.append(title, actions);

  const projectGrid = document.createElement("div");
  projectGrid.className = "form-grid";
  projectGrid.append(
    createTextField("项目 Key", project.projectKey, "例如 demo-project", (value) => updateProjectField(projectIndex, "projectKey", value)),
    createTextField("项目名称", project.projectName, "例如 Demo Project", (value) => updateProjectField(projectIndex, "projectName", value)),
  );

  const auxList = document.createElement("div");
  auxList.className = "config-aux-list";
  auxList.append(
    createMySqlCard(project, projectIndex),
    createRedisCard(project, projectIndex),
    createLinuxServersCard(project, projectIndex),
  );

  card.append(head, projectGrid, auxList);
  return card;
}

/** 创建 MySQL 配置区域。 */
function createMySqlCard(project, projectIndex) {
  const mysqlConfig = project.mysql;
  const card = document.createElement("section");
  card.className = "preview-card";

  const head = document.createElement("div");
  head.className = "section-head";
  const title = document.createElement("h3");
  title.textContent = "MySQL";
  const actions = document.createElement("div");
  actions.className = "card-actions";

  if (mysqlConfig) {
    actions.append(createButton("移除 MySQL", "danger-button", () => removeProjectMySql(projectIndex)));
  } else {
    actions.append(createButton("启用 MySQL", "secondary-button", () => addProjectMySql(projectIndex)));
  }

  head.append(title, actions);
  card.append(head);

  if (!mysqlConfig) {
    card.append(createEmpty("当前项目未配置 MySQL"));
    return card;
  }

  const grid = document.createElement("div");
  grid.className = "form-grid";
  grid.append(
    createTextField("主机", mysqlConfig.host, "例如 127.0.0.1", (value) => updateProjectMySqlField(projectIndex, "host", value)),
    createNumberField("端口", mysqlConfig.port, "例如 3306", (value) => updateProjectMySqlField(projectIndex, "port", value)),
    createTextField("用户名", mysqlConfig.user, "例如 root", (value) => updateProjectMySqlField(projectIndex, "user", value)),
    createTextField("密码", mysqlConfig.password, "数据库密码", (value) => updateProjectMySqlField(projectIndex, "password", value)),
    createTextField("默认数据库", mysqlConfig.database, "可留空", (value) => updateProjectMySqlField(projectIndex, "database", value)),
    createNumberField("连接池大小", mysqlConfig.connectionLimit, "默认 5", (value) => updateProjectMySqlField(projectIndex, "connectionLimit", value)),
  );

  card.append(grid);
  return card;
}

/** 创建 Redis 配置区域。 */
function createRedisCard(project, projectIndex) {
  const redisConfig = project.redis;
  const card = document.createElement("section");
  card.className = "preview-card";

  const head = document.createElement("div");
  head.className = "section-head";
  const title = document.createElement("h3");
  title.textContent = "Redis";
  const actions = document.createElement("div");
  actions.className = "card-actions";

  if (redisConfig) {
    actions.append(createButton("移除 Redis", "danger-button", () => removeProjectRedis(projectIndex)));
  } else {
    actions.append(createButton("启用 Redis", "secondary-button", () => addProjectRedis(projectIndex)));
  }

  head.append(title, actions);
  card.append(head);

  if (!redisConfig) {
    card.append(createEmpty("当前项目未配置 Redis"));
    return card;
  }

  const grid = document.createElement("div");
  grid.className = "form-grid";
  grid.append(
    createTextField("主机", redisConfig.host, "例如 127.0.0.1", (value) => updateProjectRedisField(projectIndex, "host", value)),
    createNumberField("端口", redisConfig.port, "例如 6379", (value) => updateProjectRedisField(projectIndex, "port", value)),
    createTextField("用户名", redisConfig.username, "普通 Redis 可留空", (value) => updateProjectRedisField(projectIndex, "username", value)),
    createTextField("密码", redisConfig.password, "可留空", (value) => updateProjectRedisField(projectIndex, "password", value)),
    createNumberField("数据库编号", redisConfig.database, "默认 0", (value) => updateProjectRedisField(projectIndex, "database", value)),
  );

  card.append(grid);
  return card;
}

/** 创建 Linux 服务器配置区域。 */
function createLinuxServersCard(project, projectIndex) {
  const linuxServers = Array.isArray(project.linuxServers) ? project.linuxServers : [];
  const card = document.createElement("section");
  card.className = "preview-card";

  const head = document.createElement("div");
  head.className = "section-head";
  const title = document.createElement("h3");
  title.textContent = "Linux 服务器";
  const actions = document.createElement("div");
  actions.className = "card-actions";
  actions.append(createButton("新增服务器", "secondary-button", () => addLinuxServer(projectIndex)));
  head.append(title, actions);

  const list = document.createElement("div");
  list.className = "server-list";
  const cards = linuxServers.map((server, serverIndex) => createLinuxServerCard(server, projectIndex, serverIndex));
  list.replaceChildren(...(cards.length ? cards : [createEmpty("当前项目未配置 Linux 服务器")]));

  card.append(head, list);
  return card;
}

/** 创建单个 Linux 服务器卡片。 */
function createLinuxServerCard(server, projectIndex, serverIndex) {
  const card = document.createElement("article");
  card.className = "server-card";

  const head = document.createElement("div");
  head.className = "section-head";
  const title = document.createElement("h3");
  title.textContent = `服务器 ${serverIndex + 1}`;
  const actions = document.createElement("div");
  actions.className = "card-actions";
  actions.append(createButton("删除服务器", "danger-button", () => removeLinuxServer(projectIndex, serverIndex)));
  head.append(title, actions);

  const grid = document.createElement("div");
  grid.className = "form-grid";
  grid.append(
    createTextField("名称", server.name, "例如 prod-1", (value) => updateLinuxServerField(projectIndex, serverIndex, "name", value)),
    createTextField("主机", server.host, "例如 192.168.1.10", (value) => updateLinuxServerField(projectIndex, serverIndex, "host", value)),
    createNumberField("端口", server.port, "例如 22", (value) => updateLinuxServerField(projectIndex, serverIndex, "port", value)),
    createTextField("用户名", server.username, "例如 deploy", (value) => updateLinuxServerField(projectIndex, serverIndex, "username", value)),
    createTextField("密码", server.password, "可留空", (value) => updateLinuxServerField(projectIndex, serverIndex, "password", value)),
    createTextField("私钥路径", server.privateKeyPath, "相对 .infra-mcp 目录", (value) => updateLinuxServerField(projectIndex, serverIndex, "privateKeyPath", value)),
  );

  card.append(head, grid);
  return card;
}

/** 创建客户端模板预览卡片。 */
function createClientTemplateCard(clientConfig) {
  const card = document.createElement("section");
  card.className = "config-card";

  const head = document.createElement("div");
  head.className = "section-head";
  const title = document.createElement("h3");
  title.textContent = "客户端模板";
  const hint = document.createElement("span");
  hint.textContent = "安装时同步生成";
  head.append(title, hint);

  const subtitle = document.createElement("p");
  subtitle.className = "card-subtitle";
  subtitle.textContent = "该模板会写入用户空间，供复制到业务项目根目录后再按实际项目修改。";

  const preview = document.createElement("pre");
  preview.className = "preview-json";
  preview.textContent = JSON.stringify(clientConfig ?? {}, null, 2);

  card.append(head, subtitle, preview);
  return card;
}

/** 创建文本输入字段。 */
function createTextField(label, value, placeholder, onInput) {
  const field = document.createElement("label");
  field.className = "field";

  const title = document.createElement("span");
  title.className = "field-label";
  title.textContent = label;

  const input = document.createElement("input");
  input.type = "text";
  input.value = toDisplayString(value);
  input.placeholder = placeholder;
  input.addEventListener("input", () => onInput(input.value));

  field.append(title, input);
  return field;
}

/** 创建数字输入字段。 */
function createNumberField(label, value, placeholder, onInput) {
  const field = document.createElement("label");
  field.className = "field";

  const title = document.createElement("span");
  title.className = "field-label";
  title.textContent = label;

  const input = document.createElement("input");
  input.type = "number";
  input.value = value === undefined || value === null ? "" : String(value);
  input.placeholder = placeholder;
  input.addEventListener("input", () => onInput(parseNumberInput(input.value)));

  field.append(title, input);
  return field;
}

/** 创建布尔开关字段。 */
function createToggleField(label, checked, onChange) {
  const field = document.createElement("div");
  field.className = "field";

  const title = document.createElement("span");
  title.className = "field-label";
  title.textContent = label;

  const toggle = document.createElement("label");
  toggle.className = "toggle-field";
  const text = document.createElement("span");
  text.className = "field-hint";
  text.textContent = checked ? "开启" : "关闭";
  const switchWrap = document.createElement("span");
  switchWrap.className = "switch";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.addEventListener("change", () => {
    text.textContent = input.checked ? "开启" : "关闭";
    onChange(input.checked);
  });
  const visual = document.createElement("span");
  switchWrap.append(input, visual);
  toggle.append(text, switchWrap);

  field.append(title, toggle);
  return field;
}

/** 创建按钮。 */
function createButton(text, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  button.addEventListener("click", onClick);
  return button;
}

/** 创建配置路径卡片。 */
function createPathCard(label, value) {
  const card = document.createElement("article");
  card.className = "path-card";

  const title = document.createElement("div");
  title.className = "path-label";
  title.textContent = label;

  const body = document.createElement("div");
  body.className = "path-value";
  body.textContent = value ?? "未提供";

  card.append(title, body);
  return card;
}

/** 新增项目。 */
function addProject() {
  updateEditableServerConfig((serverConfig) => {
    serverConfig.projects = Array.isArray(serverConfig.projects) ? serverConfig.projects : [];
    serverConfig.projects.push(createDefaultProjectConfig());
  }, true);
}

/** 删除项目。 */
function removeProject(projectIndex) {
  updateEditableServerConfig((serverConfig) => {
    serverConfig.projects.splice(projectIndex, 1);
  }, true);
}

/** 更新 HTTP 字段。 */
function updateHttpField(fieldName, value) {
  updateEditableServerConfig((serverConfig) => {
    serverConfig.http[fieldName] = value;
  });
}

/** 更新项目字段。 */
function updateProjectField(projectIndex, fieldName, value) {
  updateEditableServerConfig((serverConfig) => {
    serverConfig.projects[projectIndex][fieldName] = normalizeOptionalString(value);
  });
}

/** 启用项目 MySQL 配置。 */
function addProjectMySql(projectIndex) {
  updateEditableServerConfig((serverConfig) => {
    serverConfig.projects[projectIndex].mysql = createDefaultMySqlConfig();
  }, true);
}

/** 移除项目 MySQL 配置。 */
function removeProjectMySql(projectIndex) {
  updateEditableServerConfig((serverConfig) => {
    delete serverConfig.projects[projectIndex].mysql;
  }, true);
}

/** 更新项目 MySQL 字段。 */
function updateProjectMySqlField(projectIndex, fieldName, value) {
  updateEditableServerConfig((serverConfig) => {
    serverConfig.projects[projectIndex].mysql[fieldName] = normalizeConfigValue(value);
  });
}

/** 启用项目 Redis 配置。 */
function addProjectRedis(projectIndex) {
  updateEditableServerConfig((serverConfig) => {
    serverConfig.projects[projectIndex].redis = createDefaultRedisConfig();
  }, true);
}

/** 移除项目 Redis 配置。 */
function removeProjectRedis(projectIndex) {
  updateEditableServerConfig((serverConfig) => {
    delete serverConfig.projects[projectIndex].redis;
  }, true);
}

/** 更新项目 Redis 字段。 */
function updateProjectRedisField(projectIndex, fieldName, value) {
  updateEditableServerConfig((serverConfig) => {
    serverConfig.projects[projectIndex].redis[fieldName] = normalizeConfigValue(value);
  });
}

/** 新增 Linux 服务器。 */
function addLinuxServer(projectIndex) {
  updateEditableServerConfig((serverConfig) => {
    const project = serverConfig.projects[projectIndex];
    project.linuxServers = Array.isArray(project.linuxServers) ? project.linuxServers : [];
    project.linuxServers.push(createDefaultLinuxServerConfig(project.linuxServers.length + 1));
  }, true);
}

/** 删除 Linux 服务器。 */
function removeLinuxServer(projectIndex, serverIndex) {
  updateEditableServerConfig((serverConfig) => {
    serverConfig.projects[projectIndex].linuxServers.splice(serverIndex, 1);
  }, true);
}

/** 更新 Linux 服务器字段。 */
function updateLinuxServerField(projectIndex, serverIndex, fieldName, value) {
  updateEditableServerConfig((serverConfig) => {
    serverConfig.projects[projectIndex].linuxServers[serverIndex][fieldName] = normalizeConfigValue(value);
  });
}

/** 更新可编辑服务端配置。 */
function updateEditableServerConfig(mutator, shouldRerender) {
  const serverConfig = state.configState?.serverConfig;

  if (!serverConfig) {
    return;
  }

  mutator(serverConfig);
  state.configDirty = true;
  setConfigSaveState("有未保存更改", "");

  if (shouldRerender) {
    renderConfigEditor();
  }
}

/** 保存服务端配置。 */
function saveServerConfig() {
  if (!state.configState?.serverConfig) {
    return;
  }

  setConfigSaveState("正在保存配置", "");
  sendSocketMessage({
    type: "config_save",
    serverConfig: state.configState.serverConfig,
  });
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
    /** 实际命令文本。 */
    command: event.data?.command ?? event.text,
    /** 命令说明。 */
    explanation: event.data?.explanation,
    /** 当前命令是否需要审批。 */
    approvalRequired: true,
    /** 风险原因列表。 */
    reasons: event.data?.reasons,
    /** 风险类型列表。 */
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

/** 设置配置保存状态。 */
function setConfigSaveState(text, tone) {
  elements.configSaveState.textContent = text;
  elements.configSaveState.className = `save-state ${tone}`.trim();
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

/** 深拷贝普通 JSON 数据。 */
function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/** 创建默认项目配置。 */
function createDefaultProjectConfig() {
  return {
    /** 默认项目 key。 */
    projectKey: "",
    /** 默认项目名称。 */
    projectName: "",
    /** 默认 Linux 服务器列表。 */
    linuxServers: [],
  };
}

/** 创建默认 MySQL 配置。 */
function createDefaultMySqlConfig() {
  return {
    /** 默认 MySQL 主机。 */
    host: "127.0.0.1",
    /** 默认 MySQL 端口。 */
    port: 3306,
    /** 默认 MySQL 用户名。 */
    user: "",
    /** 默认 MySQL 密码。 */
    password: "",
    /** 默认 MySQL 数据库。 */
    database: "",
    /** 默认连接池大小。 */
    connectionLimit: 5,
  };
}

/** 创建默认 Redis 配置。 */
function createDefaultRedisConfig() {
  return {
    /** 默认 Redis 主机。 */
    host: "127.0.0.1",
    /** 默认 Redis 端口。 */
    port: 6379,
    /** 默认 Redis 用户名。 */
    username: "",
    /** 默认 Redis 密码。 */
    password: "",
    /** 默认 Redis 数据库编号。 */
    database: 0,
  };
}

/** 创建默认 Linux 服务器配置。 */
function createDefaultLinuxServerConfig(index) {
  return {
    /** 默认服务器名称。 */
    name: `server-${index}`,
    /** 默认服务器主机。 */
    host: "",
    /** 默认服务器端口。 */
    port: 22,
    /** 默认服务器用户名。 */
    username: "",
    /** 默认服务器密码。 */
    password: "",
    /** 默认服务器私钥路径。 */
    privateKeyPath: "",
  };
}

/** 规范化可选字符串。 */
function normalizeOptionalString(value) {
  return value === "" ? "" : value;
}

/** 规范化配置字段值。 */
function normalizeConfigValue(value) {
  if (typeof value === "string") {
    return value;
  }

  return value;
}

/** 将值转换为输入框展示文本。 */
function toDisplayString(value) {
  return value === undefined || value === null ? "" : String(value);
}

/** 解析数字输入框值。 */
function parseNumberInput(value) {
  if (value === "") {
    return undefined;
  }

  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : undefined;
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
