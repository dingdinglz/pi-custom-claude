# pi-custom-claude

让 Pi 原有的 `/login anthropic` 同时配置 **API Key 和 Base URL**，用于连接 Anthropic Messages 兼容的代理或中转服务。

基于 **Pi 1.1.0**（`@earendil-works` 命名空间）开发和测试；需要 Node.js 22.19+。不修改 Pi 源码，不新增供应商，不维护另一份模型列表。

## 安装

在本项目目录运行：

```bash
pi install .
```

重启 Pi，或在已打开的 Pi 中执行 `/reload`。安装后请保留这个目录：本地安装直接引用源文件。

仅临时试用，不写入 Pi 设置：

```bash
pi -e ./index.ts
```

Pi 提供扩展需要的运行时依赖，使用扩展无需先执行 `npm install`。

## 使用

1. 输入 `/login anthropic`，选择 API Key 登录方式（如果显示登录方式选择器）。
2. 输入 API Key，沿用 Pi 的密码输入框。
3. 输入 Base URL，例如 `https://gateway.example.com`。留空明确选择官方地址 `https://api.anthropic.com`。
4. 用 `/model` 选择 Anthropic 下服务商支持的 Claude 模型。

登录后立即生效，不需要重新选择当前模型。再次运行 `/login anthropic` 可更换 Key 和地址；两个值都需要重新输入。取消登录不会覆盖原来的凭据。

Base URL 会按下面的方式规范化，避免请求路径重复出现 `/v1`：

| 输入 | 保存的 Base URL | 请求路径 |
| --- | --- | --- |
| `https://gateway.example.com` | 原值 | `/v1/messages` |
| `https://gateway.example.com/v1` | `https://gateway.example.com` | `/v1/messages` |
| `https://gateway.example.com/v1/messages` | `https://gateway.example.com` | `/v1/messages` |
| `https://gateway.example.com/anthropic/v1/` | `https://gateway.example.com/anthropic` | `/anthropic/v1/messages` |
| `http://localhost:8080` | 原值 | `/v1/messages` |

无效地址会提示重新输入；不接受带用户名、密码、查询参数或片段的地址。服务端必须支持 **Anthropic Messages API**，不是仅支持 OpenAI Chat Completions 的接口。Pi 的模型列表不会自动变成中转商的模型列表；模型不存在时请换成该服务商支持的模型。

## 保存位置和优先级

凭据由 Pi 统一写入 `~/.pi/agent/auth.json`，扩展不另外存储 API Key，也不修改 `models.json`：

```json
{
  "anthropic": {
    "type": "api_key",
    "key": "你的 API Key",
    "env": {
      "ANTHROPIC_BASE_URL": "https://gateway.example.com"
    }
  }
}
```

如果设置了 `PI_CODING_AGENT_DIR`，则使用该目录下的 `auth.json`。这是敏感的本地凭据文件，不要提交到 Git。

- 已保存的 `ANTHROPIC_BASE_URL` 优先于同名环境变量，并覆盖该凭据请求的模型 Base URL（包括 `models.json` 中的地址）。
- 旧的、只有 Key 的凭据仍可使用；未设置自定义地址时保留 Pi 原来的行为。
- 也支持 `ANTHROPIC_API_KEY` + `ANTHROPIC_BASE_URL` 环境变量，不必交互登录。
- `--api-key` / SDK 请求级 API Key 会替换整份凭据，不能依赖已保存的地址；这种用法请同时设置 `ANTHROPIC_BASE_URL` 环境变量。
- Claude Pro/Max OAuth 登录逻辑保持原样，不使用本扩展的自定义地址。

`/logout anthropic` 会一起删除已保存的 Key 和 Base URL，但不会清除环境变量。要回到官方 API，可重新登录并将 Base URL 留空。卸载扩展不会删除 Pi 保存的凭据，且 Pi 原生 API Key 登录不会应用这里保存的自定义地址；更换配置后再发起请求。

只连接你信任的服务：API Key、对话和工具内容会发给该地址。HTTP 会明文传输，除本地或可信网络外应使用 HTTPS。

## Bedrock 中转兼容

如果中转服务返回 `system content must contain at least one block`，可能是 Pi 为调整思考强度发送了 `role: "system", content: []` 控制消息，而服务端不支持这种格式。

本扩展对自定义地址使用兼容模式：

- 不发送会话内的空 system / effort 控制消息，改用请求级 thinking / effort。
- 用 Pi 内置逻辑将系统指令和工具变更合并到顶层 `system` 和 `tools`，不会直接丢弃这些更新。
- 官方地址 `https://api.anthropic.com` 保留原生行为。

更新本地扩展后执行 `/reload` 即可重试，不需要重新登录。切换到兼容模式后请求前缀可能变化，首次请求可能无法命中原有缓存。

## 开发与测试

```bash
npm ci --ignore-scripts
npm run check
```

测试覆盖地址校验、登录取消、凭据保存/退出、环境变量优先级、真实 Pi 扩展加载与重载，并用本地 HTTP 服务验证请求路径、认证头、流式响应，以及重新登录和重启后的路由。还通过模拟 Bedrock 校验复现空 system 报错，验证兼容处理保留系统指令、工具更新和思考强度。测试不使用你的真实 API Key，也不调用收费模型服务。
