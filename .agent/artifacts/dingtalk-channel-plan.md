# 🔌 OpenClaw 钉钉渠道扩展方案

## 📋 概述

本文档描述如何在 OpenClaw 中标准化地扩展钉钉 (DingTalk) 渠道，参考现有 Telegram、Discord 等渠道的实现模式。

## 🏗️ 项目结构

### 推荐目录结构

```
extensions/dingtalk/
├── package.json              # 插件包配置
├── openclaw.plugin.json      # 插件元数据
├── index.ts                  # 插件入口
├── src/
│   ├── channel.ts           # 渠道核心实现 (ChannelPlugin)
│   ├── runtime.ts           # 运行时依赖注入
│   ├── config.ts            # 配置解析和Schema定义
│   ├── send.ts              # 消息发送逻辑
│   ├── monitor.ts           # Stream监听器 (从dingtalk-bot移植)
│   ├── onboarding.ts        # CLI配置向导
│   └── types.ts             # 类型定义
└── node_modules/
```

---

## 📦 Step 1: 创建基础包结构

### `package.json`

```json
{
  "name": "@openclaw/dingtalk",
  "version": "2026.2.1",
  "description": "OpenClaw DingTalk channel plugin",
  "type": "module",
  "devDependencies": {
    "openclaw": "workspace:*"
  },
  "dependencies": {
    "dingtalk-stream": "^1.0.0"
  },
  "openclaw": {
    "extensions": [
      "./index.ts"
    ]
  }
}
```

### `openclaw.plugin.json`

```json
{
  "id": "dingtalk",
  "channels": ["dingtalk"],
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {}
  }
}
```

---

## 📝 Step 2: 插件入口 (`index.ts`)

```typescript
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { dingtalkPlugin } from "./src/channel.js";
import { setDingtalkRuntime } from "./src/runtime.js";

const plugin = {
  id: "dingtalk",
  name: "DingTalk",
  description: "DingTalk (钉钉) channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setDingtalkRuntime(api.runtime);
    api.registerChannel({ plugin: dingtalkPlugin });
  },
};

export default plugin;
```

---

## 🔧 Step 3: 运行时依赖注入 (`src/runtime.ts`)

```typescript
import type { RuntimeEnv } from "openclaw/plugin-sdk";

let runtime: RuntimeEnv | null = null;

export function setDingtalkRuntime(r: RuntimeEnv) {
  runtime = r;
}

export function getDingtalkRuntime(): RuntimeEnv {
  if (!runtime) {
    throw new Error("DingTalk runtime not initialized");
  }
  return runtime;
}
```

---

## 📋 Step 4: 类型定义 (`src/types.ts`)

```typescript
import type { OpenClawConfig } from "openclaw/plugin-sdk";

export type DingtalkTokenSource = "config" | "env" | "none";

export type DingtalkAccountConfig = {
  enabled?: boolean;
  name?: string;
  clientId?: string;
  clientSecret?: string;
  robotCode?: string;
  allowFrom?: Array<string | number>;
  dmPolicy?: "open" | "allowlist" | "pairing";
  groups?: Record<string, {
    requireMention?: boolean;
    allowFrom?: string[];
  }>;
  groupPolicy?: "open" | "allowlist";
};

export type ResolvedDingtalkAccount = {
  accountId: string;
  name?: string;
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  robotCode?: string;
  tokenSource: DingtalkTokenSource;
  config: DingtalkAccountConfig;
};

export type DingtalkProbeResult = {
  ok: boolean;
  robot?: {
    name?: string;
    robotCode?: string;
  };
  error?: string;
};
```

---

## 📊 Step 5: 配置Schema和解析 (`src/config.ts`)

