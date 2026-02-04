import { html, nothing } from "lit";
import type { DingtalkStatus } from "../types";
import type { ChannelsProps } from "./channels.types";
import { formatAgo } from "../format";
import { renderChannelConfigSection } from "./channels.config";

export function renderDingtalkCard(params: {
    props: ChannelsProps;
    dingtalk?: DingtalkStatus | null;
    accountCountLabel: unknown;
}) {
    const { props, dingtalk, accountCountLabel } = params;

    return html`
    <div class="card">
      <div class="card-title">DingTalk</div>
      <div class="card-sub">Robot status and channel configuration.</div>
      ${accountCountLabel}

      <div class="status-list" style="margin-top: 16px;">
        <div>
          <span class="label">Configured</span>
          <span>${dingtalk?.configured ? "Yes" : "No"}</span>
        </div>
        <div>
          <span class="label">Running</span>
          <span>${dingtalk?.running ? "Yes" : "No"}</span>
        </div>
        <div>
          <span class="label">Last start</span>
          <span>${dingtalk?.lastStartAt ? formatAgo(dingtalk.lastStartAt) : "n/a"}</span>
        </div>
        <div>
          <span class="label">Last probe</span>
          <span>${dingtalk?.lastProbeAt ? formatAgo(dingtalk.lastProbeAt) : "n/a"}</span>
        </div>
      </div>

      ${dingtalk?.lastError
            ? html`<div class="callout danger" style="margin-top: 12px;">
            ${dingtalk.lastError}
          </div>`
            : nothing
        }

      ${dingtalk?.probe
            ? html`<div class="callout" style="margin-top: 12px;">
            Probe ${dingtalk.probe.ok ? "ok" : "failed"}
            ${dingtalk.probe.robot?.name ? `(${dingtalk.probe.robot.name})` : ""}
            ${dingtalk.probe.error ? `· ${dingtalk.probe.error}` : ""}
          </div>`
            : nothing
        }

      ${renderChannelConfigSection({ channelId: "dingtalk", props })}

      <div class="row" style="margin-top: 12px;">
        <button class="btn" @click=${() => props.onRefresh(true)}>
          Probe
        </button>
      </div>
    </div>
  `;
}
