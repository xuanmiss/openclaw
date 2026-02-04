import type { ChannelPlugin, ChannelMessageActionAdapter } from "openclaw/plugin-sdk";
import {
    buildChannelConfigSchema,
    formatPairingApproveHint,
    DmPolicySchema,
    GroupPolicySchema,
} from "openclaw/plugin-sdk";
import { z } from "zod";
import {
    resolveDingtalkAccount,
    listDingtalkAccountIds,
    resolveDefaultDingtalkAccountId,
    DEFAULT_ACCOUNT_ID,
    type ResolvedDingtalkAccount,
} from "./config.js";
import { sendMessageDingtalk } from "./send.js";
import { monitorDingtalkProvider, probeDingtalk, createOpenClawMessageHandler } from "./monitor.js";

// ============================================================================
// 配置Schema (使用 Zod)
// ============================================================================

const DingtalkGroupSchema = z
    .object({
        requireMention: z.boolean().optional(),
        allowFrom: z.array(z.string()).optional(),
    })
    .strict();

const DingtalkAccountSchema = z
    .object({
        enabled: z.boolean().optional(),
        name: z.string().optional(),
        clientId: z.string().optional(),
        clientSecret: z.string().optional(),
        robotCode: z.string().optional(),
        dmPolicy: DmPolicySchema.optional(),
        allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
    })
    .strict();

export const DingtalkConfigSchema = z
    .object({
        enabled: z.boolean().optional(),
        name: z.string().optional(),
        clientId: z.string().optional(),
        clientSecret: z.string().optional(),
        robotCode: z.string().optional(),
        dmPolicy: DmPolicySchema.optional().default("pairing"),
        allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
        groupPolicy: GroupPolicySchema.optional().default("allowlist"),
        groups: z.record(z.string(), DingtalkGroupSchema.optional()).optional(),
        historyLimit: z.number().int().min(0).optional(),
        textChunkLimit: z.number().int().positive().optional(),
        blockStreaming: z.boolean().optional(),
        accounts: z.record(z.string(), DingtalkAccountSchema.optional()).optional(),
    })
    .strict();


// ============================================================================
// 渠道元数据
// ============================================================================

const meta = {
    id: "dingtalk" as const,
    label: "DingTalk",
    selectionLabel: "DingTalk (钉钉 Stream)",
    detailLabel: "钉钉机器人",
    docsPath: "/channels/dingtalk",
    docsLabel: "dingtalk",
    blurb: "企业级即时通讯平台，支持Stream模式接入。",
    systemImage: "message.badge.filled.fill",
    order: 20,
    aliases: ["dd", "dingding", "ding"],
};

// ============================================================================
// 消息动作适配器
// ============================================================================

const dingtalkMessageActions: ChannelMessageActionAdapter = {
    listActions: () => ["send"],

    extractToolSend: ({ args }) => {
        const to = args.to || args.target || args.conversationId || args.userId;
        return to ? { to: String(to) } : null;
    },

    handleAction: async (ctx) => {
        if (ctx.action === "send") {
            const message = String(ctx.params.message || ctx.params.text || "");
            const to = String(ctx.params.to || ctx.params.conversationId || ctx.params.userId || "");

            if (!to) {
                return {
                    content: [{ type: "text", text: "Error: target (to/conversationId/userId) required" }],
                    details: { error: "missing_target" },
                };
            }

            if (!message) {
                return {
                    content: [{ type: "text", text: "Error: message required" }],
                    details: { error: "missing_message" },
                };
            }

            const atUsersRaw = ctx.params.atUsers || ctx.params.atUserIds || ctx.params.mentions;
            const atUsers = Array.isArray(atUsersRaw)
                ? atUsersRaw.map(String)
                : typeof atUsersRaw === "string"
                    ? atUsersRaw.split(",").map(s => s.trim())
                    : undefined;

            const result = await sendMessageDingtalk(to, message, {
                cfg: ctx.cfg,
                accountId: ctx.accountId ?? undefined,
                atUsers,
            });

            return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                details: result,
            };
        }

        return {
            content: [{ type: "text", text: `Unsupported action: ${ctx.action}` }],
            details: { error: "unsupported_action", action: ctx.action },
        };
    },
};