```typescript
import { Type, type Static } from "@sinclair/typebox";

export const DEFAULT_ACCOUNT_ID = "default";

// 钉钉渠道配置Schema
export const DingtalkConfigSchema = Type.Object({
  enabled: Type.Optional(Type.Boolean()),
  name: Type.Optional(Type.String()),
  clientId: Type.Optional(Type.String({ description: "钉钉应用 Client ID (AppKey)" })),
  clientSecret: Type.Optional(Type.String({ description: "钉钉应用 Client Secret" })),
  robotCode: Type.Optional(Type.String({ description: "钉钉机器人代码" })),
  dmPolicy: Type.Optional(Type.Union([
    Type.Literal("open"),
    Type.Literal("allowlist"),
    Type.Literal("pairing"),
  ])),
  allowFrom: Type.Optional(Type.Array(Type.Union([Type.String(), Type.Number()]))),
  groupPolicy: Type.Optional(Type.Union([
    Type.Literal("open"),
    Type.Literal("allowlist"),
  ])),
  groups: Type.Optional(Type.Record(Type.String(), Type.Object({
    requireMention: Type.Optional(Type.Boolean()),
    allowFrom: Type.Optional(Type.Array(Type.String())),
  }))),
  accounts: Type.Optional(Type.Record(Type.String(), Type.Object({
    enabled: Type.Optional(Type.Boolean()),
    name: Type.Optional(Type.String()),
    clientId: Type.Optional(Type.String()),
    clientSecret: Type.Optional(Type.String()),
    robotCode: Type.Optional(Type.String()),
    dmPolicy: Type.Optional(Type.Union([
      Type.Literal("open"),
      Type.Literal("allowlist"),
      Type.Literal("pairing"),
    ])),
    allowFrom: Type.Optional(Type.Array(Type.Union([Type.String(), Type.Number()]))),
  }))),
});

export type DingtalkConfig = Static<typeof DingtalkConfigSchema>;

// 解析钉钉账户配置
export function resolveDingtalkAccount(params: {
  cfg: { channels?: { dingtalk?: DingtalkConfig } };
  accountId?: string | null;
}): ResolvedDingtalkAccount {
  const { cfg, accountId: rawAccountId } = params;
  const accountId = rawAccountId?.trim() || DEFAULT_ACCOUNT_ID;
  const section = cfg.channels?.dingtalk;
  
  // 从环境变量读取
  const envClientId = process.env.DINGTALK_CLIENT_ID?.trim() || "";
  const envClientSecret = process.env.DINGTALK_CLIENT_SECRET?.trim() || "";
  const envRobotCode = process.env.DINGTALK_ROBOT_CODE?.trim() || "";
  
  if (accountId === DEFAULT_ACCOUNT_ID) {
    // 默认账户：优先配置文件，fallback到环境变量
    const clientId = section?.clientId?.trim() || envClientId;
    const clientSecret = section?.clientSecret?.trim() || envClientSecret;
    const robotCode = section?.robotCode?.trim() || envRobotCode || clientId;
    
    return {
      accountId,
      name: section?.name,
      enabled: section?.enabled !== false,
      clientId,
      clientSecret,
      robotCode,
      tokenSource: section?.clientId ? "config" : envClientId ? "env" : "none",
      config: {
        enabled: section?.enabled,
        name: section?.name,
        clientId: section?.clientId,
        clientSecret: section?.clientSecret,
        robotCode: section?.robotCode,
        allowFrom: section?.allowFrom,
        dmPolicy: section?.dmPolicy,
        groups: section?.groups,
        groupPolicy: section?.groupPolicy,
      },
    };
  }
  
  // 命名账户
  const accountConfig = section?.accounts?.[accountId];
  const clientId = accountConfig?.clientId?.trim() || "";
  const clientSecret = accountConfig?.clientSecret?.trim() || "";
  const robotCode = accountConfig?.robotCode?.trim() || clientId;
  
  return {
    accountId,
    name: accountConfig?.name,
    enabled: accountConfig?.enabled !== false,
    clientId,
    clientSecret,
    robotCode,
    tokenSource: clientId ? "config" : "none",
    config: {
      enabled: accountConfig?.enabled,
      name: accountConfig?.name,
      clientId: accountConfig?.clientId,
      clientSecret: accountConfig?.clientSecret,
      robotCode: accountConfig?.robotCode,
      allowFrom: accountConfig?.allowFrom,
      dmPolicy: accountConfig?.dmPolicy,
    },
  };
}

// 列出所有账户ID
export function listDingtalkAccountIds(cfg: { channels?: { dingtalk?: DingtalkConfig } }): string[] {
  const accounts = cfg.channels?.dingtalk?.accounts || {};
  const ids = Object.keys(accounts).filter((id) => id.trim());
  
  // 如果有默认配置或环境变量，添加default
  const hasDefaultConfig = !!(
    cfg.channels?.dingtalk?.clientId ||
    process.env.DINGTALK_CLIENT_ID
  );
  
  if (hasDefaultConfig && !ids.includes(DEFAULT_ACCOUNT_ID)) {
    return [DEFAULT_ACCOUNT_ID, ...ids];
  }
  
  return ids.length > 0 ? ids : [DEFAULT_ACCOUNT_ID];
}
```

---

## 🔌 Step 6: 渠道核心实现 (`src/channel.ts`)

