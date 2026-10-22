import { describe, expect, it, vi } from "vitest";
import { AUTO_BACKUP_INTERVAL_MS, AUTO_BACKUP_RETRY_MS, createAutomaticBackupRunner, formatAutomaticBackupError, isAutomaticBackupDue, type AutoBackupStatus } from "./automaticBackup";

const defaults = (overrides: Partial<AutoBackupStatus> = {}): AutoBackupStatus => ({
  enabled: true, directory: "D:/DoTime备份", defaultDirectory: "D:/DoTime/data/auto-backups", keepCount: 7,
  lastSuccessAt: null, lastAttemptAt: null, lastBackupFile: null, lastError: null, lastWarning: null, ...overrides,
});
function harness(status = defaults()) {
  let clock = AUTO_BACKUP_INTERVAL_MS * 2;
  let restoring = false;
  const read = vi.fn(async () => status);
  const write = vi.fn(async () => ({ status: { ...status, lastSuccessAt: clock }, created: true }));
  const createSnapshot = vi.fn(async () => '{"format":"dotime-backup"}');
  const onStatus = vi.fn();
  const onBusy = vi.fn();
  const onError = vi.fn();
  const runner = createAutomaticBackupRunner({ read, write, createSnapshot, onStatus, onBusy, onError,
    now: () => clock, isRestoring: () => restoring });
  return { runner, read, write, createSnapshot, onStatus, onBusy, onError,
    setClock: (next: number) => { clock = next; }, setRestoring: (value: boolean) => { restoring = value; } };
}

describe("自动文件备份调度", () => {
  it("旧原生进程未加载新接口时给出可理解的重启提示", () => {
    expect(formatAutomaticBackupError("Command get_auto_backup_status not found")).toBe("自动备份组件尚未加载，请完整重启桌面应用。");
    expect(formatAutomaticBackupError(new Error("备份磁盘不可用"))).toBe("备份磁盘不可用");
  });
  it("首次启动和满 24 小时补做备份，关闭、未到期和系统时钟回拨时不重复备份", () => {
    const day = AUTO_BACKUP_INTERVAL_MS;
    expect(isAutomaticBackupDue(defaults(), day)).toBe(true);
    expect(isAutomaticBackupDue(defaults({ enabled: false }), day)).toBe(false);
    expect(isAutomaticBackupDue(defaults({ lastSuccessAt: day }), day * 2 - 1)).toBe(false);
    expect(isAutomaticBackupDue(defaults({ lastSuccessAt: day }), day * 2)).toBe(true);
    expect(isAutomaticBackupDue(defaults({ lastSuccessAt: day * 2 }), day)).toBe(false);
  });

  it("原生写入失败后的重启仍遵守 30 分钟重试间隔", () => {
    const status = defaults({ lastAttemptAt: AUTO_BACKUP_INTERVAL_MS, lastError: "备份磁盘不可用" });
    expect(isAutomaticBackupDue(status, AUTO_BACKUP_INTERVAL_MS + AUTO_BACKUP_RETRY_MS - 1)).toBe(false);
    expect(isAutomaticBackupDue(status, AUTO_BACKUP_INTERVAL_MS + AUTO_BACKUP_RETRY_MS)).toBe(true);
  });

  it("启动、计时器、焦点和手动请求并发时只导出并写入一次", async () => {
    const task = harness();
    let complete!: (content: string) => void;
    task.createSnapshot.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const startup = task.runner.run();
    const focus = task.runner.run();
    const manual = task.runner.run(true);
    await Promise.resolve();
    complete("完整图片与任务快照");
    const results = await Promise.all([startup, focus, manual]);
    expect(results.every(result => result.created)).toBe(true);
    expect(task.createSnapshot).toHaveBeenCalledTimes(1);
    expect(task.write).toHaveBeenCalledTimes(1);
    expect(task.write).toHaveBeenCalledWith("完整图片与任务快照", false);
    expect(task.onBusy.mock.calls).toEqual([[true], [false]]);
  });

  it("缺失图片导致导出失败时不写入残缺备份，自动退避而手动可立即重试", async () => {
    const task = harness();
    task.createSnapshot.mockRejectedValueOnce(new Error("图片无法完整读取"));
    expect(await task.runner.run()).toEqual({ created: false, error: "图片无法完整读取" });
    expect(task.write).not.toHaveBeenCalled();
    expect(await task.runner.run()).toEqual({ created: false });
    expect(task.createSnapshot).toHaveBeenCalledTimes(1);
    expect((await task.runner.run(true)).created).toBe(true);
    expect(task.write).toHaveBeenCalledTimes(1);
  });

  it("自动检查未到期时同时点击立即备份，仍执行一次手动备份", async () => {
    const task = harness(defaults({ lastSuccessAt: AUTO_BACKUP_INTERVAL_MS * 2 }));
    const check = task.runner.run();
    const manual = task.runner.run(true);
    expect(await check).toEqual({ created: false });
    expect((await manual).created).toBe(true);
    expect(task.write).toHaveBeenCalledTimes(1);
    expect(task.write).toHaveBeenCalledWith(expect.any(String), true);
  });

  it("30 分钟后自动重试，并在原生写入失败时读取持久化的失败状态", async () => {
    const task = harness();
    task.write.mockRejectedValueOnce(new Error("文件夹无法写入"));
    expect(await task.runner.run()).toMatchObject({ error: "文件夹无法写入" });
    expect(task.read).toHaveBeenCalledTimes(2);
    task.setClock(AUTO_BACKUP_INTERVAL_MS * 2 + AUTO_BACKUP_RETRY_MS);
    expect((await task.runner.run()).created).toBe(true);
    expect(task.write).toHaveBeenCalledTimes(2);
  });

  it("正在恢复数据时不备份，图片收集期间开始恢复也不写入混合快照", async () => {
    const task = harness();
    task.setRestoring(true);
    expect(await task.runner.run(true)).toEqual({ created: false });
    expect(task.read).not.toHaveBeenCalled();
    task.setRestoring(false);
    task.createSnapshot.mockImplementation(async () => { task.setRestoring(true); return "snapshot"; });
    expect(await task.runner.run(true)).toEqual({ created: false });
    expect(task.write).not.toHaveBeenCalled();
  });

  it("自动备份关闭后仍可手动备份；未到期时不收集图片", async () => {
    const disabled = harness(defaults({ enabled: false }));
    expect(await disabled.runner.run()).toEqual({ created: false });
    expect(disabled.createSnapshot).not.toHaveBeenCalled();
    expect((await disabled.runner.run(true)).created).toBe(true);
    const recent = harness(defaults({ lastSuccessAt: AUTO_BACKUP_INTERVAL_MS * 2 }));
    expect(await recent.runner.run()).toEqual({ created: false });
    expect(recent.createSnapshot).not.toHaveBeenCalled();
  });
});
