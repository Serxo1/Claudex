import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export type DraggableWindowProps = {
  title: string;
  icon?: ReactNode;
  onClose: () => void;
  defaultPosition?: { x: number; y: number };
  width?: number;
  height?: number;
  children: ReactNode;
};

export function DraggableWindow({
  title,
  icon,
  onClose,
  defaultPosition,
  width = 360,
  height = 440,
  children
}: DraggableWindowProps) {
  const [pos, setPos] = useState(() => {
    if (defaultPosition) return defaultPosition;
    const cx = typeof window !== "undefined" ? window.innerWidth / 2 - width / 2 : 400;
    const cy = typeof window !== "undefined" ? window.innerHeight / 2 - height / 2 : 200;
    return { x: Math.max(0, cx), y: Math.max(0, cy) };
  });

  const dragging = useRef(false);
  const offset = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - width, e.clientX - offset.current.x)),
        y: Math.max(0, Math.min(window.innerHeight - 40, e.clientY - offset.current.y))
      });
    };
    const onUp = () => {
      dragging.current = false;
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [width]);

  const handleDragStart = (e: React.MouseEvent) => {
    // Don't initiate drag from the close button
    if ((e.target as HTMLElement).closest("button")) return;
    dragging.current = true;
    offset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
  };

  return createPortal(
    <div
      className="fixed z-[60] flex flex-col overflow-hidden rounded-xl border border-border/50 bg-background/90 shadow-2xl shadow-black/30 backdrop-blur-xl"
      style={{ left: pos.x, top: pos.y, width, height }}
    >
      {/* Title bar — drag handle */}
      <div
        className="flex shrink-0 cursor-grab items-center gap-2 border-b border-border/30 px-3 py-2 select-none active:cursor-grabbing"
        onMouseDown={handleDragStart}
      >
        {icon && <span className="shrink-0 text-muted-foreground/60">{icon}</span>}
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-foreground/80">
          {title}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/40 transition hover:bg-muted/30 hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      </div>

      {/* Content area */}
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>,
    document.body
  );
}
