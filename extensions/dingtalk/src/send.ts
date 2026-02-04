import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { resolveDingtalkAccount } from "./config.js";
import { getDingtalkClient } from "./client-registry.js";

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
// 辅助工具
// ============================================================================

/**
 * 判断字符串是否包含 Markdown 语法
 */
export function isMarkdown(text: string): boolean {
    // 钉钉 Markdown 支持的语法检测：标题、加粗、链接、图片、代码、引用、列表
    const markdownRegex = /(^#|[*_]{1,3}|\[.*\]\(.*\)|!\[.*\]\(.*\)|`.*`|^>|^\s*[-*+]\s|^\s*\d+\.\s)/m;
    return markdownRegex.test(text);
}

/**
 * 格式化提及用户
 * 钉钉 Markdown 消息中，提及用户需要在文本中包含 @userId 或 @mobile
 */
export function formatMentions(text: string, atUsers?: string[]): string {
    // 钉钉 Markdown 换行建议使用 \n\n
    let formattedText = text.replace(/\n/g, "\n\n");

    if (!atUsers || atUsers.length === 0) {
        return formattedText;
    }

    let mentionStr = "";
    if (atUsers.includes("all")) {
        mentionStr = " @所有人";
    } else {
        mentionStr = " " + atUsers.map((id) => `@${id}`).join(" ");
    }

    return formattedText.trim() + "\n\n" + mentionStr;
}

/**
 * 分离手机号和用户ID
 */
export function parseAtList(atUsers: string[] = []) {
    const mobiles: string[] = [];
    const userIds: string[] = [];
    let isAtAll = false;

    for (const id of atUsers) {
        if (id === "all") {
            isAtAll = true;
        } else if (/^\d{11}$/.test(id)) {
            mobiles.push(id);
        } else {
            userIds.push(id);
        }
    }
    return { mobiles, userIds, isAtAll };
}

/**
 * 获取钉钉访问令牌
 * 优先从活跃的 DWClient 中获取，否则手动获取
 */
export async function getDingtalkAccessToken(
    clientId: string,
    clientSecret: string,
    accountId?: string
): Promise<string> {
    // 尝试从注册的 Client 中获取 (SDK 自动管理刷新)
    if (accountId) {
        const client = getDingtalkClient(accountId);
        if (client) {
            return await client.getAccessToken();
        }
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
    };

    if (!data.accessToken) {
        throw new Error("No access token in response");
    }

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
    options: SendDingtalkOptions = {},
): Promise<SendDingtalkResult> {
    const { clientId, clientSecret, robotCode } = credentials;

    if (!clientId || !clientSecret) {
        return { ok: false, messageId: "", error: "DingTalk credentials not configured" };
    }

    try {
        const accessToken = await getDingtalkAccessToken(clientId, clientSecret, options.accountId);

        const response = await fetch(`https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-acs-dingtalk-access-token": accessToken,
            },
            body: JSON.stringify({
                robotCode: robotCode || clientId,
                userIds: [userId],
                msgKey: "sampleMarkdown",
                msgParam: JSON.stringify({
                    title: "DingTalk Message",
                    text: formatMentions(text, options.atUsers)
                }),
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
 * 发送钉钉消息（群聊）- 使用指定的凭证和 conversationId
 */
export async function sendMessageDingtalkToGroupWithCredentials(
    conversationId: string,
    text: string,
    credentials: { clientId: string; clientSecret: string; robotCode?: string },
    options: SendDingtalkOptions = {},
): Promise<SendDingtalkResult> {
    const { clientId, clientSecret, robotCode } = credentials;

    if (!clientId || !clientSecret) {
        return { ok: false, messageId: "", error: "DingTalk credentials not configured" };
    }

    try {
        const accessToken = await getDingtalkAccessToken(clientId, clientSecret, options.accountId);
        const msgParamObj: any = {
            title: "OpenClaw Notification",
            text: formatMentions(text, options.atUsers)
        };

        const { mobiles, userIds, isAtAll } = parseAtList(options.atUsers);
        const body: any = {
            robotCode: robotCode || clientId,
            openConversationId: conversationId,
            msgKey: "sampleMarkdown",
            msgParam: JSON.stringify(msgParamObj),
            at: {
                atUserIds: userIds,
                atMobiles: mobiles,
                isAtAll,
            },
        };

        const response = await fetch(`https://api.dingtalk.com/v1.0/robot/groupMessages/send`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-acs-dingtalk-access-token": accessToken,
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const error = await response.text();
            return { ok: false, messageId: "", error: `HTTP ${response.status}: ${error}` };
        }

        const result = (await response.json()) as { processQueryKey?: string };
        return {
            ok: true,
            messageId: result.processQueryKey || `dingtalk-group-${Date.now()}`,
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
    }, options);
}

/**
 * 发送钉钉消息（群聊/SessionWebhook - 通过Webhook回复）
 */
export async function sendMessageDingtalkToGroup(
    webhookUrl: string,
    text: string,
    options: SendDingtalkOptions = {},
): Promise<SendDingtalkResult> {
    if (!webhookUrl) {
        return { ok: false, messageId: "", error: "Webhook URL required" };
    }

    try {
        const messageBody: Record<string, any> = {
            msgtype: "markdown",
            markdown: {
                title: "DingTalk Message",
                text: formatMentions(text, options.atUsers),
            },
        };

        const { mobiles, userIds, isAtAll } = parseAtList(options.atUsers);

        // 添加@配置
        messageBody.at = {
            atUserIds: userIds,
            atMobiles: mobiles,
            isAtAll,
        };

        const headers: Record<string, string> = {
            "Content-Type": "application/json"
        };

        // 如果提供了配置，尝试获取 AccessToken (SessionWebhook 需要)
        if (options.cfg) {
            try {
                const account = resolveDingtalkAccount({
                    cfg: options.cfg,
                    accountId: options.accountId,
                });
                if (account.clientId && account.clientSecret) {
                    const accessToken = await getDingtalkAccessToken(account.clientId, account.clientSecret);
                    headers["x-acs-dingtalk-access-token"] = accessToken;
                }
            } catch (e) {
                // 忽略错误，可能是普通的自定义机器人 Webhook
            }
        }

        const response = await fetch(webhookUrl, {
            method: "POST",
            headers,
            body: JSON.stringify(messageBody),
        });

        const debugBody = JSON.stringify(messageBody, null, 2);
        console.log(`[DingTalk] Sending via Webhook: ${webhookUrl}`);
        console.log(`[DingTalk] Payload: ${debugBody}`);
        console.log(`[DingTalk] Headers: ${JSON.stringify(headers)}`);

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
        const accessToken = await getDingtalkAccessToken(account.clientId, account.clientSecret, options.accountId);

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
    } else if (target.startsWith("group:")) {
        target = target.slice(6);
    } else if (target.startsWith("channel:")) {
        target = target.slice(8);
    }

    console.log(`[DingTalk] Dispatching message. RawTo: "${to}", ResolvedTarget: "${target}"`);
    console.log(`[DingTalk] Options: ${JSON.stringify(options)}`);

    // 判断目标类型
    // 1. Webhook URL (包括流模式的 sessionWebhook)
    // 只要包含 http 字符（不一定是开头，防止带空格或特殊前缀），就视为 Webhook
    if (target.includes("http://") || target.includes("https://")) {
        console.log(`[DingTalk] Target identified as Webhook.`);
        return sendMessageDingtalkToGroup(target, text, options);
    }

    // 2. ConversationId (通常以 cid 开头)
    if (target.startsWith("cid")) {
        if (!options.cfg) return { ok: false, messageId: "", error: "Config required for group API" };
        const account = resolveDingtalkAccount({ cfg: options.cfg, accountId: options.accountId });
        return sendMessageDingtalkToGroupWithCredentials(target, text, {
            clientId: account.clientId,
            clientSecret: account.clientSecret,
            robotCode: account.robotCode,
        }, options);
    }

    // 3. 默认视为用户ID (单聊)
    return sendMessageDingtalkToUser(target, text, options);
}
