const { app, BrowserWindow, ipcMain, shell, dialog, screen } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
let ffmpegStatic = null;
let ffprobeStatic = null;
try { ffmpegStatic = require('ffmpeg-static'); } catch (_) { ffmpegStatic = null; }
try { ffprobeStatic = require('ffprobe-static'); } catch (_) { ffprobeStatic = null; }

function logDebug(...parts) {
  try {
    const dir = app.getPath('userData');
    const logPath = path.join(dir, 'debug.log');
    const line = `[${new Date().toISOString()}] ${parts.join(' ')}\n`;
    fs.appendFileSync(logPath, line);
  } catch (_) {
    // 忽略日志错误，避免影响主流程
  }
}
let sharp;
try {
  if (app.isPackaged) {
    // Electron + asar 场景下，避免从 asar 虚拟路径加载 native module 导致依赖库查找跑偏到临时目录
    const sharpPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'sharp');
    sharp = require(sharpPath);
    try { logDebug('sharp require packaged path ok:', sharpPath); } catch (_) {}
  } else {
    sharp = require('sharp');
  }
  try {
    logDebug('sharp loaded ok');
  } catch (_) {}
} catch (e) {
  sharp = null;
  try {
    logDebug('sharp require failed:', e && e.message ? e.message : String(e));
  } catch (_) {
    // ignore
  }
}

let mainWindow;
const DEFAULT_CONTENT_WIDTH = 520;
const DEFAULT_CONTENT_HEIGHT = 620;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: DEFAULT_CONTENT_WIDTH,
    height: DEFAULT_CONTENT_HEIGHT,
    minWidth: 420,
    minHeight: 380,
    useContentSize: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    title: 'MOV 压缩为 MP4',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1a1b1e',
    show: false,
  });

  mainWindow.loadFile('index.html');
  mainWindow.once('ready-to-show', () => mainWindow.show());
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

// 让窗口内容高度随 UI 变化自动增大（避免底部按钮被切割）
ipcMain.on('resize-to-content', (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;
  const desired = Math.round(payload && payload.height ? Number(payload.height) : 0);
  if (!desired || !isFinite(desired) || desired <= 0) return;

  const display = screen.getDisplayMatching(win.getBounds());
  const workArea = display && display.workArea ? display.workArea : null;
  const maxContentHeight = workArea ? Math.max(360, workArea.height - 60) : 1200;
  const targetContentHeight = clamp(desired, 360, maxContentHeight);

  const [contentW, contentH] = win.getContentSize();
  if (targetContentHeight <= contentH + 4) return; // 只自动“增高”，避免缩小导致抖动

  const [winW, winH] = win.getSize();
  const frameDeltaH = Math.max(0, winH - contentH);
  const newWinHeight = targetContentHeight + frameDeltaH;

  const bounds = win.getBounds();
  if (workArea) {
    const bottom = bounds.y + newWinHeight;
    const maxBottom = workArea.y + workArea.height;
    const newY = bottom > maxBottom ? clamp(maxBottom - newWinHeight, workArea.y, bounds.y) : bounds.y;
    win.setBounds({ x: bounds.x, y: newY, width: bounds.width, height: newWinHeight }, true);
  } else {
    win.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: newWinHeight }, true);
  }
});

// 在没有内容或任务结束后，恢复到默认窗口大小
ipcMain.on('reset-window-size', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;
  win.setContentSize(DEFAULT_CONTENT_WIDTH, DEFAULT_CONTENT_HEIGHT);
});

function getFfmpegPath() {
  if (ffmpegStatic && typeof ffmpegStatic === 'string') {
    let p = ffmpegStatic;
    // 打包后路径可能在 app.asar 中，需指向解包目录
    if (p.includes('app.asar')) {
      p = p.replace('app.asar', 'app.asar.unpacked');
    }
    if (fs.existsSync(p)) {
      logDebug('ffmpeg path (static):', p);
      return p;
    }
  }
  logDebug('ffmpeg path (fallback): ffmpeg');
  return 'ffmpeg';
}

function getFfprobePath() {
  if (ffprobeStatic && ffprobeStatic.path) {
    let p = ffprobeStatic.path;
    if (p.includes('app.asar')) {
      p = p.replace('app.asar', 'app.asar.unpacked');
    }
    if (fs.existsSync(p)) {
      logDebug('ffprobe path (static):', p);
      return p;
    }
  }
  if (process.platform === 'darwin') {
    const candidates = ['/opt/homebrew/bin/ffprobe', '/usr/local/bin/ffprobe'];
    for (const p of candidates) {
      try { if (fs.existsSync(p)) return p; } catch (_) {}
    }
  }
  logDebug('ffprobe path (fallback): ffprobe');
  return 'ffprobe';
}

