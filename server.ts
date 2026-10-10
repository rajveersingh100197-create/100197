/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { app } from './server/app';
import { CONFIG } from './server/config';
import { logger } from './server/logger';

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(CONFIG.PORT, '0.0.0.0', () => {
    logger.info(
      'Server',
      `DiwaliBigdeal Telegram Bot Backend running on http://0.0.0.0:${CONFIG.PORT}`
    );
  });
}

if (process.env.VERCEL !== '1') {
  startServer();
}

export { app };
export default app;
