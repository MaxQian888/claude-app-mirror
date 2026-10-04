// Mirrors Cognia's web/DESIGN.md tokens and shared artwork. Keep page rendering
// separate from the download handler so presentation cannot alter file streaming.
const COPY = {
  'zh-CN': {
    title: 'Claude Desktop 下载镜像 · Cognia', skip: '跳转到下载', nav: '网站导航',
    home: 'Cognia 首页', docs: '文档', theme: '切换主题', light: '浅色', dark: '深色', system: '跟随系统',
    language: 'Switch to English', alternate: 'EN', headline: '桌面端下载镜像',
    description: '下载官方原版安装包。为 macOS 和 Windows 提供国内下载入口，由 Cognia 维护。',
    unofficial: '非官方镜像', release: '当前镜像版本', recorded: '版本记录时间', policy: '保留策略', latest: '仅保留最新版',
    unavailable: '版本信息暂不可用，可前往 GitHub 查看。',
    platforms: '选择你的平台', platformNote: '独立安装包，下载后即可安装。', releaseLink: '查看 GitHub Release',
    mac: '适用于 Apple Silicon 和 Intel 芯片', x64: '适用于 Intel 和 AMD 处理器', arm: '适用于 Snapdragon 等 ARM 处理器',
    download: '下载', macInstall: '打开 DMG，将 Claude 拖入“应用程序”。',
    winInstall: '打开 MSIX，使用 Windows 应用安装程序安装。',
    verify: '下载后，核对文件', verifyDescription: '使用 SHA-256 校验和确认安装包完整性。',
    checksums: '下载校验和', manifest: '版本详情',
    help: '下载与安装', architecture: 'Windows 应该选择哪个版本？',
    architectureAnswer: '在“设置 → 系统 → 系统信息”中查看系统类型。Intel 或 AMD 处理器选择 x64；ARM 处理器选择 ARM64。',
    original: '安装包是否经过修改？',
    originalAnswer: '镜像同步 Claude 官方发布的 DMG 和 MSIX 文件，不修改、不重新打包。这里不提供 Linux 安装包。',
    history: '可以下载历史版本吗？',
    historyAnswer: 'GitHub Release 和镜像仅保留最新版本。新版本同步并通过校验后，旧的安装包会自动清理。',
    footer: '由 Cognia 维护的非官方镜像，与 Anthropic 无隶属关系。',
    official: '官方下载', source: '镜像源码', ecosystem: 'Cognia 网站',
  },
  en: {
    title: 'Claude Desktop download mirror · Cognia', skip: 'Skip to downloads', nav: 'Site navigation',
    home: 'Cognia home', docs: 'Docs', theme: 'Choose theme', light: 'Light', dark: 'Dark', system: 'System',
    language: '切换到中文', alternate: '中文', headline: 'A desktop download mirror.',
    description: 'Original installers for macOS and Windows, with a download route for mainland China. Maintained by Cognia.',
    unofficial: 'Unofficial mirror', release: 'Current mirrored version', recorded: 'Version recorded', policy: 'Retention', latest: 'Latest version only',
    unavailable: 'Version details are unavailable. Check the GitHub Release.',
    platforms: 'Choose your platform', platformNote: 'Standalone installers, ready to install after downloading.', releaseLink: 'View GitHub Release',
    mac: 'For Apple Silicon and Intel processors', x64: 'For Intel and AMD processors', arm: 'For Snapdragon and other ARM processors',
    download: 'Download', macInstall: 'Open the DMG and drag Claude into Applications.',
    winInstall: 'Open the MSIX with Windows App Installer.',
    verify: 'Check your download', verifyDescription: 'Use the SHA-256 checksums to verify file integrity.',
    checksums: 'Download checksums', manifest: 'Version details',
    help: 'Downloading and installing', architecture: 'Which Windows version should I choose?',
    architectureAnswer: 'Check System type in Settings → System → About. Choose x64 for Intel or AMD processors, and ARM64 for ARM processors.',
    original: 'Are the installers modified?',
    originalAnswer: 'This mirror copies the official Claude DMG and MSIX files without modifying or repackaging them. Linux installers are not available here.',
    history: 'Can I download an older version?',
    historyAnswer: 'GitHub Releases and this mirror keep only the latest version. Older installers are removed after a new version is synced and verified.',
    footer: 'An unofficial mirror maintained by Cognia. Not affiliated with Anthropic.',
    official: 'Official download', source: 'Mirror source', ecosystem: 'Cognia website',
  },
};