// 检查 ffmpeg 是否可用（优先使用内置 ffmpeg-static）
ipcMain.handle('check-ffmpeg', async () => {
  const exe = getFfmpegPath();
  return new Promise((resolve) => {
    const proc = spawn(exe, ['-version'], { stdio: 'pipe' });
    proc.on('error', () => resolve(false));
    proc.on('close', (code) => resolve(code === 0));
  });
});

// 用 ffprobe 获取视频分辨率与帧率（CSV 单行输出，便于解析），仅用于 UI 展示「原始」信息
ipcMain.handle('get-video-info', async (_, filePath) => {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const ffprobeExe = getFfprobePath();
  const env = { ...process.env };
  if (process.platform === 'darwin') {
    env.PATH = '/opt/homebrew/bin:/usr/local/bin:' + (env.PATH || '');
  }
  return new Promise((resolve) => {
    const proc = spawn(ffprobeExe, [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,r_frame_rate',
      '-of', 'csv=p=0',
      '-i', filePath,
    ], { stdio: ['ignore', 'pipe', 'pipe'], env });
    let out = '';
    const collect = (d) => { out += d.toString(); };
    proc.stdout.on('data', collect);
    proc.stderr.on('data', collect);
    proc.on('close', (code) => {
      if (code !== 0) { resolve(null); return; }
      try {
        const line = (out || '').trim().split('\n')[0];
        if (!line) { resolve(null); return; }
        const parts = line.split(',');
        const w = parts[0] ? parseInt(parts[0], 10) : null;
        const h = parts[1] ? parseInt(parts[1], 10) : null;
        let fps = null;
        if (parts[2]) {
          const [num, den] = String(parts[2]).split('/').map(Number);
          if (!isNaN(num) && den && den > 0) fps = Math.round((num / den) * 100) / 100;
        }
        if (w && h) resolve({ width: w, height: h, fps });
        else resolve(null);
      } catch (_) {
        resolve(null);
      }
    });
    proc.on('error', () => resolve(null));
  });
});

// 更详细的 ffprobe 元数据，仅用于检测“序列帧封装 MOV”等，不参与自动调参
async function probeVideoMeta(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const ffprobeExe = getFfprobePath();
  const env = { ...process.env };
  if (process.platform === 'darwin') {
    env.PATH = '/opt/homebrew/bin:/usr/local/bin:' + (env.PATH || '');
  }
  return new Promise((resolve) => {
    const proc = spawn(ffprobeExe, [
      '-v', 'error',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      '-i', filePath,
    ], { stdio: ['ignore', 'pipe', 'pipe'], env });
    let out = '';
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.stderr.on('data', (d) => { out += d.toString(); });
    proc.on('error', () => resolve(null));
    proc.on('close', (code) => {
      if (code !== 0) { resolve(null); return; }
      try {
        const json = JSON.parse(out || '{}');
        const streams = Array.isArray(json.streams) ? json.streams : [];
        const format = json.format || {};
        const v0 = streams.find((s) => s && s.codec_type === 'video') || null;
        const a0 = streams.find((s) => s && s.codec_type === 'audio') || null;
        const width = v0 && v0.width ? Number(v0.width) : null;
        const height = v0 && v0.height ? Number(v0.height) : null;
        const vCodec = v0 && v0.codec_name ? String(v0.codec_name) : null;
        const pixFmt = v0 && v0.pix_fmt ? String(v0.pix_fmt) : null;
        const bitRate = format && format.bit_rate ? Number(format.bit_rate) : null;
        const vStreamBitRate = v0 && v0.bit_rate ? Number(v0.bit_rate) : null;
        const hasAudio = !!a0;
        resolve({
          width: isFinite(width) ? width : null,
          height: isFinite(height) ? height : null,
          vCodec,
          pixFmt,
          bitRate: isFinite(bitRate) ? bitRate : null,
          vStreamBitRate: isFinite(vStreamBitRate) ? vStreamBitRate : null,
          hasAudio,
        });
      } catch (_) {
        resolve(null);
      }
    });
  });
}

