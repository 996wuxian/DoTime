/**
 * App icons — Tabler Icons（与 code2img / work 同一套封装方式）
 * @see https://tabler.io/icons
 */

import type { ComponentType } from "react";
import {
  IconAlarmSnooze as TbAlarmSnooze,
  IconCalendarEvent as TbCalendarEvent,
  IconChartBar as TbChartBar,
  IconArrowBarToDown as TbArrowBarToDown,
  IconArrowBarToUp as TbArrowBarToUp,
  IconBell as TbBell,
  IconBellRinging as TbBellRinging,
  IconBookmark as TbBookmark,
  IconCheck as TbCheck,
  IconChevronDown as TbChevronDown,
  IconChevronLeft as TbChevronLeft,
  IconChevronRight as TbChevronRight,
  IconChevronUp as TbChevronUp,
  IconCircleCheck as TbCircleCheck,
  IconClipboardText as TbClipboardText,
  IconClock as TbClock,
  IconClockHour4 as TbClockHour4,
  IconCode as TbCode,
  IconDatabaseExport as TbDatabaseExport,
  IconDownload as TbDownload,
  IconDeviceFloppy as TbDeviceFloppy,
  IconFlag as TbFlag,
  IconFilter as TbFilter,
  IconFlame as TbFlame,
  IconGripVertical as TbGripVertical,
  IconPhoto as TbPhoto,
  IconListCheck as TbListCheck,
  IconMinus as TbMinus,
  IconMoon as TbMoon,
  IconSearch as TbSearch,
  IconSettings as TbSettings,
  IconPlayerPause as TbPlayerPause,
  IconPlayerPauseFilled as TbPlayerPauseFilled,
  IconPencil as TbPencil,
  IconPlayerPlay as TbPlayerPlay,
  IconPlayerPlayFilled as TbPlayerPlayFilled,
  IconPlayerStop as TbPlayerStop,
  IconPlayerStopFilled as TbPlayerStopFilled,
  IconPlus as TbPlus,
  IconRepeat as TbRepeat,
  IconSquare as TbSquare,
  IconSun as TbSun,
  IconTrash as TbTrash,
  IconUpload as TbUpload,
  IconWindowMaximize as TbWindowMaximize,
  IconX as TbX,
} from "@tabler/icons-react";

export type IconProps = {
  size?: number;
  title?: string;
  className?: string;
  stroke?: number;
};

type TbIcon = ComponentType<{
  size?: number | string;
  stroke?: number;
  color?: string;
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
}>;

function wrap(Tb: TbIcon, defaults?: { stroke?: number; className?: string }) {
  function TablerAppIcon({
    size = 18,
    title,
    stroke = defaults?.stroke ?? 1.75,
    className = "",
  }: IconProps) {
    const classes = ["g-icon", defaults?.className, className]
      .filter(Boolean)
      .join(" ");
    return (
      <span
        className={classes}
        style={{
          display: "inline-flex",
          width: size,
          height: size,
          lineHeight: 0,
          color: "currentColor",
          flexShrink: 0,
          alignItems: "center",
          justifyContent: "center",
        }}
        role={title ? "img" : undefined}
        aria-hidden={title ? undefined : true}
        aria-label={title}
        title={title}
      >
        <Tb size={size} stroke={stroke} color="currentColor" aria-hidden />
      </span>
    );
  }
  return TablerAppIcon;
}

export const IconPlus = wrap(TbPlus);
export const IconSearch = wrap(TbSearch);
export const IconTrash = wrap(TbTrash);
export const IconCheck = wrap(TbCheck);
export const IconClose = wrap(TbX);
export const IconMinimize = wrap(TbMinus);
export const IconMaximize = wrap(TbSquare);
export const IconChevronLeft = wrap(TbChevronLeft);
export const IconChevronRight = wrap(TbChevronRight);
export const IconChevronUp = wrap(TbChevronUp);
export const IconChevronDown = wrap(TbChevronDown);
export const IconPlayerPlay = wrap(TbPlayerPlay);
export const IconPlayerPlayFilled = wrap(TbPlayerPlayFilled, { stroke: 0 });
export const IconPlayerPause = wrap(TbPlayerPause);
export const IconPlayerPauseFilled = wrap(TbPlayerPauseFilled, { stroke: 0 });
export const IconPlayerStop = wrap(TbPlayerStop);
export const IconPlayerStopFilled = wrap(TbPlayerStopFilled, { stroke: 0 });
export const IconClock = wrap(TbClock);
export const IconClockHour4 = wrap(TbClockHour4);
export const IconListCheck = wrap(TbListCheck);
export const IconCircleCheck = wrap(TbCircleCheck);
export const IconClipboardText = wrap(TbClipboardText);
export const IconCalendarEvent = wrap(TbCalendarEvent);
export const IconCode = wrap(TbCode);
export const IconChartBar = wrap(TbChartBar);
export const IconFlag = wrap(TbFlag);
export const IconFilter = wrap(TbFilter);
export const IconFlame = wrap(TbFlame);
export const IconPencil = wrap(TbPencil);
export const IconGripVertical = wrap(TbGripVertical);
export const IconPhoto = wrap(TbPhoto);
export const IconThemeSun = wrap(TbSun);
export const IconThemeMoon = wrap(TbMoon);
export const IconDockBottom = wrap(TbArrowBarToDown);
export const IconDockTop = wrap(TbArrowBarToUp);
export const IconRestore = wrap(TbWindowMaximize);
export const IconBell = wrap(TbBell);
export const IconBellRinging = wrap(TbBellRinging);
export const IconBookmark = wrap(TbBookmark);
export const IconAlarmSnooze = wrap(TbAlarmSnooze);
export const IconRepeat = wrap(TbRepeat);
export const IconDatabaseExport = wrap(TbDatabaseExport);
export const IconDownload = wrap(TbDownload);
export const IconDeviceFloppy = wrap(TbDeviceFloppy);
export const IconSettings = wrap(TbSettings);
export const IconUpload = wrap(TbUpload);