const ICONS = {
  arrow: '<path d="M7 17 17 7M7 7h10v10"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M5 16v4h14v-4"/>',
  check: '<path d="m8 12 3 3 5-6M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/>',
  monitor: '<rect x="3" y="3" width="18" height="13" rx="2"/><path d="M8 21h8m-4-5v5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  moon: '<path d="M20.9 13a9 9 0 1 1-9.9-9.9A7 7 0 0 0 20.9 13Z"/>',
  windows: '<path d="M3 5 11 4v7H3zm10-1.2L21 3v8h-8zM3 13h8v7l-8-1zm10 0h8v8l-8-.8z" fill="currentColor" stroke="none"/>',
  apple: '<path d="M15.9 3.4c.8-1 1.3-2.3 1.2-3.4-1.2.1-2.6.8-3.4 1.7-.7.8-1.4 2.1-1.2 3.3 1.3.1 2.6-.6 3.4-1.6ZM19.7 13c0-3 2.5-4.5 2.6-4.6-1.4-2.1-3.6-2.4-4.4-2.4-1.9-.2-3.7 1.1-4.6 1.1-.9 0-2.3-1.1-3.8-1-2 .1-3.9 1.2-4.9 3-2.1 3.6-.5 9 1.5 11.9 1 1.4 2.1 3 3.7 2.9 1.5-.1 2.1-.9 4-.9 1.8 0 2.3.9 3.9.9 1.6 0 2.6-1.4 3.5-2.8 1.2-1.6 1.6-3.2 1.6-3.3-.1 0-3.1-1.2-3.1-4.8Z" transform="translate(-1 1) scale(.9)" fill="currentColor" stroke="none"/>',
};
const icon = (name, className = '') => `<svg class="icon ${className}" aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
const brand = '<img class="brand-logo" src="/assets/cognia-logo.png" alt="" width="32" height="32">';

function escape(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function version(value) {
  return typeof value === 'string' && value.trim() ? `v${escape(value.slice(0, 100))}` : '—';
}

export function renderHomepage(manifest, locale = 'zh-CN') {
  const lang = locale === 'en' ? 'en' : 'zh-CN';
  const text = COPY[lang];
  const sources = manifest?.sources;
  const hasVersion = typeof manifest?.version === 'string' && manifest.version.trim();
  const date = typeof manifest?.generatedAt === 'string' ? new Date(manifest.generatedAt) : null;
  const recorded = date && Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date) : '—';
  const platforms = [
    { name: 'macOS', arch: 'Universal', alias: 'mac', icon: 'apple', description: text.mac, extension: '.dmg', source: sources?.macos?.universal, install: text.macInstall },
    { name: 'Windows', arch: 'x64', alias: 'win-x64', icon: 'windows', description: text.x64, extension: '.msix', source: sources?.windows?.x64, install: text.winInstall },
    { name: 'Windows', arch: 'ARM64', alias: 'win-arm64', icon: 'windows', description: text.arm, extension: '.msix', source: sources?.windows?.arm64, install: text.winInstall },
  ];
  const size = bytes => typeof bytes === 'number' && Number.isFinite(bytes) && bytes > 0
    ? `${new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(bytes / 1_000_000)} MB` : '—';
  const home = `https://cognia.cn${lang === 'zh-CN' ? '/zh' : '/'}`;
  return `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${text.description}"><meta name="color-scheme" content="light dark">
  <title>${text.title}</title>
  <link rel="icon" href="/favicon.ico"><link rel="canonical" href="https://mirror.cognia.cn/${lang === 'en' ? '?lang=en' : ''}">
  <link rel="alternate" hreflang="zh-CN" href="https://mirror.cognia.cn/">
  <link rel="alternate" hreflang="en" href="https://mirror.cognia.cn/?lang=en">
  <link rel="preload" href="/assets/geist-sans.woff2" as="font" type="font/woff2" crossorigin>
  <script src="/assets/theme.js"></script><link rel="stylesheet" href="/assets/mirror.css">
</head>
<body>
  <a class="skip-link" href="#downloads">${text.skip}</a>
  <header class="site-header">
    <nav class="shell navigation" aria-label="${text.nav}">
      <div class="brand-group"><a class="brand" href="${home}" aria-label="${text.home}">${brand}<span>Cognia</span></a><span class="brand-divider" aria-hidden="true">/</span><span class="site-name">Mirror</span></div>
      <div class="nav-actions">
        <a class="nav-link" href="https://docs.cognia.cn/${lang === 'en' ? 'en' : 'zh'}/docs">${text.docs}${icon('arrow')}</a>
        <a class="nav-link" href="https://github.com/MaxQian888/claude-app-mirror">GitHub${icon('arrow')}</a>
        <a class="locale-switch control" href="${lang === 'en' ? '/' : '/?lang=en'}" lang="${lang === 'en' ? 'zh-CN' : 'en'}" aria-label="${text.language}">${text.alternate}</a>
        <div class="theme-picker" hidden>
          <button id="theme-trigger" class="control" type="button" aria-label="${text.theme}" title="${text.theme}" aria-haspopup="menu" aria-expanded="false" aria-controls="theme-menu">
            ${icon('monitor', 'theme-system')}${icon('sun', 'theme-light')}${icon('moon', 'theme-dark')}
          </button>
          <div id="theme-menu" class="theme-menu" role="menu" aria-label="${text.theme}" hidden>
            <button type="button" role="menuitemradio" aria-checked="false" tabindex="-1" data-mode="light">${icon('sun')}<span>${text.light}</span></button>
            <button type="button" role="menuitemradio" aria-checked="false" tabindex="-1" data-mode="dark">${icon('moon')}<span>${text.dark}</span></button>
            <button type="button" role="menuitemradio" aria-checked="true" tabindex="-1" data-mode="system">${icon('monitor')}<span>${text.system}</span></button>
          </div>
        </div>
      </div>
    </nav>
  </header>
  <main>
    <section class="hero" aria-labelledby="title">
      <div class="shell hero-layout">
        <div class="hero-copy"><p class="eyebrow"><span class="signal" aria-hidden="true"></span>COGNIA MIRROR / DESKTOP</p>
          <h1 id="title">Claude Desktop<span>${text.headline}</span></h1>
          <p class="hero-description">${text.description}</p>
        </div>
        <div class="release-panel">
          <div class="release-heading"><span class="label">${text.release}</span><span class="outline-tag">${text.unofficial}</span></div>
          <p class="release-version">${version(manifest?.version)}</p>
          <dl><div><dt>${text.recorded}</dt><dd>${escape(recorded)}</dd></div><div><dt>${text.policy}</dt><dd>${text.latest}</dd></div></dl>
          ${hasVersion ? '' : `<p class="metadata-note">${text.unavailable}</p>`}
          <a class="release-link" href="https://github.com/MaxQian888/claude-app-mirror/releases/latest">${text.releaseLink}${icon('arrow')}</a>
        </div>
      </div>
    </section>
    <section class="shell downloads" id="downloads" aria-labelledby="platforms">
      <div class="section-heading"><div><h2 id="platforms">${text.platforms}</h2><p>${text.platformNote}</p></div><span class="label platforms-label">macOS / Windows</span></div>
      <div class="platform-grid">
        ${platforms.map(platform => `<article class="platform" aria-labelledby="platform-${platform.alias}">
          <div class="platform-top">${icon(platform.icon, 'platform-icon')}<span class="format label">${platform.extension}</span></div>
          <h3 id="platform-${platform.alias}">${platform.name}<span>${platform.arch}</span></h3>
          <p class="platform-description">${platform.description}</p>
          <p class="file-meta"><span>${version(platform.source?.version)}</span><span>${size(platform.source?.contentLength)}</span></p>
          <a class="download-button" href="/latest/${platform.alias}" aria-label="${text.download} ${platform.name} ${platform.arch}"><span>${text.download} ${platform.name}${platform.name === 'Windows' ? ` ${platform.arch}` : ''}</span>${icon('download')}</a>
          <p class="install-hint">${platform.install}</p>
        </article>`).join('')}
      </div>
      <div class="verification"><div class="verification-copy">${icon('check')}<div><h3>${text.verify}</h3><p>${text.verifyDescription}</p></div></div><div class="verification-links"><a href="/latest/checksums">${text.checksums}${icon('download')}</a><a href="/latest/manifest">${text.manifest}${icon('arrow')}</a></div></div>
    </section>
    <section class="shell help" aria-labelledby="help-title"><h2 id="help-title">${text.help}</h2><div class="questions">
      ${[['architecture', 'architectureAnswer'], ['original', 'originalAnswer'], ['history', 'historyAnswer']].map(([question, answer]) => `<details><summary>${text[question]}<span aria-hidden="true">+</span></summary><p>${text[answer]}</p></details>`).join('')}
    </div></section>
  </main>
  <footer class="site-footer"><div class="shell footer-layout"><div><a class="brand footer-brand" href="${home}">${brand}<span>Cognia<span class="footer-mirror"> / Mirror</span></span></a><p>${text.footer}</p></div><nav aria-label="${text.ecosystem}"><a href="${home}">Cognia${icon('arrow')}</a><a href="https://github.com/MaxQian888/claude-app-mirror">${text.source}${icon('arrow')}</a><a href="https://claude.ai/download">${text.official}${icon('arrow')}</a></nav></div></footer>
</body></html>`;
}
