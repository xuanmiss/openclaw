# @xuanmiss-npm/dingtalk

OpenClaw 钉钉 (DingTalk) 渠道插件 - 支持 Stream 模式接入。

## 安装

openclaw plugins install @xuanmiss-npm/dingtalk
```

### 从本地源码安装
# 或使用 link 模式（不复制文件，适合开发）
openclaw plugins install -l ./extensions/dingtalk
```

## 前置条件

1. 在 [钉钉开放平台](https://open.dingtalk.com/) 创建一个企业内部应用/机器人
2. 获取以下凭证：
   - **Client ID** (AppKey)
   - **Client Secret** (AppSecret)
   - **Robot Code** (机器人 Code，可选，默认使用 Client ID)

## 配置

### 使用环境变量（推荐用于默认账户）

```bash
export DINGTALK_CLIENT_ID="your-client-id"
export DINGTALK_CLIENT_SECRET="your-client-secret"
export DINGTALK_ROBOT_CODE="your-robot-code"  # 可选
```

### 使用配置文件

在 OpenClaw 配置文件中添加：

```json5
{
  channels: {
    dingtalk: {
      enabled: true,
      clientId: "your-client-id",
      clientSecret: "your-client-secret",
      robotCode: "your-robot-code",  // 可选
      dmPolicy: "pairing",  // "open" | "allowlist" | "pairing"
      groupPolicy: "allowlist",  // "open" | "allowlist"
    },
  },
}
```

## 消息策略

### DM（私聊）策略

- `pairing`（默认）：未知发送者需要通过配对码验证
- `allowlist`：仅允许 `allowFrom` 列表中的用户
- `open`：允许所有用户

### Group（群聊）策略

- `allowlist`（默认）：需要 @机器人 才会响应
- `open`：响应所有消息（需要 @机器人）

## 多账户配置

支持配置多个钉钉机器人账户：

```json5
{
  channels: {
    dingtalk: {
      accounts: {
        default: {
          name: "主机器人",
          clientId: "client-id-1",
          clientSecret: "secret-1",
        },
        alerts: {
          name: "告警机器人",
          clientId: "client-id-2",
          clientSecret: "secret-2",
        },
      },
    },
  },
}
```

## 配对验证

默认情况下，新用户需要通过配对验证：

```bash
# 查看待验证的配对请求
openclaw pairing list dingtalk

# 批准配对请求
openclaw pairing approve dingtalk <CODE>
```

## 发送消息

通过 CLI 发送消息：

```bash
# 发送到用户
openclaw message send dingtalk user:<userId> "Hello!"

# 发送到群聊
openclaw message send dingtalk <conversationId> "Hello group!"
```

## 故障排查

### 常见问题

1. **无法连接**
   - 检查 Client ID 和 Client Secret 是否正确
   - 确认机器人已在钉钉开放平台启用

2. **群聊无响应**
   - 确保机器人已被添加到群聊
   - 确认消息中 @了机器人
   - 检查 `groupPolicy` 配置

3. **私聊无响应**
   - 检查 `dmPolicy` 配置
   - 如果是 `pairing` 模式，确认用户已完成配对验证

## 相关链接

- [钉钉开放平台](https://open.dingtalk.com/)
- [OpenClaw 文档](https://openclaw.dev/)
- [GitHub 仓库](https://github.com/xuanmiss/openclaw-dingtalk)
- [问题反馈](https://github.com/xuanmiss/openclaw-dingtalk/issues)

## 许可证

MIT