function isSequenceLikeMeta(meta) {
  if (!meta) return false;
  const c = (meta.vCodec || '').toLowerCase();
  const seqCodecs = new Set(['prores', 'apcn', 'apch', 'ap4h', 'png', 'mjpeg', 'jpeg', 'tiff', 'bmp', 'qtrle', 'rawvideo', 'rle']);
  if (seqCodecs.has(c)) return true;
  const br = meta.vStreamBitRate || meta.bitRate || null;
  if (br && br > 200_000_000 && meta.hasAudio === false) return true;
  return false;
}

// 检查是否“像序列帧封装 MOV”，给前端一个推荐建议用
ipcMain.handle('check-sequence-like', async (_, filePath) => {
  const meta = await probeVideoMeta(filePath);
  if (!meta) return { sequenceLike: false };
  return {
    sequenceLike: isSequenceLikeMeta(meta),
    vCodec: meta.vCodec || null,
    pixFmt: meta.pixFmt || null,
    bitRate: meta.bitRate || null,
  };
});

// 根据用户显式选择构建 ffmpeg 参数（不做自动画质/分辨率策略）
function buildFfmpegArgs(inputPath, outputPath, options) {
  const {
    codec = 'h265',
    resolution = 'original',
    fps = 'original',
    mute = false,
    sequenceOptimized = false,
    sequenceCrf = null,
    customResolution = null,
  } = options || {};
  const isH265 = codec === 'h265';

  const args = ['-i', inputPath];

  // 视频滤镜：分辨率 + 像素格式 + 适度锐化
  const vfParts = [];
  if (resolution === 'custom' && customResolution) {
    const cw = Number.isFinite(customResolution.width) ? customResolution.width : null;
    const ch = Number.isFinite(customResolution.height) ? customResolution.height : null;
    const keepAspect = !!customResolution.keepAspect;
    if (keepAspect) {
      if (cw && !ch) {
        vfParts.push(`scale=${cw}:-2`);
      } else if (!cw && ch) {
        vfParts.push(`scale=-2:${ch}`);
      } else if (cw && ch) {
        // 同时给了宽高，优先用宽，避免拉伸
        vfParts.push(`scale=${cw}:-2`);
      }
    } else if (cw && ch) {
      vfParts.push(`scale=${cw}:${ch}`);
    }
  } else if (resolution !== 'original') {
    vfParts.push(`scale=${resolution}`);
  }
  vfParts.push(isH265 ? 'format=yuv420p10le' : 'format=yuv420p');
  vfParts.push('unsharp=3:3:0.8:3:3:0.4');
  args.push('-vf', vfParts.join(','));

  if (fps !== 'original') {
    args.push('-r', String(fps));
  }

  if (isH265) {
    args.push('-c:v', 'libx265', '-pix_fmt', 'yuv420p10le');
    const chosenCrf = sequenceOptimized
      ? clamp(Number.isFinite(sequenceCrf) ? sequenceCrf : 23, 18, 30)
      : 22;
    const baseParams = sequenceOptimized
      ? `crf=${chosenCrf}:preset=slow:level-idc=60:aq-mode=3:aq-strength=0.8:psy-rd=2.0:psy-rdoq=1.2:rdoq-level=2:merange=64:bframes=10:ref=5:deblock=1,1:no-sao=1:rect=1:limit-tu=4:tu-intra-depth=4:tu-inter-depth=4:colorprim=bt709:transfer=bt709:colormatrix=bt709`
      : 'crf=22:preset=slow:colorprim=bt709:transfer=bt709:colormatrix=bt709:aq-mode=3:psy-rd=2.0:psy-rdoq=1.0:no-sao=1';
    args.push('-x265-params', baseParams);
    if (sequenceOptimized) {
      args.push('-profile:v', 'main10');
      args.push('-level:v', '6.0');
      args.push('-b:v', '0', '-maxrate', '25M', '-bufsize', '50M');
    }
    args.push('-tag:v', 'hvc1');
  } else {
    args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p');
    args.push('-preset', 'slow', '-crf', '22');
    args.push('-x264-params', 'colorprim=bt709:transfer=bt709:colormatrix=bt709');
    if (sequenceOptimized) {
      args.push('-tune', 'stillimage');
    }
  }

  args.push('-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709');
  args.push('-movflags', '+faststart');

  if (mute) {
    args.push('-an');
  } else {
    args.push('-c:a', 'aac', '-b:a', '128k');
  }

  args.push('-y', outputPath);
  return args;
}

