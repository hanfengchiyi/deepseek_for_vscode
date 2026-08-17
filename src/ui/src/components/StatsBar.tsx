import React from "react";
import { useChatStore } from "../state/store";

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return `${min}m${sec}s`;
  const h = Math.floor(min / 60);
  return `${h}h${min % 60}m`;
}

/** Cumulative session stats bar, rendered between the model bar and the
 *  chat history. Collapsible; nothing renders until the first
 *  `session.stats` event arrives. */
export const StatsBar: React.FC = () => {
  const stats = useChatStore((s) => s.stats);
  const collapsed = useChatStore((s) => s.statsCollapsed);
  const toggle = useChatStore((s) => s.toggleStatsCollapsed);

  if (!stats) return null;

  const parts: string[] = [
    `${stats.turns} 轮 · ${stats.steps} 步`,
    `LLM ${formatDuration(stats.llmMs)} · 工具 ${formatDuration(stats.toolMs)}`,
  ];
  const ttft = stats.ttftMs ? `首 token ${(stats.ttftMs.avg / 1000).toFixed(1)}s` : null;
  const tps = stats.outputTokensPerSec !== null ? `${stats.outputTokensPerSec} tok/s` : null;
  if (ttft || tps) parts.push([ttft, tps].filter(Boolean).join(" · "));
  if (stats.cacheHitPct !== null) parts.push(`缓存 ${stats.cacheHitPct}%`);
  parts.push(`入 ${formatTokens(stats.inputTokens)} · 出 ${formatTokens(stats.outputTokens)}`);

  return (
    <div className="dsh-statsbar">
      <button
        className="dsh-statsbar-toggle"
        onClick={toggle}
        title={collapsed ? "展开统计" : "折叠统计"}
        aria-label={collapsed ? "Expand session stats" : "Collapse session stats"}
      >
        {collapsed ? "▸" : "▾"}
      </button>
      {collapsed ? null : <span className="dsh-statsbar-text">{parts.join(" ｜ ")}</span>}
    </div>
  );
};
