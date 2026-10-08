# pi-custom-claude

让 Pi 原有的 `/login anthropic` 同时配置 **API Key 和 Base URL**，用于连接 Anthropic Messages 兼容的代理或中转服务。

最低支持 **Pi 1.1.0**（`@earendil-works` 命名空间），目前也在该版本上测试；需要 Node.js 22.19+。不修改 Pi 源码，不新增供应商，不维护另一份模型列表。

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

**安装前检查 shell 中已有的 `ANTHROPIC_BASE_URL`。** 原生 Pi 不读取这个变量，但本扩展会读取。如果你曾为 Claude Code 设置它，安装扩展后，旧的只含 Key 的 Anthropic 凭据也会使用该地址，覆盖 `models.json` 中的地址。API Key 和对话会发送到这个新的目的地。若不希望继承，启动 Pi 前执行 `unset ANTHROPIC_BASE_URL`，或通过 `/login anthropic` 显式保存你要使用的地址。

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

无效地址会提示重新输入；不接受带用户名、密码、查询参数或片段的地址。误贴 `/v1/messages/count_tokens` 计数接口会明确报错并重新询问。URL 路径区分大小写：只规范化表中的小写后缀，`/V1` 等其他路径保留原样，请确认服务商提供的地址。

服务端必须支持 **Anthropic Messages API**，不是仅支持 OpenAI Chat Completions 的接口。Pi 的模型列表不会自动变成中转商的模型列表；模型不存在时请换成该服务商支持的模型。

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

- 非空的已保存 `ANTHROPIC_BASE_URL` 优先于同名环境变量；两者都会覆盖该凭据请求的模型 Base URL（包括 `models.json` 中的地址）。
- 环境变量或凭据字段为空字符串、纯空白时视为未设置，不会强制切换到官方地址。登录时留空则不同：它会保存完整的官方 URL，明确覆盖其他地址。
- 旧的、只有 Key 的凭据会继承非空的 `ANTHROPIC_BASE_URL` 环境变量；只有两处均未设置时才保留 Pi 原来的模型地址。
- 也支持 `ANTHROPIC_API_KEY` + `ANTHROPIC_BASE_URL` 环境变量，不必交互登录。
- `--api-key` / SDK 请求级 API Key 会替换整份凭据，不能依赖已保存的地址或兼容开关；可用环境变量指定两者，SDK 也可通过请求的 `env` 传入。未指定地址时使用模型自己的 Base URL。
- Claude Pro/Max OAuth 登录逻辑保持原样，不使用 API Key 凭据中的自定义地址。

模型可用性检查只检查凭据，不验证这里的地址。因此错误的 Anthropic 地址不会阻止 OpenAI 等供应商的模型列表加载；真正向 Anthropic 发起请求时仍会严格校验地址，不会静默改发到其他服务。

`/logout anthropic` 会一起删除已保存的 Key 和 Base URL，但不会清除环境变量。要回到官方 API，可重新登录并将 Base URL 留空。卸载扩展不会删除 Pi 保存的凭据，且 Pi 原生 API Key 登录不会应用这里保存的自定义地址；更换配置后再发起请求。

只连接你信任的服务：API Key、对话和工具内容会发给该地址。HTTP 会明文传输，除本地或可信网络外应使用 HTTPS。登录时遇到非回环的 HTTP 地址会额外提醒；`localhost`（含其子域）、`127.0.0.0/8` 和 `::1` 不触发这条提醒。内网地址仍会提醒，不通过 DNS 推测地址是否安全。

## Bedrock 中转兼容

如果中转服务返回 `system content must contain at least one block`，可能是 Pi 为调整思考强度发送了 `role: "system", content: []` 控制消息，而服务端不支持这种格式。

默认对 Anthropic 供应商的所有非官方地址启用兼容模式，不论地址来自登录、环境变量还是 `models.json`。这也包括直接转发到官方 API 的透明代理，而不只是 Bedrock 中转：

- 不发送会话内的空 system / effort 控制消息，改用请求级 thinking / effort。仍可在下一次请求调整思考强度，但不再重放历史消息各自的原生 effort 控制。
- 用 Pi 内置逻辑将系统指令和工具变更合并到顶层 `system` 和 `tools`，不会直接丢弃这些更新。
- 官方地址 `https://api.anthropic.com` 保留原生行为；其他供应商不受影响。

如果代理支持这些原生功能，可以关闭兼容模式，例如：

```bash
PI_CUSTOM_CLAUDE_COMPAT=off pi
```

也可在现有 `auth.json` 的 `anthropic.env` 中添加 `"PI_CUSTOM_CLAUDE_COMPAT": "off"`，与 `ANTHROPIC_BASE_URL` 放在同一对象中，不要删除原有 Key。

| `PI_CUSTOM_CLAUDE_COMPAT` | 行为 |
| --- | --- |
| 未设置 / 空白 | 继承上一级设置；最终默认为 `on` |
| `on` | 非官方地址使用兼容格式；官方地址保持原生格式 |
| `off` | 保留模型原有的传输能力配置，包括会话内 system / effort / 工具变更 |

值忽略大小写和首尾空白；其他非空值会在请求时明确报错。凭据 `env` 中的非空值优先于进程环境变量；SDK 请求的 `env` 可覆盖凭据设置。重新登录会替换该供应商的整份凭据，手动添加的开关需重新添加，或改用环境变量。

关闭兼容模式前应确认服务端支持对应功能，否则可能再次出现 Bedrock 400。更新本地扩展后执行 `/reload` 即可重试，不需要重新登录；修改进程环境变量则需重启 Pi。切换兼容模式、或合并系统/工具更新时，请求前缀可能变化并导致缓存失效。

## 开发与测试

```bash
npm ci --ignore-scripts
npm run check
```

测试覆盖地址校验、HTTP 提醒、登录取消、凭据保存/退出、空值和设置优先级、无效地址下的跨供应商模型列表、运行时/请求级 API Key、兼容模式开关，以及真实 Pi 扩展加载与重载。用本地 HTTP 服务验证请求路径、认证头、流式响应和重新登录/重启后的路由；通过模拟 Bedrock 校验复现空 system 报错，验证兼容处理保留系统指令、工具更新和思考强度。测试不使用你的真实 API Key，也不调用收费模型服务。

宿主提供的 Pi 包按官方打包约定在 `peerDependencies` 中使用 `"*"`，不打包进扩展；这不表示兼容所有 Pi 版本。开发依赖固定为测试过的 1.1.0，扩展启动时检查所需原生供应商接口，其他版本需另行验证。

## 许可证

[MIT License](LICENSE)。
