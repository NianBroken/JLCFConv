import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronRight,
  CircuitBoard,
  FileCode2,
  GitBranch,
  ImagePlus,
  LoaderCircle,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Upload,
  X,
  ExternalLink,
  RotateCcw,
  AlertCircle,
  Layers3,
  MousePointer2,
} from 'lucide-react';
import {
  DEFAULT_OPTIONS,
  DEFAULT_LOGO,
  OUTPUT_PREFIX,
  LIMITS,
  PROJECT,
  type ConversionOptions,
  type UploadInfo,
  type JobInfo,
} from '../shared/config';
import './styles.css';

interface QueueFile {
  key: string;
  file: File;
  progress: number;
  status: 'uploading' | 'ready' | 'failed';
  info?: UploadInfo;
  error?: string;
}
const bytesText = (bytes: number) => `${(bytes / 1024 ** 2).toFixed(1)} MB`;
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? '请求失败，请重试。');
  return data;
}
/** 原始 File 对象只用于上传与显示，任何操作都不具备回写设备文件的能力。 */
function App() {
  const [files, setFiles] = useState<QueueFile[]>([]);
  const [options, setOptions] = useState<ConversionOptions>(structuredClone(DEFAULT_OPTIONS));
  const [logoKind, setLogoKind] = useState<'text' | 'image'>('text');
  const [logoPreview, setLogoPreview] = useState('');
  const [logoBusy, setLogoBusy] = useState(false);
  const [job, setJob] = useState<JobInfo | null>(null);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [previewOrigin, setPreviewOrigin] = useState('');
  const [limits, setLimits] = useState<Record<keyof typeof LIMITS, number>>(LIMITS);
  const fileInput = useRef<HTMLInputElement>(null),
    logoInput = useRef<HTMLInputElement>(null);
  const requests = useRef(new Map<string, XMLHttpRequest>());
  const downloaded = useRef('');
  const busy = !!job && ['queued', 'processing'].includes(job.state);
  const ready =
    files.length > 0 &&
    files.every((file) => file.status === 'ready') &&
    !busy &&
    !logoBusy &&
    (logoKind === 'text' || options.logo.kind === 'image');
  const totalBytes = files.reduce((sum, file) => sum + file.file.size, 0);
  useEffect(() => {
    void api<{ previewOrigin: string; limits: typeof limits }>('/api/capabilities')
      .then((data) => {
        setPreviewOrigin(data.previewOrigin);
        setLimits(data.limits);
      })
      .catch((e) => setError(e.message));
    return () => {
      requests.current.forEach((request) => request.abort());
    };
  }, []);
  const download = (value: JobInfo) => {
    if (!value.downloadUrl) return;
    const anchor = document.createElement('a');
    anchor.href = value.downloadUrl;
    anchor.download = '';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };
  useEffect(() => {
    if (!job || !['processing', 'queued'].includes(job.state)) return;
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      void api<JobInfo>(`/api/conversions/${job.id}`, { signal: controller.signal })
        .then((value) => {
          setJob(value);
          if (value.downloadUrl && downloaded.current !== value.id) {
            downloaded.current = value.id;
            download(value);
          }
        })
        .catch((e) => {
          if (e.name !== 'AbortError') setError(e.message);
        });
    }, 700);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [job?.id, job?.state]);
  function upload(item: QueueFile) {
    setFiles((current) =>
      current.map((file) =>
        file.key === item.key
          ? { ...file, status: 'uploading', progress: 0, error: undefined }
          : file,
      ),
    );
    const request = new XMLHttpRequest();
    requests.current.set(item.key, request);
    const body = new FormData();
    body.append('filename', item.file.name);
    body.append('file', item.file, item.file.name);
    request.open('POST', '/api/uploads');
    request.upload.onprogress = (event) => {
      if (event.lengthComputable)
        setFiles((current) =>
          current.map((file) =>
            file.key === item.key
              ? { ...file, progress: Math.round((event.loaded / event.total) * 100) }
              : file,
          ),
        );
    };
    request.onload = () => {
      requests.current.delete(item.key);
      let data: UploadInfo & { error?: string };
      try {
        data = JSON.parse(request.responseText);
      } catch {
        data = { error: '上传响应无效。' } as typeof data;
      }
      setFiles((current) =>
        current.map((file) =>
          file.key === item.key
            ? request.status === 201
              ? { ...file, info: data, status: 'ready', progress: 100 }
              : { ...file, status: 'failed', error: data.error ?? '上传失败。' }
            : file,
        ),
      );
    };
    request.onerror = () => {
      requests.current.delete(item.key);
      setFiles((current) =>
        current.map((file) =>
          file.key === item.key
            ? { ...file, status: 'failed', error: '网络连接中断，请重试。' }
            : file,
        ),
      );
    };
    request.send(body);
  }
  function addFiles(incoming: FileList | File[]) {
    if (busy) return;
    setError('');
    setJob(null);
    const selected = Array.from(incoming);
    if (
      selected.length + files.length > limits.files ||
      selected.reduce((sum, f) => sum + f.size, totalBytes) > limits.batchBytes
    ) {
      setError(`每批最多 ${limits.files} 份文件，总大小不超过 ${bytesText(limits.batchBytes)}。`);
      return;
    }
    const items = selected.map((file) => ({
      key: crypto.randomUUID(),
      file,
      status: 'uploading' as const,
      progress: 0,
    }));
    setFiles((current) => [...current, ...items]);
    items.forEach((item) => {
      if (
        !/\.html?$/i.test(item.file.name) ||
        item.file.size === 0 ||
        item.file.size > limits.fileBytes
      )
        setFiles((current) =>
          current.map((file) =>
            file.key === item.key
              ? {
                  ...file,
                  status: 'failed',
                  error: `请选择非空 HTML 文件，单份不超过 ${bytesText(limits.fileBytes)}。`,
                }
              : file,
          ),
        );
      else upload(item);
    });
  }
  async function uploadLogo(file?: File) {
    if (!file) return;
    setLogoBusy(true);
    setError('');
    try {
      const body = new FormData();
      body.append('file', file);
      const result = await api<{ assetId: string; preview: string }>('/api/logo-assets', {
        method: 'POST',
        body,
      });
      setOptions((current) => ({ ...current, logo: { kind: 'image', assetId: result.assetId } }));
      setLogoPreview(result.preview);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLogoBusy(false);
    }
  }
  async function convert() {
    if (!ready) return;
    setError('');
    try {
      setJob(
        await api<JobInfo>('/api/conversions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileIds: files.map((file) => file.info!.id), options }),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="app-shell min-h-screen">
      <header className="topbar">
        <a className="brand" href="/">
          <span className="brand-mark">
            <CircuitBoard size={23} />
          </span>
          <span>
            {PROJECT.name}
            <small>JLCFConv</small>
          </span>
        </a>
        <a className="github-link" href={PROJECT.github} target="_blank" rel="noreferrer">
          <GitBranch size={17} />
          <span>GitHub</span>
          <ExternalLink size={13} />
        </a>
      </header>
      <main>
        <section className="hero">
          <div className="eyebrow">
            <span /> PCB 3D · HTML 转换工具
          </div>
          <h1>
            让模型预览，
            <br className="mobile-break" />
            <em>成为你的展示。</em>
          </h1>
          <p>
            自定义品牌，整理页面，适配触控。
            <br className="mobile-break" />
            把嘉立创 HTML 转成可独立分享的 PCB 模型预览。
          </p>
          <div className="hero-tags">
            <span>
              <ShieldCheck size={15} />
              原始文件只读
            </span>
            <span>
              <Layers3 size={15} />
              支持批量转换
            </span>
            <span>
              <CheckCheck size={15} />
              完整离线预览
            </span>
          </div>
        </section>
        <div className="workspace-grid">
          <section className="panel upload-panel">
            <div className="panel-heading">
              <div>
                <span className="step">01</span>
                <h2>选择 HTML 文件</h2>
              </div>
              <span className="subtle">单个或批量上传</span>
            </div>
            <input
              ref={fileInput}
              type="file"
              accept=".html,.htm,text/html"
              multiple
              hidden
              onChange={(event) => {
                if (event.target.files) addFiles(event.target.files);
                event.target.value = '';
              }}
            />
            <div
              className={`dropzone ${dragging ? 'is-dragging' : ''}`}
              onDragOver={(event) => {
                event.preventDefault();
                if (!busy) setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                addFiles(event.dataTransfer.files);
              }}
            >
              <div className="upload-symbol">
                <FileCode2 size={30} />
                <span>
                  <Plus size={12} />
                </span>
              </div>
              <h3>将 HTML 文件拖到这里</h3>
              <p>或从设备中选择嘉立创 PCB 3D 文件</p>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => fileInput.current?.click()}
              >
                <Upload size={16} />
                选择文件
              </button>
              <small>支持 .html 与 .htm · 单份最大 {bytesText(limits.fileBytes)}</small>
            </div>
            <div className="queue-heading">
              <span>
                文件队列 <b>{files.length.toString().padStart(2, '0')}</b>
              </span>
              {files.length > 0 && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    requests.current.forEach((request) => request.abort());
                    requests.current.clear();
                    setFiles([]);
                    setJob(null);
                  }}
                >
                  清空
                </button>
              )}
            </div>
            <div className="file-list">
              {files.length === 0 ? (
                <div className="empty-queue">
                  <FileCode2 size={19} />
                  <span>还没有选择文件</span>
                  <small>添加文件后，在右侧设置转换内容</small>
                </div>
              ) : (
                files.map((file) => (
                  <div className="file-row" key={file.key}>
                    <span className="file-icon">
                      <FileCode2 size={20} />
                    </span>
                    <div className="file-copy">
                      <strong title={file.file.name}>{file.file.name}</strong>
                      <div>
                        <span>{bytesText(file.file.size)}</span>
                        <span
                          className={
                            file.status === 'failed'
                              ? 'error-text'
                              : file.status === 'ready'
                                ? 'success-text'
                                : ''
                          }
                        >
                          {file.status === 'ready'
                            ? '已就绪'
                            : file.status === 'failed'
                              ? file.error
                              : `上传中 ${file.progress}%`}
                        </span>
                      </div>
                      {file.status === 'uploading' && (
                        <div className="upload-progress">
                          <i style={{ width: `${file.progress}%` }} />
                        </div>
                      )}
                    </div>
                    {file.status === 'ready' ? (
                      <Check size={17} className="success-text" />
                    ) : file.status === 'failed' ? (
                      <button className="icon-button" title="重试上传" onClick={() => upload(file)}>
                        <RotateCcw size={15} />
                      </button>
                    ) : (
                      <LoaderCircle size={16} className="spin" />
                    )}
                    <button
                      className="icon-button"
                      title={`移除 ${file.file.name}`}
                      disabled={busy}
                      onClick={() => {
                        requests.current.get(file.key)?.abort();
                        requests.current.delete(file.key);
                        setFiles((current) => current.filter((f) => f.key !== file.key));
                        setJob(null);
                      }}
                    >
                      <X size={15} />
                    </button>
                  </div>
                ))
              )}
            </div>
            <div className="input-note">
              <ShieldCheck size={18} />
              <p>
                始终保留原文件<strong>转换只生成新的 HTML，不覆盖、不回写。</strong>
              </p>
            </div>
            <div className="output-example">
              <span>输出文件名</span>
              <code>
                <b>{OUTPUT_PREFIX}</b>
                {files[0]?.file.name ?? '原始文件名.html'}
              </code>
            </div>
          </section>
          <section className="panel config-panel">
            <div className="panel-heading">
              <div>
                <span className="step">02</span>
                <h2>设置转换内容</h2>
              </div>
              <SlidersHorizontal size={18} className="subtle" />
            </div>
            <fieldset disabled={busy}>
              <div className="config-section">
                <div className="section-label">
                  <h3>自定义 LOGO</h3>
                  <span>静态展示，无跳转</span>
                </div>
                <div className="segmented">
                  <button
                    type="button"
                    className={logoKind === 'text' ? 'active' : ''}
                    onClick={() => {
                      setLogoKind('text');
                      setOptions((current) => ({
                        ...current,
                        logo: { kind: 'text', text: DEFAULT_LOGO },
                      }));
                    }}
                  >
                    文字 LOGO
                  </button>
                  <button
                    type="button"
                    className={logoKind === 'image' ? 'active' : ''}
                    onClick={() => setLogoKind('image')}
                  >
                    图片 LOGO
                  </button>
                </div>
                {logoKind === 'text' ? (
                  <input
                    aria-label="LOGO 文字"
                    maxLength={500}
                    value={options.logo.kind === 'text' ? options.logo.text : ''}
                    onChange={(event) =>
                      setOptions((current) => ({
                        ...current,
                        logo: { kind: 'text', text: event.target.value },
                      }))
                    }
                  />
                ) : (
                  <>
                    <input
                      ref={logoInput}
                      type="file"
                      accept="image/*,.ico"
                      hidden
                      onChange={(event) => {
                        void uploadLogo(event.target.files?.[0]);
                        event.target.value = '';
                      }}
                    />
                    <button
                      className="logo-upload"
                      onClick={() => logoInput.current?.click()}
                      disabled={logoBusy}
                    >
                      {logoBusy ? (
                        <LoaderCircle className="spin" size={20} />
                      ) : logoPreview ? (
                        <img src={logoPreview} alt="LOGO 预览" />
                      ) : (
                        <ImagePlus size={20} />
                      )}
                      <span>{logoPreview ? '更换图片' : '上传图片或图标'}</span>
                    </button>
                    <small className="field-hint">
                      最大 {bytesText(limits.logoBytes)}，图片转换为静态内容并内嵌保存
                    </small>
                  </>
                )}
              </div>
              <div className="config-section">
                <div className="section-label">
                  <h3>网站标题</h3>
                  <span>浏览器标签页名称</span>
                </div>
                <div className="segmented">
                  <button
                    type="button"
                    className={options.title.kind === 'filename' ? 'active' : ''}
                    onClick={() =>
                      setOptions((current) => ({ ...current, title: { kind: 'filename' } }))
                    }
                  >
                    使用原文件名
                  </button>
                  <button
                    type="button"
                    className={options.title.kind === 'text' ? 'active' : ''}
                    onClick={() =>
                      setOptions((current) => ({ ...current, title: { kind: 'text', text: '' } }))
                    }
                  >
                    自定义文字
                  </button>
                </div>
                {options.title.kind === 'text' ? (
                  <input
                    aria-label="网站标题文字"
                    placeholder="填写转换后网页的标题"
                    maxLength={500}
                    value={options.title.text}
                    onChange={(event) =>
                      setOptions((current) => ({
                        ...current,
                        title: { kind: 'text', text: event.target.value },
                      }))
                    }
                  />
                ) : (
                  <div className="title-preview">
                    <FileCode2 size={15} />
                    <span>{files[0]?.file.name ?? '每份文件使用各自的原始文件名'}</span>
                    <Check size={14} />
                  </div>
                )}
              </div>
              <div className="config-section optimizations">
                <label className="option-row">
                  <span className="option-icon">
                    <Sparkles size={20} />
                  </span>
                  <span>
                    <strong>优化网页</strong>
                    <small>清理多余界面，统一文案，适配窄屏</small>
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    aria-label="优化网页"
                    checked={options.optimizePage}
                    onChange={(event) =>
                      setOptions((current) => ({ ...current, optimizePage: event.target.checked }))
                    }
                  />
                  <i className="switch" />
                </label>
                <label className="option-row">
                  <span className="option-icon">
                    <MousePointer2 size={20} />
                  </span>
                  <span>
                    <strong>优化交互</strong>
                    <small>扩大操作热区，支持触摸展开与拖动</small>
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    aria-label="优化交互"
                    checked={options.optimizeInteraction}
                    onChange={(event) =>
                      setOptions((current) => ({
                        ...current,
                        optimizeInteraction: event.target.checked,
                      }))
                    }
                  />
                  <i className="switch" />
                </label>
              </div>
            </fieldset>
            <div className="config-footer">
              <CheckCheck size={15} />
              <span>模型数据保持完整，所需资源随文件保存</span>
            </div>
          </section>
        </div>
        {error && (
          <div role="alert" className="alert">
            <AlertCircle size={18} />
            <span>{error}</span>
            <button className="icon-button" onClick={() => setError('')}>
              <X size={16} />
            </button>
          </div>
        )}
        <section className="action-bar">
          <div>
            <span className="action-icon">
              <ArrowDownToLine size={21} />
            </span>
            <p>
              <strong>
                {busy
                  ? `正在转换 ${job.progress}%`
                  : files.length
                    ? `已选择 ${files.length} 份文件`
                    : '准备好你的模型文件'}
              </strong>
              <small>
                {busy
                  ? '正在处理页面与离线资源，请保持页面打开'
                  : files.length > 1
                    ? `共 ${bytesText(totalBytes)}，完成后自动下载 ZIP`
                    : '转换完成后自动下载新的 HTML 文件'}
              </small>
            </p>
          </div>
          {busy ? (
            <button
              className="button secondary"
              onClick={() => {
                void api<JobInfo>(`/api/conversions/${job!.id}`, { method: 'DELETE' })
                  .then(setJob)
                  .catch((e) => setError(e.message));
              }}
            >
              取消转换
            </button>
          ) : (
            <button
              className="button primary"
              disabled={
                !ready ||
                (options.logo.kind === 'text' && !options.logo.text.trim()) ||
                (options.title.kind === 'text' && !options.title.text.trim())
              }
              onClick={() => {
                void convert();
              }}
            >
              转换并下载
              <ArrowRight size={18} />
            </button>
          )}
        </section>
        {job && (
          <section className="panel results">
            <div className="panel-heading">
              <div>
                <span className="step">03</span>
                <h2>
                  {job.state === 'success'
                    ? '转换完成'
                    : job.state === 'partial'
                      ? '部分文件转换成功'
                      : job.state === 'failed'
                        ? '转换未完成'
                        : job.state === 'cancelled'
                          ? '转换已取消'
                          : '转换进度'}
                </h2>
              </div>
              {job.downloadUrl && (
                <button className="text-button" onClick={() => download(job)}>
                  <ArrowDownToLine size={15} />
                  重新下载
                </button>
              )}
            </div>
            {job.files.map((file, index) => (
              <div className="result-row" key={file.id}>
                {file.state === 'success' ? (
                  <Check size={18} className="success-text" />
                ) : ['failed', 'cancelled'].includes(file.state) ? (
                  <AlertCircle size={18} className="error-text" />
                ) : (
                  <LoaderCircle size={18} className="spin" />
                )}
                <div>
                  <strong>{file.outputName}</strong>
                  <small>
                    {file.error ??
                      (file.state === 'success'
                        ? '已生成，模型数据完整性检查通过'
                        : file.state === 'processing'
                          ? '正在转换'
                          : '等待处理')}
                  </small>
                </div>
                {job.previewUrls?.[index] && (
                  <a
                    href={previewOrigin + job.previewUrls[index]}
                    target="_blank"
                    rel="noreferrer"
                    className="preview-link"
                  >
                    预览
                    <ChevronRight size={16} />
                  </a>
                )}
              </div>
            ))}
            {job.downloadUrl && (
              <p className="result-note">
                下载已自动开始。结果保留 {Math.round(limits.retentionMs / 60000)}{' '}
                分钟，可重新下载或打开 HTTPS 预览。
              </p>
            )}
          </section>
        )}
        <footer>
          <span>
            JLCFConv <span className="footer-dot">·</span> 让每一块 PCB 清晰呈现
          </span>
          <span>
            由{' '}
            <a href="https://github.com/NianBroken" target="_blank" rel="noreferrer">
              NianBroken
            </a>{' '}
            构建
          </span>
        </footer>
      </main>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
