#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const os = require('os');

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
};

// Progress bar class with ETA
class ProgressBar {
  constructor(total) {
    this.total = total;
    this.current = 0;
    this.barLength = 40;
    this.startTime = Date.now();
    this.completedTimes = [];
  }

  update(current, message = '') {
    this.current = current;
    const progress = this.current / this.total;
    const filledLength = Math.round(this.barLength * progress);
    const emptyLength = this.barLength - filledLength;
    
    const bar = '█'.repeat(filledLength) + '░'.repeat(emptyLength);
    const percentage = Math.round(progress * 100);
    
    // Calculate ETA
    let eta = '';
    if (this.current > 0) {
      const elapsedTime = (Date.now() - this.startTime) / 1000;
      const averageTimePerItem = elapsedTime / this.current;
      const remainingItems = this.total - this.current;
      const estimatedRemainingTime = remainingItems * averageTimePerItem;
      eta = ` | ETA: ${formatTime(estimatedRemainingTime)}`;
    }
    
    process.stdout.write(`\r[${bar}] ${percentage}% - ${message}${eta}`);
    
    if (this.current === this.total) {
      process.stdout.write('\n');
    }
  }

  recordCompletion(duration) {
    this.completedTimes.push(duration);
  }
}

// Format time in HH:MM:SS
function formatTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Get all MP4 files in a directory (including subdirectories if specified)
async function getMP4Files(directory, recursive = false) {
  const mp4Files = [];
  
  async function scanDirectory(dir) {
    try {
      const files = await fs.readdir(dir);
      
      for (const file of files) {
        const fullPath = path.join(dir, file);
        const stats = await fs.stat(fullPath);
        
        if (stats.isDirectory() && recursive) {
          await scanDirectory(fullPath);
        } else if (stats.isFile() && file.toLowerCase().endsWith('.mp4')) {
          mp4Files.push(fullPath);
        }
      }
    } catch (error) {
      console.error(`${colors.red}Error reading directory ${dir}:${colors.reset}`, error.message);
    }
  }
  
  await scanDirectory(directory);
  return mp4Files;
}

// Check if output file already exists
async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// Get file size in MB
async function getFileSize(filePath) {
  try {
    const stats = await fs.stat(filePath);
    return (stats.size / (1024 * 1024)).toFixed(2);
  } catch {
    return 0;
  }
}

// Analyze a single video
async function analyzeVideo(videoPath, options) {
  const baseName = path.basename(videoPath, '.MP4');
  const baseNameLower = path.basename(videoPath, '.mp4');
  const finalBaseName = baseName !== videoPath ? baseName : baseNameLower;
  const directory = path.dirname(videoPath);
  const outputPath = path.join(directory, `${finalBaseName}.txt`);
  
  // Check if already analyzed (skip by default unless force is enabled)
  if (!options.force && await fileExists(outputPath)) {
    return { status: 'skipped', reason: 'Already analyzed', outputPath };
  }
  
  // Build command with options
  const command = `video-analyzer "${videoPath}" --slim --delay-between-frames ${options.delay} --frame-skip ${options.frameSkip} --output "${outputPath}"`;
  
  try {
    const startTime = Date.now();
    const { stdout, stderr } = await execPromise(command, {
      maxBuffer: 10 * 1024 * 1024 // 10MB buffer
    });
    const duration = (Date.now() - startTime) / 1000;
    
    return { 
      status: 'success', 
      duration,
      output: stdout,
      outputPath
    };
  } catch (error) {
    return { 
      status: 'error', 
      error: error.message,
      stderr: error.stderr
    };
  }
}

// Save batch report
async function saveBatchReport(directory, results, options, totalDuration) {
  const report = {
    timestamp: new Date().toISOString(),
    directory,
    options,
    summary: {
      totalFiles: results.length,
      successful: results.filter(r => r.status === 'success').length,
      skipped: results.filter(r => r.status === 'skipped').length,
      errors: results.filter(r => r.status === 'error').length,
      totalDuration: totalDuration
    },
    results: results.map(r => ({
      file: r.file,
      status: r.status,
      duration: r.duration,
      outputPath: r.outputPath,
      error: r.error
    }))
  };
  
  const reportPath = path.join(directory, `batch-analysis-report-${Date.now()}.json`);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  return reportPath;
}

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    delay: 0,
    frameSkip: 30,
    force: false,
    recursive: true,
    directory: null
  };
  
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--delay':
      case '-d':
        options.delay = parseFloat(args[++i]) || 0;
        break;
      case '--frame-skip':
      case '-f':
        options.frameSkip = parseInt(args[++i]) || 10;
        break;
      case '--force':
        options.force = true;
        break;
      case '--recursive':
      case '-r':
        options.recursive = true;
        break;
      case '--help':
      case '-h':
        showHelp();
        process.exit(0);
      default:
        if (!options.directory && !args[i].startsWith('-')) {
          options.directory = args[i];
        }
    }
  }
  
  return options;
}

