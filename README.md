# MOV 压缩为 MP4

把 MOV 拖进窗口，点击「开始压缩」，输出 MP4 会保存在该 MOV 所在文件夹，文件名相同、扩展名为 `.mp4`。

---

## 一、环境要求

- **Node.js**：建议 18 或以上（[官网下载](https://nodejs.org/) 或 `brew install node`）
- **ffmpeg**：未安装请执行 `brew install ffmpeg`
- **系统**：macOS（本应用为 Mac 桌面应用）
- **Mac 封面零色差**：需安装 Xcode 命令行工具（终端执行 `xcode-select --install`），本机会用系统 AVFoundation 提取首帧，与「照片」中视频首帧显示一致。

---

## 二、下载项目

```bash
git clone https://github.com/Richan2018/mov-to-mp4.git
cd mov-to-mp4
```

或从 GitHub 页面点 **Code → Download ZIP**，解压后进入该文件夹，在终端里执行后续命令时把 `mov-to-mp4` 换成你解压出的文件夹名即可。

---

## 三、安装依赖

在项目目录下执行：

```bash
npm install
```

等待安装完成（首次可能稍久，会下载 Electron 等）。

---

## 四、运行应用（开发模式）

```bash
npm start
```

会打开应用窗口。拖放 MOV 到灰色区域，或点击该区域用对话框选择文件，然后点击「开始压缩」。完成后可点「在 Finder 中显示」打开输出文件所在位置。

---

## 五、打包成 Mac 安装包

在项目目录下执行：

```bash
npm run build
```

- 默认会为**当前 Mac 架构**打包（M 系列芯片为 arm64，Intel 为 x64）。
- 打包结果在 **`dist`** 目录：
  - **M 系列芯片**：`dist/MOV 压缩-1.0.0-arm64-mac_M系列芯片.zip`
  - **Intel 芯片**：`dist/MOV 压缩-1.0.0-mac_Inter芯片.zip`
  - 解压后把「MOV 压缩.app」拖到「应用程序」即可使用。

### 只打 Intel 版（在 M 芯片 Mac 上）

```bash
npm run build:intel
```

### 只打 DMG 安装镜像

```bash
npm run build:dmg
```

---

## 常见问题

- **提示找不到 ffmpeg**：先安装 `brew install ffmpeg`，再重新运行或重新打包。
- **打包很慢**：首次会下载 Electron 等，属正常现象。
- **封面和「照片」里不一致**：安装 Xcode 命令行工具：`xcode-select --install`。
