# opencode-session-title

OpenCode 插件：监听 session 状态变化，自动更新 Tmux window 标签。

## 安装

### npm 安装

```bash
npm install opencode-session-title
```

### 本地路径安装（开发调试）

```bash
git clone <repo-url> && cd opencode-session-title
npm install
```

然后在 `opencode.json` 中配置绝对路径：

```json
{
  "plugin": ["/home/user/opencode-session-title"]
}
```

## 配置

在 `opencode.json` 中添加：

```json
{
  "plugin": ["opencode-session-title"]
}
```

或使用本地路径：

```json
{
  "plugin": ["/home/user/opencode-session-title"]
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
| `debug` | boolean | `false` | 启用后输出 JSON 格式调试日志到 stderr |
| `dryRun` | boolean | `false` | 启用后跳过 tmux 命令，仅输出日志 |

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

启用后每次事件触发时输出 JSON 日志，包含事件类型、session 信息、标签内容、tmux 命令结果。

### Dry-Run 模式

```json
{
  "plugin": [["opencode-session-title", { "dryRun": true, "debug": true }]]
}
```

跳过 tmux 命令执行，仅输出日志，适合调试。

## 原理

插件通过 OpenCode v1 plugin API 的 `Hooks.event` 监听 `session.created`、`session.updated`、`session.status` 事件，调用 `tmux rename-window` 更新当前 window 标签。非 Tmux 环境下静默跳过。`/sessions` 切换时自动更新为新 session 标题。

## 开发

```bash
npm install
npm test
```

## License

MIT
