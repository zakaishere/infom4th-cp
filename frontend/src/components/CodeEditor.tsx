import { useEffect, useRef } from "react";
import { Compartment, EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection,
  dropCursor, rectangularSelection, crosshairCursor, highlightSpecialChars } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, indentUnit, syntaxHighlighting,
  StreamLanguage, type LanguageSupport } from "@codemirror/language";
import { acceptCompletion, autocompletion, closeBrackets, closeBracketsKeymap, closeCompletion, moveCompletionSelection, startCompletion } from "@codemirror/autocomplete";
import { completionsFor } from "../lib/completions";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import { cpp } from "@codemirror/lang-cpp";
import { java } from "@codemirror/lang-java";
import { python } from "@codemirror/lang-python";
import { javascript } from "@codemirror/lang-javascript";
import { rust } from "@codemirror/lang-rust";
import { go } from "@codemirror/lang-go";
import { php } from "@codemirror/lang-php";
import { kotlin, csharp } from "@codemirror/legacy-modes/mode/clike";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import type { Extension } from "@codemirror/state";

/** Syntax support per judge language code. */
function languageSupport(language?: string): Extension {
  const table: Record<string, () => LanguageSupport | Extension> = {
    CPP: cpp, CPP20: cpp, C: cpp, JAVA: java, PYTHON: python, PYPY: python,
    JAVASCRIPT: javascript, RUST: rust, GO: go, PHP: () => php({ plain: false }),
    KOTLIN: () => StreamLanguage.define(kotlin), CSHARP: () => StreamLanguage.define(csharp),
    RUBY: () => StreamLanguage.define(ruby),
  };
  return (language && table[language]?.()) || [];
}

/** InfoM4th code colours on the One Dark syntax palette. */
const theme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "#0b2633", color: "#d9eef3", fontSize: "14px" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.55" },
  ".cm-content": { caretColor: "#35c7e8", padding: "10px 0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#35c7e8", borderLeftWidth: "2px" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": { backgroundColor: "#1d5a72 !important" },
  ".cm-gutters": { backgroundColor: "#071d27", color: "#4f7f8f", border: "none", borderRight: "1px solid #12384a" },
  ".cm-activeLine": { backgroundColor: "rgba(53, 199, 232, 0.06)" },
  ".cm-activeLineGutter": { backgroundColor: "rgba(53, 199, 232, 0.1)", color: "#9fd8e6" },
  ".cm-matchingBracket": { backgroundColor: "rgba(53, 199, 232, 0.25) !important", outline: "1px solid #35c7e8" },
  ".cm-selectionMatch": { backgroundColor: "rgba(53, 199, 232, 0.14)" },
  ".cm-foldGutter span": { color: "#4f7f8f" },
  ".cm-tooltip": { backgroundColor: "#0c3547", border: "1px solid #1d6f86", color: "#d9eef3" },
  ".cm-tooltip-autocomplete ul li[aria-selected]": { backgroundColor: "#1d6f86", color: "#ffffff" },
  ".cm-tooltip-autocomplete ul": { fontFamily: "var(--font-mono)" },
  ".cm-completionDetail": { color: "#9fc6d1", fontStyle: "normal", marginLeft: "0.75em" },
  ".cm-completionMatchedText": { color: "#35c7e8", textDecoration: "none", fontWeight: "700" },
  ".cm-panels": { backgroundColor: "#071d27", color: "#d9eef3" },
  ".cm-panels input, .cm-panels button": { width: "auto", padding: "2px 6px" },
}, { dark: true });

export function CodeEditor({ value, onChange, onSubmit, onRun, readOnly, language }: {
  value: string; onChange?: (v: string) => void; onSubmit?: () => void; onRun?: () => void; readOnly?: boolean; language?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const languageSlot = useRef(new Compartment());
  const readOnlySlot = useRef(new Compartment());
  // Latest callbacks without recreating the editor.
  const callbacks = useRef({ onChange, onSubmit, onRun });
  callbacks.current = { onChange, onSubmit, onRun };
  const suggestions = useRef(completionsFor(language));
  useEffect(() => { suggestions.current = completionsFor(language); }, [language]);

  useEffect(() => {
    if (!host.current) return;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(), highlightActiveLineGutter(), highlightSpecialChars(), history(), foldGutter(),
          drawSelection(), dropCursor(), EditorState.allowMultipleSelections.of(true), indentOnInput(),
          syntaxHighlighting(oneDarkHighlightStyle, { fallback: true }), bracketMatching(), closeBrackets(),
          autocompletion({ activateOnTyping: true, defaultKeymap: false, interactionDelay: 0, override: [(context) => suggestions.current(context)] }),
          rectangularSelection(), crosshairCursor(), highlightActiveLine(),
          highlightSelectionMatches(), indentUnit.of("    "), EditorState.tabSize.of(4), theme,
          Prec.highest(keymap.of([
            { key: "Mod-Enter", run: () => { callbacks.current.onSubmit?.(); return true; } },
            { key: "Mod-'", run: () => { callbacks.current.onRun?.(); return true; } },
          ])),
          // Tab takes a suggestion; Enter always starts a new line, so typing fast never inserts one by accident.
          Prec.high(keymap.of([
            { key: "Tab", run: acceptCompletion },
            { key: "ArrowDown", run: moveCompletionSelection(true) },
            { key: "ArrowUp", run: moveCompletionSelection(false) },
            { key: "Escape", run: closeCompletion },
            { key: "Ctrl-Space", run: startCompletion },
          ])),
          keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, indentWithTab]),
          languageSlot.current.of(languageSupport(language)),
          readOnlySlot.current.of(EditorState.readOnly.of(Boolean(readOnly))),
          EditorView.updateListener.of((u) => { if (u.docChanged) callbacks.current.onChange?.(u.state.doc.toString()); }),
          EditorView.contentAttributes.of({ "aria-label": "Source code" }),
        ],
      }),
    });
    view.current = editor;
    return () => { editor.destroy(); view.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // External changes (template reset, language switch, loaded draft) replace the document.
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== value)
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
  }, [value]);
  useEffect(() => { view.current?.dispatch({ effects: languageSlot.current.reconfigure(languageSupport(language)) }); }, [language]);
  useEffect(() => { view.current?.dispatch({ effects: readOnlySlot.current.reconfigure(EditorState.readOnly.of(Boolean(readOnly))) }); }, [readOnly]);

  return <div className="code-editor" ref={host} />;
}
