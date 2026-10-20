const express = require('express');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

const app = express();
const PORT = process.env.PORT || 3000;
const FILES_DIR = path.join(__dirname, 'files');

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

async function ensureFilesDir() {
  await fsp.mkdir(FILES_DIR, { recursive: true });
}

// Accept safe paths relative to files/ and reject traversal outside it.
function safeRelativePath(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim().replace(/\\/g, '/');
  if (!raw) return '';
  if (raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) return null;
  const parts = raw.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || /[<>:"|?*\x00-\x1f]/.test(part))) return null;
  const resolved = path.resolve(FILES_DIR, ...parts);
  if (resolved !== FILES_DIR && !resolved.startsWith(FILES_DIR + path.sep)) return null;
  return parts.join(path.sep);
}

function safeEntryName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  if (!name || name === '.' || name === '..' || /[\\/:*?"<>|\x00-\x1f]/.test(name)) return null;
  return name;
}

function makeTxtName(value) {
  const name = safeEntryName(String(value || '').replace(/\.txt$/i, ''));
  return name ? `${name}.txt` : null;
}

function fullPath(relativePath) {
  const safe = safeRelativePath(relativePath);
  if (safe === null) return null;
  const resolved = path.resolve(FILES_DIR, safe);
  if (resolved !== FILES_DIR && !resolved.startsWith(FILES_DIR + path.sep)) return null;
  return resolved;
}

function displaySize(bytes) {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

async function getEntries(relativeDir = '') {
  await ensureFilesDir();
  const directory = fullPath(relativeDir);
  if (!directory) throw Object.assign(new Error('Invalid folder path'), { status: 400 });
  const names = await fsp.readdir(directory, { withFileTypes: true });
  const entries = await Promise.all(names.map(async entry => {
    const rel = path.posix.join(relativeDir.split(path.sep).join('/'), entry.name).replace(/^\//, '');
    const absolute = path.join(directory, entry.name);
    const stat = await fsp.stat(absolute);
    if (entry.isDirectory()) return { type: 'folder', name: entry.name, relativePath: rel, modified: stat.mtime, size: 0, sizeLabel: 'Folder' };
    if (entry.isFile()) return { type: 'file', name: entry.name, relativePath: rel, modified: stat.mtime, size: stat.size, sizeLabel: displaySize(stat.size) };
    return null;
  }));
  return entries.filter(Boolean).sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1);
}

app.get('/', async (req, res, next) => {
  try {
    const currentDir = safeRelativePath(req.query.dir || '');
    if (currentDir === null) return res.status(400).send('Invalid folder path. <a href="/">Go back</a>');
    const dirPath = fullPath(currentDir);
    const stat = await fsp.stat(dirPath);
    if (!stat.isDirectory()) return res.status(400).send('That path is not a folder. <a href="/">Go back</a>');
    const entries = await getEntries(currentDir);
    const files = entries.filter(entry => entry.type === 'file');
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    const breadcrumbs = currentDir ? currentDir.split(path.sep).map((name, index, parts) => ({ name, path: parts.slice(0, index + 1).join('/') })) : [];
    res.render('index', { entries, files, totalSize, currentDir: currentDir.split(path.sep).join('/'), breadcrumbs });
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return res.status(404).send('Folder not found. <a href="/">Go back</a>');
    next(error);
  }
});

app.post('/create', async (req, res, next) => {
  try {
    const filename = makeTxtName(req.body.title);
    const currentDir = safeRelativePath(req.body.dir || '');
    if (!filename || currentDir === null) return res.status(400).send('Please enter a valid file or folder name. <a href="/">Go back</a>');
    const destinationDir = fullPath(currentDir);
    await fsp.mkdir(destinationDir, { recursive: true });
    await fsp.writeFile(path.join(destinationDir, filename), String(req.body.body || ''), { flag: 'wx' });
    res.redirect('/?dir=' + encodeURIComponent(currentDir.split(path.sep).join('/')));
  } catch (error) {
    if (error.code === 'EEXIST') return res.status(409).send('A file with this name already exists. <a href="/">Go back</a>');
    next(error);
  }
});

app.post('/folders/create', async (req, res, next) => {
  try {
    const folderName = safeEntryName(req.body.folderName);
    const currentDir = safeRelativePath(req.body.dir || '');
    if (!folderName || currentDir === null) return res.status(400).send('Please enter a valid folder name. <a href="/">Go back</a>');
    const parent = fullPath(currentDir);
    await fsp.mkdir(parent, { recursive: true });
    await fsp.mkdir(path.join(parent, folderName));
    res.redirect('/?dir=' + encodeURIComponent(currentDir.split(path.sep).join('/')));
  } catch (error) {
    if (error.code === 'EEXIST') return res.status(409).send('A folder with this name already exists. <a href="/">Go back</a>');
    next(error);
  }
});

app.post('/folders/delete', async (req, res, next) => {
  try {
    const folder = safeRelativePath(req.body.folder || '');
    const currentDir = safeRelativePath(req.body.dir || '');
    if (!folder || folder === null || currentDir === null) return res.status(400).send('Invalid folder path. <a href="/">Go back</a>');
    const folderPath = fullPath(folder);
    if (!folderPath || folderPath === FILES_DIR) return res.status(400).send('Cannot delete this folder. <a href="/">Go back</a>');
    await fsp.rmdir(folderPath); // Only empty folders can be removed.
    res.redirect('/?dir=' + encodeURIComponent(currentDir.split(path.sep).join('/')));
  } catch (error) {
    if (error.code === 'ENOENT') return res.status(404).send('Folder not found. <a href="/">Go back</a>');
    if (error.code === 'ENOTEMPTY' || error.code === 'EEXIST') return res.status(409).send('Folder is not empty. Move or delete its contents first. <a href="/">Go back</a>');
    next(error);
  }
});

app.get('/about', async (req, res, next) => {
  try {
    const relative = safeRelativePath(req.query.file || '');
    if (!relative || relative === null) return res.status(400).send('Invalid file path. <a href="/">Go back</a>');
    const absolute = fullPath(relative);
    const stat = await fsp.stat(absolute);
    if (!stat.isFile()) return res.status(400).send('That path is not a file. <a href="/">Go back</a>');
    const filedata = await fsp.readFile(absolute, 'utf8');
    const parentDir = path.posix.dirname(relative.split(path.sep).join('/'));
    res.render('code', { filename: path.basename(relative), relativePath: relative.split(path.sep).join('/'), parentDir: parentDir === '.' ? '' : parentDir, filedata, size: stat.size, modified: stat.mtime });
  } catch (error) {
    if (error.code === 'ENOENT') return res.status(404).send('File not found. <a href="/">Go back</a>');
    next(error);
  }
});

app.get('/download', async (req, res, next) => {
  const relative = safeRelativePath(req.query.file || '');
  if (!relative || relative === null) return res.status(400).send('Invalid file path. <a href="/">Go back</a>');
  const absolute = fullPath(relative);
  res.download(absolute, path.basename(relative), error => {
    if (error && !res.headersSent) {
      if (error.code === 'ENOENT') return res.status(404).send('File not found. <a href="/">Go back</a>');
      next(error);
    }
  });
});

app.get('/update', async (req, res, next) => {
  try {
    const relative = safeRelativePath(req.query.file || '');
    if (!relative || relative === null) return res.status(400).send('Invalid file path. <a href="/">Go back</a>');
    const absolute = fullPath(relative);
    const filedata = await fsp.readFile(absolute, 'utf8');
    const parentDir = path.posix.dirname(relative.split(path.sep).join('/'));
    res.render('update', { filename: path.basename(relative), relativePath: relative.split(path.sep).join('/'), parentDir: parentDir === '.' ? '' : parentDir, filedata });
  } catch (error) {
    if (error.code === 'ENOENT') return res.status(404).send('File not found. <a href="/">Go back</a>');
    next(error);
  }
});

app.post('/update', async (req, res, next) => {
  try {
    const oldRelative = safeRelativePath(req.body.oldname || '');
    const newName = makeTxtName(req.body.newname || '');
    if (!oldRelative || oldRelative === null || !newName) return res.status(400).send('Please enter a valid file name. <a href="/">Go back</a>');
    const oldPath = fullPath(oldRelative);
    const newPath = path.join(path.dirname(oldPath), newName);
    if (oldPath !== newPath) {
      try { await fsp.access(newPath); return res.status(409).send('Another file already uses that name. <a href="/">Go back</a>'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    await fsp.writeFile(oldPath, String(req.body.newcontent || ''));
    if (oldPath !== newPath) await fsp.rename(oldPath, newPath);
    const parentDir = path.posix.dirname(oldRelative.split(path.sep).join('/'));
    res.redirect('/?dir=' + encodeURIComponent(parentDir === '.' ? '' : parentDir));
  } catch (error) {
    if (error.code === 'ENOENT') return res.status(404).send('File not found. <a href="/">Go back</a>');
    next(error);
  }
});

app.post('/delete', async (req, res, next) => {
  try {
    const relative = safeRelativePath(req.body.delete || '');
    const currentDir = safeRelativePath(req.body.dir || '');
    if (!relative || relative === null || currentDir === null) return res.sendStatus(400);
    await fsp.unlink(fullPath(relative));
    res.redirect('/?dir=' + encodeURIComponent(currentDir.split(path.sep).join('/')));
  } catch (error) {
    if (error.code === 'ENOENT') return res.status(404).send('File not found. <a href="/">Go back</a>');
    next(error);
  }
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(error.status || 500).send('Something went wrong. Please try again. <a href="/">Go back</a>');
});

ensureFilesDir().then(() => {
  app.listen(PORT, () => console.log(`File Manager running at http://localhost:${PORT}`));
});
