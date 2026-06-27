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

## 自定义格式

通过 `PluginOptions.template` 自定义标签模板，支持 `{icon}`、`{title}`、`{status}` 占位符：

```json
{
  "plugin": [["opencode-session-title", { "template": "{title} [{status}]" }]]
}
```

效果：`修复登录bug [busy]`

## 原理

插件通过 OpenCode v1 plugin API 的 `Hooks.event` 监听 `session.created`、`session.updated`、`session.status` 事件，调用 `tmux rename-window` 更新当前 window 标签。非 Tmux 环境下静默跳过。

## License

MIT
