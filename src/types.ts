// opencode-session-title: shared types

export type SessionStatus = "idle" | "busy" | "retry";

export interface PluginOptions {
  /** Tmux 标签格式模板，默认 "[{icon}] {title}" */
  template?: string;
  /** 标签最大字符数，超长截断加 "…"，默认不截断 */
  maxLength?: number;
  /** 开启 debug 日志（记录所有级别），默认 false */
  debug?: boolean;
  /** 干运行模式（不执行 tmux 命令），默认 false */
  dryRun?: boolean;
  /** 日志文件目录，默认 ".opencode/logs/" */
  logDir?: string;
  /** ponytail: use plain File transport for tests */
  testMode?: boolean;
}

export interface CurrentState {
  title: string;
  status: SessionStatus;
}


