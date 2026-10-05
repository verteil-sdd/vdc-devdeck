import os from 'os';
import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

class SystemMetrics {
  constructor() {
    this.prevCpuTimes = this.getCpuTimes();
  }

  getCpuTimes() {
    const cpus = os.cpus();
    let idle = 0;
    let total = 0;
    for (const cpu of cpus) {
      for (const type in cpu.times) {
        total += cpu.times[type];
      }
      idle += cpu.times.idle;
    }
    return { idle, total };
  }

  getCpuUsage() {
    const current = this.getCpuTimes();
    const idleDiff = current.idle - this.prevCpuTimes.idle;
    const totalDiff = current.total - this.prevCpuTimes.total;
    this.prevCpuTimes = current;

    if (totalDiff <= 0) return 0;
    const usage = Math.round(100 - (100 * idleDiff) / totalDiff);
    return Math.max(0, Math.min(100, usage));
  }

  async getMetrics() {
    const cpu = this.getCpuUsage();
    let memTotal = os.totalmem();
    let memFree = os.freemem();
    let swapTotal = 0;
    let swapFree = 0;

    try {
      if (fs.existsSync('/proc/meminfo')) {
        const lines = fs.readFileSync('/proc/meminfo', 'utf8').split('\n');
        const map = {};
        for (const line of lines) {
          const parts = line.split(':');
          if (parts.length === 2) {
            map[parts[0].trim()] = parseInt(parts[1].trim(), 10);
          }
        }
        if (map['MemTotal']) memTotal = map['MemTotal'] * 1024;
        if (map['MemAvailable']) memFree = map['MemAvailable'] * 1024;
        if (map['SwapTotal']) swapTotal = map['SwapTotal'] * 1024;
        if (map['SwapFree']) swapFree = map['SwapFree'] * 1024;
      }
    } catch {}

    const memTotalMb = Math.round(memTotal / (1024 * 1024));
    const memUsedMb = Math.round((memTotal - memFree) / (1024 * 1024));
    const memPercent = memTotalMb > 0 ? Math.round((memUsedMb / memTotalMb) * 100) : 0;

    const swapTotalMb = Math.round(swapTotal / (1024 * 1024));
    const swapUsedMb = Math.round((swapTotal - swapFree) / (1024 * 1024));
    const swapPercent = swapTotalMb > 0 ? Math.round((swapUsedMb / swapTotalMb) * 100) : 0;

    let activeJvms = 0;
    try {
      const { stdout } = await execAsync('pgrep -c java').catch(() => ({ stdout: '0' }));
      activeJvms = parseInt(stdout.trim(), 10) || 0;
    } catch {}

    return {
      cpu,
      memTotalMb,
      memUsedMb,
      memPercent,
      swapTotalMb,
      swapUsedMb,
      swapPercent,
      activeJvms,
      loadAvg: os.loadavg()[0].toFixed(2),
      uptime: Math.round(os.uptime())
    };
  }
}

export const systemMetrics = new SystemMetrics();
