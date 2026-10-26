# 调研与适配记录

2026-10-26，分析版本为 Microsoft Store 网易云音乐 `3.1.23.204814`，对应 MSIX `3.1.23.0`，x64，Chromium/CEF 91。

## 参考资料

| 来源 | 用到的内容 |
| --- | --- |
| [BetterNCM 插件库](https://github.com/BetterNCM/BetterNCM-Plugins) | JS 插件结构和 NCM3 manifest。Store 版能否安装框架仍需单独验证。 |
| [BetterNCM Store 版讨论 #34](https://github.com/std-microblock/chromatic/issues/34) | 2022 年旧版客户端解包重签的经验，不足以证明 3.1.23 能直接安装。 |
| [CEF General Usage](https://github.com/chromiumembedded/cef/blob/master/docs/general_usage.md) | `remote_debugging_port` / `remote-debugging-port` 配置。宿主可以禁用命令行参数，实际是否生效需要验证。 |
| [CEF 91.1 对应封装参考](https://cefsharp.github.io/api/91.1.x/html/P_CefSharp_CefSettingsBase_RemoteDebuggingPort.htm) | 同代 CEF 调试端口配置。 |
| [NeteaseHookSDK](https://github.com/lgnorant-lu/NeteaseHookSDK) | v0.1.3 beta 的 CDP 和 JS 状态读取方案。本项目没有使用它的代理 DLL；其中 Electron 的描述也不能代替 CEF 检测。 |
| [Orpheus runtime adapter](https://github.com/SUPERtongmeng/ncm-orpheus/blob/main/plugin/main.js) | 通过 webpack/DVA 读取 3.x 的 `playing` 状态。相关字段另在 3.1.23 资源中核对过。 |
| [Open-Orpheus WebPack.ts](https://github.com/YUCLing/open-orpheus/blob/main/src/main/packs/WebPack.ts) | ntpk 包结构：前 100 字节为头部，后面是 ZIP。用于只读检查页面和脚本。 |
| [DeepSeek First API Call](https://api-docs.deepseek.com/) | Chat Completions 格式。查阅时官方默认模型为 `deepseek-flash`，地址为 `https://api.deepseek.com`。 |
| [DeepSeek Search & Fetch](https://api-docs.deepseek.com/guides/search/) | `POST /v1/tools/search`，与聊天接口使用同一个 bearer key；请求包含 `query`、`count`、`need_content`，返回来源和正文。计费以服务商现行规则为准。 |
| [DeepSeek Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/) | 查询时关闭 thinking，正文读取 `message.content`。 |
| [CDP Runtime](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/) | `addBinding`、`bindingCalled`、`evaluate`，用于主页面和本机服务之间的通信。 |
| [Windows ActivateApplication](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-iapplicationactivationmanager-activateapplication) 与 [接口生命周期](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nn-shobjidl_core-iapplicationactivationmanager) | 商店应用按 AUMID 激活并传递启动参数；短生命周期启动器用 CLSCTX_LOCAL_SERVER。使用 AO_NONE，无需设置包调试模式。 |
| [MicrosoftEdge 启动器示例](https://github.com/MicrosoftEdge/edge-launcher/blob/master/MIcrosoftEdgeLauncherCsharp/Program.cs) | 官方 C# COM 接口调用示例。仓库已于 2021 年归档，只参考接口声明，行为以现行 Windows 文档为准。 |
| [PowerShell 引号规则](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_quoting_rules?view=powershell-5.1) | 弯引号也被视为字符串界定符，需要转义。提示文字改用角括号，并用桌面快捷方式实际调用的 Windows PowerShell 检查全部脚本。 |

## 为什么这样接入

Store 安装目录由系统管理，直接往里面放 BetterNCM DLL 不适合作为默认方案。旧版重签的经验也不能直接套到 3.1.23。

现在采用独立启动入口和本机 CDP 连接器：退出托盘客户端后，从新入口带参数启动，再给主页面加载按钮。客户端文件保持原样，运行时只依赖 Node 24 自带的 fetch 和 WebSocket。

最初直接启动商店安装目录下的 exe，遇到“拒绝访问”。已将商店版改为读取包清单中的应用 Id，以包族名和应用 Id 构成 AUMID，交给 Windows 激活管理器启动；桌面版仍走注册表中的可执行文件。没有改变 WindowsApps 权限或重签安装包。入口解析和 COM 声明已测试，实际激活及参数传递仍待客户端验证。

搜索使用 DeepSeek 官方接口，同一个密钥就能完成检索和整理，不需要另配搜索服务。每次新查询先搜索一次，再把资料交给模型。搜索出错就报错，不自动退回模型记忆；关闭联网需要在设置里明确选择。

网页材料只作为参考数据，页面渲染不接受 HTML。引用来自搜索返回的 HTTP/HTTPS 地址。

## 3.1.23 的页面和状态

- `orpheus.ntpk` 偏移 100 后为 ZIP。主页面是 `orpheus://orpheus/pub/app.html`。
- webpack4 全局为 `window.webpackJsonp`。DVA 工具在 module 12，`.a.getStore()` 返回状态。运行时按模块特征查找，不固定使用这个编号。
- 歌曲优先读取 `playing.curTrack` 或 `playing.curPlaying.track`，回退到 `resourceTrackId`、`resourceName`、`resourceArtists`。只取当前歌曲，不读取账户、歌单或 Cookie。
- 完整播放页的 footer 与 `#page_pc_songplay` 是兄弟节点。按钮位置在 `[class*="VinylPageContainer_"] .page-footer .vinyl-page-bar-wrapper .left`，新 AB 布局则用 `.red-star-comment-wrapper`。
- 设置内容在 `#page_pc_setting main.right-container`。读取歌曲失败时，可从播放页标题、歌手和专辑的 `title` 属性回退。
- React 重建页面后会重新挂载入口。按钮阻止鼠标事件冒泡，避免顺带触发底栏展开。样式放在 Shadow DOM 内。

密钥用 Windows DPAPI CurrentUser 加密，不写进配置、日志或命令行。结果缓存 7 天，最多保留 100 首，可以手动清除。

## 验证到哪了

已检查安装版本、资源包结构、状态字段和页面容器。26 项测试通过，包括服务请求、CDP 桥、DPAPI 持久化、商店应用入口解析和 COM 接口编译、全部 PowerShell 脚本的语法检查、实际启动脚本的预检查，以及独立浏览器里的首次设置、结果展示和设置入口。

修复过一处启动前解析失败：错误提示中未转义的弯引号让脚本在执行前退出，隐藏窗口没有留下提示。当前提示文字已修正；启动器增加阶段日志和不激活客户端的 `-CheckOnly` 检查，相关回归检查使用 Windows PowerShell 5.1。

还没有验证真实客户端是否接受调试启动参数、按钮在 CEF 里的挂载和布局，也没有发出真实 DeepSeek 请求。浏览器里的离线测试不能代替这几项，因此目前按实验版本处理。

## 需要留意的地方

- 关掉窗口可能只是最小化到托盘。原进程没退出，新启动参数通常不会生效；启动器会提示手动退出。
- 客户端更新可能改变模块和 DOM。无法识别歌曲时允许手动填写，不从搜索列表里猜一首。
- 第三方中转可能只支持聊天，没有 `/v1/tools/search`。这种情况下会显示搜索失败，可以更换接口，或主动关闭联网。
- 连接测试只请求 `/models`，不能证明余额充足、搜索可用或推理一定成功。
- CDP 有页面操作权限，只连接 `127.0.0.1`，不开放公网访问，也不放宽来源检查。
- `research-local/` 只用于本地检查原版资源，已排除出 Git 和分发包。
