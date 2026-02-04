import type { OpenClawConfig, RuntimeEnv } from "openclaw/plugin-sdk";
import { recordInboundSession } from "openclaw/plugin-sdk";
import type { DingtalkProbeResult } from "./config.js";
import { DWClient, TOPIC_ROBOT, type DWClientDownStream } from "dingtalk-stream";
import { getDingtalkRuntime } from "./runtime.js";
import { sendMessageDingtalk } from "./send.js";
import { registerDingtalkClient, unregisterDingtalkClient } from "./client-registry.js";


// ============================================================================
// 类型定义
// ============================================================================

export type MonitorDingtalkParams = {
    clientId: string;
    clientSecret: string;
    robotCode?: string;
    accountId: string;
    config: OpenClawConfig;
    runtime: RuntimeEnv;
    abortSignal: AbortSignal;
    onMessage?: (message: DingtalkInboundMessage) => Promise<void>;
};

export type DingtalkInboundMessage = {
    conversationId: string;
    conversationType: "1" | "2"; // 1=单聊, 2=群聊
    senderId: string;
    senderNick: string;
    senderCorpId?: string;
    senderStaffId?: string;
    content: string;
    msgId: string;
    msgtype: string;
    createAt: number;
    sessionWebhook?: string;
    sessionWebhookExpiredTime?: number;
    atUsers?: Array<{ dingtalkId: string; staffId?: string }>;
    isAdmin?: boolean;
    chatbotUserId?: string;
};

export type RobotMessage = {
    conversationId?: string;
    conversationType?: string;
    senderId?: string;
    senderNick?: string;
    senderCorpId?: string;
    senderStaffId?: string;
    chatbotUserId?: string;
    msgId?: string;
    msgtype?: string;
    createAt?: number;
    text?: { content?: string };
    sessionWebhook?: string;
    sessionWebhookExpiredTime?: number;
    atUsers?: Array<{ dingtalkId?: string; staffId?: string }>;
    isAdmin?: boolean;
    robotCode?: string;
};

// ============================================================================
// 探测函数
// ============================================================================

/**
 * 探测钉钉机器人账户状态
 * 通过获取AccessToken验证凭证是否有效
 */
export async function probeDingtalk(
    clientId: string,
    clientSecret: string,
    timeoutMs: number,
): Promise<DingtalkProbeResult> {
    if (!clientId || !clientSecret) {
        return { ok: false, error: "Missing clientId or clientSecret" };
    }

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        const response = await fetch(`https://api.dingtalk.com/v1.0/oauth2/accessToken`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                appKey: clientId,
                appSecret: clientSecret,
            }),
            signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
            const error = await response.text();
            return { ok: false, error: `HTTP ${response.status}: ${error}` };
        }

        const data = (await response.json()) as {
            accessToken?: string;
            expireIn?: number;
        };

        return {
            ok: Boolean(data.accessToken),
            robot: { robotCode: clientId },
        };
    } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
            return { ok: false, error: "Timeout" };
        }
        return { ok: false, error: String(err) };
    }
}

// ============================================================================
// Stream监听器 (使用官方 dingtalk-stream SDK)
// ============================================================================

/**
 * 启动钉钉Stream监听器
 */
export async function monitorDingtalkProvider(params: MonitorDingtalkParams): Promise<void> {
    const { clientId, clientSecret, robotCode, accountId, config, runtime, abortSignal, onMessage } =
        params;

    const logger = getDingtalkRuntime().logging.getChildLogger({ subsystem: "dingtalk/monitor", accountId });

    logger.info(`Starting DingTalk Stream provider (RobotCode: ${robotCode || clientId})`);

    // 创建钉钉Stream客户端
    const client = new DWClient({
        clientId,
        clientSecret,
        debug: false,
    });

    // 注册到全局注册表以便发送端复用
    registerDingtalkClient(accountId, client);

    // 注册机器人消息回调
    client.registerCallbackListener(TOPIC_ROBOT, async (res: DWClientDownStream) => {
        try {
            const message = JSON.parse(res.data) as RobotMessage;
            const { text, senderStaffId, sessionWebhook, conversationId, senderNick, msgId } = message;

            const messageContent = text?.content?.trim() || "";
            if (!messageContent) return;

            // 构建入站消息
            const inboundMessage: DingtalkInboundMessage = {
                conversationId: conversationId || "",
                conversationType: message.conversationType === "2" ? "2" : "1",
                senderId: message.senderId || senderStaffId || "",
                senderNick: senderNick || "",
                senderCorpId: message.senderCorpId,
                senderStaffId: senderStaffId,
                content: messageContent,
                msgId: msgId || "",
                msgtype: message.msgtype || "text",
                createAt: message.createAt || Date.now(),
                sessionWebhook,
                sessionWebhookExpiredTime: message.sessionWebhookExpiredTime,
                atUsers: message.atUsers?.map((u) => ({
                    dingtalkId: u.dingtalkId || "",
                    staffId: u.staffId,
                })),
                isAdmin: message.isAdmin,
                chatbotUserId: message.chatbotUserId,
            };

            // 给回包，表示消息已收到 (DingTalk 要求 5s 内回复)
            if (res.headers?.messageId) {
                client.socketCallBackResponse(res.headers.messageId, "ok");
            }

            // 调用消息处理回调
            if (onMessage) {
                onMessage(inboundMessage).catch(err => {
                    logger.error(`Message handler error: ${String(err)}`);
                });
            }
        } catch (err) {
            logger.error(`Error processing message: ${String(err)}`);
        }
    });

    // 连接到钉钉Stream服务
    client.connect();

    // 等待abort信号
    return new Promise((resolve) => {
        abortSignal.addEventListener("abort", () => {
            logger.info("Stream provider stopping...");
            unregisterDingtalkClient(accountId);
            // 注意：dingtalk-stream SDK 可能没有提供断开连接的方法
            resolve();
        });
    });
}

