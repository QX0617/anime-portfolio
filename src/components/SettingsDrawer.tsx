import { useState } from "react";
import { Check, Eye, EyeOff, Github, KeyRound, Layers, ListMusic, Loader2, Pencil, Settings2, ShieldCheck, Trash2, User } from "lucide-react";
import { useSite, type SettingsTab } from "@/lib/site-context";
import { AuroraButton } from "@/components/ui/aurora-button";
import { ProfileTab } from "@/components/ProfileTab";
import { BackgroundTab } from "@/components/BackgroundTab";
import { GitHubSyncTab } from "@/components/GitHubSyncTab";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const TABS: { key: SettingsTab; label: string; Icon: typeof User }[] = [
  { key: "profile", label: "资料", Icon: User },
  { key: "background", label: "背景", Icon: Layers },
  { key: "projects", label: "项目", Icon: ListMusic },
  { key: "github", label: "GitHub", Icon: Github },
];

export function SettingsDrawer() {
  const { settingsOpen, setSettingsOpen, settingsTab, setSettingsTab, editMode, unlock, lock, openSettings } = useSite();
  const [keyInput, setKeyInput] = useState("");
  const [checking, setChecking] = useState(false);
  const [shake, setShake] = useState(false);

  if (!settingsOpen) return null;

  async function tryUnlock() {
    if (!keyInput.trim()) return;
    setChecking(true);
    setShake(false);
    try {
      const ok = await unlock(keyInput);
      if (ok) {
        toast.success("编辑模式已解锁");
        setKeyInput("");
        setSettingsTab("profile");
      } else {
        setShake(true);
        toast.error("密钥不正确");
      }
    } catch {
      toast.error("校验失败，请稍后重试");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-ink/30 backdrop-blur-sm" onClick={() => setSettingsOpen(false)}>
      <aside
        onClick={(e) => e.stopPropagation()}
        className="animate-pop-in flex h-full w-full max-w-md flex-col overflow-hidden bg-popover shadow-2xl ring-1 ring-white/50"
      >
        <div className="aurora-bg flex shrink-0 items-center justify-between px-5 py-4">
          <h3 className="flex items-center gap-2 font-display text-lg font-bold text-ink">
            <Settings2 size={18} className="text-lilac" /> 站点设置
          </h3>
          <AuroraButton variant="ghost" size="iconSm" onClick={() => setSettingsOpen(false)} title="关闭">
            <span className="text-lg leading-none">×</span>
          </AuroraButton>
        </div>

        {!editMode ? (
          <div className="flex flex-1 flex-col justify-center px-6 pb-16">
            <div className="glass-card rounded-3xl p-7 text-center">
              <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-lilac/12">
                <KeyRound size={22} className="text-lilac" />
              </span>
              <h4 className="font-display text-lg font-bold text-ink">站长密钥</h4>
              <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                输入密钥即可解锁编辑模式，管理头像、用户名、项目与背景。访客无需密钥，只能浏览。
              </p>
              <div className={cn("mt-6 flex gap-2", shake && "animate-shake")}>
                <input
                  type="password"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void tryUnlock()}
                  placeholder="请输入密钥"
                  autoComplete="off"
                  className="w-full rounded-xl border border-input bg-white/85 px-3.5 py-2.5 text-sm text-ink outline-none transition placeholder:text-muted-foreground/70 focus:border-lilac/60 focus:ring-2 focus:ring-lilac/25"
                />
                <AuroraButton variant="glow" size="md" onClick={() => void tryUnlock()} disabled={checking || !keyInput.trim()}>
                  {checking ? <Loader2 size={15} className="animate-spin" /> : "解锁"}
                </AuroraButton>
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground">解锁状态仅保存在当前浏览器标签页。</p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex shrink-0 gap-1 border-b border-border/60 bg-white/50 px-4 py-2">
              {TABS.map(({ key, label, Icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSettingsTab(key)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[13px] font-semibold transition",
                    settingsTab === key ? "bg-lilac/12 text-lilac" : "text-muted-foreground hover:bg-muted/60 hover:text-ink",
                  )}
                >
                  <Icon size={14} /> {label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5">
              {settingsTab === "profile" && <ProfileTab />}
              {settingsTab === "background" && <BackgroundTab />}
              {settingsTab === "projects" && <ProjectsTab />}
              {settingsTab === "github" && <GitHubSyncTab />}
            </div>

            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border/60 bg-white/60 px-5 py-3.5">
              <span className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700">
                <ShieldCheck size={13} /> 编辑模式
              </span>
              <AuroraButton variant="soft" size="sm" onClick={() => { lock(); toast.success("已退出编辑模式"); }}>
                退出编辑
              </AuroraButton>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

function ProjectsTab() {
  const { projects, setSettingsOpen, deleteProject, saveProject, reorderProjects } = useSite();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function move(id: string, dir: -1 | 1) {
    const order = projects.map((p) => p.id);
    const i = order.indexOf(id);
    const j = i + dir;
    if (i === -1 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    setBusyId(id);
    try {
      await reorderProjects(order);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "排序失败");
    } finally {
      setBusyId(null);
    }
  }

  async function toggle(project: (typeof projects)[number]) {
    setBusyId(project.id);
    try {
      await saveProject({ ...project, hidden: !project.hidden });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(project: (typeof projects)[number]) {
    if (!window.confirm(`确定删除「${project.title}」？`)) return;
    setBusyId(project.id);
    try {
      await deleteProject(project.id);
      toast.success("已删除");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除失败");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">共 {projects.length} 个项目，可排序 / 隐藏 / 删除</p>
        <AuroraButton variant="soft" size="sm" onClick={() => { setSettingsOpen(false); window.dispatchEvent(new CustomEvent("pf:new-project")); }}>
          <Check size={12} /> 新建
        </AuroraButton>
      </div>

      {projects.length === 0 && (
        <p className="rounded-2xl border-2 border-dashed border-lilac/25 bg-lilac/5 px-4 py-10 text-center text-[13px] text-muted-foreground">
          还没有项目，点「新建」上传第一个作品。
        </p>
      )}

      {projects.map((p, i) => (
        <div key={p.id} className={cn("glass-card flex items-center gap-2 rounded-2xl px-3.5 py-3", busyId === p.id && "opacity-60")}>
          <span className="w-4 shrink-0 text-center font-mono text-[11px] text-muted-foreground">{i + 1}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-ink">{p.title}</p>
            <p className="truncate font-mono text-[10.5px] text-muted-foreground">
              {p.demo_mode === "inline" ? "站内体验" : p.demo_mode === "external" ? "外链体验" : "仅源码"}
              {p.hidden && " · 已隐藏"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <MiniBtn title="上移" disabled={i === 0} onClick={() => void move(p.id, -1)}>↑</MiniBtn>
            <MiniBtn title="下移" disabled={i === projects.length - 1} onClick={() => void move(p.id, 1)}>↓</MiniBtn>
            <MiniBtn title={p.hidden ? "显示" : "隐藏"} onClick={() => void toggle(p)}>
              {p.hidden ? <Eye size={13} /> : <EyeOff size={13} />}
            </MiniBtn>
            <MiniBtn title="编辑" onClick={() => { setSettingsOpen(false); window.dispatchEvent(new CustomEvent("pf:edit-project", { detail: p.id })); }}>
              <Pencil size={13} />
            </MiniBtn>
            <MiniBtn title="删除" danger onClick={() => void remove(p)}><Trash2 size={13} /></MiniBtn>
          </div>
        </div>
      ))}
    </div>
  );
}

function MiniBtn({ children, title, onClick, disabled, danger }: { children: React.ReactNode; title: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-lg text-ink-soft transition hover:bg-lilac/12 hover:text-lilac disabled:opacity-25 disabled:hover:bg-transparent",
        danger && "hover:bg-destructive/10 hover:text-destructive",
      )}
    >
      {children}
    </button>
  );
}
