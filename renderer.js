const dropZone = document.getElementById('dropZone');
const dropText = document.getElementById('dropText');
const dropHint = document.getElementById('dropHint');
const fileInfo = document.getElementById('fileInfo');
const fileName = document.getElementById('fileName');
const btnClear = document.getElementById('btnClear');
const optionsPanel = document.getElementById('optionsPanel');
const resolutionEl = document.getElementById('resolution');
const fpsEl = document.getElementById('fps');
const muteEl = document.getElementById('mute');
const extractCoverEl = document.getElementById('extractCover');
const coverFormatEl = document.getElementById('coverFormat');
const reduceMoireEl = document.getElementById('reduceMoire');
const compressOnlyBlock = document.getElementById('compressOnlyBlock');
const extractCoverRow = document.getElementById('extractCoverRow');
const reduceMoireRow = document.getElementById('reduceMoireRow');
const coverHintEl = document.getElementById('coverHint');
const sourceVideoInfoEl = document.getElementById('sourceVideoInfo');
const sequenceHintEl = document.getElementById('sequenceHint');
const sequenceOptimizedEl = document.getElementById('sequenceOptimized');
const sequenceCrfEl = document.getElementById('sequenceCrf');
const customResolutionRow = document.getElementById('customResolutionRow');
const customWidthEl = document.getElementById('customWidth');
const customHeightEl = document.getElementById('customHeight');
const customKeepAspectEl = document.getElementById('customKeepAspect');
const progressWrap = document.getElementById('progressWrap');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const progressEta = document.getElementById('progressEta');
const btnStart = document.getElementById('btnStart');
const messageEl = document.getElementById('message');
const openLogLink = document.getElementById('openLogLink');

let selectedPath = null;
let isExtractOnlyMode = false; // true 表示仅导出首帧（拖入的是 MP4）
let originalWidth = null;
let originalHeight = null;
let customUpdating = false;

let resizeRaf = null;
function requestWindowResizeToFit() {
  if (!window.api || typeof window.api.resizeToContent !== 'function') return;
  const content = document.querySelector('.content');
  if (!content) return;

  // 只在内容发生“溢出需要滚动”时增高窗口。
  // 避免用 scrollHeight 绝对值 + flex 布局产生的正反馈导致窗口一直变高。
  const overflow = Math.ceil(content.scrollHeight - content.clientHeight);
  if (!isFinite(overflow) || overflow <= 2) return;

  const desired = Math.ceil(window.innerHeight + overflow + 12);
  if (!isFinite(desired) || desired <= 0) return;
  window.api.resizeToContent(desired);
}

function scheduleWindowResizeToFit() {
  if (resizeRaf != null) return;
  resizeRaf = requestAnimationFrame(() => {
    resizeRaf = null;
    requestWindowResizeToFit();
  });
}

function showMessage(text, type = 'success') {
  messageEl.textContent = '';
  messageEl.className = 'message ' + type;
  messageEl.appendChild(document.createTextNode(text));
  messageEl.classList.remove('hidden');
  scheduleWindowResizeToFit();
}

if (openLogLink) {
  openLogLink.addEventListener('click', (e) => {
    e.preventDefault();
    if (window.api && typeof window.api.revealDebugLog === 'function') {
      window.api.revealDebugLog();
    }
  });
}

function hideMessage() {
  messageEl.classList.add('hidden');
  scheduleWindowResizeToFit();
}

function setFile(path, name) {
  selectedPath = path;
  const lower = (path || '').toLowerCase();
  isExtractOnlyMode = lower.endsWith('.mp4');
  fileName.textContent = name || path.split('/').pop() || path.split('\\').pop();
  fileInfo.classList.remove('hidden');
  optionsPanel.classList.remove('hidden');
  btnStart.disabled = false;
  progressWrap.classList.add('hidden');
  hideMessage();
  if (compressOnlyBlock) {
    compressOnlyBlock.style.display = isExtractOnlyMode ? 'none' : '';
  }
  if (extractCoverRow) {
    extractCoverRow.style.display = isExtractOnlyMode ? 'none' : '';
  }
  if (coverHintEl) {
    coverHintEl.textContent = isExtractOnlyMode
      ? '从当前视频首帧截取，与播放时颜色一致（零色差），保存至同目录。'
      : '封面从输出视频的首帧截取，与播放时颜色一致，保存至同目录。';
  }
  if (extractCoverEl) {
    extractCoverEl.checked = true;
  }
  btnStart.textContent = isExtractOnlyMode ? '导出首帧' : '开始压缩';
  updateReduceMoireVisibility();
  updateOriginalOptions(path);
  updateSequenceHint(path);
  scheduleWindowResizeToFit();
}

