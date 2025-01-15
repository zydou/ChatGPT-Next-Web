import { IconButton } from "./button";
import { ErrorBoundary } from "./error";
import styles from "./mcp-market.module.scss";
import EditIcon from "../icons/edit.svg";
import AddIcon from "../icons/add.svg";
import CloseIcon from "../icons/close.svg";
import DeleteIcon from "../icons/delete.svg";
import RestartIcon from "../icons/reload.svg";
import EyeIcon from "../icons/eye.svg";
import GithubIcon from "../icons/github.svg";
import { List, ListItem, Modal, showToast } from "./ui-lib";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import presetServersJson from "../mcp/preset-server.json";
import {
  addMcpServer,
  getClientStatus,
  getClientTools,
  getMcpConfigFromFile,
  removeMcpServer,
  restartAllClients,
} from "../mcp/actions";
import {
  ListToolsResponse,
  McpConfigData,
  PresetServer,
  ServerConfig,
} from "../mcp/types";
import clsx from "clsx";

const presetServers = presetServersJson as PresetServer[];

interface ConfigProperty {
  type: string;
  description?: string;
  required?: boolean;
  minItems?: number;
}

export function McpMarketPage() {
  const navigate = useNavigate();
  const [searchText, setSearchText] = useState("");
  const [userConfig, setUserConfig] = useState<Record<string, any>>({});
  const [editingServerId, setEditingServerId] = useState<string | undefined>();
  const [tools, setTools] = useState<ListToolsResponse["tools"] | null>(null);
  const [viewingServerId, setViewingServerId] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const [config, setConfig] = useState<McpConfigData>();
  const [clientStatuses, setClientStatuses] = useState<
    Record<
      string,
      {
        status: "active" | "error" | "undefined";
        errorMsg: string | null;
      }
    >
  >({});

  // 检查服务器是否已添加
  const isServerAdded = (id: string) => {
    return id in (config?.mcpServers ?? {});
  };

  // 从服务器获取初始状态
  useEffect(() => {
    const loadInitialState = async () => {
      try {
        setIsLoading(true);
        const config = await getMcpConfigFromFile();
        setConfig(config);

        // 获取所有客户端的状态
        const statuses: Record<string, any> = {};
        for (const clientId of Object.keys(config.mcpServers)) {
          statuses[clientId] = await getClientStatus(clientId);
        }
        setClientStatuses(statuses);
      } catch (error) {
        console.error("Failed to load initial state:", error);
        showToast("Failed to load initial state");
      } finally {
        setIsLoading(false);
      }
    };
    loadInitialState();
  }, []);

  // Debug: 监控状态变化
  useEffect(() => {
    console.log("MCP Market - Current config:", config);
    console.log("MCP Market - Current clientStatuses:", clientStatuses);
  }, [config, clientStatuses]);

  // 加载当前编辑服务器的配置
  useEffect(() => {
    if (editingServerId && config) {
      const currentConfig = config.mcpServers[editingServerId];
      if (currentConfig) {
        // 从当前配置中提取用户配置
        const preset = presetServers.find((s) => s.id === editingServerId);
        if (preset?.configSchema) {
          const userConfig: Record<string, any> = {};
          Object.entries(preset.argsMapping || {}).forEach(([key, mapping]) => {
            if (mapping.type === "spread") {
              // 对于 spread 类型，从 args 中提取数组
              const startPos = mapping.position ?? 0;
              userConfig[key] = currentConfig.args.slice(startPos);
            } else if (mapping.type === "single") {
              // 对于 single 类型，获取单个值
              userConfig[key] = currentConfig.args[mapping.position ?? 0];
            } else if (
              mapping.type === "env" &&
              mapping.key &&
              currentConfig.env
            ) {
              // 对于 env 类型，从环境变量中获取值
              userConfig[key] = currentConfig.env[mapping.key];
            }
          });
          setUserConfig(userConfig);
        }
      } else {
        setUserConfig({});
      }
    }
  }, [editingServerId, config]);

  // 保存服务器配置
  const saveServerConfig = async () => {
    const preset = presetServers.find((s) => s.id === editingServerId);
    if (!preset || !preset.configSchema || !editingServerId) return;

    try {
      setIsLoading(true);
      // 构建服务器配置
      const args = [...preset.baseArgs];
      const env: Record<string, string> = {};

      Object.entries(preset.argsMapping || {}).forEach(([key, mapping]) => {
        const value = userConfig[key];
        if (mapping.type === "spread" && Array.isArray(value)) {
          const pos = mapping.position ?? 0;
          args.splice(pos, 0, ...value);
        } else if (
          mapping.type === "single" &&
          mapping.position !== undefined
        ) {
          args[mapping.position] = value;
        } else if (
          mapping.type === "env" &&
          mapping.key &&
          typeof value === "string"
        ) {
          env[mapping.key] = value;
        }
      });

      const serverConfig: ServerConfig = {
        command: preset.command,
        args,
        ...(Object.keys(env).length > 0 ? { env } : {}),
      };

      // 更新配置并初始化新服务器
      const newConfig = await addMcpServer(editingServerId, serverConfig);
      setConfig(newConfig);

      // 更新状态
      const status = await getClientStatus(editingServerId);
      setClientStatuses((prev) => ({
        ...prev,
        [editingServerId]: status,
      }));

      setEditingServerId(undefined);
      showToast("Server configuration saved successfully");
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Failed to save configuration",
      );
    } finally {
      setIsLoading(false);
    }
  };

  // 获取服务器支持的 Tools
  const loadTools = async (id: string) => {
    try {
      const result = await getClientTools(id);
      if (result) {
        setTools(result);
      } else {
        throw new Error("Failed to load tools");
      }
    } catch (error) {
      showToast("Failed to load tools");
      console.error(error);
      setTools(null);
    }
  };

  // 重启所有客户端
  const handleRestartAll = async () => {
    try {
      setIsLoading(true);
      const newConfig = await restartAllClients();
      setConfig(newConfig);

      // 更新所有客户端状态
      const statuses: Record<string, any> = {};
      for (const clientId of Object.keys(newConfig.mcpServers)) {
        statuses[clientId] = await getClientStatus(clientId);
      }
      setClientStatuses(statuses);

      showToast("Successfully restarted all clients");
    } catch (error) {
      showToast("Failed to restart clients");
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  // 添加服务器
  const addServer = async (preset: PresetServer) => {
    if (!preset.configurable) {
      try {
        setIsLoading(true);
        showToast("Creating MCP client...");
        // 如果服务器不需要配置，直接添加
        const serverConfig: ServerConfig = {
          command: preset.command,
          args: [...preset.baseArgs],
        };
        const newConfig = await addMcpServer(preset.id, serverConfig);
        setConfig(newConfig);

        // 更新状态
        const status = await getClientStatus(preset.id);
        setClientStatuses((prev) => ({
          ...prev,
          [preset.id]: status,
        }));
      } finally {
        setIsLoading(false);
      }
    } else {
      // 如果需要配置，打开配置对话框
      setEditingServerId(preset.id);
      setUserConfig({});
    }
  };

  // 移除服务器
  const removeServer = async (id: string) => {
    try {
      setIsLoading(true);
      const newConfig = await removeMcpServer(id);
      setConfig(newConfig);

      // 移除状态
      setClientStatuses((prev) => {
        const newStatuses = { ...prev };
        delete newStatuses[id];
        return newStatuses;
      });
    } finally {
      setIsLoading(false);
    }
  };

  // 渲染配置表单
  const renderConfigForm = () => {
    const preset = presetServers.find((s) => s.id === editingServerId);
    if (!preset?.configSchema) return null;

    return Object.entries(preset.configSchema.properties).map(
      ([key, prop]: [string, ConfigProperty]) => {
        if (prop.type === "array") {
          const currentValue = userConfig[key as keyof typeof userConfig] || [];
          const itemLabel = (prop as any).itemLabel || key;
          const addButtonText =
            (prop as any).addButtonText || `Add ${itemLabel}`;

          return (
            <ListItem
              key={key}
              title={key}
              subTitle={prop.description}
              vertical
            >
              <div className={styles["path-list"]}>
                {(currentValue as string[]).map(
                  (value: string, index: number) => (
                    <div key={index} className={styles["path-item"]}>
                      <input
                        type="text"
                        value={value}
                        placeholder={`${itemLabel} ${index + 1}`}
                        onChange={(e) => {
                          const newValue = [...currentValue] as string[];
                          newValue[index] = e.target.value;
                          setUserConfig({ ...userConfig, [key]: newValue });
                        }}
                      />
                      <IconButton
                        icon={<DeleteIcon />}
                        className={styles["delete-button"]}
                        onClick={() => {
                          const newValue = [...currentValue] as string[];
                          newValue.splice(index, 1);
                          setUserConfig({ ...userConfig, [key]: newValue });
                        }}
                      />
                    </div>
                  ),
                )}
                <IconButton
                  icon={<AddIcon />}
                  text={addButtonText}
                  className={styles["add-button"]}
                  bordered
                  onClick={() => {
                    const newValue = [...currentValue, ""] as string[];
                    setUserConfig({ ...userConfig, [key]: newValue });
                  }}
                />
              </div>
            </ListItem>
          );
        } else if (prop.type === "string") {
          const currentValue = userConfig[key as keyof typeof userConfig] || "";
          return (
            <ListItem key={key} title={key} subTitle={prop.description}>
              <div className={styles["input-item"]}>
                <input
                  type="text"
                  value={currentValue}
                  placeholder={`Enter ${key}`}
                  onChange={(e) => {
                    setUserConfig({ ...userConfig, [key]: e.target.value });
                  }}
                />
              </div>
            </ListItem>
          );
        }
        return null;
      },
    );
  };

  // 检查服务器状态
  const checkServerStatus = (clientId: string) => {
    return clientStatuses[clientId] || { status: "undefined", errorMsg: null };
  };

  // 渲染服务器列表
  const renderServerList = () => {
    return presetServers
      .filter((server) => {
        if (searchText.length === 0) return true;
        const searchLower = searchText.toLowerCase();
        return (
          server.name.toLowerCase().includes(searchLower) ||
          server.description.toLowerCase().includes(searchLower) ||
          server.tags.some((tag) => tag.toLowerCase().includes(searchLower))
        );
      })
      .sort((a, b) => {
        const aStatus = checkServerStatus(a.id).status;
        const bStatus = checkServerStatus(b.id).status;

        // 定义状态优先级
        const statusPriority = {
          error: 0,
          active: 1,
          undefined: 2,
        };

        // 首先按状态排序
        if (aStatus !== bStatus) {
          return statusPriority[aStatus] - statusPriority[bStatus];
        }

        // 然后按名称排序
        return a.name.localeCompare(b.name);
      })
      .map((server) => (
        <div
          className={clsx(styles["mcp-market-item"], {
            [styles["disabled"]]: isLoading,
          })}
          key={server.id}
        >
          <div className={styles["mcp-market-header"]}>
            <div className={styles["mcp-market-title"]}>
              <div className={styles["mcp-market-name"]}>
                {server.name}
                {checkServerStatus(server.id).status !== "undefined" && (
                  <span
                    className={clsx(styles["server-status"], {
                      [styles["error"]]:
                        checkServerStatus(server.id).status === "error",
                    })}
                  >
                    {checkServerStatus(server.id).status === "error" ? (
                      <>
                        Error
                        <span className={styles["error-message"]}>
                          : {checkServerStatus(server.id).errorMsg}
                        </span>
                      </>
                    ) : (
                      "Active"
                    )}
                  </span>
                )}
                {server.repo && (
                  <a
                    href={server.repo}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles["repo-link"]}
                    title="Open repository"
                  >
                    <GithubIcon />
                  </a>
                )}
              </div>
              <div className={styles["tags-container"]}>
                {server.tags.map((tag, index) => (
                  <span key={index} className={styles["tag"]}>
                    {tag}
                  </span>
                ))}
              </div>
              <div
                className={clsx(styles["mcp-market-info"], "one-line")}
                title={server.description}
              >
                {server.description}
              </div>
            </div>
            <div className={styles["mcp-market-actions"]}>
              {isServerAdded(server.id) ? (
                <>
                  {server.configurable && (
                    <IconButton
                      icon={<EditIcon />}
                      text="Configure"
                      className={clsx({
                        [styles["action-error"]]:
                          checkServerStatus(server.id).status === "error",
                      })}
                      onClick={() => setEditingServerId(server.id)}
                      disabled={isLoading}
                    />
                  )}
                  <IconButton
                    icon={<EyeIcon />}
                    text="Tools"
                    onClick={async () => {
                      setViewingServerId(server.id);
                      await loadTools(server.id);
                    }}
                    disabled={
                      isLoading ||
                      checkServerStatus(server.id).status === "error"
                    }
                  />
                  <IconButton
                    icon={<DeleteIcon />}
                    text="Remove"
                    className={styles["action-danger"]}
                    onClick={() => removeServer(server.id)}
                    disabled={isLoading}
                  />
                </>
              ) : (
                <IconButton
                  icon={<AddIcon />}
                  text="Add"
                  className={styles["action-primary"]}
                  onClick={() => addServer(server)}
                  disabled={isLoading}
                />
              )}
            </div>
          </div>
        </div>
      ));
  };

  return (
    <ErrorBoundary>
      <div className={styles["mcp-market-page"]}>
        <div className="window-header">
          <div className="window-header-title">
            <div className="window-header-main-title">
              MCP Market
              {isLoading && (
                <span className={styles["loading-indicator"]}>Loading...</span>
              )}
            </div>
            <div className="window-header-sub-title">
              {Object.keys(config?.mcpServers ?? {}).length} servers configured
            </div>
          </div>

          <div className="window-actions">
            <div className="window-action-button">
              <IconButton
                icon={<RestartIcon />}
                bordered
                onClick={handleRestartAll}
                text="Restart All"
                disabled={isLoading}
              />
            </div>
            <div className="window-action-button">
              <IconButton
                icon={<CloseIcon />}
                bordered
                onClick={() => navigate(-1)}
                disabled={isLoading}
              />
            </div>
          </div>
        </div>

        <div className={styles["mcp-market-page-body"]}>
          <div className={styles["mcp-market-filter"]}>
            <input
              type="text"
              className={styles["search-bar"]}
              placeholder={"Search MCP Server"}
              autoFocus
              onInput={(e) => setSearchText(e.currentTarget.value)}
            />
          </div>

          <div className={styles["server-list"]}>{renderServerList()}</div>
        </div>

        {/*编辑服务器配置*/}
        {editingServerId && (
          <div className="modal-mask">
            <Modal
              title={`Configure Server - ${editingServerId}`}
              onClose={() => !isLoading && setEditingServerId(undefined)}
              actions={[
                <IconButton
                  key="cancel"
                  text="Cancel"
                  onClick={() => setEditingServerId(undefined)}
                  bordered
                  disabled={isLoading}
                />,
                <IconButton
                  key="confirm"
                  text="Save"
                  type="primary"
                  onClick={saveServerConfig}
                  bordered
                  disabled={isLoading}
                />,
              ]}
            >
              <List>{renderConfigForm()}</List>
            </Modal>
          </div>
        )}

        {/*支持的Tools*/}
        {viewingServerId && (
          <div className="modal-mask">
            <Modal
              title={`Server Details - ${viewingServerId}`}
              onClose={() => setViewingServerId(undefined)}
              actions={[
                <IconButton
                  key="close"
                  text="Close"
                  onClick={() => setViewingServerId(undefined)}
                  bordered
                />,
              ]}
            >
              <div className={styles["tools-list"]}>
                {isLoading ? (
                  <div>Loading...</div>
                ) : tools?.tools ? (
                  tools.tools.map(
                    (tool: ListToolsResponse["tools"], index: number) => (
                      <div key={index} className={styles["tool-item"]}>
                        <div className={styles["tool-name"]}>{tool.name}</div>
                        <div className={styles["tool-description"]}>
                          {tool.description}
                        </div>
                      </div>
                    ),
                  )
                ) : (
                  <div>No tools available</div>
                )}
              </div>
            </Modal>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}