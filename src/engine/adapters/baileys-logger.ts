import { BaileysLogger } from '../types/baileys.types';

const LIBSIGNAL_SECRET_BEARING_MESSAGES = new Set([
  'Closing session:',
  'Opening session:',
  'Removing old closed session:',
  'Session already closed',
]);

let libsignalConsoleRedactionInstalled = false;

export function redactLibsignalConsoleArgs(args: unknown[]): unknown[] {
  if (typeof args[0] !== 'string' || !LIBSIGNAL_SECRET_BEARING_MESSAGES.has(args[0])) {
    return args;
  }
  return [args[0], '[REDACTED_SESSION_STATE]'];
}

/**
 * libsignal 6 writes Signal session objects directly to console.info/warn, bypassing Baileys' logger.
 * Those objects contain private ratchet keys. Keep the operational message while dropping the object
 * before Node's console formatter can serialize it.
 */
export function installLibsignalConsoleRedaction(): void {
  if (libsignalConsoleRedactionInstalled) {
    return;
  }
  libsignalConsoleRedactionInstalled = true;

  for (const level of ['info', 'warn'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]): void => {
      original(...redactLibsignalConsoleArgs(args));
    };
  }
}

/** Fully silent logger so Baileys does not spam stdout; diagnostics flow via connection.update. */
export function createSilentLogger(): BaileysLogger {
  const noop = (): void => {};
  const logger: BaileysLogger = {
    level: 'silent',
    child: () => logger,
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
  };
  return logger;
}

const BAILEYS_LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error'];

/**
 * Baileys logger, silent by default. Set `BAILEYS_LOG_LEVEL` (trace|debug|info|warn|error) to surface
 * Baileys' own diagnostics - the history/app-state sync decision flow ("awaiting notification", "App
 * state sync complete", MAC errors) at debug/info, and the raw decoded WA wire frames at trace. Emits
 * JSON lines to stdout (context "baileys-wire") independent of the app log level, so a run can be
 * captured with `BAILEYS_LOG_LEVEL=trace node dist/main > baileys-wire.log`.
 */
export function createBaileysLogger(): BaileysLogger {
  installLibsignalConsoleRedaction();

  const configured = (process.env.BAILEYS_LOG_LEVEL ?? 'silent').toLowerCase();
  if (!BAILEYS_LOG_LEVELS.includes(configured)) {
    return createSilentLogger();
  }
  const threshold = BAILEYS_LOG_LEVELS.indexOf(configured);
  const write =
    (lvl: string) =>
    (obj: unknown, msg?: string): void => {
      if (BAILEYS_LOG_LEVELS.indexOf(lvl) < threshold) {
        return;
      }
      const rec =
        typeof obj === 'string' ? { msg: obj } : { ...(obj as Record<string, unknown>), ...(msg ? { msg } : {}) };
      process.stdout.write(
        JSON.stringify({ ts: new Date().toISOString(), level: lvl, context: 'baileys-wire', ...rec }) + '\n',
      );
    };
  const logger: BaileysLogger = {
    level: configured,
    child: () => logger,
    trace: write('trace'),
    debug: write('debug'),
    info: write('info'),
    warn: write('warn'),
    error: write('error'),
  };
  return logger;
}
