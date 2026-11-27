import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AdminIcon } from "./AdminIcons";

export type SearchOption = {
  value: string;
  label: string;
  sub?: string;
  meta?: string | number;
  keywords?: string;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: SearchOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  compact?: boolean;
  clearable?: boolean;
  allowCreate?: boolean;
  createLabel?: (input: string) => string;
  minWidth?: number;
  maxWidth?: number;
  ariaLabel?: string;
};

export function SearchSelect({
  value,
  onChange,
  options,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyLabel = "No matches",
  disabled = false,
  compact = false,
  clearable = false,
  allowCreate = false,
  createLabel,
  minWidth,
  maxWidth,
  ariaLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number; width: number }>({
    top: 0,
    left: 0,
    width: 240,
  });

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedOption = useMemo(() => options.find((o) => o.value === value), [options, value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) =>
      `${o.label} ${o.sub ?? ""} ${o.keywords ?? ""} ${o.value}`.toLowerCase().includes(q),
    );
  }, [options, query]);

  const cleanCreate = query.trim().replace(/\s+/g, " ");
  const canCreate =
    allowCreate &&
    cleanCreate.length > 0 &&
    !options.some(
      (o) =>
        o.value.toLowerCase() === cleanCreate.toLowerCase() ||
        o.label.toLowerCase() === cleanCreate.toLowerCase(),
    );

  const totalItems = filtered.length + (canCreate ? 1 : 0);

  const updatePos = () => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const flipUp = spaceBelow < 230 && rect.top > 250;
    const width = Math.min(Math.max(rect.width, 230), window.innerWidth - 24);
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    if (flipUp) {
      setPos({ bottom: window.innerHeight - rect.top + 4, left, width });
    } else {
      setPos({ top: rect.bottom + 4, left, width });
    }
  };

  useLayoutEffect(() => {
    if (!open) return;
    updatePos();
    const onResizeOrScroll = () => updatePos();
    window.addEventListener("resize", onResizeOrScroll);
    window.addEventListener("scroll", onResizeOrScroll, true);
    return () => {
      window.removeEventListener("resize", onResizeOrScroll);
      window.removeEventListener("scroll", onResizeOrScroll, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    const idx = options.findIndex((o) => o.value === value);
    setActiveIdx(idx >= 0 ? idx : 0);
    requestAnimationFrame(() => inputRef.current?.focus());

    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open, options, value]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  const pick = (nextValue: string) => {
    onChange(nextValue);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (totalItems > 0) setActiveIdx((i) => (i + 1) % totalItems);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (totalItems > 0) setActiveIdx((i) => (i - 1 + totalItems) % totalItems);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (activeIdx < filtered.length) {
        pick(filtered[activeIdx].value);
      } else if (canCreate) {
        pick(cleanCreate);
      }
    }
  };

  const displayLabel = selectedOption ? selectedOption.label : value ? value : "";

  return (
    <div
      className={"sselect" + (compact ? " compact" : "")}
      style={{
        ...(minWidth ? { minWidth } : {}),
        ...(maxWidth ? { maxWidth } : {}),
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={"sselect-trigger" + (open ? " open" : "")}
        onClick={() => !disabled && setOpen((o) => !o)}
      >
        <span className={"sselect-value" + (!displayLabel ? " is-placeholder" : "")}>
          {displayLabel || placeholder}
        </span>
        <span className="sselect-icons">
          {clearable && value && !disabled && (
            <span
              role="button"
              tabIndex={-1}
              aria-label="Clear"
              className="sselect-clear"
              onClick={(e) => {
                e.stopPropagation();
                onChange("");
              }}
            >
              <AdminIcon name="close" size={12} />
            </span>
          )}
          <span className="sselect-chevron">
            <AdminIcon name={open ? "chevronUp" : "chevronDown"} size={13} />
          </span>
        </span>
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="sselect-menu"
            style={{
              position: "fixed",
              ...(pos.top !== undefined ? { top: pos.top } : {}),
              ...(pos.bottom !== undefined ? { bottom: pos.bottom } : {}),
              left: pos.left,
              width: pos.width,
            }}
            onKeyDown={onKeyDown}
          >
            <div className="sselect-search-wrap">
              <input
                ref={inputRef}
                type="text"
                className="sselect-search"
                placeholder={searchPlaceholder}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>

            <div className="sselect-list" role="listbox">
              {filtered.length === 0 && !canCreate ? (
                <div className="sselect-empty">{emptyLabel}</div>
              ) : (
                filtered.map((opt, idx) => {
                  const isSelected = opt.value === value;
                  const isHighlighted = idx === activeIdx;
                  return (
                    <button
                      key={opt.value || "__empty__"}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      className={
                        "sselect-item" +
                        (isSelected ? " selected" : "") +
                        (isHighlighted ? " active" : "")
                      }
                      onMouseEnter={() => setActiveIdx(idx)}
                      onClick={() => pick(opt.value)}
                    >
                      <span className="sselect-item-main">
                        <span className="sselect-item-label">{opt.label}</span>
                        {opt.sub && <span className="sselect-item-sub">{opt.sub}</span>}
                      </span>
                      <span className="sselect-item-right">
                        {opt.meta !== undefined && <span className="sselect-meta">{opt.meta}</span>}
                        {isSelected && (
                          <span className="sselect-check">
                            <AdminIcon name="check" size={13} />
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })
              )}

              {canCreate && (
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  className={
                    "sselect-item create" + (activeIdx === filtered.length ? " active" : "")
                  }
                  onMouseEnter={() => setActiveIdx(filtered.length)}
                  onClick={() => pick(cleanCreate)}
                >
                  <span className="sselect-item-main" style={{ flexDirection: "row", alignItems: "center", gap: "0.4rem" }}>
                    <AdminIcon name="plus" size={13} />
                    <span className="sselect-item-label">
                      {createLabel ? createLabel(cleanCreate) : `Create "${cleanCreate}"`}
                    </span>
                  </span>
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
