// opencode-session-title: shared types

export type SessionStatus = "idle" | "busy" | "retry";

export interface PluginOptions {
  /** Tmux 标签格式模板，默认 "[{icon}] {title}" */
  template?: string;
  /** 开启 debug 日志（记录所有级别），默认 false */
  debug?: boolean;
  /** 干运行模式（不执行 tmux 命令），默认 false */
  dryRun?: boolean;
  /** 日志文件目录，默认 ".opencode/logs/" */
  logDir?: string;
}

export interface CurrentState {
  title: string;
  status: SessionStatus;
}


