import os from 'os';
import fs from 'fs';
import path from 'path';

// Determine user data directory based on OS (cross-platform)
const getUserDataDir = () => {
  const platform = process.platform;
  const homeDir = os.homedir();

  if (platform === 'win32') {
    // Windows: %APPDATA%\@nuqtaplus
    return path.join(homeDir, 'AppData', 'Roaming', '@nuqtaplus');
  } else if (platform === 'darwin') {
    // macOS: ~/Library/Application Support/@nuqtaplus
    return path.join(homeDir, 'Library', 'Application Support', '@nuqtaplus');
  } else {
    // Linux and other Unix-like systems: ~/.config/@nuqtaplus
    return path.join(homeDir, '.config', '@nuqtaplus');
  }
};

const userDataDir = getUserDataDir();

// Path to the database file
const dbFilePath = path.join(userDataDir, 'database', 'nuqtaplus.db');

const ensureDatabaseDirectoryExists = () => {
  const dbDir = path.dirname(dbFilePath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
};

ensureDatabaseDirectoryExists();

export { dbFilePath };
