/**
 * App icons — Tabler Icons（与 code2img / work 同一套封装方式）
 * @see https://tabler.io/icons
 */

import type { ComponentType } from "react";
import {
  IconCalendarEvent as TbCalendarEvent,
  IconCheck as TbCheck,
  IconChevronLeft as TbChevronLeft,
  IconChevronRight as TbChevronRight,
  IconCircleCheck as TbCircleCheck,
  IconClock as TbClock,
  IconClockHour4 as TbClockHour4,
  IconFlag as TbFlag,
  IconFlame as TbFlame,
  IconListCheck as TbListCheck,
  IconMinus as TbMinus,
  IconPlayerPlay as TbPlayerPlay,
  IconPlayerStop as TbPlayerStop,
  IconPlus as TbPlus,
  IconSquare as TbSquare,
  IconTrash as TbTrash,
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
export const IconTrash = wrap(TbTrash);
export const IconCheck = wrap(TbCheck);
export const IconClose = wrap(TbX);
export const IconMinimize = wrap(TbMinus);
export const IconMaximize = wrap(TbSquare);
export const IconChevronLeft = wrap(TbChevronLeft);
export const IconChevronRight = wrap(TbChevronRight);
export const IconPlayerPlay = wrap(TbPlayerPlay);
export const IconPlayerStop = wrap(TbPlayerStop);
export const IconClock = wrap(TbClock);
export const IconClockHour4 = wrap(TbClockHour4);
export const IconListCheck = wrap(TbListCheck);
export const IconCircleCheck = wrap(TbCircleCheck);
export const IconCalendarEvent = wrap(TbCalendarEvent);
export const IconFlag = wrap(TbFlag);
export const IconFlame = wrap(TbFlame);