// 系统 sRGB 描述文件路径（Mac 图库/照片按此解释未标图片）
const SRGB_PROFILE = '/System/Library/ColorSync/Profiles/sRGB Profile.icc';

// 用 sips 为 PNG 嵌入 sRGB 描述文件，导入图库后与视频首帧显示一致
function embedSrgbProfile(imagePath) {
  if (!fs.existsSync(imagePath) || process.platform !== 'darwin') return Promise.resolve();
  if (!fs.existsSync(SRGB_PROFILE)) return Promise.resolve();
  return new Promise((resolve) => {
    const proc = spawn('sips', ['--embedProfile', SRGB_PROFILE, imagePath], { stdio: 'pipe' });
    proc.on('close', () => resolve());
    proc.on('error', () => resolve());
  });
}

function convertPngToWebpLosslessWithFfmpeg(pngPath, webpPath) {
  if (!fs.existsSync(pngPath)) return Promise.resolve(false);
  return new Promise((resolve) => {
    const ff = getFfmpegPath();
    // 使用 libwebp lossless，尽量保持质量；yuv444p 保留色度细节
    const args = [
      '-y',
      '-i', pngPath,
      '-frames:v', '1',
      '-c:v', 'libwebp',
      '-lossless', '1',
      '-pix_fmt', 'yuv444p',
      webpPath,
    ];
    const proc = spawn(ff, args, { stdio: 'pipe' });
    let err = '';
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(webpPath)) resolve(true);
      else {
        logDebug('webp ffmpeg fallback failed code=', String(code), 'errTail=', err.slice(-300));
        resolve(false);
      }
    });
    proc.on('error', (e) => {
      logDebug('webp ffmpeg fallback spawn error:', e && e.message ? e.message : String(e));
      resolve(false);
    });
  });
}

// 无损压缩 PNG（不改变像素，保留 ICC），大幅减小体积
function compressPngLossless(imagePath) {
  if (!sharp || !fs.existsSync(imagePath)) return Promise.resolve();
  const tmpPath = imagePath + '.tmp.png';
  return sharp(imagePath)
    .png({ compressionLevel: 9 })
    .toFile(tmpPath)
    .then(() => {
      fs.renameSync(tmpPath, imagePath);
    })
    .catch(() => {
      try { fs.unlinkSync(tmpPath); } catch (_) {}
    });
}

const COVER_MAX_BYTES = 2 * 1024 * 1024; // 2MB，兼顾清晰度与体积

// 将 PNG 无损缩小到 maxBytes 以内（仅缩小尺寸，不改变色彩，零色差）
function convertPngUnderMaxBytes(pngPath, outputPath, maxBytes) {
  if (!sharp || !fs.existsSync(pngPath)) return Promise.resolve();
  const tmpPath = outputPath + '.tmp.png';
  async function tryNext() {
    let buf = await sharp(pngPath).png({ compressionLevel: 9 }).toBuffer();
    if (buf.length <= maxBytes) {
      await fs.promises.writeFile(tmpPath, buf);
      return;
    }
    const maxPixels = [2560, 1920, 1600, 1280, 960, 800];
    for (const maxDim of maxPixels) {
      buf = await sharp(pngPath)
        .resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true })
        .png({ compressionLevel: 9 })
        .toBuffer();
      if (buf.length <= maxBytes) {
        await fs.promises.writeFile(tmpPath, buf);
        return;
      }
    }
    buf = await sharp(pngPath)
      .resize(640, 640, { fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer();
    await fs.promises.writeFile(tmpPath, buf);
  }
  return tryNext()
    .then(() => {
      fs.renameSync(tmpPath, outputPath);
    })
    .catch((err) => {
      try { fs.unlinkSync(tmpPath); } catch (_) {}
      throw err;
    });
}