```typescript
import type {
  ChannelPlugin,
  ChannelMessageActionAdapter,
  OpenClawConfig,
} from "openclaw/plugin-sdk";
import {
  buildChannelConfigSchema,
  DEFAULT_ACCOUNT_ID,
  formatPairingApproveHint,
} from "openclaw/plugin-sdk";
import { getDingtalkRuntime } from "./runtime.js";
import {
  DingtalkConfigSchema,
  resolveDingtalkAccount,
  listDingtalkAccountIds,
  type ResolvedDingtalkAccount,
} from "./config.js";
import { sendMessageDingtalk } from "./send.js";
import { monitorDingtalkProvider, probeDingtalk } from "./monitor.js";

// 渠道元数据
const meta = {
  id: "dingtalk",
  label: "DingTalk",
  selectionLabel: "DingTalk (钉钉 Stream)",
  detailLabel: "钉钉机器人",
  docsPath: "/channels/dingtalk",
  docsLabel: "dingtalk",
  blurb: "企业级即时通讯平台，支持Stream模式。",
  systemImage: "message.badge.filled.fill",
  order: 20, // 排序优先级
};

// 消息动作适配器
const dingtalkMessageActions: ChannelMessageActionAdapter = {
  listActions: () => ["send", "typing"],
  extractToolSend: ({ args }) => {
    const to = args.to || args.target || args.conversationId;
    return to ? { to: String(to) } : null;
  },
  handleAction: async (ctx) => {
    if (ctx.action === "send") {
      const message = String(ctx.params.message || ctx.params.text || "");
      const to = String(ctx.params.to || ctx.params.conversationId || "");
      const result = await sendMessageDingtalk(to, message, {
        accountId: ctx.accountId ?? undefined,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    }
    return {
      content: [{ type: "text", text: `Unsupported action: ${ctx.action}` }],
      details: { error: "unsupported" },
    };
  },
};

// 主渠道插件定义
export const dingtalkPlugin: ChannelPlugin<ResolvedDingtalkAccount> = {
  id: "dingtalk",
  meta,
  
  capabilities: {
    chatTypes: ["direct", "group"],
    reactions: false,  // 钉钉暂不支持reaction
    threads: false,    // 钉钉暂不支持线程
    media: true,       // 支持媒体消息
    nativeCommands: false,
    blockStreaming: true,
  },
  
  reload: { configPrefixes: ["channels.dingtalk"] },
  configSchema: buildChannelConfigSchema(DingtalkConfigSchema),
  
  config: {
    listAccountIds: (cfg) => listDingtalkAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveDingtalkAccount({ cfg, accountId }),
    defaultAccountId: () => DEFAULT_ACCOUNT_ID,
    isConfigured: (account) => Boolean(account.clientId?.trim() && account.clientSecret?.trim()),
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: Boolean(account.clientId?.trim() && account.clientSecret?.trim()),
      tokenSource: account.tokenSource,
    }),
    resolveAllowFrom: ({ cfg, accountId }) =>
      (resolveDingtalkAccount({ cfg, accountId }).config.allowFrom ?? []).map(String),
  },
  
  security: {
    resolveDmPolicy: ({ cfg, accountId, account }) => {
      const resolvedAccountId = accountId ?? account.accountId ?? DEFAULT_ACCOUNT_ID;
      const useAccountPath = Boolean(cfg.channels?.dingtalk?.accounts?.[resolvedAccountId]);
      const basePath = useAccountPath
        ? `channels.dingtalk.accounts.${resolvedAccountId}.`
        : "channels.dingtalk.";
      return {
        policy: account.config.dmPolicy ?? "pairing",
        allowFrom: account.config.allowFrom ?? [],
        policyPath: `${basePath}dmPolicy`,
        allowFromPath: basePath,
        approveHint: formatPairingApproveHint("dingtalk"),
        normalizeEntry: (raw) => raw.replace(/^dingtalk:/i, ""),
      };
    },
  },
  
  messaging: {
    normalizeTarget: (raw) => {
      const trimmed = raw.trim();
      if (!trimmed) return undefined;
      // 支持 dingtalk:conversationId 格式
      return trimmed.replace(/^dingtalk:/i, "");
    },
    targetResolver: {
      looksLikeId: (raw) => /^cid[A-Za-z0-9+/=]+$/i.test(raw.trim()),
      hint: "<conversationId>",
    },
  },
  
  pairing: {
    idLabel: "dingtalkUserId",
    normalizeAllowEntry: (entry) => entry.replace(/^dingtalk:/i, ""),
    notifyApproval: async ({ cfg, id }) => {
      await sendMessageDingtalk(id, "✅ 你已被授权与 OpenClaw 对话！", {});
    },
  },
  
  actions: dingtalkMessageActions,
  
  outbound: {
    deliveryMode: "direct",
    chunker: null,
    textChunkLimit: 4000,
    sendText: async ({ to, text, accountId }) => {
      const result = await sendMessageDingtalk(to, text, {
        accountId: accountId ?? undefined,
      });
      return { channel: "dingtalk", ...result };
    },
    sendMedia: async ({ to, text, mediaUrl, accountId }) => {
      const result = await sendMessageDingtalk(to, text, {
        accountId: accountId ?? undefined,
        mediaUrl,
      });
      return { channel: "dingtalk", ...result };
    },
  },
  
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    probeAccount: async ({ account, timeoutMs }) =>
      probeDingtalk(account.clientId, account.clientSecret, timeoutMs),
    buildAccountSnapshot: ({ account, runtime, probe }) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: Boolean(account.clientId?.trim() && account.clientSecret?.trim()),
      tokenSource: account.tokenSource,
      running: runtime?.running ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastError: runtime?.lastError ?? null,
      probe,
    }),
  },
  
  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      ctx.log?.info(`[${account.accountId}] starting DingTalk Stream provider`);
      
      return monitorDingtalkProvider({
        clientId: account.clientId,
        clientSecret: account.clientSecret,
        robotCode: account.robotCode,
        accountId: account.accountId,
        config: ctx.cfg,
        runtime: ctx.runtime,
        abortSignal: ctx.abortSignal,
      });
    },
  },
};
```

