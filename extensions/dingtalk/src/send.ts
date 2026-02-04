import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { resolveDingtalkAccount } from "./config.js";

// ============================================================================
// 类型定义
// ============================================================================

export type SendDingtalkOptions = {
    cfg?: OpenClawConfig;
    accountId?: string;
    mediaUrl?: string;
    atUsers?: string[];
    conversationType?: "single" | "group";
};

export type SendDingtalkResult = {
    ok: boolean;
    messageId: string;
    processQueryKey?: string;
    error?: string;
};

// ============================================================================
// 访问令牌缓存
// ============================================================================

type TokenCacheEntry = {
    accessToken: string;
    expiresAt: number;
};

const tokenCache = new Map<string, TokenCacheEntry>();

/**
 * 获取钉钉访问令牌（带缓存）
 */
export async function getDingtalkAccessToken(
    clientId: string,
    clientSecret: string,
): Promise<string> {
    const cacheKey = `${clientId}:${clientSecret}`;
    const cached = tokenCache.get(cacheKey);

    // 检查缓存是否有效（提前5分钟刷新）
    if (cached && cached.expiresAt > Date.now() + 5 * 60 * 1000) {
        return cached.accessToken;
    }

    const response = await fetch(`https://api.dingtalk.com/v1.0/oauth2/accessToken`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            appKey: clientId,
            appSecret: clientSecret,
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to get access token: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as {
        accessToken?: string;
        expireIn?: number;
    };

    if (!data.accessToken) {
        throw new Error("No access token in response");
    }

    // 缓存令牌（默认7200秒过期）
    const expiresIn = data.expireIn || 7200;
    tokenCache.set(cacheKey, {
        accessToken: data.accessToken,
        expiresAt: Date.now() + expiresIn * 1000,
    });

    return data.accessToken;
}

// ============================================================================
// 消息发送
// ============================================================================

/**
 * 发送钉钉消息（单聊）- 使用指定的凭证
 */
export async function sendMessageDingtalkToUserWithCredentials(
    userId: string,
    text: string,
    credentials: { clientId: string; clientSecret: string; robotCode?: string },
): Promise<SendDingtalkResult> {
    const { clientId, clientSecret, robotCode } = credentials;

    if (!clientId || !clientSecret) {
        return { ok: false, messageId: "", error: "DingTalk credentials not configured" };
    }

    try {
        const accessToken = await getDingtalkAccessToken(clientId, clientSecret);

        const response = await fetch(`https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-acs-dingtalk-access-token": accessToken,
            },
            body: JSON.stringify({
                robotCode: robotCode || clientId,
                userIds: [userId],
                msgKey: "sampleText",
                msgParam: JSON.stringify({ content: text }),
            }),
        });

        if (!response.ok) {
            const error = await response.text();
            return { ok: false, messageId: "", error: `HTTP ${response.status}: ${error}` };
        }

        const result = (await response.json()) as { processQueryKey?: string };
        return {
            ok: true,
            messageId: result.processQueryKey || `dingtalk-${Date.now()}`,
            processQueryKey: result.processQueryKey,
        };
    } catch (err) {
        return { ok: false, messageId: "", error: String(err) };
    }
}

/**
 * 发送钉钉消息（单聊）
 */
export async function sendMessageDingtalkToUser(
    userId: string,
    text: string,
    options: SendDingtalkOptions = {},
): Promise<SendDingtalkResult> {
    if (!options.cfg) {
        return { ok: false, messageId: "", error: "Config not provided" };
    }

    const account = resolveDingtalkAccount({
        cfg: options.cfg,
        accountId: options.accountId,
    });

    return sendMessageDingtalkToUserWithCredentials(userId, text, {
        clientId: account.clientId,
        clientSecret: account.clientSecret,
        robotCode: account.robotCode,
    });
}

/**
 * 发送钉钉消息（群聊 - 通过Webhook回复）
 */
export async function sendMessageDingtalkToGroup(
    webhookUrl: string,
    text: string,
    options: SendDingtalkOptions = {},
): Promise<SendDingtalkResult> {
    if (!webhookUrl) {
        return { ok: false, messageId: "", error: "Webhook URL required for group messages" };
    }

    try {
        const messageBody: Record<string, unknown> = {
            msgtype: "text",
            text: {
                content: text,
            },
        };

        // 添加@用户
        if (options.atUsers && options.atUsers.length > 0) {
            messageBody.at = {
                atUserIds: options.atUsers,
            };
        }

        const response = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(messageBody),
        });

        if (!response.ok) {
            const error = await response.text();
            return { ok: false, messageId: "", error: `HTTP ${response.status}: ${error}` };
        }

        return { ok: true, messageId: `webhook-${Date.now()}` };
    } catch (err) {
        return { ok: false, messageId: "", error: String(err) };
    }
}

/**
 * 发送钉钉Markdown消息
 */
export async function sendMarkdownDingtalk(
    userId: string,
    title: string,
    text: string,
    options: SendDingtalkOptions = {},
): Promise<SendDingtalkResult> {
    if (!options.cfg) {
        return { ok: false, messageId: "", error: "Config not provided" };
    }

    const account = resolveDingtalkAccount({
        cfg: options.cfg,
        accountId: options.accountId,
    });

    if (!account.clientId || !account.clientSecret) {
        return { ok: false, messageId: "", error: "DingTalk credentials not configured" };
    }

    try {
        const accessToken = await getDingtalkAccessToken(account.clientId, account.clientSecret);

        const response = await fetch(`https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-acs-dingtalk-access-token": accessToken,
            },
            body: JSON.stringify({
                robotCode: account.robotCode || account.clientId,
                userIds: [userId],
                msgKey: "sampleMarkdown",
                msgParam: JSON.stringify({ title, text }),
            }),
        });

        if (!response.ok) {
            const error = await response.text();
            return { ok: false, messageId: "", error: `HTTP ${response.status}: ${error}` };
        }

        const result = (await response.json()) as { processQueryKey?: string };
        return {
            ok: true,
            messageId: result.processQueryKey || `dingtalk-md-${Date.now()}`,
            processQueryKey: result.processQueryKey,
        };
    } catch (err) {
        return { ok: false, messageId: "", error: String(err) };
    }
}

/**
 * 通用消息发送接口
 * 根据目标类型自动选择发送方式
 */
export async function sendMessageDingtalk(
    to: string,
    text: string,
    options: SendDingtalkOptions = {},
): Promise<SendDingtalkResult> {
    // 识别并处理 OpenClaw 统一样式的 Target 格式
    let target = to;
    if (target.startsWith("user:")) {
        target = target.slice(5);
    } else if (target.startsWith("channel:")) {
        target = target.slice(8);
    }

    // 判断目标类型
    // - 如果经过 slice 后的 target 仍是 webhook URL 格式，或原位就是，使用群聊发送
    if (target.startsWith("http://") || target.startsWith("https://") || to.startsWith("http://") || to.startsWith("https://")) {
        return sendMessageDingtalkToGroup(target, text, options);
    }

    // 否则视为用户ID，使用单聊发送
    return sendMessageDingtalkToUser(target, text, options);
}
