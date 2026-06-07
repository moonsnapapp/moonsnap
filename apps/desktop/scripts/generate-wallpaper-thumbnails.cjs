/**
 * Generate thumbnail versions of wallpaper images for the sidebar preview.
 *
 * Usage: node scripts/generate-wallpaper-thumbnails.js
 *
 * Requires: npm install sharp
 */

const fs = require('fs');
const path = require('path');

// Check if sharp is installed
let sharp;
try {
  sharp = require('sharp');
} catch (e) {
  console.error('Error: sharp is not installed. Run: npm install sharp');
  process.exit(1);
}

const BACKGROUNDS_DIR = path.join(__dirname, '../src-tauri/assets/backgrounds');
const THUMBNAIL_SIZE = { width: 200, height: 112 }; // 16:9 aspect ratio
const THUMBNAIL_QUALITY = 60; // JPEG quality (lower = smaller file)

function createThumbnailStats() {
  return {
    totalOriginal: 0,
    totalThumbnail: 0,
    count: 0,
  };
}

function getThemeDirectories() {
  return fs.readdirSync(BACKGROUNDS_DIR).filter((entry) =>
    fs.statSync(path.join(BACKGROUNDS_DIR, entry)).isDirectory()
  );
}

function ensureThumbnailDirectory(themeDir) {
  const thumbDir = path.join(themeDir, 'thumbs');
  if (!fs.existsSync(thumbDir)) {
    fs.mkdirSync(thumbDir, { recursive: true });
  }
  return thumbDir;
}

function getWallpaperFiles(themeDir) {
  return fs.readdirSync(themeDir).filter(isWallpaperImage);
}

function isWallpaperImage(file) {
  return file.endsWith('.jpg') || file.endsWith('.png');
}

function getThumbnailOutputPath(thumbDir, file) {
  return path.join(thumbDir, file.replace(/\.(jpg|png)$/, '.jpg'));
}

async function renderThumbnail(inputPath, outputPath) {
  await sharp(inputPath)
    .resize(THUMBNAIL_SIZE.width, THUMBNAIL_SIZE.height, {
      fit: 'cover',
      position: 'center',
    })
    .jpeg({ quality: THUMBNAIL_QUALITY })
    .toFile(outputPath);
}

function recordThumbnailStats(stats, originalSize, thumbSize) {
  stats.totalOriginal += originalSize;
  stats.totalThumbnail += thumbSize;
  stats.count++;
}

async function processWallpaperFile(theme, themeDir, thumbDir, file, stats) {
  const inputPath = path.join(themeDir, file);
  const outputPath = getThumbnailOutputPath(thumbDir, file);

  try {
    const originalSize = fs.statSync(inputPath).size;
    await renderThumbnail(inputPath, outputPath);
    const thumbSize = fs.statSync(outputPath).size;
    recordThumbnailStats(stats, originalSize, thumbSize);
    logThumbnailResult(theme, file, originalSize, thumbSize);
  } catch (err) {
    console.error(`Failed ${theme}/${file}: ${err.message}`);
  }
}

function logThumbnailResult(theme, file, originalSize, thumbSize) {
  console.log(
    `Generated ${theme}/${file}: ${formatKilobytes(originalSize)}KB -> ${formatKilobytes(thumbSize)}KB`
  );
}

function formatKilobytes(bytes) {
  return (bytes / 1024).toFixed(1);
}

function logThumbnailSummary(stats) {
  console.log('\n--- Summary ---');
  console.log(`Processed: ${stats.count} images`);
  console.log(`Original total: ${formatMegabytes(stats.totalOriginal)}MB`);
  console.log(`Thumbnail total: ${formatMegabytes(stats.totalThumbnail)}MB`);
  console.log(`Reduction: ${getReductionPercent(stats)}%`);
}

function formatMegabytes(bytes) {
  return (bytes / 1024 / 1024).toFixed(2);
}

function getReductionPercent(stats) {
  return ((1 - stats.totalThumbnail / stats.totalOriginal) * 100).toFixed(1);
}

async function processTheme(theme, stats) {
  const themeDir = path.join(BACKGROUNDS_DIR, theme);
  const thumbDir = ensureThumbnailDirectory(themeDir);
  const files = getWallpaperFiles(themeDir);

  for (const file of files) {
    await processWallpaperFile(theme, themeDir, thumbDir, file, stats);
  }
}

async function generateThumbnails() {
  const stats = createThumbnailStats();

  for (const theme of getThemeDirectories()) {
    await processTheme(theme, stats);
  }

  logThumbnailSummary(stats);
}

generateThumbnails().catch(console.error);