// ============================================================================
// 主渠道插件定义
// ============================================================================

export const dingtalkPlugin: ChannelPlugin<ResolvedDingtalkAccount> = {
    id: "dingtalk",
    meta,

    // ---------------------------------------------------------------------------
    // 能力声明
    // ---------------------------------------------------------------------------
    capabilities: {
        chatTypes: ["direct", "group"],
        reactions: false, // 钉钉暂不支持reaction
        threads: false, // 钉钉暂不支持线程
        media: true, // 支持媒体消息
        nativeCommands: false,
        blockStreaming: true,
    },

    // ---------------------------------------------------------------------------
    // 配置热重载
    // ---------------------------------------------------------------------------
    reload: { configPrefixes: ["channels.dingtalk"] },
    configSchema: buildChannelConfigSchema(DingtalkConfigSchema),

    // ---------------------------------------------------------------------------
    // 配置适配器
    // ---------------------------------------------------------------------------
    config: {
        listAccountIds: (cfg) => listDingtalkAccountIds(cfg),
        resolveAccount: (cfg, accountId) => resolveDingtalkAccount({ cfg, accountId }),
        defaultAccountId: (cfg) => resolveDefaultDingtalkAccountId(cfg),

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

        formatAllowFrom: ({ allowFrom }) =>
            allowFrom
                .map((entry) => String(entry).trim())
                .filter(Boolean)
                .map((entry) => entry.replace(/^dingtalk:/i, ""))
                .map((entry) => entry.toLowerCase()),
    },

    // ---------------------------------------------------------------------------
    // 安全适配器
    // ---------------------------------------------------------------------------
    security: {
        resolveDmPolicy: ({ cfg, accountId, account }) => {
            const resolvedAccountId = accountId ?? account.accountId ?? DEFAULT_ACCOUNT_ID;
            const dingtalkConfig = (cfg.channels as Record<string, unknown> | undefined)?.dingtalk as
                | Record<string, unknown>
                | undefined;
            const useAccountPath = Boolean(
                (dingtalkConfig?.accounts as Record<string, unknown> | undefined)?.[resolvedAccountId],
            );
            const basePath = useAccountPath
                ? `channels.dingtalk.accounts.${resolvedAccountId}.`
                : "channels.dingtalk.";

            return {
                policy: account.config.dmPolicy ?? "pairing",
                allowFrom: account.config.allowFrom ?? [],
                policyPath: `${basePath}dmPolicy`,
                allowFromPath: basePath,
                approveHint: formatPairingApproveHint("dingtalk"),
                normalizeEntry: (raw: string) => raw.replace(/^dingtalk:/i, ""),
            };
        },

        collectWarnings: ({ account, cfg }) => {
            const warnings: string[] = [];
            const defaultGroupPolicy = (
                cfg.channels as { defaults?: { groupPolicy?: string } } | undefined
            )?.defaults?.groupPolicy;
            const groupPolicy = account.config.groupPolicy ?? defaultGroupPolicy ?? "open";

            if (groupPolicy === "open") {
                warnings.push(
                    `- DingTalk groups: groupPolicy="open" allows any group member to trigger the bot (mention-gated). ` +
                    `Set channels.dingtalk.groupPolicy="allowlist" and configure channels.dingtalk.groups.`,
                );
            }

            return warnings;
        },
    },

    // ---------------------------------------------------------------------------
    // 消息适配器
    // ---------------------------------------------------------------------------
    messaging: {
        normalizeTarget: (raw) => {
            const trimmed = raw.trim();
            if (!trimmed) return undefined;
            // 支持 dingtalk:userId 格式
            return trimmed.replace(/^dingtalk:/i, "");
        },
        targetResolver: {
            looksLikeId: (raw) => {
                const trimmed = raw.trim();
                // 钉钉用户ID格式检测
                return /^[a-zA-Z0-9]{10,}$/.test(trimmed) || trimmed.startsWith("cid");
            },
            hint: "<userId|conversationId>",
        },
    },

    // ---------------------------------------------------------------------------
    // 配对适配器
    // ---------------------------------------------------------------------------
    pairing: {
        idLabel: "dingtalkUserId",
        normalizeAllowEntry: (entry) => entry.replace(/^dingtalk:/i, ""),
        notifyApproval: async ({ id }) => {
            await sendMessageDingtalk(id, "✅ 你已被授权与 OpenClaw 对话！", {});
        },
    },

    // ---------------------------------------------------------------------------
    // 消息动作
    // ---------------------------------------------------------------------------
    actions: dingtalkMessageActions,

    // ---------------------------------------------------------------------------
    // 出站消息适配器
    // ---------------------------------------------------------------------------
    outbound: {
        deliveryMode: "direct",
        chunker: null,
        textChunkLimit: 4000,

        sendText: async ({ cfg, to, text, accountId }) => {
            const result = await sendMessageDingtalk(to, text, {
                cfg,
                accountId: accountId ?? undefined,
            });
            return { channel: "dingtalk", ...result };
        },

        sendMedia: async ({ cfg, to, text, mediaUrl, accountId }) => {
            // 钉钉的媒体消息需要特殊处理
            // 这里简化为发送文本+链接
            const messageWithMedia = mediaUrl ? `${text}\n\n📎 ${mediaUrl}` : text;
            const result = await sendMessageDingtalk(to, messageWithMedia, {
                cfg,
                accountId: accountId ?? undefined,
            });
            return { channel: "dingtalk", ...result };
        },
    },

    // ---------------------------------------------------------------------------
    // 状态适配器
    // ---------------------------------------------------------------------------
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

        buildChannelSummary: ({ snapshot }) => ({
            configured: snapshot.configured ?? false,
            tokenSource: snapshot.tokenSource ?? "none",
            running: snapshot.running ?? false,
            lastStartAt: snapshot.lastStartAt ?? null,
            lastStopAt: snapshot.lastStopAt ?? null,
            lastError: snapshot.lastError ?? null,
            probe: snapshot.probe,
        }),
    },

    // ---------------------------------------------------------------------------
    // Gateway适配器
    // ---------------------------------------------------------------------------
    gateway: {
        startAccount: async (ctx) => {
            const account = ctx.account;

            // 先探测验证凭证
            let probeLabel = "";
            try {
                const probe = await probeDingtalk(account.clientId, account.clientSecret, 3000);
                if (probe.ok) {
                    probeLabel = ` (${account.robotCode || account.clientId})`;
                } else {
                    ctx.log?.warn?.(`[${account.accountId}] Probe failed: ${probe.error}`);
                }
            } catch (err) {
                ctx.log?.debug?.(`[${account.accountId}] Probe error: ${String(err)}`);
            }

            ctx.log?.info(`[${account.accountId}] Starting DingTalk Stream provider${probeLabel}`);

            const onMessage = createOpenClawMessageHandler({
                accountId: account.accountId,
                config: ctx.cfg,
                runtime: ctx.runtime,
            });

            return monitorDingtalkProvider({
                clientId: account.clientId,
                clientSecret: account.clientSecret,
                robotCode: account.robotCode,
                accountId: account.accountId,
                config: ctx.cfg,
                runtime: ctx.runtime,
                abortSignal: ctx.abortSignal,
                onMessage,
            });
        },
    },

    // ---------------------------------------------------------------------------
    // 目录适配器
    // ---------------------------------------------------------------------------
    directory: {
        self: async () => null,
        listPeers: async () => [],
        listGroups: async () => [],
    },
};
