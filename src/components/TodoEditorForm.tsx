import { FormEvent, useEffect, useRef, useState } from "react";
import type {
  ClipboardEvent,
  CSSProperties,
  ChangeEvent,
  DragEvent,
  ReactNode,
  WheelEvent,
} from "react";
import type {
  RecurrenceEditScope,
  RecurrenceFrequency,
  RecurrenceRule,
  TaskTemplate,
  TodoImage,
  Urgency,
} from "../types";
import { RECURRENCE_LABELS, URGENCY_LABELS } from "../types";
import {
  formatClockTime,
  formatDateKey,
  formatDisplayDate,
  formatDuration,
  PRESET_MINUTES,
} from "../utils/time";
import { createTodoImageFromFile, MAX_TODO_IMAGES } from "../utils/todoImages";
import { useTodoImageSrc } from "../hooks/useTodoImageSrc";
import {
  getDefaultReminderTime,
  normalizeReminderTime,
} from "../utils/reminders";
import { DatePickerField } from "./DatePickerField";
import { MonthDaySelect } from "./MonthDaySelect";
import { TaskTemplateControls } from "./TaskTemplateControls";
import {
  IconCheck,
  IconClock,
  IconClockHour4,
  IconClose,
  IconBell,
  IconChevronDown,
  IconChevronUp,
  IconFlame,
  IconPhoto,
  IconRepeat,
  IconTrash,
  IconUpload,
} from "./icons";

export interface TodoDraft {
  title: string;
  date: string;
  taskTime: string;
  comment: string;
  subtaskTitles: string;
  images: TodoImage[];
  urgency: Urgency;
  plannedSeconds: number;
  countdownEnabled: boolean;
  countdownOnlyEnabled: boolean;
  reminderEnabled: boolean;
  reminderTime: string | null;
  recordTimeEnabled: boolean;
  recurrence: RecurrenceRule | null;
  recurrenceEditScope: RecurrenceEditScope;
}

interface TodoEditorFormProps {
  initialDraft: TodoDraft;
  title: string;
  titleIcon: ReactNode;
  submitLabel: string;
  className: string;
  todoId?: string;
  showImages?: boolean;
  autoFocus?: boolean;
  onSubmit: (draft: TodoDraft) => void;
  onCancel: () => void;
  todoDateSummaries: ReadonlyMap<string, import("../types").TodoDateSummary>;
  templates?: readonly TaskTemplate[];
  templateNotice?: string | null;
  onSaveTemplate?: (
    draft: TodoDraft,
    name: string,
    includeRecurrence: boolean,
  ) => TaskTemplate | null;
  onManageTemplates?: () => void;
}

const URGENCIES: Urgency[] = ["low", "medium", "high", "critical"];
const RECURRENCE_FREQUENCIES: RecurrenceFrequency[] = [
  "daily",
  "weekdays",
  "weekly",
  "monthly",
];
const WEEKDAYS = [
  { value: 1, label: "一" },
  { value: 2, label: "二" },
  { value: 3, label: "三" },
  { value: 4, label: "四" },
  { value: 5, label: "五" },
  { value: 6, label: "六" },
  { value: 7, label: "日" },
];
const HOURS = Array.from({ length: 24 }, (_, hour) =>
  String(hour).padStart(2, "0"),
);
const MINUTES = Array.from({ length: 60 }, (_, minute) =>
  String(minute).padStart(2, "0"),
);
const TIME_PICKER_OPTION_STEP = 34;
const TIME_PICKER_POPOVER_WIDTH = 220;
const TIME_PICKER_POPOVER_HEIGHT = 250;
const TIME_PICKER_POPOVER_GAP = 8;
const TIME_PICKER_VIEWPORT_PADDING = 8;
const MAX_IMAGE_SELECTION = MAX_TODO_IMAGES;
const IMAGE_FILE_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "gif",
  "heic",
  "heif",
  "jpeg",
  "jpg",
  "png",
  "webp",
]);
type TaskMode = "normal" | "record" | "countdown";

type ActiveTimePicker = "task" | "reminder" | "countdown" | null;
type NativeImagePath = {
  kind: "native-path";
  path: string;
};
type ImageDropSource = File | string | NativeImagePath;
type AddImageSources = (sources: readonly ImageDropSource[]) => Promise<void>;

function isImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  const extension = file.name.split(".").pop()?.toLowerCase();
  return extension != null && IMAGE_FILE_EXTENSIONS.has(extension);
}

function isHttpImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function resolveDroppedUrl(value: string, baseUrl?: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  try {
    const url = new URL(trimmed, baseUrl);
    return isHttpImageUrl(url.toString()) ? url.toString() : null;
  } catch {
    return null;
  }
}

function getDroppedImageUrls(dataTransfer: DataTransfer | null): string[] {
  if (!dataTransfer) return [];

  const uriList = dataTransfer
    .getData("text/uri-list")
    .split(/\r?\n/)
    .map((value) => resolveDroppedUrl(value))
    .filter((value): value is string => value != null);
  const baseUrl = uriList[0];
  const textUrl = resolveDroppedUrl(dataTransfer.getData("text/plain"));
  const html = dataTransfer.getData("text/html");
  const htmlUrls: string[] = [];

  if (html) {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    for (const image of Array.from(parsed.querySelectorAll("img"))) {
      const src =
        image.getAttribute("src") ??
        image.getAttribute("data-src") ??
        image.getAttribute("srcset")?.split(",")[0]?.trim().split(/\s+/)[0];
      const url = src ? resolveDroppedUrl(src, baseUrl) : null;
      if (url) htmlUrls.push(url);
    }
  }

  return [...uriList, ...(textUrl ? [textUrl] : []), ...htmlUrls].filter(
    (url, index, urls) => urls.indexOf(url) === index,
  );
}

