import { Pencil } from "lucide-react";
import { useSite } from "@/lib/site-context";
import { cn } from "@/lib/utils";

/** 编辑模式下出现在区块右上角的「编辑」角标按钮 */
export function EditTag({ label, onClick, className }: { label: string; onClick: () => void; className?: string }) {
  const { editMode } = useSite();
  if (!editMode) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "absolute right-5 top-5 z-20 inline-flex items-center gap-1.5 rounded-full bg-lilac/90 px-3.5 py-1.5 text-xs font-semibold text-white shadow-lg shadow-lilac/30 backdrop-blur transition hover:bg-lilac hover:shadow-lilac/40 active:scale-95",
        className,
      )}
    >
      <Pencil size={12} strokeWidth={2.5} />
      {label}
    </button>
  );
}

/** 编辑模式下的虚线容器高亮 */
export function EditZone({ children, className }: { children: React.ReactNode; className?: string }) {
  const { editMode } = useSite();
  return (
    <div data-editing={editMode ? "true" : "false"} className={cn("edit-zone", className)}>
      {children}
    </div>
  );
}