// 将 PNG 转为 JPEG，尽量控制在 maxBytes 以内；始终保持原始分辨率，只通过质量控制体积
function convertToJpegUnderMaxBytes(pngPath, jpegPath, maxBytes) {
  if (!sharp || !fs.existsSync(pngPath)) return Promise.resolve();
  // maxBytes 为 Infinity 时表示“极高质量 JPG（不限制体积）”：直接用最高质量输出
  if (!Number.isFinite(maxBytes)) {
    return sharp(pngPath)
      .jpeg({
        quality: 100,
        mozjpeg: true,
        chromaSubsampling: '4:4:4',
        trellisQuantisation: true,
        overshootDeringing: true,
        optimiseScans: true,
        quantisationTable: 3,
      })
      .toFile(jpegPath)
      .then(() => {});
  }
  const highQualityMode = maxBytes > COVER_MAX_BYTES;
  // 先用“极高质量”编码一遍，看是否已满足体积要求；不足再逐级降低质量
  const qualities = highQualityMode
    ? [100, 99, 98, 97, 96, 95, 94, 93, 92, 91, 90, 89, 88, 87, 86, 85, 84, 83, 82]
    : [100, 98, 96, 94, 92, 90, 88, 86, 84, 82, 80, 78];
  const jpegOpts = (quality) => ({
    quality,
    mozjpeg: true,
    chromaSubsampling: '4:4:4',
    trellisQuantisation: true,
    overshootDeringing: true,
    optimiseScans: true,
    quantisationTable: 3,
  });
  async function tryNext() {
    let lastBuf = null;
    for (const q of qualities) {
      const buf = await sharp(pngPath)
        .jpeg(jpegOpts(q))
        .toBuffer();
      lastBuf = buf;
      if (buf.length <= maxBytes) {
        await fs.promises.writeFile(jpegPath, buf);
        return;
      }
    }
    // 如果所有质量都仍然超出上限，则使用最后一次编码结果（最低质量），仍保持原分辨率
    if (lastBuf) {
      await fs.promises.writeFile(jpegPath, lastBuf);
    }
  }
  return tryNext();
}

// 用系统 AVFoundation 提取首帧（与「照片」/QuickTime 同一条解码与色彩管线），实现零色差
function extractFirstFrameNative(mp4Path, imagePath) {
  let helperPath;
  if (app.isPackaged) {
    const name = process.arch === 'x64' ? 'extract_frame_helper_x64' : 'extract_frame_helper';
    helperPath = path.join(process.resourcesPath, name);
  } else {
    const name = process.arch === 'x64' ? 'extract_frame_helper_x64' : 'extract_frame_helper';
    helperPath = path.join(__dirname, name);
  }
  if (!fs.existsSync(helperPath)) {
    logDebug('extractFirstFrameNative helper missing at', helperPath);
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    logDebug('extractFirstFrameNative using helper', helperPath, 'mp4Path:', mp4Path, 'imagePath:', imagePath);
    const proc = spawn(helperPath, [mp4Path, imagePath], { stdio: 'pipe' });
    proc.stderr.on('data', (d) => {
      logDebug('extractFirstFrameNative stderr:', String(d).trim());
    });
    proc.on('close', (code) => {
      logDebug('extractFirstFrameNative exit code:', String(code));
      resolve(code === 0);
    });
    proc.on('error', (e) => {
      logDebug('extractFirstFrameNative spawn error:', e && e.message ? e.message : String(e));
      resolve(false);
    });
  });
}

