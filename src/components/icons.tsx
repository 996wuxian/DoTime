/**
 * App icons — Tabler Icons（与 code2img / work 同一套封装方式）
 * @see https://tabler.io/icons
 */

import type { ComponentType } from "react";
import {
  IconAlarmSnooze as TbAlarmSnooze,
  IconCalendarEvent as TbCalendarEvent,
  IconArrowBarToDown as TbArrowBarToDown,
  IconArrowBarToUp as TbArrowBarToUp,
  IconBell as TbBell,
  IconBellRinging as TbBellRinging,
  IconCheck as TbCheck,
  IconChevronDown as TbChevronDown,
  IconChevronLeft as TbChevronLeft,
  IconChevronRight as TbChevronRight,
  IconChevronUp as TbChevronUp,
  IconCircleCheck as TbCircleCheck,
  IconClock as TbClock,
  IconClockHour4 as TbClockHour4,
  IconDatabaseExport as TbDatabaseExport,
  IconDownload as TbDownload,
  IconFlag as TbFlag,
  IconFlame as TbFlame,
  IconGripVertical as TbGripVertical,
  IconListCheck as TbListCheck,
  IconMinus as TbMinus,
  IconMoon as TbMoon,
  IconSearch as TbSearch,
  IconPlayerPause as TbPlayerPause,
  IconPencil as TbPencil,
  IconPlayerPlay as TbPlayerPlay,
  IconPlayerStop as TbPlayerStop,
  IconPlus as TbPlus,
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
export const IconPlayerPause = wrap(TbPlayerPause);
export const IconPlayerStop = wrap(TbPlayerStop);
export const IconClock = wrap(TbClock);
export const IconClockHour4 = wrap(TbClockHour4);
export const IconListCheck = wrap(TbListCheck);
export const IconCircleCheck = wrap(TbCircleCheck);
export const IconCalendarEvent = wrap(TbCalendarEvent);
export const IconFlag = wrap(TbFlag);
export const IconFlame = wrap(TbFlame);
export const IconPencil = wrap(TbPencil);
export const IconGripVertical = wrap(TbGripVertical);
export const IconThemeSun = wrap(TbSun);
export const IconThemeMoon = wrap(TbMoon);
export const IconDockBottom = wrap(TbArrowBarToDown);
export const IconDockTop = wrap(TbArrowBarToUp);
export const IconRestore = wrap(TbWindowMaximize);
export const IconBell = wrap(TbBell);
export const IconBellRinging = wrap(TbBellRinging);
export const IconAlarmSnooze = wrap(TbAlarmSnooze);
export const IconDatabaseExport = wrap(TbDatabaseExport);
export const IconDownload = wrap(TbDownload);
export const IconUpload = wrap(TbUpload);