function getImageFiles(dataTransfer: DataTransfer | null): File[] {
  if (!dataTransfer) return [];

  const files = Array.from(dataTransfer.files).filter((file) =>
    isImageFile(file),
  );
  if (files.length > 0) return files;

  return Array.from(dataTransfer.items)
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => file != null && isImageFile(file));
}

function getImageDropSources(
  dataTransfer: DataTransfer | null,
): ImageDropSource[] {
  return [...getImageFiles(dataTransfer), ...getDroppedImageUrls(dataTransfer)];
}

function getFileNameFromUrl(url: string, mimeType: string): string {
  try {
    const pathname = new URL(url).pathname;
    const name = decodeURIComponent(pathname.split("/").pop() ?? "").trim();
    if (name && name.includes(".")) return name;
  } catch {
    // Use the MIME type fallback below.
  }

  const extension = mimeType.split("/")[1]?.split("+")[0] || "png";
  return `dropped-image.${extension}`;
}

async function createImageFileFromUrl(url: string): Promise<File> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`无法下载图片（${response.status}）。`);
  }

  const blob = await response.blob();
  const mimeType = blob.type.startsWith("image/") ? blob.type : "image/png";
  return new File([blob], getFileNameFromUrl(url, mimeType), {
    type: mimeType,
  });
}

async function createImageFileFromNativePath(path: string): Promise<File> {
  const { invoke } = await import("@tauri-apps/api/core");
  const image = await invoke<{
    name: string;
    mimeType: string;
    dataUrl: string;
  }>("read_todo_image_file", { path });
  const response = await fetch(image.dataUrl);
  const blob = await response.blob();
  return new File([blob], image.name, { type: image.mimeType });
}

function formatReminderDateHint(dateKey: string, time: string) {
  const today = formatDateKey();
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrow = formatDateKey(tomorrowDate);
  const dateLabel =
    dateKey === today
      ? "今天"
      : dateKey === tomorrow
        ? "明天"
        : formatDisplayDate(dateKey);

  return `${dateLabel} ${time}`;
}

function getCountdownTargetTime(plannedSeconds: number) {
  return formatClockTime(Date.now() + Math.max(60, plannedSeconds) * 1000);
}

function getCountdownSecondsUntil(time: string, nowMs = Date.now()) {
  const normalized = normalizeReminderTime(time);
  if (normalized == null) return 60;

  const [hour, minute] = normalized.split(":").map(Number);
  const target = new Date(nowMs);
  target.setHours(hour, minute, 0, 0);
  if (target.getTime() <= nowMs) {
    target.setDate(target.getDate() + 1);
  }

  return Math.max(60, Math.ceil((target.getTime() - nowMs) / 1000));
}

function formatCountdownTargetHint(time: string) {
  const normalized = normalizeReminderTime(time);
  if (normalized == null) return null;

  const nowMs = Date.now();
  const [hour, minute] = normalized.split(":").map(Number);
  const target = new Date(nowMs);
  target.setHours(hour, minute, 0, 0);
  if (target.getTime() <= nowMs) {
    target.setDate(target.getDate() + 1);
  }

  const today = formatDateKey(new Date(nowMs));
  const tomorrowDate = new Date(nowMs);
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrow = formatDateKey(tomorrowDate);
  const targetDate = formatDateKey(target);
  const dateLabel =
    targetDate === today
      ? "今天"
      : targetDate === tomorrow
        ? "明天"
        : formatDisplayDate(targetDate);

  return `${dateLabel} ${normalized}`;
}

function TodoFormImagePreview({
  todoId,
  image,
}: {
  todoId?: string;
  image: TodoImage;
}) {
  const src = useTodoImageSrc(todoId, image);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  return src && !failed ? (
    <img
      src={src}
      alt={image.name}
      draggable={false}
      onError={() => setFailed(true)}
    />
  ) : (
    <div
      className="todo-form__image-placeholder"
      role="img"
      aria-label="图片加载失败"
    >
      <IconPhoto size={20} />
    </div>
  );
}

export function createDefaultTodoDraft(date = formatDateKey()): TodoDraft {
  return {
    title: "",
    date,
    taskTime: formatClockTime(Date.now()),
    comment: "",
    subtaskTitles: "",
    images: [],
    urgency: "medium",
    plannedSeconds: 25 * 60,
    countdownEnabled: false,
    countdownOnlyEnabled: false,
    reminderEnabled: false,
    reminderTime: getDefaultReminderTime(),
    recordTimeEnabled: false,
    recurrence: null,
    recurrenceEditScope: "series",
  };
}