function updateOriginalOptions(filePath) {
  const resolutionOriginal = resolutionEl.querySelector('option[value="original"]');
  const fpsOriginal = fpsEl.querySelector('option[value="original"]');
  if (resolutionOriginal) resolutionOriginal.textContent = '原始';
  if (fpsOriginal) fpsOriginal.textContent = '原始';
  if (resolutionEl) resolutionEl.value = 'original';
  if (fpsEl) fpsEl.value = 'original';
  sourceVideoInfoEl.classList.add('hidden');
  sourceVideoInfoEl.textContent = '';
  if (sequenceHintEl) {
    sequenceHintEl.classList.add('hidden');
    sequenceHintEl.textContent = '';
  }
  if (sequenceOptimizedEl) sequenceOptimizedEl.checked = false;
  if (sequenceCrfEl) sequenceCrfEl.value = '23';
  if (customResolutionRow) customResolutionRow.classList.add('hidden');
  if (customWidthEl) customWidthEl.value = '';
  if (customHeightEl) customHeightEl.value = '';
  if (customKeepAspectEl) customKeepAspectEl.checked = true;
  scheduleWindowResizeToFit();
  if (!filePath) return;
  window.api.getVideoInfo(filePath).then((info) => {
    if (!info) return;
    originalWidth = info.width != null ? info.width : null;
    originalHeight = info.height != null ? info.height : null;
    const parts = [];
    if (info.width != null && info.height != null) {
      if (resolutionOriginal) resolutionOriginal.textContent = `原始 (${info.width}×${info.height})`;
      parts.push(`${info.width}×${info.height}`);
    }
    if (info.fps != null) {
      const fpsStr = Number.isInteger(info.fps) ? String(info.fps) : info.fps.toFixed(2);
      if (fpsOriginal) fpsOriginal.textContent = `原始 (${fpsStr} fps)`;
      parts.push(fpsStr + ' fps');
    }
    if (parts.length) {
      sourceVideoInfoEl.textContent = '原片：' + parts.join('，');
      sourceVideoInfoEl.classList.remove('hidden');
      scheduleWindowResizeToFit();
    }
  });
}

function updateSequenceHint(filePath) {
  if (!filePath || !window.api || typeof window.api.checkSequenceLike !== 'function') return;
  if (!sequenceHintEl) return;
  sequenceHintEl.classList.add('hidden');
  sequenceHintEl.textContent = '';
  if (sequenceOptimizedEl) sequenceOptimizedEl.checked = false;
  if (sequenceCrfEl) sequenceCrfEl.value = '23';
  window.api.checkSequenceLike(filePath).then((info) => {
    if (!info || !info.sequenceLike) return;
    sequenceHintEl.textContent =
      '检测到可能是序列帧封装 MOV（如 ProRes/PNG 动画）。如需更稳更细腻的压缩，可勾选“序列帧优化”，使用推荐的 H.265 参数（CRF 23，slow，高级搜索）。';
    sequenceHintEl.classList.remove('hidden');
    scheduleWindowResizeToFit();
  });
}

