import fs from 'fs';
import path from 'path';
import os from 'os';

// Determine user data directory based on OS
const userDataDir = path.join(os.homedir(), 'AppData', 'Roaming', '@nuqtaplus');

// Path to the .init.lock file to track initialization
// most be in the userData directory
const lockFilePath = path.join(userDataDir, '.init.lock');

// Check if it's the first run
const isFirstRun = !fs.existsSync(lockFilePath);

const createLockFile = () => {
  // Ensure the user data directory exists
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }
  fs.writeFileSync(lockFilePath, 'Initialization complete');
};

export { isFirstRun, createLockFile };
