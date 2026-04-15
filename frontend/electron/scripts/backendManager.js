import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import path from 'path';
import { app } from 'electron';
import logger from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';

export default class BackendManager {
  constructor() {
    this.backendProcess = null;
    this.backendPID = null;
  }

  isRunning() {
    return (
      this.backendProcess &&
      !this.backendProcess.killed &&
      typeof this.backendProcess.pid === 'number'
    );
  }

  async StartBackend() {
    if (this.backendProcess && !this.backendProcess.killed) {
      logger.warn('Backend server is already running');
      return;
    }

    let command, args, cwd;

    if (isDev) {
      // Dev mode: run backend directly using node --watch
      const backendPackageDir = path.resolve(__dirname, '../../../../backend');
      const serverScript = path.join(backendPackageDir, 'src', 'server.js');

      command = process.platform === 'win32' ? 'node.exe' : 'node';
      args = ['--watch', serverScript];
      cwd = backendPackageDir;

      logger.info(`Starting backend in dev mode from: ${backendPackageDir}`);
    } else {
      // Production: use bundled Node.js executable
      const backendDir = path.join(process.resourcesPath, 'backend');
      const serverScript = path.join(backendDir, 'src', 'server.js');
      const bundledNode = path.join(backendDir, 'bin', 'node.exe');

      // Verify files exist
      const fs = await import('fs');
      const scriptExists = fs.existsSync(serverScript);
      if (!scriptExists) {
        logger.error(`Server script not found at: ${serverScript}`);
        throw new Error(`Server script not found at: ${serverScript}`);
      }

      const nodeExists = fs.existsSync(bundledNode);
      if (!nodeExists) {
        logger.error(`Bundled Node.js not found at: ${bundledNode}`);
        throw new Error(`Bundled Node.js not found at: ${bundledNode}`);
      }

      // Use bundled Node.js executable
      command = bundledNode;
      args = [serverScript];
      cwd = backendDir;

      logger.info(`Starting backend in production mode from: ${backendDir}`);
      logger.info(`Using bundled Node.js: ${bundledNode}`);
    }

    // ابدأ عملية الخلفية

    this.backendProcess = spawn(command, args, {
      cwd,
      stdio: 'pipe',
      env: { ...process.env },
    });

    this.backendPID = this.backendProcess.pid;
    logger.info(`Backend PID: ${this.backendPID}`);

    this.backendProcess.on('error', (err) => {
      logger.error('Failed to start backend server:', err);
    });

    this.backendProcess.on('exit', (code) => {
      logger.info(`Backend server exited with code ${code}`);
      this.backendProcess = null;
    });

    logger.info('Backend server started');
  }

  async StopBackend() {
    if (!this.isRunning()) {
      logger.warn('StopBackend: process not running — skip.');
      return;
    }

    try {
      logger.info(`Stopping backend (PID: ${this.backendProcess.pid})...`);
      this.backendProcess.kill();
      await this.ShutDownBackendGracefully();
      logger.info('Backend process stopped successfully');
    } catch (err) {
      logger.warn(`StopBackend kill failed: ${err.message}`);
    }

    this.backendProcess = null;
  }

  async ShutDownBackendGracefully() {
    if (!this.backendProcess || this.backendProcess.killed) {
      logger.warn('Backend server is not running');
      return;
    }

    logger.info('Gracefully shutting down backend server...');

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        logger.warn('Backend did not stop gracefully, forcing shutdown');
        this.backendProcess.kill('SIGKILL');
        resolve();
      }, 5000);

      this.backendProcess.on('exit', () => {
        clearTimeout(timeout);
        logger.info('Backend server shut down gracefully');
        this.backendProcess = null;
        resolve();
      });

      this.backendProcess.kill('SIGTERM');
    });
  }

  async CleanupBackendProcess() {
    if (!this.isRunning()) {
      logger.warn('Cleanup requested but backend is not running — skip kill.');
      return;
    }

    try {
      logger.info(`Cleaning backend (PID: ${this.backendProcess.pid})...`);
      this.backendProcess.kill('SIGKILL');
      await this.ShutDownBackendGracefully();
      logger.info('Backend process killed successfully');
    } catch (err) {
      logger.warn(`Backend kill failed but it’s OK: ${err.message}`);
    }

    this.backendProcess = null;
  }
}
