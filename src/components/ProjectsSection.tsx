import { useEffect, useMemo, useState } from "react";
import { PackageOpen, Plus, Sparkles } from "lucide-react";
import { useSite } from "@/lib/site-context";
import type { Project } from "@/lib/types";
import { SectionBackground } from "@/components/SectionBackground";
import { EditTag, EditZone } from "@/components/EditOverlay";
import { ProjectCard } from "@/components/ProjectCard";
import { ProjectDetail } from "@/components/ProjectDetail";
import { ProjectEditor } from "@/components/ProjectEditor";
import { AuroraButton } from "@/components/ui/aurora-button";
import { toast } from "sonner";

export function ProjectsSection() {
  const { projects, visibleProjects, editMode, openSettings, reorderProjects, deleteProject, saveProject } = useSite();
  const [filter, setFilter] = useState<string>("全部");
  const [detail, setDetail] = useState<Project | null>(null);
  const [editing, setEditing] = useState<Project | "new" | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // 设置抽屉里的「新建 / 编辑」通过全局事件传递到此处，避免层层传回调
  useEffect(() => {
    const onNew = () => setEditing("new");
    const onEdit = (e: Event) => {
      const found = projects.find((p) => p.id === (e as CustomEvent<string>).detail);
      if (found) setEditing(found);
    };
    window.addEventListener("pf:new-project", onNew);
    window.addEventListener("pf:edit-project", onEdit);
    return () => {
      window.removeEventListener("pf:new-project", onNew);
      window.removeEventListener("pf:edit-project", onEdit);
    };
  }, [projects]);

  const tags = useMemo(() => {
    const set = new Set<string>();
    for (const p of projects) for (const t of p.tags) set.add(t);
    return ["全部", ...Array.from(set)];
  }, [projects]);

  const shown = filter === "全部" ? visibleProjects : visibleProjects.filter((p) => p.tags.includes(filter));

  /** HTML5 拖放：容器必须 preventDefault 才允许放置，并在 onDrop 里完成移动 */
  function handleDrop(targetId: string) {
    const sourceId = draggingId;
    setDraggingId(null);
    setDragOverId(null);
    if (!sourceId || sourceId === targetId) return;
    const order = projects.map((p) => p.id).filter((id) => id !== sourceId);
    const at = order.indexOf(targetId);
    if (at === -1) return;
    order.splice(at, 0, sourceId);
    void reorderProjects(order).catch((e: unknown) =>
      toast.error(e instanceof Error ? e.message : "排序保存失败"),
    );
  }

  async function toggleHidden(project: Project) {
    try {
      await saveProject({ ...project, hidden: !project.hidden });
      toast.success(project.hidden ? "已设为可见" : "已对访客隐藏");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "操作失败");
    }
  }

  async function remove(project: Project) {
    if (!window.confirm(`确定删除「${project.title}」？该操作不可撤销。`)) return;
    try {
      await deleteProject(project.id);
      toast.success("项目已删除");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除失败");
    }
  }

  return (
    <EditZone>
      <section id="works" className="relative overflow-hidden py-24 sm:py-28">
        <SectionBackground section="projects" />

        <div className="relative z-10 mx-auto max-w-6xl px-6">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <div className="night-scrim night-text -mx-4 px-4 py-2">
              <p className="reveal font-mono text-xs uppercase tracking-[0.3em] text-night-label">works</p>
              <h2 className="reveal reveal-up mt-3 font-display text-3xl font-bold tracking-tight text-night-ink sm:text-[2.6rem]">
                小玩意儿<span className="aurora-text">陈列室</span>
              </h2>
              <p className="reveal reveal-up mt-3 text-sm text-night-ink-soft">
                AI 工具 · 数字玩具 · 开源贡献 —— 共 {visibleProjects.length} 个作品{editMode && projects.length !== visibleProjects.length ? `（含 ${projects.length - visibleProjects.length} 个已隐藏）` : ""}
                {editMode && <span className="ml-2 text-[11px] text-night-ink-soft/70">· 拖拽卡片可排序</span>}
              </p>
            </div>

            {editMode && (
              <AuroraButton variant="glow" size="md" onClick={() => setEditing("new")} className="reveal reveal-right shrink-0">
                <Plus size={16} /> 上传新项目
              </AuroraButton>
            )}
          </div>

          {tags.length > 2 && (
            <div className="reveal mt-9 flex flex-wrap gap-2">
              {tags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setFilter(tag)}
                  className={
                    "rounded-pill px-4 py-1.5 text-xs font-semibold transition-all duration-300 " +
                    (filter === tag
                      ? "bg-ink text-white shadow-lg shadow-lilac/25"
                      : "bg-white/65 text-ink-soft backdrop-blur hover:bg-white hover:text-ink")
                  }
                >
                  {tag}
                </button>
              ))}
            </div>
          )}

          {shown.length === 0 ? (
            <div className="reveal mt-14 flex flex-col items-center gap-4 rounded-3xl border-2 border-dashed border-lilac/25 bg-white/45 px-6 py-16 text-center backdrop-blur">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-lilac/12">
                <PackageOpen size={24} className="text-lilac" />
              </span>
              <p className="font-display text-lg font-bold text-ink">
                {editMode ? "还没有作品，从第一个开始吧" : "这里还很安静"}
              </p>
              <p className="max-w-sm text-sm text-ink-soft">
                {editMode
                  ? "支持上传源代码 zip、构建产物（zip 或多文件）、单文件静态网页 —— 上传即可在站内直接体验。"
                  : "站长正在把 AI 小工具和开源贡献一个个搬上来，稍后再来逛逛。"}
              </p>
              {editMode && (
                <AuroraButton variant="soft" size="sm" onClick={() => setEditing("new")}>
                  <Sparkles size={13} /> 上传第一个作品
                </AuroraButton>
              )}
            </div>
          ) : (
            <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((project, i) => (
                <div
                  key={project.id}
                  onDragOver={(e) => {
                    if (!editMode || !draggingId || draggingId === project.id) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    setDragOverId(project.id);
                  }}
                  onDragLeave={() => setDragOverId((cur) => (cur === project.id ? null : cur))}
                  onDrop={(e) => {
                    if (!editMode) return;
                    e.preventDefault();
                    handleDrop(project.id);
                  }}
                >
                  <ProjectCard
                    project={project}
                    index={i}
                    editMode={editMode}
                    dragging={draggingId === project.id}
                    dragOver={dragOverId === project.id}
                    onDragStartState={setDraggingId}
                    onOpen={() => setDetail(project)}
                    onEdit={() => setEditing(project)}
                    onDelete={() => void remove(project)}
                    onToggleHidden={() => void toggleHidden(project)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        <EditTag label="编辑背景" onClick={() => openSettings("background")} />
      </section>

      <ProjectDetail project={detail} onClose={() => setDetail(null)} />
      <ProjectEditor target={editing} onClose={() => setEditing(null)} />
    </EditZone>
  );
}
