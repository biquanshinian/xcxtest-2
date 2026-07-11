"""Estimate WeChat main package size (source files, excluding subpackages and packOptions.ignore)."""
import os
import fnmatch

root = os.path.dirname(os.path.abspath(__file__))
subpkg = (
    'subpackages/', 'pages/nasa-data/', 'pages/about/', 'pages/collect/',
    'pages/space-explore/', 'pages/image-preview/', 'pages/webview/',
    'pages/mission-detail/', 'pages/search/', 'pages/video-player/',
)
exclude_dirs = {
    'node_modules', 'cloudfunctions', 'admin-web', '.git', '_error_report_extract',
    'scripts', 'scf-cos-trigger', 'cloudfunctionTemplate', '.github', 'workers', 'test', 'docs',
}
ignore_globs = [
    'admin-web.zip', '**/*.zip', '_weanalysis*', '_analyze_size*', 'workers/**', 'test/**',
    'docs/**', 'utils/.api-full.backup.js', 'cloudflare-worker/**', 'admin-web/**',
    '_error_report_extract/**', '**/*.md', '*.md', 'scf-cos-trigger/**', 'scripts/**',
    'cloudfunctions/**', 'cloudfunctionTemplate/**', 'project.miniapp.json',
    'code_obfuscation_config.json', 'project.private.config.json', 'package-lock.json',
    'eslint.config.js', '_weanalysis*.py', '_analyze_size.py', 'md2wechat*.sh', 'utils/api.js',
    '.prettierrc.json', '.prettierignore', '.gitignore', 'package.json',
]


def norm(p):
    return p.replace('\\', '/')


def ignored(rel):
    base = os.path.basename(rel)
    for g in ignore_globs:
        if fnmatch.fnmatch(rel, g) or fnmatch.fnmatch(base, g):
            return True
    return False


def is_main(rel):
    return not any(rel.startswith(p) for p in subpkg)


files = []
for dp, dns, fns in os.walk(root):
    dns[:] = [d for d in dns if d not in exclude_dirs]
    for f in fns:
        full = os.path.join(dp, f)
        rel = norm(os.path.relpath(full, root))
        if not is_main(rel) or ignored(rel):
            continue
        try:
            files.append((os.path.getsize(full), rel))
        except OSError:
            pass

files.sort(key=lambda x: -x[0])
total = sum(s for s, _ in files)
print(f'MAIN PACKAGE: {total/1024:.1f} KB ({total/1024/1024:.3f} MB) - {len(files)} files')
folders = {}
for sz, rel in files:
    parts = rel.split('/')
    if parts[0] == 'pages' and len(parts) > 1:
        key = 'pages/' + parts[1]
    elif parts[0] in ('utils', 'components', 'images', 'custom-tab-bar', 'styles'):
        key = parts[0]
    else:
        key = parts[0]
    folders[key] = folders.get(key, 0) + sz
print('By folder:')
for k, v in sorted(folders.items(), key=lambda x: -x[1]):
    print(f'  {k}: {v/1024:.1f} KB')
print('Top 20:')
for sz, rel in files[:20]:
    print(f'  {sz/1024:.1f} KB  {rel}')