function clearFile() {
  selectedPath = null;
  fileInfo.classList.add('hidden');
  optionsPanel.classList.add('hidden');
  btnStart.disabled = true;
  dropText.textContent = '将 MOV 或 MP4 文件拖放到此处';
  isExtractOnlyMode = false;
  if (compressOnlyBlock) compressOnlyBlock.style.display = '';
  if (extractCoverRow) extractCoverRow.style.display = '';
  if (coverHintEl) coverHintEl.textContent = '封面从输出视频的首帧截取，与播放时颜色一致，保存至同目录。';
  if (extractCoverEl) extractCoverEl.checked = true;
  btnStart.textContent = '开始压缩';
  const resolutionOriginal = resolutionEl.querySelector('option[value="original"]');
  const fpsOriginal = fpsEl.querySelector('option[value="original"]');
  if (resolutionOriginal) resolutionOriginal.textContent = '原始';
  if (fpsOriginal) fpsOriginal.textContent = '原始';
  sourceVideoInfoEl.classList.add('hidden');
  sourceVideoInfoEl.textContent = '';
  if (sequenceHintEl) {
    sequenceHintEl.classList.add('hidden');
    sequenceHintEl.textContent = '';
  }
  if (sequenceOptimizedEl) sequenceOptimizedEl.checked = false;
  if (sequenceCrfEl) sequenceCrfEl.value = '23';
  if (customResolutionRow) customResolutionRow.classList.add('hidden');
  if (customWidthEl) customWidthEl.value = '';
  if (customHeightEl) customHeightEl.value = '';
  if (customKeepAspectEl) customKeepAspectEl.checked = true;
  hideMessage();
  if (window.api && typeof window.api.resetWindowSize === 'function') {
    window.api.resetWindowSize();
  } else {
    scheduleWindowResizeToFit();
  }
}

function getOptions() {
  const codec = document.querySelector('input[name="codec"]:checked');
  let sequenceCrf = null;
  if (sequenceCrfEl && sequenceCrfEl.value !== '') {
    const n = parseInt(sequenceCrfEl.value, 10);
    if (!isNaN(n)) sequenceCrf = n;
  }
  let customResolution = null;
  if (resolutionEl.value === 'custom' && customWidthEl && customHeightEl && customKeepAspectEl) {
    const w = customWidthEl.value ? parseInt(customWidthEl.value, 10) : null;
    const h = customHeightEl.value ? parseInt(customHeightEl.value, 10) : null;
    const keepAspect = !!customKeepAspectEl.checked;
    if ((w && w > 0) || (h && h > 0)) {
      customResolution = { width: w, height: h, keepAspect };
    }
  }
  return {
    codec: codec ? codec.value : 'h265',
    resolution: resolutionEl.value,
    fps: fpsEl.value,
    sequenceOptimized: !!(sequenceOptimizedEl && sequenceOptimizedEl.checked),
    sequenceCrf,
    customResolution,
    mute: muteEl.checked,
    extractCover: extractCoverEl.checked,
    coverFormat: coverFormatEl.value,
    reduceMoire: reduceMoireEl.checked,
  };
}

function formatRemaining(sec) {
  if (sec == null || !isFinite(sec) || sec < 0) return '';
  if (sec < 60) return `约 ${Math.round(sec)} 秒`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s > 0 ? `约 ${m} 分 ${s} 秒` : `约 ${m} 分钟`;
}

function getPathFromFile(file) {
  if (file.path) return file.path;
  return null;
}

// 拖放
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.stopPropagation();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', (e) => {
  e.preventDefault();
  e.stopPropagation();
  dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  e.stopPropagation();
  dropZone.classList.remove('drag-over');
  const files = e.dataTransfer.files;
  if (files.length === 0) return;
  const file = files[0];
  const path = getPathFromFile(file);
  if (!path) {
    showMessage('请直接拖入文件到窗口，不要从某些应用内拖拽。', 'error');
    return;
  }
  const ext = (file.name || '').toLowerCase();
  if (!ext.endsWith('.mov') && !ext.endsWith('.mp4')) {
    showMessage('请拖入 .mov 或 .mp4 文件', 'error');
    return;
  }
  setFile(path, file.name);
});

// 点击选择文件
dropZone.addEventListener('click', async () => {
  const path = await window.api.chooseFile();
  if (!path) return;
  const name = path.split('/').pop() || path.split('\\').pop();
  setFile(path, name);
});

btnClear.addEventListener('click', (e) => {
  e.stopPropagation();
  clearFile();
});