---

## 📤 Step 7: 消息发送 (`src/send.ts`)

```typescript
import { getDingtalkRuntime } from "./runtime.js";
import { resolveDingtalkAccount, DEFAULT_ACCOUNT_ID } from "./config.js";

export type SendDingtalkOptions = {
  accountId?: string;
  mediaUrl?: string;
  atUsers?: string[];
};

export type SendDingtalkResult = {
  ok: boolean;
  messageId?: string;
  error?: string;
};

// 发送钉钉消息
export async function sendMessageDingtalk(
  to: string,
  text: string,
  options: SendDingtalkOptions = {},
): Promise<SendDingtalkResult> {
  const runtime = getDingtalkRuntime();
  const cfg = runtime.config.readConfigFile();
  const account = resolveDingtalkAccount({
    cfg,
    accountId: options.accountId,
  });
  
  if (!account.clientId || !account.clientSecret) {
    return { ok: false, error: "DingTalk credentials not configured" };
  }
  
  try {
    // 这里需要调用钉钉API发送消息
    // 可以使用钉钉的服务端API或通过WebSocket响应
    
    // 简化实现：通过DingTalk机器人API发送
    const accessToken = await getDingtalkAccessToken(account.clientId, account.clientSecret);
    
    const response = await fetch(
      `https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-acs-dingtalk-access-token": accessToken,
        },
        body: JSON.stringify({
          robotCode: account.robotCode,
          userIds: [to],
          msgKey: "sampleText",
          msgParam: JSON.stringify({ content: text }),
        }),
      },
    );
    
    if (!response.ok) {
      const error = await response.text();
      return { ok: false, error };
    }
    
    const result = await response.json();
    return { ok: true, messageId: result.processQueryKey };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// 获取钉钉访问令牌
async function getDingtalkAccessToken(clientId: string, clientSecret: string): Promise<string> {
  const response = await fetch(
    `https://api.dingtalk.com/v1.0/oauth2/accessToken`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        appKey: clientId,
        appSecret: clientSecret,
      }),
    },
  );
  
  if (!response.ok) {
    throw new Error(`Failed to get access token: ${response.statusText}`);
  }
  
  const data = await response.json();
  return data.accessToken;
}
```

---

## 🔄 Step 8: Stream监听器 (`src/monitor.ts`)

这是从现有 `dingtalk-bot` 移植的核心逻辑：

```typescript
import type { OpenClawConfig, RuntimeEnv } from "openclaw/plugin-sdk";
import { getDingtalkRuntime } from "./runtime.js";

export type MonitorDingtalkParams = {
  clientId: string;
  clientSecret: string;
  robotCode?: string;
  accountId: string;
  config: OpenClawConfig;
  runtime: RuntimeEnv;
  abortSignal: AbortSignal;
};

export type DingtalkProbeResult = {
  ok: boolean;
  robot?: { name?: string; robotCode?: string };
  error?: string;
};

