# 嘉立创文件转换

JLCFConv 是用于嘉立创 PCB 3D 离线 HTML 的浏览器转换工具。作者为 NianBroken，项目地址为 https://github.com/NianBroken/JLCFConv。

上传 HTML，设置静态 LOGO 和网站标题，点击“转换并下载”。单份结果自动下载 HTML，多份结果自动下载 ZIP。ZIP 内每份 HTML 的名称都是 `中山勤奋光电` 与原始文件名直接连接。同名输入保存在独立编号子目录中。

## 功能

- 默认 LOGO 为 `中山勤奋光电PCB模型预览`，支持自定义文字、PNG、JPEG、WebP、GIF、SVG 和 ICO 等媒体输入。图片以静态 PNG 内嵌，不带原编辑器导航事件。
- 网站标题默认使用各自原始文件名，包含扩展名，也可统一填写文字。
- 网页优化默认开启，删除指定头部和导航，处理相关事件与样式，修改参数标签、SVG 提示，并重排窄屏头部。
- 交互优化默认开启，使用 Pointer Events 支持侧栏展开、收起和拖动。按钮至少 44 × 44 像素，拖动区域至少 24 像素。
- WASM、字体和线程辅助代码保存在输出内部。下载结果支持断网直接打开。HTTPS 预览采用独立端口和跨源隔离，浏览器允许时使用 Rust 多线程。Rust 线程预算按设备能力计算，上限为 4。
- 输入副本与结果分离，原始设备文件不会被覆盖。每份输出都核对 PCB、BOM 和模型数据脚本的 SHA-256。
- 支持单文件失败报告、部分成功、取消任务、上传重试、结果重新下载、会话隔离和过期清理。

## 运行

Windows 11 x64 使用设备级 Node.js LTS。当前设备级运行时位于 `%ProgramFiles%\JLCFConv\node\node.exe`。系统 PATH 已注册该目录。

```powershell
npm ci
npm run build
npm start
```

服务启动后将真实地址、端口和进程信息写入 `.runtime/service.json`。工具优先使用 HTTPS 3443，预览优先使用 HTTPS 3444，占用时选择空闲端口。

证书配置需要管理员 PowerShell。

```powershell
npm run setup:https
npm run service:install
npm run service:status
```

`service:install` 注册 Windows 后台计划任务，开机启动，并在服务退出后重启。任务仅为设备级 Node 可执行文件开放局域网入站连接。`service:stop` 停止后台任务与项目进程。

```powershell
npm run service:stop
```

HTTPS 根证书公开部分保存在 `%ProgramData%\JLCFConv\tls\root-ca.cer`。本机已安装信任。其他局域网设备需要安装并信任此公开根证书，再访问实际 HTTPS 地址。私钥保存在同目录，访问权限限定为管理员、SYSTEM 和配置时的运行用户，不进入 Git。

开发命令 `npm run dev` 构建项目后启动相同的 HTTPS 系统。界面源代码在 `src/client`，转换逻辑在 `src/core`，结果页面适配在 `src/preview`，服务端在 `src/server`，共享配置在 `src/shared`。

## 转换范围与适配

适配器依据真实样本中的 React 组件属性、CSS 模块语义键、显示标签和事件结构识别目标，不依赖打包变量名或 class 散列后缀。parse5 提供原始位置，MagicString 仅修改对应区间，Babel 处理动态界面脚本，PostCSS 校验适配样式。

支持当前六份真实样本使用的引擎 `4.1.33.9acde59c` 和界面 `1.0.353.4cd90317`。未匹配必要结构时，该文件明确失败，其他文件继续处理。未准备的新 WASM 版本不会生成依赖在线资源的假成功输出。

离线资源来源、大小与摘要记录在 `assets/vendor/manifest.json`。准备另一版本资源时，显式指定其真实样本。

```powershell
npm run resources -- "C:\样本位置\模型.html"
```

转换服务正常运行时不读取用户样本目录。只有明确执行样本测试或设置 `JLCF_BASELINE_DIR` 的测试服务会读取指定目录。生产后台任务不设置该变量。

## 配置

环境变量均为可选项。容量和时间值使用正整数。

| 环境变量 | 默认值与作用 |
| --- | --- |
| `PORT` | 工具端口 3443 |
| `PREVIEW_PORT` | 预览端口 3444 |
| `JLCF_TLS_DIR` | `%ProgramData%\JLCFConv\tls` |
| `JLCF_DATA_DIR` | 项目 `.runtime/data` |
| `JLCF_WORKERS` | 按 CPU 和可用内存计算，默认上限 4 |
| `JLCF_MAX_FILE_BYTES` | 单份 134217728 字节 |
| `JLCF_MAX_BATCH_BYTES` | 每批 1073741824 字节 |
| `JLCF_MAX_FILES` | 每批 32 份 |
| `JLCF_MAX_LOGO_BYTES` | LOGO 8388608 字节 |
| `JLCF_MAX_LOGO_PIXELS` | 静态 LOGO 最长边 4096 像素 |
| `JLCF_RETENTION_MS` | 结果保留 3600000 毫秒 |
| `JLCF_TIMEOUT_MS` | 单份转换超时 300000 毫秒 |

前端通过 `/api/capabilities` 读取有效限制。活动转换与下载不会被过期清理器移除。服务重启后的无引用副本也按照保留期限清理。

## 测试

```powershell
npm test
npm run format:check
npm run build
```

真实浏览器测试使用本机 Chrome，无证书跳过选项。Node 接口测试信任本项目根证书。

```powershell
$env:NODE_EXTRA_CA_CERTS = "$env:ProgramData\JLCFConv\tls\root-ca.pem"
$env:JLCF_TEST_SAMPLES = "C:\Users\Administrator\Desktop\HTML测试样本"
npm run test:e2e
npx tsx tests/configurations.ts
npx tsx tests/edge-flows.ts
npx tsx tests/offline-all.ts
npx tsx tests/engine-modes.ts
npx tsx tests/upload-boundaries.ts
```

`tests/touch.ts` 和 `tests/panels.ts` 使用 `JLCF_TEST_JOB` 指定真实转换任务，使用 `JLCF_TEST_INDEX` 指定其文件下标。前者覆盖 320、390、768、1024、1440 像素，后者检查左右侧栏、手机底栏、取消拖动、参数详情和屏幕旋转。

测试输出在 `test-results`，包括实际下载的 HTML、ZIP、截图和 JSON 报告。原样基线保留原始错误；转换结果保留正常运算诊断，不覆盖或屏蔽 console。最终核验记录见 `docs/验收报告.md`。
