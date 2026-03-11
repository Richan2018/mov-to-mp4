# MOV 压缩为 MP4

把 MOV 拖进窗口，点击「开始压缩」，输出 MP4 会保存在该 MOV 所在文件夹，文件名相同、扩展名为 `.mp4`。

## 依赖

- 已安装 **ffmpeg**（若未安装：`brew install ffmpeg`）
- Node.js（用于安装与运行）
- **Mac 封面零色差**：需安装 Xcode 命令行工具（`xcode-select --install`），本机会用系统 AVFoundation 提取首帧，与「照片」中视频首帧显示一致。

## 使用

```bash
cd mov-compress-app
npm install
npm start
```

拖放 MOV 到灰色区域，或点击该区域用对话框选择文件，然后点击「开始压缩」。完成后可点「在 Finder 中显示」打开输出文件所在位置。

## 打包为 Mac 应用（可选）

```bash
npm run build
```

会在 `dist` 目录生成 `.dmg`，安装后即可像普通应用一样使用。
