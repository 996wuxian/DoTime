import type { ChangeEvent, CSSProperties } from "react";
import { clamp, formatDuration } from "../utils/time";

interface CountdownDialProps {
  /** 计划秒数 */
  value: number;
  /** 最小秒数，默认 1 分钟 */
  minSeconds?: number;
  /** 最大秒数，默认 4 小时 */
  maxSeconds?: number;
  disabled?: boolean;
  onChange: (seconds: number) => void;
  size?: number;
}

/** 横向拖拽进度条，用于设置计划倒计时。 */
export function CountdownDial({
  value,
  minSeconds = 60,
  maxSeconds = 4 * 3600,
  disabled = false,
  onChange,
  size = 160,
}: CountdownDialProps) {
  const ratio = clamp((value - minSeconds) / (maxSeconds - minSeconds), 0, 1);
  const width = Math.max(260, Math.round(size * 2));
  const style = {
    "--countdown-ratio": `${ratio * 100}%`,
    "--countdown-width": `${width}px`,
  } as CSSProperties;

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = Number(event.currentTarget.value);
    onChange(clamp(nextValue, minSeconds, maxSeconds));
  };

  return (
    <div className={`countdown-dial ${disabled ? "is-disabled" : ""}`} style={style}>
      <div className="countdown-dial__meta">
        <span className="countdown-dial__label">计划时长</span>
        <span className="countdown-dial__value">
          {formatDuration(value)}
        </span>
      </div>
      <input
        type="range"
        className="countdown-dial__range"
        min={minSeconds}
        max={maxSeconds}
        step={60}
        value={value}
        disabled={disabled}
        aria-label="计划时长"
        aria-valuetext={formatDuration(value)}
        onChange={handleChange}
      />
    </div>
  );
}
