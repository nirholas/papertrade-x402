import { createApp } from '../../src/app.js';
import type { Env } from '../../src/config.js';

const app = createApp();

export const onRequest: PagesFunction<Env> = (context) => app.fetch(context.request, context.env);
