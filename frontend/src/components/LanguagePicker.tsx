import { useEffect } from "react";
import { useData } from "../app";
import { ALL_LANGUAGES, LANGUAGE_NAMES } from "../ui";

type Language = { code: string; display_name: string; enabled: boolean };
const SUPPORTED = ALL_LANGUAGES;

/** Checkboxes for judge languages; languages without a verified judge runtime cannot be chosen. */
export function LanguagePicker({ value, onChange, disabled }: { value: string[]; onChange: (codes: string[]) => void; disabled?: boolean }) {
  const languages = useData<Language[]>("/api/languages");
  const enabled = new Set((languages.data ?? []).filter((l) => l.enabled).map((l) => l.code));
  // Drop selections the judges cannot run, so validation and contests do not fail later.
  // A sealed version only shows what it was validated with, so it is left alone.
  useEffect(() => {
    if (!languages.data || disabled) return;
    const usable = value.filter((c) => enabled.has(c));
    if (usable.length !== value.length) onChange(usable.length ? usable : SUPPORTED.filter((c) => enabled.has(c)));
  }, [languages.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const available = SUPPORTED.filter((c) => enabled.has(c));
  const allChosen = available.length > 0 && available.every((c) => value.includes(c));
  return (
    <div className="stack" style={{ gap: "0.3rem" }}>
      {available.length > 1 && !disabled && (
        <div className="row small" style={{ gap: "0.5rem" }}>
          <button type="button" className="small" onClick={() => onChange(allChosen ? [] : available)}>{allChosen ? "Clear all" : `Select all (${available.length})`}</button>
          <span className="muted">{value.length} of {available.length} selected</span>
        </div>
      )}
      <div className="chips">
        {SUPPORTED.map((code) => (
          <label key={code} className="check small" title={enabled.has(code) ? "" : "No verified judge runtime is enabled for this language"}>
            <input type="checkbox" disabled={disabled || !enabled.has(code)} checked={value.includes(code)}
              onChange={(e) => onChange(e.target.checked ? [...value, code] : value.filter((x) => x !== code))} />
            <span style={{ opacity: enabled.has(code) ? 1 : 0.5 }}>{LANGUAGE_NAMES[code]}</span>
          </label>
        ))}
      </div>
      {languages.data && enabled.size < SUPPORTED.length && (
        <span className="small muted">Greyed out: no judge runtime enabled yet (Control room → Languages).</span>
      )}
      {languages.data && enabled.size === 0 && <span className="small" style={{ color: "var(--danger)" }}>No language is enabled. A super administrator must enable a verified runtime first.</span>}
    </div>
  );
}
