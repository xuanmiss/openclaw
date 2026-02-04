import type { OpenClawConfig } from "openclaw/plugin-sdk";

// ============================================================================
// 类型定义
// ============================================================================

export type DingtalkTokenSource = "config" | "env" | "none";

export type DingtalkAccountConfig = {
    enabled?: boolean;
    name?: string;
    clientId?: string;
    clientSecret?: string;
    robotCode?: string;
    allowFrom?: Array<string | number>;
    dmPolicy?: "open" | "allowlist" | "pairing";
    groups?: Record<
        string,
        {
            requireMention?: boolean;
            allowFrom?: string[];
        }
    >;
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

export type DingtalkConfig = {
    enabled?: boolean;
    name?: string;
    clientId?: string;
    clientSecret?: string;
    robotCode?: string;
    dmPolicy?: "open" | "allowlist" | "pairing";
    allowFrom?: Array<string | number>;
    groupPolicy?: "open" | "allowlist";
    groups?: Record<
        string,
        {
            requireMention?: boolean;
            allowFrom?: string[];
        }
    >;
    accounts?: Record<
        string,
        {
            enabled?: boolean;
            name?: string;
            clientId?: string;
            clientSecret?: string;
            robotCode?: string;
            dmPolicy?: "open" | "allowlist" | "pairing";
            allowFrom?: Array<string | number>;
        }
    >;
};

// ============================================================================
// 常量
// ============================================================================

export const DEFAULT_ACCOUNT_ID = "default";

// ============================================================================
// 配置解析函数
// ============================================================================

/**
 * 解析钉钉账户配置
 */
export function resolveDingtalkAccount(params: {
    cfg: OpenClawConfig;
    accountId?: string | null;
}): ResolvedDingtalkAccount {
    const { cfg, accountId: rawAccountId } = params;
    const accountId = rawAccountId?.trim() || DEFAULT_ACCOUNT_ID;
    const section = (cfg.channels as Record<string, unknown> | undefined)?.dingtalk as
        | DingtalkConfig
        | undefined;

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

/**
 * 列出所有钉钉账户ID
 */
export function listDingtalkAccountIds(cfg: OpenClawConfig): string[] {
    const section = (cfg.channels as Record<string, unknown> | undefined)?.dingtalk as
        | DingtalkConfig
        | undefined;
    const accounts = section?.accounts || {};
    const ids = Object.keys(accounts).filter((id) => id.trim());

    // 如果有默认配置或环境变量，添加default
    const hasDefaultConfig = !!(section?.clientId || process.env.DINGTALK_CLIENT_ID);

    if (hasDefaultConfig && !ids.includes(DEFAULT_ACCOUNT_ID)) {
        return [DEFAULT_ACCOUNT_ID, ...ids];
    }

    return ids.length > 0 ? ids : [DEFAULT_ACCOUNT_ID];
}

/**
 * 解析默认钉钉账户ID
 */
export function resolveDefaultDingtalkAccountId(cfg: OpenClawConfig): string {
    const ids = listDingtalkAccountIds(cfg);
    return ids[0] || DEFAULT_ACCOUNT_ID;
}
