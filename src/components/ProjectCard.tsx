import { useState } from "react";
import { Code2, Eye, EyeOff, Gamepad2, Github, Pencil, Rocket, Star, Trash2 } from "lucide-react";
import type { Project } from "@/lib/types";
import { AuroraButton } from "@/components/ui/aurora-button";
import { cn } from "@/lib/utils";

type Props = {
  project: Project;
  index: number;
  editMode: boolean;
  dragging: boolean;
  dragOver: boolean;
  onDragStartState: (id: string | null) => void;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleHidden: () => void;
};

const TAG_TONES = ["bg-bubble/12 text-bubble", "bg-lilac/12 text-lilac", "bg-sky/14 text-sky", "bg-mint/18 text-emerald-700", "bg-butter/25 text-amber-700"];

export function ProjectCard({ project, index, editMode, dragging, dragOver, onDragStartState, onOpen, onEdit, onDelete, onToggleHidden }: Props) {
  // 与 ProjectDetail 的判定保持一致：有站内体验页或外部链接就能体验。
  // 不再依赖 gh_entry_path —— 站长手动上传过一次体验页，卡片上就该出现「立即体验」。
  const canExperience =
    project.demo_mode === "external" ? Boolean(project.external_url) : Boolean(project.entry_url);
  // 封面用的是外部 CDN 地址，链接失效时不能让用户看到破图，退回渐变占位。
  const [coverFailed, setCoverFailed] = useState(false);

  return (
    <article
      draggable={editMode}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", project.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStartState(project.id);
      }}
      onDragEnd={() => onDragStartState(null)}
      className={cn(
        "reveal reveal-up glass-card group relative flex flex-col overflow-hidden rounded-3xl transition-all duration-300",
        editMode && "cursor-grab active:cursor-grabbing",
        dragging && "opacity-40",
        dragOver && "ring-2 ring-lilac ring-offset-2 ring-offset-background",
        project.hidden && "opacity-60",
      )}
      style={{ ["--reveal-delay" as string]: `${Math.min(index, 6) * 90}ms` }}
    >
      <button
        type="button"
        onClick={onOpen}
        className="relative block aspect-[16/10] w-full overflow-hidden text-left"
        aria-label={`查看项目 ${project.title}`}
      >
        {project.cover_url && !coverFailed ? (
          <img
            src={project.cover_url}
            alt=""
            loading="lazy"
            onError={() => setCoverFailed(true)}
            className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.06]"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center aurora-bg">
            <Rocket size={34} className="text-white/85 drop-shadow-lg" />
          </span>
        )}
        <span className="absolute inset-0 bg-gradient-to-t from-ink/45 via-transparent to-transparent opacity-0 transition group-hover:opacity-100" />
        {project.hidden && (
          <span className="absolute left-3 top-3 rounded-full bg-ink/70 px-2.5 py-1 text-[10px] font-bold text-white backdrop-blur">
          已隐藏
          </span>
        )}
        {project.origin === "github" && (
          <span className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-ink/70 px-2.5 py-1 font-mono text-[10px] font-semibold text-white backdrop-blur">
            <Github size={11} />
            {(project.gh_stars ?? 0) > 0 && (
              <span className="inline-flex items-center gap-0.5">
                <Star size={10} className="text-butter" /> {project.gh_stars}
              </span>
            )}
            {project.gh_language && <span>{project.gh_language}</span>}
          </span>
        )}
      </button>

      <div className="flex flex-1 flex-col p-5">
        <h3 className="font-display text-lg font-bold leading-snug text-ink">{project.title}</h3>
        <p className="mt-2 line-clamp-2 flex-1 text-[13px] leading-relaxed text-ink-soft/90">
          {project.description || "暂无简介"}
        </p>

        {project.tags.length > 0 && (
          <div className="mt-3.5 flex flex-wrap gap-1.5">
            {project.tags.slice(0, 4).map((tag, i) => (
              <span key={tag} className={cn("rounded-pill px-2.5 py-0.5 font-mono text-[10.5px] font-semibold", TAG_TONES[i % TAG_TONES.length])}>
                {tag}
              </span>
            ))}
          </div>
        )}

        <div className="mt-5 flex items-center gap-2">
          {canExperience && (
            <AuroraButton size="sm" variant="glow" onClick={onOpen} className="flex-1">
              <Gamepad2 size={13} /> 立即体验
            </AuroraButton>
          )}
          {project.source_url && (
            <AuroraButton size="sm" variant="soft" onClick={onOpen} className={canExperience ? "" : "flex-1"}>
              <Code2 size={13} /> {canExperience ? "详情" : "源码"}
            </AuroraButton>
          )}
          {project.origin === "github" ? (
            <AuroraButton size="sm" variant="soft" onClick={onOpen} className={canExperience ? "" : "flex-1"}>
              <Code2 size={13} /> 文档 · 源码
            </AuroraButton>
          ) : !canExperience && !project.source_url ? (
            <AuroraButton size="sm" variant="outline" onClick={onOpen} className="flex-1">
              查看详情
            </AuroraButton>
          ) : null}
        </div>
      </div>

      {editMode && (
        <div className="absolute right-3 top-3 z-10 flex gap-1.5 opacity-0 transition group-hover:opacity-100">
          <IconTool title="编辑" onClick={onEdit}><Pencil size={13} /></IconTool>
          <IconTool title={project.hidden ? "显示" : "隐藏"} onClick={onToggleHidden}>
            {project.hidden ? <Eye size={13} /> : <EyeOff size={13} />}
          </IconTool>
          <IconTool title="删除" danger onClick={onDelete}><Trash2 size={13} /></IconTool>
        </div>
      )}
    </article>
  );
}

function IconTool({ children, title, onClick, danger }: { children: React.ReactNode; title: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-full bg-white/85 text-ink shadow-md backdrop-blur transition hover:scale-110 active:scale-95",
        danger && "text-destructive",
      )}
    >
      {children}
    </button>
  );
}