// 探测钉钉机器人状态
export async function probeDingtalk(
  clientId: string,
  clientSecret: string,
  timeoutMs: number,
): Promise<DingtalkProbeResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    
    const response = await fetch(
      `https://api.dingtalk.com/v1.0/oauth2/accessToken`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appKey: clientId,
          appSecret: clientSecret,
        }),
        signal: controller.signal,
      },
    );
    
    clearTimeout(timeout);
    
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` };
    }
    
    const data = await response.json();
    return {
      ok: Boolean(data.accessToken),
      robot: { robotCode: clientId },
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// 启动钉钉Stream监听器
// 注意：这里需要将Python版本的逻辑转换为TypeScript
// 可以使用 dingtalk-stream 的 Node.js 版本或自定义WebSocket实现
export async function monitorDingtalkProvider(params: MonitorDingtalkParams): Promise<void> {
  const { clientId, clientSecret, robotCode, accountId, config, runtime, abortSignal } = params;
  
  // TODO: 实现钉钉Stream监听
  // 可以参考 ~/.openclaw/workspace/dingtalk-bot/app_stream_sdk.py 的逻辑
  // 
  // 主要步骤：
  // 1. 使用 dingtalk-stream SDK 或自定义 WebSocket 连接钉钉服务器
  // 2. 监听机器人消息事件
  // 3. 将消息转发给 OpenClaw 的消息处理流程
  // 4. 处理响应并回复钉钉
  
  console.log(`[${accountId}] DingTalk Stream monitor started`);
  
  // 简化占位实现
  return new Promise((resolve) => {
    abortSignal.addEventListener("abort", () => {
      console.log(`[${accountId}] DingTalk Stream monitor stopped`);
      resolve();
    });
  });
}
```

---

## ⚙️ Step 9: 配置文件示例 (`openclaw.json`)

```json
{
  "channels": {
    "dingtalk": {
      "enabled": true,
      "clientId": "dinggrxndi7fwsusfxut",
      "clientSecret": "your-secret-here",
      "robotCode": "dinggrxndi7fwsusfxut",
      "dmPolicy": "open",
      "groupPolicy": "allowlist",
      "groups": {
        "cid123456789": {
          "requireMention": true
        }
      }
    }
  }
}
```

或使用环境变量：

```bash
export DINGTALK_CLIENT_ID=dinggrxndi7fwsusfxut
export DINGTALK_CLIENT_SECRET=your-secret-here
export DINGTALK_ROBOT_CODE=dinggrxndi7fwsusfxut
```

---

## 🔗 Step 10: 注册渠道到核心 (可选，用于核心渠道)

如果要将钉钉作为核心渠道（而非扩展），需要修改 `src/channels/registry.ts`：

```typescript
export const CHAT_CHANNEL_ORDER = [
  "telegram",
  "whatsapp",
  "discord",
  "googlechat",
  "slack",
  "signal",
  "imessage",
  "dingtalk",  // 添加钉钉
] as const;

// 在 CHAT_CHANNEL_META 中添加
dingtalk: {
  id: "dingtalk",
  label: "DingTalk",
  selectionLabel: "DingTalk (钉钉 Stream)",
  detailLabel: "钉钉机器人",
  docsPath: "/channels/dingtalk",
  docsLabel: "dingtalk",
  blurb: "企业级即时通讯平台，支持Stream模式。",
  systemImage: "message.badge.filled.fill",
},

// 在 CHAT_CHANNEL_ALIASES 中添加
export const CHAT_CHANNEL_ALIASES: Record<string, ChatChannelId> = {
  // ...existing
  dd: "dingtalk",
  dingding: "dingtalk",
};
```

---

## 📋 实现清单

### 必须实现

- [x] `package.json` - 包配置
- [x] `openclaw.plugin.json` - 插件元数据
- [x] `index.ts` - 插件入口
- [x] `src/runtime.ts` - 运行时注入
- [x] `src/types.ts` - 类型定义
- [x] `src/config.ts` - 配置解析
- [x] `src/channel.ts` - 渠道插件主体
- [x] `src/send.ts` - 消息发送

### 建议实现

- [ ] `src/monitor.ts` - Stream监听器（完整实现）
- [ ] `src/onboarding.ts` - CLI配置向导
- [ ] `src/message-actions.ts` - 消息动作处理
- [ ] 单元测试

### 从现有dingtalk-bot移植

- [ ] `app_stream_sdk.py` → `src/monitor.ts` (Stream连接)
- [ ] `openclaw_websocket.py` → 使用OpenClaw内部API替代
- [ ] `openclaw_integration.py` → 不需要，直接集成到channel中

---

## 🚀 下一步

1. 创建 `extensions/dingtalk/` 目录
2. 复制基础文件结构
3. 实现完整的 `monitor.ts` (参考Python版本)
4. 测试本地运行
5. 提交PR

需要我帮你创建这些文件吗？
