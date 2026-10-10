/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { SystemLogEntry } from './types';
import crypto from 'crypto';

const MAX_LOGS = 250;
const logs: SystemLogEntry[] = [];

export const logger = {
  log(
    level: SystemLogEntry['level'],
    component: string,
    message: string,
    metadata?: Record<string, unknown>
  ): SystemLogEntry {
    const entry: SystemLogEntry = {
      id: crypto.randomUUID(),
      level,
      component,
      message,
      metadata,
      timestamp: new Date().toISOString(),
    };
    logs.unshift(entry);
    if (logs.length > MAX_LOGS) {
      logs.pop();
    }
    const metaStr = metadata ? ` ${JSON.stringify(metadata)}` : '';
    console.log(`[${entry.timestamp}] [${level}] [${component}] ${message}${metaStr}`);
    return entry;
  },

  info(component: string, message: string, metadata?: Record<string, unknown>) {
    return this.log('INFO', component, message, metadata);
  },

  warn(component: string, message: string, metadata?: Record<string, unknown>) {
    return this.log('WARN', component, message, metadata);
  },

  error(component: string, message: string, metadata?: Record<string, unknown>) {
    return this.log('ERROR', component, message, metadata);
  },

  security(component: string, message: string, metadata?: Record<string, unknown>) {
    return this.log('SECURITY', component, message, metadata);
  },

  webhook(component: string, message: string, metadata?: Record<string, unknown>) {
    return this.log('WEBHOOK', component, message, metadata);
  },

  getRecentLogs(limit = 100): SystemLogEntry[] {
    return logs.slice(0, limit);
  },

  clearLogs() {
    logs.length = 0;
  },
};
