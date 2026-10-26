const ALLOWED_TAGS = new Set(["P", "DIV", "BR", "B", "STRONG", "I", "EM", "U", "S", "STRIKE", "UL", "OL", "LI", "BLOCKQUOTE"]);
const DROP_TAGS = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "SVG", "MATH", "FORM", "INPUT", "BUTTON", "TEXTAREA", "SELECT", "NOSCRIPT"]);
const SAFE_IMAGE = /^data:image\/(?:png|jpeg|gif|webp|bmp);base64,[A-Za-z0-9+/]+={0,2}$/;
export const NOTE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp"]);

// Rebuild a small, inert subset of rich text. Never retain pasted event handlers,
// remote image URLs, links, arbitrary styles, or active embedded content.
export function sanitizeNoteHtml(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  const output = document.createElement("div");
  function append(node: Node, target: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      target.appendChild(document.createTextNode(node.textContent ?? ""));
      return;
    }
    if (!(node instanceof HTMLElement) || DROP_TAGS.has(node.tagName)) return;
    if (node.tagName === "IMG") {
      const src = node.getAttribute("src") ?? "";
      if (SAFE_IMAGE.test(src)) {
        const image = document.createElement("img");
        image.src = src;
        image.alt = node.getAttribute("alt") ?? "便签图片";
        target.appendChild(image);
      }
      return;
    }
    const element = ALLOWED_TAGS.has(node.tagName) ? document.createElement(node.tagName.toLowerCase()) : null;
    let childTarget: Node = element ?? target;
    if (element) target.appendChild(element);
    // Office/browser clipboard HTML often expresses inline formatting with spans.
    const styles = node.style;
    const wrappers = [
      styles.fontWeight === "bold" || Number(styles.fontWeight) >= 600 ? "b" : null,
      styles.fontStyle === "italic" ? "i" : null,
      styles.textDecoration.includes("underline") ? "u" : null,
      styles.textDecoration.includes("line-through") ? "s" : null,
    ];
    for (const tag of wrappers) {
      if (tag) {
        const wrapper = document.createElement(tag);
        childTarget.appendChild(wrapper);
        childTarget = wrapper;
      }
    }
    for (const child of node.childNodes) append(child, childTarget);
  }
  for (const node of template.content.childNodes) append(node, output);
  return output.innerHTML;
}

export function notePreview(html: string): string {
  const template = document.createElement("template");
  // This fragment stays inert and is only read as text; do not rebuild images
  // or serialize their base64 payloads just to generate a search preview.
  template.innerHTML = html;
  for (const element of template.content.querySelectorAll("script,style,iframe,object,embed,svg,math,form,input,button,textarea,select,noscript")) element.remove();
  for (const block of template.content.querySelectorAll("p,div,li,br")) {
    block.appendChild(document.createTextNode(" "));
  }
  const text = (template.content.textContent ?? "").replace(/\s+/g, " ").trim();
  return text || (template.content.querySelector("img") ? "图片便签" : "空白便签");
}

export function textToNoteHtml(text: string): string {
  const element = document.createElement("div");
  element.textContent = text;
  return element.innerHTML.replace(/\r?\n/g, "<br>");
}

export function readNoteImage(file: File): Promise<string> {
  if (!NOTE_IMAGE_TYPES.has(file.type)) return Promise.reject(new Error("请选择 PNG、JPG、GIF、WebP 或 BMP 图片。"));
  if (file.size > 5 * 1024 * 1024) return Promise.reject(new Error("每张图片最多 5 MB，请选择较小的图片。"));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("图片读取失败。"));
    reader.onerror = () => reject(new Error("图片读取失败，请重试。"));
    reader.readAsDataURL(file);
  });
}