// ============================================================================
// 集成OpenClaw消息处理
// ============================================================================

/**
 * 创建与OpenClaw集成的消息处理器
 * 将钉钉消息转发给OpenClaw Gateway处理
 */
export function createOpenClawMessageHandler(params: {
    accountId: string;
    config: OpenClawConfig;
    runtime: RuntimeEnv;
}) {
    const { accountId, config: cfg } = params;
    const runtime = getDingtalkRuntime();
    const logger = runtime.logging.getChildLogger({ subsystem: "dingtalk/handler", accountId });

    return async (message: DingtalkInboundMessage): Promise<void> => {
        const isGroup = message.conversationType === "2";
        const senderId = message.senderStaffId || message.senderId;

        // 构建会话标识
        // 单聊使用用户ID，群聊使用会话ID
        const to = isGroup ? `channel:${message.conversationId}` : `user:${senderId}`;
        const from = `dingtalk:${senderId}`;

        // 格式化 Inbound Envelope
        const storePath = runtime.channel.session.resolveStorePath(cfg.session?.store, {
            agentId: undefined, // 使用默认 agent 或由路由决定
        });

        // 这里的路由逻辑通常由 Gateway 处理，我们需要提供足够的上下文
        const sessionKey = `dingtalk:${accountId}:${isGroup ? `group:${message.conversationId}` : `direct:${senderId}`}`;

        const previousTimestamp = runtime.channel.session.readSessionUpdatedAt({
            storePath,
            sessionKey,
        });

        const envelopeOptions = runtime.channel.reply.resolveEnvelopeFormatOptions(cfg);
        const combinedBody = runtime.channel.reply.formatInboundEnvelope({
            channel: "DingTalk",
            from: message.senderNick || senderId,
            timestamp: message.createAt,
            body: message.content,
            chatType: isGroup ? "channel" : "direct",
            senderLabel: message.senderNick || senderId,
            previousTimestamp,
            envelope: envelopeOptions,
        });

        // 组装 Context
        const ctxPayload = runtime.channel.reply.finalizeInboundContext({
            Body: combinedBody,
            RawBody: message.content,
            From: from,
            To: to,
            SessionKey: sessionKey,
            AccountId: accountId,
            ChatType: isGroup ? "channel" : "direct",
            ConversationLabel: isGroup ? `DingTalk Group ${message.conversationId}` : `DingTalk User ${message.senderNick}`,
            SenderName: message.senderNick,
            SenderId: senderId,
            Provider: "dingtalk",
            Surface: "dingtalk",
            MessageSid: message.msgId,
            Timestamp: message.createAt,
            WasMentioned: !isGroup || message.atUsers?.some(u => u.dingtalkId === message.chatbotUserId || u.staffId === message.chatbotUserId),
            OriginatingChannel: "dingtalk",
            OriginatingTo: to,
        });

        // 记录会话
        await recordInboundSession({
            storePath,
            sessionKey,
            ctx: ctxPayload,
            onRecordError: (err) => {
                logger.error(`Failed to record session: ${String(err)}`);
            },
        });

        // 创建回复分发器
        const { dispatcher, replyOptions, markDispatchIdle } = runtime.channel.reply.createReplyDispatcherWithTyping({
            deliver: async (payload) => {
                const text = payload.text || "";
                if (!text && !payload.mediaUrl && !(payload.mediaUrls?.length)) return;

                // 优先使用 sessionWebhook (适用于流模式即时回复)
                const deliverTarget = message.sessionWebhook || to;

                // 自动把原发送者加入艾特列表 (如果是群聊回复)
                const atUsers = isGroup ? [senderId] : undefined;

                await sendMessageDingtalk(deliverTarget, text, {
                    cfg,
                    accountId,
                    atUsers,
                });
            },
            onError: (err) => {
                runtime.logging.getChildLogger({ subsystem: "dingtalk/dispatch" }).error(`Reply failed: ${String(err)}`);
            },
        });

        // 分发消息
        await runtime.channel.reply.dispatchReplyFromConfig({
            ctx: ctxPayload,
            cfg,
            dispatcher,
            replyOptions,
        });

        markDispatchIdle();
    };
}