// 从已编码的 MP4 提取首帧；返回 { ok, coverPath }，coverPath 为最终封面路径（可能 .jpg / .png / .webp）
// options.coverFormat === 'png_only' 时仅输出 PNG，不转为 WebP
// 优先用系统 AVFoundation（零色差），不可用时回退 ffmpeg + sips
function extractFirstFrame(mp4Path, imagePath, options) {
  const outIsJpeg = /\.jpe?g$/i.test(imagePath);
  const outIsPng = /\.png$/i.test(imagePath);
  const pngOnlyNoWebP = (options && options.coverFormat) === 'png_only';
  const tempPng = outIsJpeg || outIsPng
    ? path.join(path.dirname(imagePath), '.cover_temp.png')
    : imagePath;
  const extractTo = outIsJpeg || outIsPng ? tempPng : imagePath;
  const dir = path.dirname(imagePath);
  const base = path.basename(imagePath, path.extname(imagePath)).replace(/_cover$/, '');

  const tryExtract = (args) =>
    new Promise((resolve) => {
      const ff = getFfmpegPath();
      logDebug('extractFirstFrame ffmpeg:', ff, 'mp4Path:', mp4Path, 'imagePath:', imagePath);
      const proc = spawn(ff, args, { stdio: 'pipe' });
      proc.stderr.on('data', (d) => {
        logDebug('extractFirstFrame stderr:', String(d).trim());
      });
      proc.on('close', (code) => resolve(code === 0));
      proc.on('error', () => resolve(false));
    });

  function finishPng(pngPath) {
    // 减轻摩尔纹只作用于 JPG，PNG/WebP 始终保持与视频首帧同样的锐利度
    const applyReduceMoire = (options && options.reduceMoire) && sharp && outIsJpeg;
    const afterMoire = applyReduceMoire
      ? sharp(pngPath)
          .blur(1.5)
          .toFile(pngPath + '.tmp')
          .then(() => {
            fs.renameSync(pngPath + '.tmp', pngPath);
          })
          .catch(() => {
            try { fs.unlinkSync(pngPath + '.tmp'); } catch (_) {}
          })
      : Promise.resolve();
    return afterMoire.then(() => embedSrgbProfile(pngPath)).then(() => {
      if (outIsJpeg) {
        // 1) 优先用 sharp + mozjpeg 控制在 2MB 内；若开启减摩尔则放宽至 4MB；若选择“极高质量 JPG（不限制体积）”则完全不设上限
        if (sharp) {
          let maxBytes = COVER_MAX_BYTES;
          if (options && options.coverFormat === 'jpg_unlimited') {
            maxBytes = Infinity;
          } else if (options && options.reduceMoire) {
            maxBytes = 4 * 1024 * 1024;
          }
          return convertToJpegUnderMaxBytes(pngPath, imagePath, maxBytes)
            .then(() => { try { fs.unlinkSync(pngPath); } catch (_) {} })
            .then(() => fs.promises.stat(imagePath).then((st) => ({ ok: true, coverPath: imagePath, coverSize: st.size })));
        }
        // 2) 若 sharp 在打包环境中不可用，则退回 ffmpeg 将 PNG 转为 JPEG
        return new Promise((resolve) => {
          const ff = getFfmpegPath();
          const tmpJpg = imagePath + '.tmp.jpg';
          logDebug('jpeg fallback ffmpeg:', ff, 'pngPath:', pngPath, 'imagePath:', imagePath);
          const args = ['-y', '-i', pngPath, '-frames:v', '1', '-qscale:v', '2', tmpJpg];
          const proc = spawn(ff, args, { stdio: 'pipe' });
          let err = '';
          proc.stderr.on('data', (d) => { err += d.toString(); });
          proc.on('close', (code) => {
            if (code === 0 && fs.existsSync(tmpJpg)) {
              try { fs.renameSync(tmpJpg, imagePath); } catch (_) { fs.copyFileSync(tmpJpg, imagePath); fs.unlinkSync(tmpJpg); }
              try { fs.unlinkSync(pngPath); } catch (_) {}
              resolve({ ok: true, coverPath: imagePath });
            } else {
              logDebug('jpeg fallback failed code=', String(code), 'errTail=', err.slice(-300));
              // 失败时退回 PNG 作为封面，至少保证有图
              resolve({ ok: true, coverPath: pngPath });
            }
          });
          proc.on('error', (e) => {
            logDebug('jpeg fallback spawn error:', e && e.message ? e.message : String(e));
            resolve({ ok: true, coverPath: pngPath });
          });
        });
      }
      if (outIsPng) {
        return compressPngLossless(pngPath).then(() =>
          fs.promises.stat(pngPath).then((st) => {
            const pngOut = path.join(dir, `${base}_cover.png`);
            const webpOut = path.join(dir, `${base}_cover.webp`);
            if (st.size <= COVER_MAX_BYTES || pngOnlyNoWebP) {
              try { fs.renameSync(pngPath, pngOut); } catch (_) { fs.copyFileSync(pngPath, pngOut); fs.unlinkSync(pngPath); }
              return { ok: true, coverPath: pngOut };
            }
            if (!sharp) {
              // sharp 不可用：尝试用 ffmpeg 转无损 WebP；失败则回退 PNG
              return convertPngToWebpLosslessWithFfmpeg(pngPath, webpOut).then((okWebp) => {
                if (okWebp) {
                  try { fs.unlinkSync(pngPath); } catch (_) {}
                  return { ok: true, coverPath: webpOut };
                }
                try { fs.renameSync(pngPath, pngOut); } catch (_) { fs.copyFileSync(pngPath, pngOut); fs.unlinkSync(pngPath); }
                return { ok: true, coverPath: pngOut };
              });
            }
            return sharp(pngPath)
              .webp({ lossless: true })
              .toFile(webpOut)
              .then(() => {
                try { fs.unlinkSync(pngPath); } catch (_) {}
                return { ok: true, coverPath: webpOut };
              })
              .catch(() => {
                // WebP 转换失败时，尝试用 ffmpeg 转无损 WebP；再失败就回退 PNG
                return convertPngToWebpLosslessWithFfmpeg(pngPath, webpOut).then((okWebp) => {
                  if (okWebp) {
                    try { fs.unlinkSync(pngPath); } catch (_) {}
                    return { ok: true, coverPath: webpOut };
                  }
                  try { fs.renameSync(pngPath, pngOut); } catch (_) { try { fs.copyFileSync(pngPath, pngOut); fs.unlinkSync(pngPath); } catch (_) {} }
                  return { ok: true, coverPath: pngOut };
                });
              });
          })
        );
      }
      return compressPngLossless(pngPath).then(() => ({ ok: true, coverPath: imagePath }));
    });
  }

  // 1) macOS（开发或打包）：仅用内置 AVFoundation helper（extract_frame_helper）取首帧 → sRGB PNG。helper 不可用仅当：打包未把 helper 放入 extraResources、二进制架构/权限问题、或视频无法解码。
  if (process.platform === 'darwin') {
    return extractFirstFrameNative(mp4Path, extractTo).then((ok) =>
      ok ? finishPng(extractTo) : { ok: false }
    );
  }

  // 2) 非 macOS：用 ffmpeg 取首帧
  return tryExtract([
    '-i', mp4Path,
    '-vframes', '1',
    '-vf', 'scale=iw:ih:in_color_matrix=bt709:in_range=tv:out_color_matrix=bt709:out_range=pc',
    '-pix_fmt', 'rgb24',
    '-color_primaries', 'bt709', '-color_trc', 'iec61966-2-1', '-colorspace', 'bt709', '-color_range', 'pc',
    '-update', '1',
    '-f', 'image2', '-y', extractTo,
  ]).then((ok) => (ok ? finishPng(extractTo) : { ok: false }));
}

