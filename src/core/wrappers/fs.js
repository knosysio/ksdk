const shell = require('shelljs');

function cp(fromPath, toPath) {
  shell.cp(fromPath, toPath);
}

function rm(fileOrDirPath) {
  shell.rm('-rf', fileOrDirPath);
}

function mkdir(dirPath) {
  shell.mkdir('-p', dirPath);
}

function touch(filePath) {
  shell.touch(filePath);
}

module.exports = { cp, rm, mkdir, touch };
