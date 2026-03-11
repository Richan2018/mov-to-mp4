const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  checkFfmpeg: () => ipcRenderer.invoke('check-ffmpeg'),
  chooseFile: () => ipcRenderer.invoke('choose-file'),
  getVideoInfo: (filePath) => ipcRenderer.invoke('get-video-info', filePath),
  checkSequenceLike: (filePath) => ipcRenderer.invoke('check-sequence-like', filePath),
  compress: (inputPath, options) => ipcRenderer.invoke('compress', inputPath, options),
  extractFrameOnly: (videoPath, options) => ipcRenderer.invoke('extract-frame-only', videoPath, options),
  revealDebugLog: () => ipcRenderer.invoke('reveal-debug-log'),
  revealInFinder: (filePath) => ipcRenderer.invoke('reveal-in-finder', filePath),
  resizeToContent: (height) => ipcRenderer.send('resize-to-content', { height }),
  resetWindowSize: () => ipcRenderer.send('reset-window-size'),
  onCompressProgress: (fn) => {
    ipcRenderer.on('compress-progress', (_, data) => fn(data));
  },
});
