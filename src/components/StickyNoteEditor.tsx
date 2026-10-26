import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import { IconBold, IconItalic, IconUnderline, IconStrikethrough, IconList, IconPhoto } from "./icons";
import { readNoteImage, sanitizeNoteHtml, textToNoteHtml } from "../utils/stickyNoteEditor";
import { noteErrorMessage } from "../data/stickyNotes";

const FORMATS = [
  { command: "bold", label: "粗体 (Ctrl+B)", icon: IconBold },
  { command: "italic", label: "斜体 (Ctrl+I)", icon: IconItalic },
  { command: "underline", label: "下划线 (Ctrl+U)", icon: IconUnderline },
  { command: "strikeThrough", label: "删除线", icon: IconStrikethrough },
  { command: "insertUnorderedList", label: "项目符号列表", icon: IconList },
] as const;

type Props = {
  initialHtml: string;
  onChange: (html: string) => void;
  onSave: () => void;
  onError: (message: string) => void;
};

export function StickyNoteEditor({ initialHtml, onChange, onSave, onError }: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const selectionRef = useRef<Range | null>(null);
  const initialHtmlRef = useRef(initialHtml);
  const initialized = useRef(false);
  const composing = useRef(false);
  const [formats, setFormats] = useState<string[]>([]);
  const [empty, setEmpty] = useState(true);

  const updateSelection = useCallback(() => {
    const selection = window.getSelection();
    if (selection?.rangeCount && editorRef.current?.contains(selection.anchorNode)) {
      selectionRef.current = selection.getRangeAt(0).cloneRange();
      const nextFormats = FORMATS.filter(({ command }) => document.queryCommandState(command)).map(({ command }) => command);
      setFormats((current) => current.length === nextFormats.length && current.every((value, index) => value === nextFormats[index]) ? current : nextFormats);
    }
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (!initialized.current) {
      editor.innerHTML = sanitizeNoteHtml(initialHtmlRef.current);
      initialHtmlRef.current = "";
      initialized.current = true;
      setEmpty(!editor.textContent?.trim() && !editor.querySelector("img,li"));
      editor.focus();
    }
    document.addEventListener("selectionchange", updateSelection);
    return () => document.removeEventListener("selectionchange", updateSelection);
  }, [updateSelection]);

  const save = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const isEmpty = !editor.textContent?.trim() && !editor.querySelector("img,li");
    setEmpty(isEmpty);
    onChange(isEmpty ? "" : editor.innerHTML);
    updateSelection();
  }, [onChange, updateSelection]);

  function restoreSelection() {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const selection = window.getSelection();
    if (!selection) return;
    const range = selectionRef.current;
    selection.removeAllRanges();
    if (range && editor.contains(range.commonAncestorContainer)) selection.addRange(range);
    else {
      const end = document.createRange();
      end.selectNodeContents(editor);
      end.collapse(false);
      selection.addRange(end);
    }
  }

  function execute(command: string, value?: string) {
    restoreSelection();
    // Chromium's editing commands retain native undo/redo and IME behavior.
    document.execCommand("styleWithCSS", false, "false");
    document.execCommand(command, false, value);
    save();
  }

  async function insertImages(files: File[]) {
    updateSelection();
    try {
      const sources = await Promise.all(files.map(readNoteImage));
      if (!editorRef.current) return;
      execute("insertHTML", sources.map((src) => `<img src="${src}" alt="便签图片"><br>`).join(""));
    } catch (error) { onError(noteErrorMessage(error)); }
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    const images = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
    if (images.length) { void insertImages(images); return; }
    const html = event.clipboardData.getData("text/html");
    execute("insertHTML", html ? sanitizeNoteHtml(html) : textToNoteHtml(event.clipboardData.getData("text/plain")));
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const images = Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith("image/"));
    if (images.length) { void insertImages(images); return; }
    const html = event.dataTransfer.getData("text/html");
    execute("insertHTML", html ? sanitizeNoteHtml(html) : textToNoteHtml(event.dataTransfer.getData("text/plain")));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.ctrlKey || event.metaKey) {
      if (event.key.toLowerCase() === "s") { event.preventDefault(); save(); onSave(); }
      if (event.shiftKey && event.key.toLowerCase() === "l") { event.preventDefault(); execute("insertUnorderedList"); }
    }
  }

  return (
    <>
      <div className="sticky-note__paper">
        <div
          ref={editorRef}
          className="sticky-note__editor"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-label="便签内容"
          aria-multiline="true"
          aria-placeholder="记笔记…"
          data-empty={empty}
          spellCheck={false}
          onInput={() => { if (!composing.current) save(); }}
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={() => { composing.current = false; save(); }}
          onBlur={save}
          onPaste={handlePaste}
          onDrop={handleDrop}
          onDragOver={(event) => event.preventDefault()}
          onKeyDown={handleKeyDown}
        />
      </div>
      <footer className="sticky-note__toolbar" role="toolbar" aria-label="文字格式">
        {FORMATS.map(({ command, label, icon: Icon }) => (
          <button
            key={command}
            type="button"
            className="sticky-note__button"
            title={label}
            aria-label={label}
            aria-pressed={formats.includes(command)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => execute(command)}
          ><Icon size={20} /></button>
        ))}
        <span className="sticky-note__tool-divider" />
        <button
          type="button"
          className="sticky-note__button"
          title="插入图片"
          aria-label="插入图片"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => { updateSelection(); fileRef.current?.click(); }}
        ><IconPhoto size={20} /></button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
          multiple
          hidden
          aria-label="选择便签图片"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            if (files.length) void insertImages(files);
            event.target.value = "";
          }}
        />
      </footer>
    </>
  );
}