// Show help message
function showHelp() {
  console.log(`
${colors.cyan}${colors.bright}Video Batch Analyzer${colors.reset}

${colors.yellow}Usage:${colors.reset}
  batch-analyzer [directory] [options]

${colors.yellow}Options:${colors.reset}
  --delay, -d <seconds>     Delay between frames (default: 0)
  --frame-skip, -f <n>      Process every Nth frame (default: 30)
  --force                   Force re-analyze existing files
  --recursive, -r           Search subdirectories recursively
  --help, -h                Show this help message

${colors.yellow}Examples:${colors.reset}
  batch-analyzer                          # Analyze current directory
  batch-analyzer ./VIDEOS                 # Analyze VIDEOS directory
  batch-analyzer ./VIDEOS --frame-skip 15 # Use frame-skip of 15
  batch-analyzer ./VIDEOS --force         # Re-analyze all files
  batch-analyzer ./VIDEOS --recursive     # Include subdirectories
`);
}

// Main function
async function main() {
  const options = parseArgs();
  const targetDir = options.directory || process.cwd();
  
  console.clear();
  console.log(`${colors.cyan}${colors.bright}╔═══════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.cyan}${colors.bright}║      Video Batch Analyzer v2.0        ║${colors.reset}`);
  console.log(`${colors.cyan}${colors.bright}╚═══════════════════════════════════════╝${colors.reset}\n`);
  
  // Validate directory
  try {
    const stats = await fs.stat(targetDir);
    if (!stats.isDirectory()) {
      console.error(`${colors.red}❌ Error: Not a valid directory${colors.reset}`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`${colors.red}❌ Error: Directory not found${colors.reset}`);
    process.exit(1);
  }
  
  // Show configuration
  console.log(`${colors.blue}📁 Directory: ${targetDir}${colors.reset}`);
  console.log(`${colors.blue}⚙️  Configuration:${colors.reset}`);
  console.log(`  • Delay between frames: ${options.delay}s`);
  console.log(`  • Process every ${options.frameSkip} frame(s)`);
  console.log(`  • Skip existing: ${!options.force ? 'Yes' : 'No'}`);
  console.log(`  • Recursive search: ${options.recursive ? 'Yes' : 'No'}`);
  
  // Find MP4 files
  console.log(`\n${colors.blue}🔍 Scanning for MP4 files${options.recursive ? ' (including subdirectories)' : ''}...${colors.reset}`);
  const mp4Files = await getMP4Files(targetDir, options.recursive);
  
  if (mp4Files.length === 0) {
    console.log(`${colors.yellow}⚠️  No MP4 files found in ${targetDir}${colors.reset}`);
    process.exit(0);
  }
  
  console.log(`${colors.green}✓ Found ${mp4Files.length} MP4 file(s)${colors.reset}`);
  
  // Show files to be processed with size info
  console.log(`\n${colors.blue}📹 Files to process:${colors.reset}`);
  let totalSize = 0;
  const filesToProcess = [];
  const filesToSkip = [];
  
  for (const file of mp4Files) {
    const size = await getFileSize(file);
    totalSize += parseFloat(size);
    const relativePath = path.relative(targetDir, file);
    
    // Check if output already exists
    const baseName = path.basename(file, '.MP4');
    const baseNameLower = path.basename(file, '.mp4');
    const finalBaseName = baseName !== file ? baseName : baseNameLower;
    const outputPath = path.join(path.dirname(file), `${finalBaseName}.txt`);
    const exists = await fileExists(outputPath);
    
    if (exists && !options.force) {
      filesToSkip.push({ path: file, relativePath, size });
    } else {
      filesToProcess.push({ path: file, relativePath, size });
    }
  }
  
  // Show files to process
  if (filesToProcess.length > 0) {
    console.log(`\n${colors.green}Files to analyze:${colors.reset}`);
    filesToProcess.forEach((file, i) => {
      console.log(`  ${i + 1}. ${file.relativePath} ${colors.dim}(${file.size} MB)${colors.reset}`);
    });
  }
  
  // Show files to skip
  if (filesToSkip.length > 0) {
    console.log(`\n${colors.yellow}Files to skip (already analyzed):${colors.reset}`);
    filesToSkip.forEach(file => {
      console.log(`  • ${file.relativePath} ${colors.dim}(${file.size} MB)${colors.reset}`);
    });
  }
  
  if (filesToProcess.length === 0) {
    console.log(`\n${colors.yellow}✓ All files already analyzed. Use --force to re-analyze.${colors.reset}`);
    process.exit(0);
  }
  
  // Estimate time
  const processSize = filesToProcess.reduce((sum, f) => sum + parseFloat(f.size), 0);
  const estimatedTimePerMB = 2; // seconds (rough estimate)
  const adjustmentFactor = options.frameSkip / 10; // Adjust based on frame skip
  const totalEstimatedTime = processSize * estimatedTimePerMB / adjustmentFactor;
  
  console.log(`\n${colors.yellow}📊 Total size to process: ${processSize.toFixed(2)} MB${colors.reset}`);
  console.log(`${colors.yellow}⏱️  Estimated time: ${formatTime(totalEstimatedTime)}${colors.reset}`);
  
  // Show system resources
  const cpus = os.cpus().length;
  const totalMem = (os.totalmem() / (1024 * 1024 * 1024)).toFixed(2);
  const freeMem = (os.freemem() / (1024 * 1024 * 1024)).toFixed(2);
  console.log(`${colors.dim}💻 System: ${cpus} CPUs, ${freeMem}/${totalMem} GB RAM available${colors.reset}`);
  
  // Process videos
  console.log(`\n${colors.green}🚀 Starting analysis...${colors.reset}\n`);
  
  const progressBar = new ProgressBar(mp4Files.length);
  const results = [];
  const startTime = Date.now();
  
  for (let i = 0; i < mp4Files.length; i++) {
    const videoPath = mp4Files[i];
    const fileName = path.relative(targetDir, videoPath);
    
    progressBar.update(i, `Analyzing ${path.basename(videoPath)}...`);
    
    const result = await analyzeVideo(videoPath, options);
    result.file = fileName;
    results.push(result);
    
    if (result.status === 'success') {
      progressBar.recordCompletion(result.duration);
    } else if (result.status === 'error') {
      console.error(`\n${colors.red}❌ Error processing ${fileName}: ${result.error}${colors.reset}`);
    }
  }
  
  progressBar.update(mp4Files.length, 'Complete!');
  
  const totalDuration = (Date.now() - startTime) / 1000;
  
  // Save batch report
  const reportPath = await saveBatchReport(targetDir, results, options, totalDuration);
  
  // Show summary
  const successCount = results.filter(r => r.status === 'success').length;
  const skippedCount = results.filter(r => r.status === 'skipped').length;
  const errorCount = results.filter(r => r.status === 'error').length;
  
  console.log(`\n${colors.cyan}${colors.bright}═══════════════════════════════════════${colors.reset}`);
  console.log(`${colors.cyan}${colors.bright}           Analysis Summary            ${colors.reset}`);
  console.log(`${colors.cyan}${colors.bright}═══════════════════════════════════════${colors.reset}`);
  console.log(`${colors.green}✓ Successfully analyzed: ${successCount}${colors.reset}`);
  console.log(`${colors.yellow}⏭️  Skipped (already analyzed): ${skippedCount}${colors.reset}`);
  console.log(`${colors.red}❌ Errors: ${errorCount}${colors.reset}`);
  console.log(`${colors.blue}⏱️  Total time: ${formatTime(totalDuration)}${colors.reset}`);
  
  if (successCount > 0) {
    const avgTime = results
      .filter(r => r.status === 'success')
      .reduce((sum, r) => sum + r.duration, 0) / successCount;
    console.log(`${colors.blue}📊 Average time per video: ${formatTime(avgTime)}${colors.reset}`);
  }
  
  console.log(`\n${colors.green}✅ Analysis complete!${colors.reset}`);
  console.log(`${colors.cyan}📁 Results saved in: ${targetDir}${colors.reset}`);
  console.log(`${colors.magenta}📋 Batch report: ${path.relative(targetDir, reportPath)}${colors.reset}`);
  
  // Show error details if any
  if (errorCount > 0) {
    console.log(`\n${colors.red}Error details:${colors.reset}`);
    results.filter(r => r.status === 'error').forEach(r => {
      console.log(`  ${colors.red}• ${r.file}: ${r.error}${colors.reset}`);
    });
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log(`\n\n${colors.red}❌ Analysis interrupted by user${colors.reset}`);
  process.exit(0);
});

// Run the script
main().catch(error => {
  console.error(`${colors.red}Fatal error:${colors.reset}`, error);
  process.exit(1);
});