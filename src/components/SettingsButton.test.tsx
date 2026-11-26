import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SettingsDialogContent } from "./SettingsButton";
import { THEME_ACCENT_PRESETS } from "../utils/theme";
import type { useAppUpdates } from "../hooks/useAppUpdates";

const mockUpdates: ReturnType<typeof useAppUpdates> = {
  status: "idle",
  info: null,
  downloaded: null,
  progress: null,
  error: null,
  check: vi.fn(),
  download: vi.fn(),
  openReleasePage: vi.fn(),
  openDownloadDirectory: vi.fn(),
};

describe("SettingsDialogContent 主题色配置", () => {
  it("渲染预设主题色网格、自定义取色器与 Hex 输入框", () => {
    const html = renderToStaticMarkup(
      <SettingsDialogContent
        onClose={vi.fn()}
        updates={mockUpdates}
        titleId="settings-title"
      />,
    );

    expect(html).toContain("主题色");
    expect(html).toContain('aria-label="预设主题色"');
    expect(html).toContain('aria-label="自定义主题色取色器"');
    expect(html).toContain('aria-label="自定义主题色色值"');
    for (const preset of THEME_ACCENT_PRESETS) {
      expect(html).toContain(preset.label);
    }
    expect(html).toContain("恢复默认");
  });
});
