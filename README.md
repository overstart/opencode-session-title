# opencode-session-title

OpenCode 插件：监听 session 状态变化，自动更新 Tmux window 标签。

## 安装

```bash
npm install opencode-session-title
```

## 配置

在 `opencode.json` 中添加：

```json
{
  "plugin": ["opencode-session-title"]
}
```

## 效果

| 状态 | 标签示例 |
|------|----------|
| idle | `[○] 修复登录bug` |
| busy | `[●] 修复登录bug` |
| retry | `[↻] 修复登录bug` |

## 选项

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `template` | string | `"[{icon}] {title}"` | 标签模板，支持 `{icon}` `{title}` `{status}` |
| `maxLength` | number | 无限制 | 标签最大字符数，超长截断加 `…` |
| `debug` | boolean | `false` | 启用后记录所有级别日志到文件（默认仅 error/warn） |
| `dryRun` | boolean | `false` | 启用后跳过 tmux 命令，仅输出日志 |
| `logDir` | string | `.opencode/logs/` | 日志文件输出目录 |

### 自定义格式

```json
{
  "plugin": [["opencode-session-title", { "template": "{title} [{status}]" }]]
}
```

效果：`修复登录bug [busy]`

### 调试模式

```json
{
  "plugin": [["opencode-session-title", { "debug": true }]]
}
```

启用后日志写入 `.opencode/logs/opencode-session-title-YYYY-MM-DD.log`，按天轮转保留 7 天。

### Dry-Run 模式

```json
{
  "plugin": [["opencode-session-title", { "dryRun": true, "debug": true }]]
}
```

跳过 tmux 命令执行，仅输出日志，适合调试。

### 自定义日志目录

```json
{
  "plugin": [["opencode-session-title", { "logDir": "/var/log/myapp" }]]
}
```

### 标签长度限制

Tmux 标签栏空间有限，设置 `maxLength` 截断长标题：

```json
{
  "plugin": [["opencode-session-title", { "maxLength": 10 }]]
}
```

效果：`[●] 修复登录页面的按钮样式问题` → `[●] 修复登录页面…`

启用 `maxLength` 后，插件会同时将完整标题存入 tmux window option `@opencode_title_full`，可在 `.tmux.conf` 中配置点击弹窗显示：

```tmux
# 点击标签弹出完整标题
bind -n MouseDown1Status if -F '#{@opencode_title_full}' {
  display-popup -h 3 -w 60 "#{@opencode_title_full}"
}
```

## 原理

插件通过 OpenCode v1 plugin API 的 `Hooks.event` 监听 `session.created`、`session.updated`、`session.status` 事件，调用 `tmux rename-window` 更新当前 window 标签。非 Tmux 环境下静默跳过。`/sessions` 切换时自动更新为新 session 标题。

## 开发

```bash
bun install
bun test        # 运行测试
bun run build   # 编译 TypeScript → index.js
```

## License

MIT