// 开始压缩：inputPath + options { codec, resolution, fps, mute, extractCover }
ipcMain.handle('compress', async (_, inputPath, options) => {
  if (!inputPath || typeof inputPath !== 'string') {
    return { ok: false, error: '请先拖入 MOV 文件' };
  }

  const dir = path.dirname(inputPath);
  const base = path.basename(inputPath, path.extname(inputPath));
  const outputPath = path.join(dir, `${base}.mp4`);

  if (!fs.existsSync(inputPath)) {
    return { ok: false, error: '找不到输入文件' };
  }
  const args = buildFfmpegArgs(inputPath, outputPath, options);
  // -progress pipe:2 让 ffmpeg 把进度写到 stderr，便于实时解析
  const progressArgs = ['-nostdin', '-progress', 'pipe:2', '-stats_period', '0.25', ...args];

  return new Promise((resolve) => {
    const ffmpeg = spawn(getFfmpegPath(), progressArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let stderrLineBuffer = '';
    let totalDurationSec = null;
    const startTime = Date.now();

    function sendProgress(pct, remainingSec) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('compress-progress', { percent: pct, remainingSec });
      }
    }

    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
      stderrLineBuffer += data.toString();
      const lines = stderrLineBuffer.split(/\r?\n/);
      stderrLineBuffer = lines.pop() || '';

      for (const line of lines) {
        if (totalDurationSec == null) {
          const dm = line.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2})\.(\d+)/);
          if (dm) {
            totalDurationSec = parseInt(dm[1], 10) * 3600 + parseInt(dm[2], 10) * 60 + parseInt(dm[3], 10) + parseInt(dm[4], 10) / 1000;
          }
        }
        const outTimeMs = line.match(/out_time_ms=(\d+)/);
        if (outTimeMs && totalDurationSec != null && totalDurationSec > 0) {
          const currentSec = parseInt(outTimeMs[1], 10) / 1e6;
          const pct = Math.min(99, Math.round((currentSec / totalDurationSec) * 100));
          const elapsed = (Date.now() - startTime) / 1000;
          const remainingSec = pct > 1 && pct < 100 ? (elapsed / pct) * (100 - pct) : null;
          sendProgress(pct, remainingSec);
        }
      }
      // 无 -progress 时用 time= 行兜底（如 pipe:2 不可用）
      if (totalDurationSec != null) {
        const timeMatch = stderr.match(/time=(\d{2}):(\d{2}):(\d{2})/g);
        if (timeMatch && timeMatch.length > 0) {
          const last = timeMatch[timeMatch.length - 1];
          const m = last.match(/time=(\d{2}):(\d{2}):(\d{2})/);
          if (m) {
            const current = parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10);
            const pct = Math.min(99, Math.round((current / totalDurationSec) * 100));
            const elapsed = (Date.now() - startTime) / 1000;
            const remainingSec = pct > 1 && pct < 100 ? (elapsed / pct) * (100 - pct) : null;
            sendProgress(pct, remainingSec);
          }
        }
      }
    });

    ffmpeg.on('close', async (code) => {
      if (code !== 0) {
        resolve({ ok: false, error: stderr.slice(-800) || `ffmpeg 退出码 ${code}` });
        return;
      }
      mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.send('compress-progress', { percent: 100, remainingSec: 0 });

      let coverPath = null;
      let coverSize = null;
      let coverError = null;
      if (options && options.extractCover && fs.existsSync(outputPath)) {
        const coverExt = (options.coverFormat === 'png' || options.coverFormat === 'png_only') ? 'png' : 'jpg';
        const requestedCover = path.join(dir, `${base}_cover.${coverExt}`);
        try {
          const result = await extractFirstFrame(outputPath, requestedCover, options);
          if (result && result.ok && result.coverPath) {
            coverPath = result.coverPath;
            coverSize = result.coverSize;
          } else if (result && !result.ok) coverError = result.error || '封面截取失败';
        } catch (e) {
          coverError = e && e.message ? e.message : String(e);
        }
      }
      resolve({ ok: true, outputPath, coverPath, coverSize, coverError });
    });

    ffmpeg.on('error', (err) => {
      resolve({ ok: false, error: err.message || '无法启动 ffmpeg' });
    });
  });
});