// 分辨率切换时显示/隐藏自定义输入
if (resolutionEl) {
  resolutionEl.addEventListener('change', () => {
    if (!customResolutionRow) return;
    if (resolutionEl.value === 'custom') {
      customResolutionRow.classList.remove('hidden');
      // 初次切到自定义时，如果只知道原始分辨率且保持比例，默认填入原始宽
      if (customKeepAspectEl && customKeepAspectEl.checked && originalWidth && originalHeight) {
        if (customWidthEl && !customWidthEl.value) customWidthEl.value = String(originalWidth);
      }
    } else {
      customResolutionRow.classList.add('hidden');
      if (customWidthEl) customWidthEl.value = '';
      if (customHeightEl) customHeightEl.value = '';
    }
    scheduleWindowResizeToFit();
  });
}

function updateCustomResolutionFromWidth() {
  if (customUpdating) return;
  if (!customWidthEl || !customHeightEl || !customKeepAspectEl) return;
  const w = parseInt(customWidthEl.value, 10);
  if (!originalWidth || !originalHeight || !Number.isFinite(w) || w <= 0) return;
  if (!customKeepAspectEl.checked) return;
  const h = Math.round((w * originalHeight) / originalWidth);
  if (h <= 0) return;
  customUpdating = true;
  try {
    customHeightEl.value = String(h);
  } finally {
    customUpdating = false;
  }
}

function updateCustomResolutionFromHeight() {
  if (customUpdating) return;
  if (!customWidthEl || !customHeightEl || !customKeepAspectEl) return;
  const h = parseInt(customHeightEl.value, 10);
  if (!originalWidth || !originalHeight || !Number.isFinite(h) || h <= 0) return;
  if (!customKeepAspectEl.checked) return;
  const w = Math.round((h * originalWidth) / originalHeight);
  if (w <= 0) return;
  customUpdating = true;
  try {
    customWidthEl.value = String(w);
  } finally {
    customUpdating = false;
  }
}

if (customWidthEl) {
  customWidthEl.addEventListener('change', updateCustomResolutionFromWidth);
  customWidthEl.addEventListener('blur', updateCustomResolutionFromWidth);
  customWidthEl.addEventListener('input', updateCustomResolutionFromWidth);
}

if (customHeightEl) {
  customHeightEl.addEventListener('change', updateCustomResolutionFromHeight);
  customHeightEl.addEventListener('blur', updateCustomResolutionFromHeight);
  customHeightEl.addEventListener('input', updateCustomResolutionFromHeight);
}

if (customKeepAspectEl) {
  customKeepAspectEl.addEventListener('change', () => {
    if (customKeepAspectEl.checked) {
      // 重新勾选保持比例时，用当前非空那一边推算另一边
      if (customWidthEl && customWidthEl.value) {
        updateCustomResolutionFromWidth();
      } else if (customHeightEl && customHeightEl.value) {
        updateCustomResolutionFromHeight();
      }
    }
  });
}

function updateReduceMoireVisibility() {
  if (!reduceMoireRow || !coverFormatEl) return;
  const v = coverFormatEl.value;
  reduceMoireRow.style.display = (v === 'jpg' || v === 'jpg_unlimited') ? '' : 'none';
  scheduleWindowResizeToFit();
}

if (coverFormatEl) {
  coverFormatEl.addEventListener('change', updateReduceMoireVisibility);
}

function updateSequenceControlsEnabled() {
  const enabled = !!(sequenceOptimizedEl && sequenceOptimizedEl.checked);
  if (sequenceCrfEl) sequenceCrfEl.disabled = !enabled;
}

if (sequenceOptimizedEl) {
  sequenceOptimizedEl.addEventListener('change', updateSequenceControlsEnabled);
  updateSequenceControlsEnabled();
}

// UI 变化时自动让窗口增高，避免按钮被遮挡
(() => {
  const contentInner = document.querySelector('.content-inner');
  const content = document.querySelector('.content');
  if (!contentInner || !content) return;
  const ro = new ResizeObserver(() => scheduleWindowResizeToFit());
  ro.observe(contentInner);
  ro.observe(content);
  window.addEventListener('load', () => scheduleWindowResizeToFit(), { once: true });
  scheduleWindowResizeToFit();
})();

