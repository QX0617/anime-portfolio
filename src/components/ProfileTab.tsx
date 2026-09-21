import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useSite } from "@/lib/site-context";
import type { SocialLink } from "@/lib/types";
import { ImageUploader } from "@/components/ImageUploader";
import { AuroraButton } from "@/components/ui/aurora-button";
import { toast } from "sonner";

export function ProfileTab() {
  const { settings, saveSettings, saving } = useSite();
  const [username, setUsername] = useState(settings.username);
  const [tagline, setTagline] = useState(settings.tagline);
  const [bio, setBio] = useState(settings.bio);
  const [avatar, setAvatar] = useState(settings.avatar_url);
  const [links, setLinks] = useState<SocialLink[]>(settings.social_links);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setUsername(settings.username);
    setTagline(settings.tagline);
    setBio(settings.bio);
    setAvatar(settings.avatar_url);
    setLinks(settings.social_links);
    setDirty(false);
  }, [settings]);

  async function submit() {
    if (!username.trim()) {
      toast.error("用户名不能为空");
      return;
    }
    const valid = links.filter((l) => l.label.trim() && l.url.trim());
    try {
      await saveSettings({ username: username.trim(), tagline, bio, avatar_url: avatar, social_links: valid });
      setLinks(valid);
      setDirty(false);
      toast.success("资料已保存");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    }
  }

  const inputCls =
    "w-full rounded-xl border border-input bg-white/80 px-3.5 py-2.5 text-sm text-ink outline-none transition placeholder:text-muted-foreground/70 focus:border-lilac/60 focus:ring-2 focus:ring-lilac/25";

  return (
    <div className="space-y-5">
      <ImageUploader label="头像" value={avatar} onChange={(url) => { setAvatar(url); setDirty(true); }} aspect="1 / 1" hint="方形最佳，≤8MB" className="max-w-[168px]" />

      <div>
        <label className="mb-1.5 block text-xs font-semibold text-ink-soft">用户名</label>
        <input className={inputCls} value={username} onChange={(e) => { setUsername(e.target.value); setDirty(true); }} maxLength={24} />
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-semibold text-ink-soft">一句话简介</label>
        <input className={inputCls} value={tagline} onChange={(e) => { setTagline(e.target.value); setDirty(true); }} maxLength={60} placeholder="用代码创造温柔的小宇宙" />
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-semibold text-ink-soft">关于我（支持换行分段）</label>
        <textarea className={inputCls + " min-h-[120px] resize-y"} value={bio} onChange={(e) => { setBio(e.target.value); setDirty(true); }} placeholder="介绍你的经历、擅长方向与兴趣…" />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="text-xs font-semibold text-ink-soft">社交 / 联系链接</label>
          <AuroraButton variant="soft" size="sm" onClick={() => { setLinks([...links, { label: "", url: "" }]); setDirty(true); }}>
            <Plus size={12} /> 添加
          </AuroraButton>
        </div>
        {links.length === 0 && <p className="text-[11px] text-muted-foreground">还没有链接，例如 GitHub、邮箱、小红书。</p>}
        <div className="space-y-2">
          {links.map((l, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                className={inputCls + " !w-28 shrink-0"}
                placeholder="名称"
                value={l.label}
                onChange={(e) => { setLinks(links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x))); setDirty(true); }}
              />
              <input
                className={inputCls}
                placeholder="https:// 或 mailto:"
                value={l.url}
                onChange={(e) => { setLinks(links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x))); setDirty(true); }}
              />
              <button type="button" onClick={() => { setLinks(links.filter((_, j) => j !== i)); setDirty(true); }} className="shrink-0 text-destructive/70 transition hover:text-destructive">
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <AuroraButton variant="glow" size="md" className="w-full" disabled={!dirty || saving} onClick={() => void submit()}>
        {saving ? <><Loader2 size={14} className="animate-spin" /> 保存中…</> : dirty ? "保存资料" : "已保存"}
      </AuroraButton>
    </div>
  );
}
