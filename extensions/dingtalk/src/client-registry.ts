import { DWClient } from "dingtalk-stream";

/**
 * 存放活跃的钉钉客户端实例
 */
const activeClients = new Map<string, DWClient>();

/**
 * 注册客户端
 */
export function registerDingtalkClient(accountId: string, client: DWClient) {
    activeClients.set(accountId, client);
}

/**
 * 获取客户端
 */
export function getDingtalkClient(accountId: string): DWClient | undefined {
    return activeClients.get(accountId);
}

/**
 * 移除客户端
 */
export function unregisterDingtalkClient(accountId: string) {
    activeClients.delete(accountId);
}