export function TodoEditorForm({
  initialDraft,
  title,
  titleIcon,
  submitLabel,
  className,
  todoId,
  showImages = true,
  autoFocus = false,
  onSubmit,
  onCancel,
  todoDateSummaries,
  templates,
  templateNotice = null,
  onSaveTemplate,
  onManageTemplates,
}: TodoEditorFormProps) {
  const [draft, setDraft] = useState<TodoDraft>(initialDraft);
  const [activeTimePicker, setActiveTimePicker] =
    useState<ActiveTimePicker>(null);
  const [timePickerPosition, setTimePickerPosition] =
    useState<CSSProperties | null>(null);
  const [countdownTargetTime, setCountdownTargetTime] = useState(() =>
    getCountdownTargetTime(initialDraft.plannedSeconds),
  );
  const [countdownTimeTouched, setCountdownTimeTouched] = useState(false);
  const [draggingImageId, setDraggingImageId] = useState<string | null>(null);
  const [isImageDropActive, setIsImageDropActive] = useState(false);
  const [isImagePasteTarget, setIsImagePasteTarget] = useState(false);
  const [imageImportNotice, setImageImportNotice] = useState<string | null>(
    null,
  );
  const taskTimeRef = useRef<HTMLDivElement | null>(null);
  const taskTimeButtonRef = useRef<HTMLButtonElement | null>(null);
  const reminderTimeRef = useRef<HTMLDivElement | null>(null);
  const reminderTimeButtonRef = useRef<HTMLButtonElement | null>(null);
  const countdownTimeRef = useRef<HTMLDivElement | null>(null);
  const countdownTimeButtonRef = useRef<HTMLButtonElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const imageDropDepthRef = useRef(0);
  const imageDropzoneRef = useRef<HTMLButtonElement | null>(null);
  const imageDropzoneHoveredRef = useRef(false);
  const imageDropzoneFocusedRef = useRef(false);
  const addImageSourcesRef = useRef<AddImageSources | null>(null);
  const hourListRef = useRef<HTMLDivElement | null>(null);
  const minuteListRef = useRef<HTMLDivElement | null>(null);
  const trimmedTitle = draft.title.trim();
  const taskTimeValue =
    normalizeReminderTime(draft.taskTime) ?? formatClockTime(Date.now());
  const reminderTimeValue =
    normalizeReminderTime(draft.reminderTime) ?? getDefaultReminderTime();
  const countdownTimeValue =
    normalizeReminderTime(countdownTargetTime) ??
    getCountdownTargetTime(draft.plannedSeconds);
  const reminderDateTimeHint = draft.reminderEnabled
    ? formatReminderDateHint(draft.date, reminderTimeValue)
    : null;
  const countdownTargetHint = draft.countdownEnabled
    ? formatCountdownTargetHint(countdownTimeValue)
    : null;
  const activeTimeValue =
    activeTimePicker === "task"
      ? taskTimeValue
      : activeTimePicker === "countdown"
        ? countdownTimeValue
        : reminderTimeValue;
  const [selectedHour, selectedMinute] = activeTimeValue.split(":");
  const taskMode: TaskMode = draft.countdownEnabled
    ? "countdown"
    : draft.recordTimeEnabled
      ? "record"
      : "normal";
  const countdownOnlyEnabled = draft.countdownEnabled && draft.countdownOnlyEnabled;

  const updateDraft = <K extends keyof TodoDraft>(
    key: K,
    value: TodoDraft[K],
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const addImageSources = async (sources: readonly ImageDropSource[]) => {
    if (sources.length === 0) return;
    const remaining = MAX_IMAGE_SELECTION - draft.images.length;
    if (remaining <= 0) return;

    const nextImages = (
      await Promise.allSettled(
        sources
          .slice(0, remaining)
          .map(async (source) =>
            createTodoImageFromFile(
              typeof source === "string"
                ? await createImageFileFromUrl(source)
                : "kind" in source
                  ? await createImageFileFromNativePath(source.path)
                  : source,
            ),
          ),
      )
    )
      .filter(
        (result): result is PromiseFulfilledResult<TodoImage> =>
          result.status === "fulfilled",
      )
      .map((result) => result.value);
    const failedCount = sources.length - nextImages.length;
    if (failedCount > 0) {
      setImageImportNotice(
        nextImages.length > 0
          ? `已添加 ${nextImages.length} 张图片，另有 ${failedCount} 张无法读取`
          : "无法读取拖入的图片，请尝试先复制图片后粘贴",
      );
    } else {
      setImageImportNotice(null);
    }
    setDraft((current) => ({
      ...current,
      images: [...current.images, ...nextImages].slice(0, MAX_IMAGE_SELECTION),
    }));
  };
  addImageSourcesRef.current = addImageSources;

  const handleImageInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    void addImageSources(files.filter(isImageFile));
  };

  const handleImagePaste = (event: ClipboardEvent<HTMLButtonElement>) => {
    const sources = getImageDropSources(event.clipboardData);
    if (sources.length === 0 || draft.images.length >= MAX_IMAGE_SELECTION) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    void addImageSources(sources);
  };

  const handleImageDropzoneDragEnter = (
    event: DragEvent<HTMLButtonElement>,
  ) => {
    if (draft.images.length >= MAX_IMAGE_SELECTION) {
      return;
    }
    event.preventDefault();
    imageDropDepthRef.current += 1;
    setIsImageDropActive(true);
  };

  const handleImageDropzoneDragOver = (event: DragEvent<HTMLButtonElement>) => {
    if (draft.images.length >= MAX_IMAGE_SELECTION) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsImageDropActive(true);
  };

  const handleImageDropzoneDragLeave = (
    event: DragEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    imageDropDepthRef.current = Math.max(0, imageDropDepthRef.current - 1);
    if (imageDropDepthRef.current === 0) setIsImageDropActive(false);
  };

  const handleImageDropzoneDrop = (event: DragEvent<HTMLButtonElement>) => {
    if (draft.images.length >= MAX_IMAGE_SELECTION) return;
    event.preventDefault();
    event.stopPropagation();
    imageDropDepthRef.current = 0;
    setIsImageDropActive(false);
    const sources = getImageDropSources(event.dataTransfer);
    if (sources.length > 0) {
      void addImageSources(sources);
    } else {
      setImageImportNotice("无法识别拖入内容，请拖入图片文件或网页中的图片");
    }
  };

  const isNativeDropInsideZone = (position: { x: number; y: number }) => {
    const rect = imageDropzoneRef.current?.getBoundingClientRect();
    if (!rect) return false;
    const devicePixelRatio = window.devicePixelRatio || 1;
    const candidates = [
      { x: position.x, y: position.y },
      {
        x: position.x / devicePixelRatio,
        y: position.y / devicePixelRatio,
      },
    ];
    return candidates.some(
      ({ x, y }) =>
        x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom,
    );
  };

  useEffect(() => {
    if (!showImages) return;

    let disposed = false;
    let unlisten: (() => void) | null = null;

    void (async () => {
      try {
        const { getCurrentWebview } = await import("@tauri-apps/api/webview");
        const removeListener = await getCurrentWebview().onDragDropEvent(
          (event) => {
            const payload = event.payload;
            if (payload.type === "enter" || payload.type === "over") {
              setIsImageDropActive(isNativeDropInsideZone(payload.position));
              return;
            }
            if (payload.type === "leave") {
              setIsImageDropActive(false);
              return;
            }

            const isInside = isNativeDropInsideZone(payload.position);
            setIsImageDropActive(false);
            if (!isInside || payload.paths.length === 0) return;

            const sources: NativeImagePath[] = payload.paths.map((path) => ({
              kind: "native-path",
              path,
            }));
            void addImageSourcesRef.current?.(sources);
          },
        );
        if (disposed) {
          removeListener();
        } else {
          unlisten = removeListener;
        }
      } catch {
        // Browser dev mode does not expose Tauri's native drag-drop API.
      }
    })();

    return () => {
      disposed = true;
      unlisten?.();
      setIsImageDropActive(false);
    };
  }, [showImages]);

  useEffect(() => {
    if (!isImagePasteTarget) return;

    const handleDocumentPaste = (event: globalThis.ClipboardEvent) => {
      if (event.defaultPrevented) return;
      const sources = getImageDropSources(event.clipboardData);
      if (sources.length === 0 || draft.images.length >= MAX_IMAGE_SELECTION) {
        return;
      }
      event.preventDefault();
      void addImageSources(sources);
    };

    document.addEventListener("paste", handleDocumentPaste);
    return () => document.removeEventListener("paste", handleDocumentPaste);
  }, [draft.images.length, isImagePasteTarget]);

  const updateImagePasteTarget = () => {
    setIsImagePasteTarget(
      imageDropzoneHoveredRef.current || imageDropzoneFocusedRef.current,
    );
  };

  const removeDraftImage = (id: string) => {
    setDraft((current) => ({
      ...current,
      images: current.images.filter((image) => image.id !== id),
    }));
  };

  const reorderDraftImage = (draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;
    setDraft((current) => {
      const draggedIndex = current.images.findIndex(
        (image) => image.id === draggedId,
      );
      const targetIndex = current.images.findIndex(
        (image) => image.id === targetId,
      );
      if (draggedIndex < 0 || targetIndex < 0) return current;
      const nextImages = [...current.images];
      const [draggedImage] = nextImages.splice(draggedIndex, 1);
      nextImages.splice(targetIndex, 0, draggedImage);
      return { ...current, images: nextImages };
    });
  };

  const handleImageDragStart =
    (imageId: string) => (event: DragEvent<HTMLElement>) => {
      setDraggingImageId(imageId);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", imageId);
    };

  const handleImageDrop =
    (targetId: string) => (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      const draggedId =
        event.dataTransfer.getData("text/plain") || draggingImageId;
      if (draggedId) reorderDraftImage(draggedId, targetId);
      setDraggingImageId(null);
    };

  const handleReminderToggle = (enabled: boolean) => {
    setDraft((current) => ({
      ...current,
      reminderEnabled: enabled,
      reminderTime: enabled
        ? (normalizeReminderTime(current.reminderTime) ??
          getDefaultReminderTime())
        : current.reminderTime,
    }));
  };

  const handleTaskModeChange = (mode: TaskMode) => {
    if (mode === "countdown") {
      setCountdownTargetTime(getCountdownTargetTime(draft.plannedSeconds));
      setCountdownTimeTouched(false);
    } else if (activeTimePicker === "countdown") {
      setActiveTimePicker(null);
    }
    setDraft((current) => ({
      ...current,
      countdownEnabled: mode === "countdown",
      countdownOnlyEnabled:
        mode === "countdown" ? current.countdownOnlyEnabled : false,
      recordTimeEnabled: mode === "record" || mode === "countdown",
      plannedSeconds:
        mode === "countdown"
          ? Math.max(60, current.plannedSeconds)
          : current.plannedSeconds,
    }));
  };

  const handleRecurrenceToggle = (enabled: boolean) => {
    setDraft((current) => {
      if (!enabled) {
        return {
          ...current,
          recurrence: null,
          recurrenceEditScope: "series",
        };
      }
      const date = new Date(`${current.date}T00:00:00`);
      const isoWeekday = date.getDay() === 0 ? 7 : date.getDay();
      return {
        ...current,
        recurrenceEditScope: "series",
        recurrence: {
          frequency: "daily",
          weekdays: [isoWeekday],
          monthDay: date.getDate(),
          endDate: null,
        },
      };
    });
  };

  const updateRecurrence = <K extends keyof RecurrenceRule>(
    key: K,
    value: RecurrenceRule[K],
  ) => {
    setDraft((current) =>
      current.recurrence == null
        ? current
        : {
            ...current,
            recurrence: { ...current.recurrence, [key]: value },
            recurrenceEditScope: "series",
          },
    );
  };

  const toggleRecurrenceWeekday = (weekday: number) => {
    if (draft.recurrence == null) return;
    const current = draft.recurrence.weekdays;
    const next = current.includes(weekday)
      ? current.filter((day) => day !== weekday)
      : [...current, weekday].sort((a, b) => a - b);
    if (next.length > 0) updateRecurrence("weekdays", next);
  };

  const toggleTimePicker = (target: Exclude<ActiveTimePicker, null>) => {
    if (target === "reminder" && !draft.reminderEnabled) return;
    if (target === "countdown" && !draft.countdownEnabled) return;
    if (activeTimePicker === target) {
      setActiveTimePicker(null);
      return;
    }

    updateTimePickerPosition(target);
    setActiveTimePicker(target);
  };

  const updateTimePickerPosition = (
    target: Exclude<ActiveTimePicker, null> = activeTimePicker ?? "task",
  ) => {
    const button =
      target === "task"
        ? taskTimeButtonRef.current
        : target === "countdown"
          ? countdownTimeButtonRef.current
          : reminderTimeButtonRef.current;
    if (!button) return;

    const rect = button.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const left = Math.min(
      Math.max(TIME_PICKER_VIEWPORT_PADDING, rect.left),
      Math.max(
        TIME_PICKER_VIEWPORT_PADDING,
        viewportWidth -
          TIME_PICKER_POPOVER_WIDTH -
          TIME_PICKER_VIEWPORT_PADDING,
      ),
    );
    const hasRoomBelow =
      rect.bottom + TIME_PICKER_POPOVER_GAP + TIME_PICKER_POPOVER_HEIGHT <=
      viewportHeight - TIME_PICKER_VIEWPORT_PADDING;
    const rawTop = hasRoomBelow
      ? rect.bottom + TIME_PICKER_POPOVER_GAP
      : rect.top - TIME_PICKER_POPOVER_HEIGHT - TIME_PICKER_POPOVER_GAP;
    const top = Math.min(
      Math.max(TIME_PICKER_VIEWPORT_PADDING, rawTop),
      Math.max(
        TIME_PICKER_VIEWPORT_PADDING,
        viewportHeight -
          TIME_PICKER_POPOVER_HEIGHT -
          TIME_PICKER_VIEWPORT_PADDING,
      ),
    );

    setTimePickerPosition({ left, top });
  };

  const updateTimePart = (part: "hour" | "minute", value: string) => {
    const nextTime =
      part === "hour"
        ? `${value}:${selectedMinute}`
        : `${selectedHour}:${value}`;
    if (activeTimePicker === "countdown") {
      setCountdownTargetTime(nextTime);
      setCountdownTimeTouched(true);
      updateDraft("plannedSeconds", getCountdownSecondsUntil(nextTime));
      return;
    }
    updateDraft(
      activeTimePicker === "task" ? "taskTime" : "reminderTime",
      nextTime,
    );
  };

  useEffect(() => {
    if (activeTimePicker == null) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      const activeRef =
        activeTimePicker === "task"
          ? taskTimeRef
          : activeTimePicker === "countdown"
            ? countdownTimeRef
            : reminderTimeRef;
      if (target instanceof Node && activeRef.current?.contains(target)) {
        return;
      }
      setActiveTimePicker(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveTimePicker(null);
    };

    const handleViewportChange = (event?: Event) => {
      const target = event?.target;
      const activeRef =
        activeTimePicker === "task"
          ? taskTimeRef
          : activeTimePicker === "countdown"
            ? countdownTimeRef
            : reminderTimeRef;
      if (target instanceof Node && activeRef.current?.contains(target)) {
        return;
      }
      updateTimePickerPosition(activeTimePicker);
    };

    updateTimePickerPosition(activeTimePicker);
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("scroll", handleViewportChange, true);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("scroll", handleViewportChange, true);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeTimePicker]);

  useEffect(() => {
    if (activeTimePicker == null) return;
    window.requestAnimationFrame(() => {
      centerTimePickerList(hourListRef.current, Number(selectedHour));
      centerTimePickerList(minuteListRef.current, Number(selectedMinute));
    });
  }, [activeTimePicker, selectedHour, selectedMinute]);

  useEffect(() => {
    if (activeTimePicker == null) return;

    const lists = [hourListRef.current, minuteListRef.current].filter(
      (list): list is HTMLDivElement => list !== null,
    );
    const handleWheel = (event: globalThis.WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const list = event.currentTarget;
      if (!(list instanceof HTMLDivElement)) return;
      const verticalDelta =
        Math.abs(event.deltaY) >= Math.abs(event.deltaX)
          ? event.deltaY
          : event.deltaX;
      list.scrollTop += verticalDelta;
    };

    lists.forEach((list) =>
      list.addEventListener("wheel", handleWheel, { passive: false }),
    );
    return () => {
      lists.forEach((list) => list.removeEventListener("wheel", handleWheel));
    };
  }, [activeTimePicker]);

  const centerTimePickerList = (
    list: HTMLDivElement | null,
    selectedIndex: number,
  ) => {
    if (!list) return;
    const targetTop =
      selectedIndex * TIME_PICKER_OPTION_STEP -
      (list.clientHeight - TIME_PICKER_OPTION_STEP) / 2;
    list.scrollTop = Math.max(0, targetTop);
  };

  const handleTimePickerListWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const verticalDelta =
      Math.abs(event.deltaY) >= Math.abs(event.deltaX)
        ? event.deltaY
        : event.deltaX;
    event.currentTarget.scrollTop += verticalDelta;
  };

  const scrollTimePickerList = (
    list: HTMLDivElement | null,
    direction: -1 | 1,
  ) => {
    if (!list) return;
    list.scrollBy({
      top: direction * TIME_PICKER_OPTION_STEP * 4,
      behavior: "smooth",
    });
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!trimmedTitle) return;
    const plannedSeconds =
      draft.countdownEnabled && countdownTimeTouched
        ? getCountdownSecondsUntil(countdownTimeValue)
        : draft.plannedSeconds;
    onSubmit({
      ...draft,
      title: trimmedTitle,
      countdownOnlyEnabled: draft.countdownEnabled && draft.countdownOnlyEnabled,
      plannedSeconds,
      taskTime: normalizeReminderTime(draft.taskTime) ?? taskTimeValue,
      recordTimeEnabled: draft.countdownEnabled
        ? true
        : draft.recordTimeEnabled,
      reminderTime: draft.reminderEnabled
        ? normalizeReminderTime(draft.reminderTime)
        : null,
      images: showImages ? draft.images.slice(0, MAX_IMAGE_SELECTION) : [],
    });
  };

  const applyTemplate = (template: TaskTemplate) => {
    setCountdownTargetTime(getCountdownTargetTime(template.plannedSeconds));
    setCountdownTimeTouched(false);
    setDraft((current) => ({
      ...current,
      title: template.title,
      taskTime: template.taskTime ?? current.taskTime,
      comment: template.comment,
      subtaskTitles: template.subtasks
        .map((subtask) => subtask.title)
        .join("\n"),
      urgency: template.urgency,
      plannedSeconds: template.plannedSeconds,
      countdownEnabled: template.countdownEnabled,
      countdownOnlyEnabled: Boolean(template.countdownOnlyEnabled),
      reminderEnabled: template.reminderEnabled,
      reminderTime: template.reminderTime,
      recordTimeEnabled: template.countdownEnabled
        ? true
        : template.recordTimeEnabled,
      recurrence: template.recurrence
        ? {
            ...template.recurrence,
            weekdays: [...template.recurrence.weekdays],
            endDate: null,
          }
        : null,
      recurrenceEditScope: "series",
    }));
  };

  return (
    <form className={className} onSubmit={handleSubmit}>
      <div className="todo-form__header">
        <h2>
          {titleIcon}
          {title}
        </h2>
        <div className="todo-form__header-actions">
          {templates && onSaveTemplate && onManageTemplates && (
            <TaskTemplateControls
              compact
              templates={templates}
              draft={draft}
              notice={templateNotice}
              onApply={applyTemplate}
              onSave={(name, includeRecurrence) =>
                onSaveTemplate(draft, name, includeRecurrence)
              }
              onManage={onManageTemplates}
            />
          )}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onCancel}
          >
            <IconClose size={16} />
            取消
          </button>
        </div>
      </div>

      <div className="todo-form__primary-row">
        <label className="field">
          <span className="field__label">任务内容</span>
          <input
            className="field__input"
            name="title"
            autoComplete="off"
            value={draft.title}
            onChange={(event) => updateDraft("title", event.target.value)}
            placeholder="今天要完成什么？"
            autoFocus={autoFocus}
            maxLength={120}
          />
        </label>
        <div className="todo-form__datetime-row">
          <DatePickerField
            label="任务日期"
            value={draft.date}
            fallbackDate={draft.date}
            todoSummaries={todoDateSummaries}
            onChange={(date) => {
              if (date) updateDraft("date", date);
            }}
          />
          <div className="field field--task-time" aria-label="任务时间设置">
            <span className="field__label">
              <IconClock size={14} />
              任务时间
            </span>
            <div ref={taskTimeRef} className="todo-reminder-time">
              <button
                ref={taskTimeButtonRef}
                type="button"
                className="todo-reminder-time__control"
                onClick={() => toggleTimePicker("task")}
                aria-haspopup="listbox"
                aria-expanded={activeTimePicker === "task"}
              >
                <IconClock size={14} />
                <span className="todo-reminder-time__value">
                  {taskTimeValue}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="todo-form__meta-row">
        <div className="field field--urgency">
          <span className="field__label">
            <IconFlame size={14} />
            紧急程度
          </span>
          <div className="urgency-group" role="group" aria-label="紧急程度">
            {URGENCIES.map((urgency) => (
              <button
                key={urgency}
                type="button"
                className={`urgency-chip urgency-chip--${urgency} ${
                  draft.urgency === urgency ? "is-active" : ""
                }`}
                onClick={() => updateDraft("urgency", urgency)}
              >
                <span
                  className={`urgency-icon urgency-icon--${urgency}`}
                  aria-hidden
                >
                  <IconFlame size={14} />
                </span>
                {URGENCY_LABELS[urgency]}
              </button>
            ))}
          </div>
        </div>

        <div className="field field--reminder" aria-label="提醒时间设置">
          <div className="field__label-row">
            <span className="field__label">
              <IconBell size={14} />
              提醒时间
            </span>
            <label className="switch-control">
              <input
                type="checkbox"
                aria-label={draft.reminderEnabled ? "关闭提醒" : "开启提醒"}
                checked={draft.reminderEnabled}
                onChange={(event) =>
                  handleReminderToggle(event.currentTarget.checked)
                }
              />
              <span className="switch-control__track" aria-hidden />
            </label>
          </div>
          <div
            ref={reminderTimeRef}
            className={`todo-reminder-time ${
              draft.reminderEnabled ? "" : "is-disabled"
            }`}
          >
            <button
              ref={reminderTimeButtonRef}
              type="button"
              className="todo-reminder-time__control"
              disabled={!draft.reminderEnabled}
              onClick={() => toggleTimePicker("reminder")}
              aria-haspopup="listbox"
              aria-expanded={activeTimePicker === "reminder"}
            >
              <IconClock size={14} />
              <span className="todo-reminder-time__value">
                {reminderTimeValue}
              </span>
            </button>
          </div>
          {reminderDateTimeHint && (
            <span className="field__hint">
              实际提醒：{reminderDateTimeHint}
            </span>
          )}
        </div>
      </div>

      {templates && (
        <div className="todo-form__template-defaults">
          <label className="field">
            <span className="field__label">默认评论</span>
            <textarea
              className="field__textarea"
              value={draft.comment}
              rows={3}
              maxLength={500}
              onChange={(event) => updateDraft("comment", event.target.value)}
              placeholder="应用模板后带入到待办评论"
            />
          </label>
          <label className="field">
            <span className="field__label">默认子待办</span>
            <textarea
              className="field__textarea"
              value={draft.subtaskTitles}
              rows={3}
              maxLength={1200}
              onChange={(event) =>
                updateDraft("subtaskTitles", event.target.value)
              }
              placeholder="每行一个子待办"
            />
          </label>
        </div>
      )}

      <div className="todo-task-mode" role="radiogroup" aria-label="待办类型">
        <label
          className={`todo-task-mode__option ${
            taskMode === "normal" ? "is-active" : ""
          }`}
        >
          <input
            type="radio"
            name="taskMode"
            checked={taskMode === "normal"}
            onChange={() => handleTaskModeChange("normal")}
          />
          <span>普通待办</span>
        </label>
        <label
          className={`todo-task-mode__option ${
            taskMode === "record" ? "is-active" : ""
          }`}
        >
          <input
            type="radio"
            name="taskMode"
            checked={taskMode === "record"}
            onChange={() => handleTaskModeChange("record")}
          />
          <IconClockHour4 size={14} />
          <span>记录时间</span>
        </label>
        <label
          className={`todo-task-mode__option ${
            taskMode === "countdown" ? "is-active" : ""
          }`}
        >
          <input
            type="radio"
            name="taskMode"
            checked={taskMode === "countdown"}
            onChange={() => handleTaskModeChange("countdown")}
          />
          <IconClock size={14} />
          <span>倒计时</span>
        </label>
      </div>

      <div
        className={`preset-row ${draft.countdownEnabled ? "" : "is-disabled"}`}
        aria-label="预设时长"
      >
        {PRESET_MINUTES.map((minutes) => (
          <button
            key={minutes}
            type="button"
            className={`preset-chip ${
              draft.countdownEnabled && draft.plannedSeconds === minutes * 60
                ? "is-active"
                : ""
            }`}
            disabled={!draft.countdownEnabled}
            onClick={() => {
              updateDraft("plannedSeconds", minutes * 60);
              setCountdownTargetTime(getCountdownTargetTime(minutes * 60));
              setCountdownTimeTouched(false);
            }}
          >
            {minutes < 60 ? `${minutes}分` : `${minutes / 60}小时`}
          </button>
        ))}
        <div
          ref={countdownTimeRef}
          className={`todo-reminder-time countdown-time ${
            draft.countdownEnabled ? "" : "is-disabled"
          }`}
        >
          <button
            ref={countdownTimeButtonRef}
            type="button"
            className="todo-reminder-time__control"
            disabled={!draft.countdownEnabled}
            onClick={() => toggleTimePicker("countdown")}
            aria-label={`选择倒计时结束时间，当前 ${countdownTimeValue}`}
            aria-haspopup="listbox"
            aria-expanded={activeTimePicker === "countdown"}
            title={
              countdownTargetHint ? `预计结束：${countdownTargetHint}` : undefined
            }
          >
            <IconClock size={14} />
            <span className="todo-reminder-time__value">
              {countdownTimeValue}
            </span>
            <span className="countdown-time__duration">
              {formatDuration(draft.plannedSeconds)}
            </span>
          </button>
        </div>
        <label className="switch-control countdown-only-toggle">
          <input
            type="checkbox"
            aria-label={countdownOnlyEnabled ? "关闭仅倒计时" : "开启仅倒计时"}
            checked={countdownOnlyEnabled}
            onChange={(event) => {
              const checked = event.currentTarget.checked;
              setDraft((current) => ({
                ...current,
                countdownOnlyEnabled: current.countdownEnabled && checked,
              }));
            }}
            disabled={!draft.countdownEnabled}
          />
          <span className="switch-control__track" aria-hidden />
          <span className="switch-control__label">仅倒计时</span>
        </label>
      </div>

      <section className="recurrence-panel" aria-label="重复任务设置">
        <div className="field__label-row">
          <span className="field__label">
            <IconRepeat size={14} />
            重复任务
          </span>
          <label className="switch-control">
            <input
              type="checkbox"
              aria-label={
                draft.recurrence == null ? "开启重复任务" : "关闭重复任务"
              }
              checked={draft.recurrence != null}
              onChange={(event) =>
                handleRecurrenceToggle(event.currentTarget.checked)
              }
            />
            <span className="switch-control__track" aria-hidden />
          </label>
        </div>

        {draft.recurrence != null && (
          <div className="recurrence-panel__body">
            <div
              className="recurrence-frequency"
              role="group"
              aria-label="重复频率"
            >
              {RECURRENCE_FREQUENCIES.map((frequency) => (
                <button
                  key={frequency}
                  type="button"
                  className={`recurrence-frequency__option ${
                    draft.recurrence?.frequency === frequency ? "is-active" : ""
                  }`}
                  onClick={() => updateRecurrence("frequency", frequency)}
                >
                  {RECURRENCE_LABELS[frequency]}
                </button>
              ))}
            </div>

            {draft.recurrence.frequency === "weekly" && (
              <div className="recurrence-weekdays" aria-label="每周重复日期">
                {WEEKDAYS.map((weekday) => (
                  <button
                    key={weekday.value}
                    type="button"
                    className={
                      draft.recurrence?.weekdays.includes(weekday.value)
                        ? "is-active"
                        : ""
                    }
                    aria-pressed={
                      draft.recurrence?.weekdays.includes(weekday.value) ??
                      false
                    }
                    onClick={() => toggleRecurrenceWeekday(weekday.value)}
                  >
                    {weekday.label}
                  </button>
                ))}
              </div>
            )}

            <div className="recurrence-panel__limits">
              {draft.recurrence.frequency === "monthly" && (
                <div className="field recurrence-panel__month-day">
                  <span className="field__label">每月日期</span>
                  <MonthDaySelect
                    value={draft.recurrence.monthDay ?? 1}
                    onChange={(day) => updateRecurrence("monthDay", day)}
                  />
                </div>
              )}
              <DatePickerField
                label="结束日期（可选）"
                value={draft.recurrence.endDate}
                fallbackDate={draft.date}
                todoSummaries={todoDateSummaries}
                minDate={draft.date}
                optional
                onChange={(date) => updateRecurrence("endDate", date)}
              />
            </div>
          </div>
        )}

        {initialDraft.recurrence != null && (
          <div
            className="recurrence-edit-scope"
            role="group"
            aria-label="编辑重复任务范围"
          >
            <button
              type="button"
              className={
                draft.recurrenceEditScope === "single" ? "is-active" : ""
              }
              onClick={() => updateDraft("recurrenceEditScope", "single")}
            >
              仅本次
            </button>
            <button
              type="button"
              className={
                draft.recurrenceEditScope === "series" ? "is-active" : ""
              }
              onClick={() => updateDraft("recurrenceEditScope", "series")}
            >
              本次及后续
            </button>
          </div>
        )}
      </section>

      {showImages && (
        <section className="todo-form__images" aria-label="待办图片">
          <div className="field__label-row">
            <span className="field__label">
              <IconPhoto size={14} />
              图片
            </span>
            <div className="todo-form__images-meta">
              <span>
                {draft.images.length}/{MAX_IMAGE_SELECTION}
              </span>
            </div>
          </div>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={handleImageInputChange}
          />
          {draft.images.length > 0 ? (
            <div className="todo-form__image-list">
              {draft.images.map((image) => (
                <figure
                  key={image.id}
                  className={`todo-form__image-item ${
                    draggingImageId === image.id ? "is-dragging" : ""
                  }`}
                  draggable
                  onDragStart={handleImageDragStart(image.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={handleImageDrop(image.id)}
                  onDragEnd={() => setDraggingImageId(null)}
                  title="拖拽调整顺序"
                >
                  <TodoFormImagePreview todoId={todoId} image={image} />
                  <button
                    type="button"
                    className="todo-form__image-remove"
                    onClick={() => removeDraftImage(image.id)}
                    aria-label={`移除图片 ${image.name}`}
                    title="移除图片"
                  >
                    <IconTrash size={12} />
                  </button>
                </figure>
              ))}
            </div>
          ) : (
            <div className="todo-form__images-empty"></div>
          )}
          <button
            type="button"
            ref={imageDropzoneRef}
            className={`todo-form__image-dropzone ${
              isImageDropActive ? "is-drag-active" : ""
            }`}
            onClick={() => imageInputRef.current?.click()}
            onPaste={handleImagePaste}
            onMouseEnter={() => {
              imageDropzoneHoveredRef.current = true;
              updateImagePasteTarget();
            }}
            onMouseLeave={() => {
              imageDropzoneHoveredRef.current = false;
              updateImagePasteTarget();
            }}
            onFocus={() => {
              imageDropzoneFocusedRef.current = true;
              updateImagePasteTarget();
            }}
            onBlur={() => {
              imageDropzoneFocusedRef.current = false;
              updateImagePasteTarget();
            }}
            onDragEnter={handleImageDropzoneDragEnter}
            onDragOver={handleImageDropzoneDragOver}
            onDragLeave={handleImageDropzoneDragLeave}
            onDrop={handleImageDropzoneDrop}
            disabled={draft.images.length >= MAX_IMAGE_SELECTION}
            aria-label="粘贴、选择或拖拽图片"
          >
            <IconUpload size={20} />
            <strong>
              {draft.images.length >= MAX_IMAGE_SELECTION
                ? `已达到 ${MAX_IMAGE_SELECTION} 张图片上限`
                : "粘贴图片、选择文件或拖拽到此处"}
            </strong>
            {draft.images.length < MAX_IMAGE_SELECTION && (
              <span>支持同时添加多张图片</span>
            )}
          </button>
          {imageImportNotice && (
            <p className="todo-form__images-notice" role="status">
              {imageImportNotice}
            </p>
          )}
        </section>
      )}

      {activeTimePicker != null && (
        <div
          className="time-picker-popover"
          role="dialog"
          style={timePickerPosition ?? undefined}
          onPointerDown={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
        >
          <div className="time-picker-popover__column">
            <span className="time-picker-popover__label">时</span>
            <button
              type="button"
              className="time-picker-popover__scroll-btn"
              aria-label="向上滚动小时"
              onClick={() => scrollTimePickerList(hourListRef.current, -1)}
            >
              <IconChevronUp size={12} />
            </button>
            <div
              ref={hourListRef}
              className="time-picker-popover__list"
              role="listbox"
              aria-label="选择小时"
              onWheelCapture={handleTimePickerListWheel}
              onWheel={handleTimePickerListWheel}
            >
              {HOURS.map((hour) => (
                <button
                  key={hour}
                  type="button"
                  className={`time-picker-popover__option ${
                    selectedHour === hour ? "is-active" : ""
                  }`}
                  role="option"
                  aria-selected={selectedHour === hour}
                  onClick={() => updateTimePart("hour", hour)}
                >
                  {hour}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="time-picker-popover__scroll-btn"
              aria-label="向下滚动小时"
              onClick={() => scrollTimePickerList(hourListRef.current, 1)}
            >
              <IconChevronDown size={12} />
            </button>
          </div>
          <div className="time-picker-popover__column">
            <span className="time-picker-popover__label">分</span>
            <button
              type="button"
              className="time-picker-popover__scroll-btn"
              aria-label="向上滚动分钟"
              onClick={() => scrollTimePickerList(minuteListRef.current, -1)}
            >
              <IconChevronUp size={12} />
            </button>
            <div
              ref={minuteListRef}
              className="time-picker-popover__list"
              role="listbox"
              aria-label="选择分钟"
              onWheelCapture={handleTimePickerListWheel}
              onWheel={handleTimePickerListWheel}
            >
              {MINUTES.map((minute) => (
                <button
                  key={minute}
                  type="button"
                  className={`time-picker-popover__option ${
                    selectedMinute === minute ? "is-active" : ""
                  }`}
                  role="option"
                  aria-selected={selectedMinute === minute}
                  onClick={() => updateTimePart("minute", minute)}
                >
                  {minute}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="time-picker-popover__scroll-btn"
              aria-label="向下滚动分钟"
              onClick={() => scrollTimePickerList(minuteListRef.current, 1)}
            >
              <IconChevronDown size={12} />
            </button>
          </div>
        </div>
      )}

      <button
        type="submit"
        className="btn btn-primary btn-block btn-add-submit"
        disabled={!trimmedTitle}
      >
        <IconCheck size={16} />
        {submitLabel}
      </button>
    </form>
  );
}