// 仅导出视频首帧（与压缩流程中的封面逻辑一致：AVFoundation + sRGB + sharp，零色差）
ipcMain.handle('extract-frame-only', async (_, videoPath, options) => {
  if (!videoPath || typeof videoPath !== 'string') {
    return { ok: false, error: '请先选择视频文件' };
  }
  if (!fs.existsSync(videoPath) || !fs.statSync(videoPath).isFile()) {
    return { ok: false, error: '找不到视频文件' };
  }
  const dir = path.dirname(videoPath);
  const base = path.basename(videoPath, path.extname(videoPath)).replace(/_cover$/, '');
  const coverFormat = (options && options.coverFormat) || 'jpg';
  const coverExt = (coverFormat === 'png' || coverFormat === 'png_only') ? 'png' : 'jpg';
  const requestedCover = path.join(dir, `${base}_cover.${coverExt}`);
  const opts = {
    coverFormat: coverFormat === 'png_only' ? 'png_only' : coverFormat,
    reduceMoire: !!(options && options.reduceMoire),
  };
  try {
    const result = await extractFirstFrame(videoPath, requestedCover, opts);
    if (result && result.ok && result.coverPath) {
      return { ok: true, coverPath: result.coverPath, coverSize: result.coverSize };
    }
    return { ok: false, error: (result && result.error) ? result.error : '首帧导出失败' };
  } catch (e) {
    return { ok: false, error: (e && e.message) ? e.message : String(e) };
  }
});

// 选择 MOV/MP4 文件（返回绝对路径）
ipcMain.handle('choose-file', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: '选择视频文件',
    filters: [
      { name: '视频', extensions: ['mov', 'mp4'] },
      { name: 'MOV', extensions: ['mov'] },
      { name: 'MP4', extensions: ['mp4'] },
    ],
    properties: ['openFile'],
  });
  if (canceled || !filePaths.length) return null;
  return filePaths[0];
});

// 在 Finder 中显示输出文件
ipcMain.handle('reveal-in-finder', (_, filePath) => {
  if (filePath && fs.existsSync(filePath)) {
    shell.showItemInFolder(filePath);
  }
});

// 在 Finder 中显示调试日志（打包版也可用）
ipcMain.handle('reveal-debug-log', async () => {
  try {
    const dir = app.getPath('userData');
    const logPath = path.join(dir, 'debug.log');
    // 确保文件存在，便于 Finder 定位
    try { fs.appendFileSync(logPath, ''); } catch (_) {}
    shell.showItemInFolder(logPath);
    return { ok: true, logPath };
  } catch (e) {
    return { ok: false, error: (e && e.message) ? e.message : String(e) };
  }
});
