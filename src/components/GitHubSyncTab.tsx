import { useState } from "react";
import { GitBranch, Github, Loader2, RefreshCw, Star } from "lucide-react";
import { useSite } from "@/lib/site-context";
import { sinceLabel, starLabel } from "@/lib/github";
import type { GithubRepoRow } from "@/lib/types";
import { AuroraButton } from "@/components/ui/aurora-button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export function GitHubSyncTab() {
  const { ghRepos, ghState, ghBusy, syncGithub, toggleRepoShow, saveRepoIntro } = useSite();
  const [editing, setEditing] = useState<GithubRepoRow | null>(null);
  const [draft, setDraft] = useState("");

  async function runSync() {
    try {
      const msg = await syncGithub();
      toast.success(msg);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "同步失败，请稍后重试");
    }
  }

  async function onToggle(repo: GithubRepoRow, show: boolean) {
    try {
      await toggleRepoShow(repo, show);
      toast.success(show ? `「${repo.name}」已上架到作品区` : `「${repo.name}」已从作品区下架`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "操作失败");
    }
  }

  async function saveIntro() {
    if (!editing) return;
    if (!draft.trim()) {
      toast.error("介绍不能为空");
      return;
    }
    try {
      await saveRepoIntro(editing, draft);
      toast.success("介绍已保存，后续同步不会覆盖");
      setEditing(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    }
  }

  return (
    <div className="space-y-4">
      <div className="glass-card rounded-2xl p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[13px] font-bold text-ink">
              <Github size={14} className="text-lilac" /> {ghState?.org_login ?? "egg-Li-dd"}
            </p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
              每天自动核对一次最新内容；组织里<strong>新出现的仓库会自动上架</strong>，取消勾选过的不会被重新拉起。README 与源码在打开时实时读取，不占本站存储。
            </p>
            <p className="mt-1.5 font-mono text-[10.5px] text-muted-foreground">
              上次同步 {sinceLabel(ghState?.last_sync_at ?? null)} · 共 {ghRepos.length} 个仓库
            </p>
          </div>
          <AuroraButton variant="glow" size="sm" onClick={() => void runSync()} disabled={ghBusy}>
            {ghBusy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            立即同步
          </AuroraButton>
        </div>
      </div>

      {ghRepos.length === 0 && (
        <p className="rounded-2xl border-2 border-dashed border-lilac/25 bg-lilac/5 px-4 py-10 text-center text-[13px] text-muted-foreground">
          还没有同步过仓库，点上面的「立即同步」拉取一次。
        </p>
      )}

      {ghRepos.map((repo) => (
        <div key={repo.id} className={cn("glass-card space-y-2.5 rounded-2xl px-3.5 py-3", ghBusy && "opacity-70")}>
          <div className="flex items-start gap-2.5">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 truncate text-[13px] font-semibold text-ink">
                {repo.name}
                {repo.archived && <span className="shrink-0 rounded-pill bg-butter/25 px-1.5 py-0.5 text-[9.5px] font-bold text-amber-700">归档</span>}
              </p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 font-mono text-[10.5px] text-muted-foreground">
                {repo.language && (
                  <span className="inline-flex items-center gap-1">
                    <GitBranch size={10} /> {repo.language}
                  </span>
                )}
                <span className="inline-flex items-center gap-1">
                  <Star size={10} /> {starLabel(repo.stars)}
                </span>
                <span>推送于 {sinceLabel(repo.pushed_at)}</span>
              </p>
            </div>
            <label className="flex shrink-0 cursor-pointer items-center gap-1.5 pt-0.5">
              <input
                type="checkbox"
                checked={repo.show_on_site}
                disabled={ghBusy}
                onChange={(e) => void onToggle(repo, e.target.checked)}
                className="h-3.5 w-3.5 accent-[oklch(0.62_0.19_300)]"
              />
              <span className="text-[11px] font-semibold text-muted-foreground">展示</span>
            </label>
          </div>

          {repo.intro_zh ? (
            <p className="text-[12px] leading-relaxed text-ink-soft/90">{repo.intro_zh}</p>
          ) : (
            <p className="text-[12px] italic leading-relaxed text-muted-foreground">还没有中文介绍</p>
          )}

          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] text-muted-foreground">
              {repo.intro_source === "manual" ? "站长自定义" : repo.intro_source === "auto" ? "自动生成" : "未生成"}
            </span>
            <button
              type="button"
              onClick={() => {
                setEditing(repo);
                setDraft(repo.intro_zh);
              }}
              className="text-[11px] font-semibold text-lilac transition hover:underline"
            >
              写介绍
            </button>
          </div>
        </div>
      ))}

      {editing && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-ink/35 backdrop-blur-sm sm:items-center sm:p-6" onClick={() => setEditing(null)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="animate-pop-in w-full max-w-md rounded-t-3xl bg-popover p-5 shadow-2xl ring-1 ring-white/50 sm:rounded-3xl sm:p-6"
          >
            <h4 className="font-display text-base font-bold text-ink">编辑「{editing.name}」的中文介绍</h4>
            <p className="mt-1 text-[11.5px] text-muted-foreground">这段文字会作为作品卡片与详情页的简介。保存后自动同步不再覆盖它。</p>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={4}
              maxLength={200}
              placeholder="一到两句话，说清这个项目做什么、给谁用"
              className="mt-3 w-full resize-none rounded-xl border border-input bg-white/85 px-3.5 py-2.5 text-[13px] leading-relaxed text-ink outline-none transition placeholder:text-muted-foreground/70 focus:border-lilac/60 focus:ring-2 focus:ring-lilac/25"
            />
            <p className="mt-1 text-right font-mono text-[10.5px] text-muted-foreground">{draft.length}/200</p>
            <div className="mt-3 flex gap-2">
              <AuroraButton variant="soft" size="md" className="flex-1" onClick={() => setEditing(null)}>
                取消
              </AuroraButton>
              <AuroraButton variant="glow" size="md" className="flex-1" onClick={() => void saveIntro()}>
                保存
              </AuroraButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