// 进度：{ percent, remainingSec }
window.api.onCompressProgress((data) => {
  const pct = data.percent ?? data;
  const remainingSec = typeof data === 'object' ? data.remainingSec : null;
  progressFill.style.width = pct + '%';
  progressText.textContent = pct >= 100 ? '完成' : `压缩中… ${pct}%`;
  progressEta.textContent = pct >= 100 ? '' : formatRemaining(remainingSec);
  progressEta.style.visibility = remainingSec != null ? 'visible' : 'hidden';
  scheduleWindowResizeToFit();
});

// 开始压缩 或 仅导出首帧
btnStart.addEventListener('click', async () => {
  if (!selectedPath) return;

  progressWrap.classList.remove('hidden');
  progressFill.style.width = '0%';
  progressText.textContent = isExtractOnlyMode ? '导出中…' : '准备中…';
  progressEta.textContent = '';
  progressEta.style.visibility = 'hidden';
  btnStart.disabled = true;
  hideMessage();

  const options = getOptions();
  let result;
  try {
    if (isExtractOnlyMode) {
      result = await window.api.extractFrameOnly(selectedPath, options);
    } else {
      result = await window.api.compress(selectedPath, options);
    }
  } catch (err) {
    progressWrap.classList.add('hidden');
    showMessage((isExtractOnlyMode ? '导出失败（IPC）：' : '压缩失败（IPC）：') + (err && err.message ? err.message : String(err)), 'error');
    btnStart.disabled = false;
    return;
  }

  if (result && result.ok) {
    progressText.textContent = '完成';
    progressEta.textContent = '';
    if (isExtractOnlyMode) {
      const sizeStr = result.coverSize != null
        ? (result.coverSize >= 1024 * 1024
            ? '，约 ' + (result.coverSize / 1024 / 1024).toFixed(1) + ' MB'
            : '，约 ' + Math.round(result.coverSize / 1024) + ' KB')
        : '';
      showMessage('已导出首帧封面，保存至与视频同目录。' + sizeStr);
      if (result.coverPath) {
        const coverLink = document.createElement('a');
        coverLink.href = '#';
        coverLink.textContent = '在 Finder 中显示';
        coverLink.onclick = (e) => {
          e.preventDefault();
          window.api.revealInFinder(result.coverPath);
        };
        messageEl.appendChild(document.createTextNode(' '));
        messageEl.appendChild(coverLink);
      }
      clearFile();
      return;
    }
    let msg = result.coverPath
      ? '压缩完成，已保存 MP4 与首帧封面图（与视频同目录）。'
      : '压缩完成，输出与 MOV 同目录。';
    if (result.coverSize != null) {
      msg += result.coverSize >= 1024 * 1024
        ? ' 封面约 ' + (result.coverSize / 1024 / 1024).toFixed(1) + ' MB'
        : ' 封面约 ' + Math.round(result.coverSize / 1024) + ' KB';
    }
    if (!result.coverPath && result.coverError) {
      msg += '（封面截取失败：' + result.coverError + '）';
    }
    showMessage(msg);
    const link = document.createElement('a');
    link.href = '#';
    link.textContent = '在 Finder 中显示';
    link.onclick = (e) => {
      e.preventDefault();
      window.api.revealInFinder(result.outputPath);
    };
    messageEl.appendChild(document.createTextNode(' '));
    messageEl.appendChild(link);
    if (result.coverPath) {
      const sep = document.createTextNode(' · ');
      const coverLink = document.createElement('a');
      coverLink.href = '#';
      coverLink.textContent = '封面图';
      coverLink.onclick = (e) => {
        e.preventDefault();
        window.api.revealInFinder(result.coverPath);
      };
      messageEl.appendChild(sep);
      messageEl.appendChild(coverLink);
    }
    clearFile();
  } else {
    progressWrap.classList.add('hidden');
    showMessage((isExtractOnlyMode ? '导出失败：' : '压缩失败：') + (result && result.error ? result.error : '未知错误'), 'error');
    btnStart.disabled = false;
  }
});
