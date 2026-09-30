# onlineMusic

一个本地优先的音乐工作台：把音频、视频和图片收进自己的媒体库，读内嵌标签与封面，在浏览器里试听、看波形、改元数据。界面是一整套自绘的毛玻璃（backdrop-filter + 边缘折射 + 随背景自适应的墨色），不依赖任何外部服务。

![onlineMusic 界面](docs/screenshot.jpg)

## 功能

- **本地账号** — 邮箱 + 密码注册登录，`scrypt` 加盐哈希，会话写入 HttpOnly Cookie，一年有效。全部数据留在自己的磁盘上。
- **媒体入库** — 音频 `wav / mp3 / flac / aiff / m4a / ogg`，视频 `mp4 / mov / webm`，图片 `png / jpg / jpeg / webp`，单个账号上限 10000 个资源。
- **自动读取标签** — 导入时在浏览器端解析内嵌的标题、艺术家、专辑与封面图。
- **波形与播放控制** — 波形图拖动定位，增益与播放速率可调，随机 / 上一首 / 下一首 / 循环，播放器支持全屏 Now Playing 视图。
- **元数据编辑** — 标题、艺术家、专辑、流派、歌词、描述与标签。
- **媒体库视图** — 按专辑聚合，索引以 NDJSON 逐行推送，封面单独按需拉取，大库也能立刻看到第一行。
- **响应式** — 桌面为侧栏 + 工作台，窄屏切换为底部胶囊导航与全屏歌词。

## 技术栈

| | |
|---|---|
| 框架 | Next.js 14（App Router，standalone 输出） |
| 语言 | TypeScript |
| UI | React 18 + 手写 CSS（`app/globals.css`），图标用 lucide-react |
| 标签解析 | music-metadata |
| 存储 | 文件系统上的 JSON 索引 + 媒体目录 |
| 部署 | Docker / docker-compose，命名卷 `music_data` |

## 快速开始

```bash
npm install
npm run dev            # http://localhost:3000
```

生产环境用 Docker：

```bash
./build.sh             # docker-compose build && docker-compose up -d
```

## 数据存放

所有状态都在 `AUTH_DATA_DIR` 指向的目录里（默认 `./data`）：

```
data/
├── accounts.json      # 账号、密码哈希、会话
├── assets.json        # 媒体索引与元数据
└── media/             # 上传的原始文件，按 uuid 命名
```

Docker 部署时该目录是指名卷 `music_data`，容器重建不会丢数据。

## 目录结构

```
app/
├── page.tsx           # 工作台主体：库、编辑器、播放器状态
├── settings-view.tsx  # 设置面板
├── bottom-pill.tsx    # 窄屏底部导航
├── globals.css        # 毛玻璃主题与全部样式
└── api/
    ├── auth/          # 注册 / 登录 / 登出 / 当前会话
    └── assets/        # 列表（含 NDJSON 流式索引）、上传、详情、封面、原始文件
lib/
├── accounts.ts        # 账号与会话存储
├── assets.ts          # 媒体索引存储
├── asset-validation.ts# 入参校验
├── embedded-tags.ts   # 内嵌标签与封面解析
├── glassEdge.ts       # 玻璃边缘折射（SVG 位移滤镜）
├── glassWebgl.ts      # 玻璃的 WebGL 版本
└── inkSampler.ts      # 采样背景，推导文字墨色
```
