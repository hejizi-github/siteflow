import type { CDPSession } from 'playwright';
import type { ScriptInfo } from '../shared/types.js';

export async function getScriptSource(cdp: CDPSession, scriptId: string): Promise<string> {
  const result = await cdp.send('Debugger.getScriptSource', { scriptId }) as { scriptSource: string };
  return result.scriptSource;
}

export async function getScriptSnippet(
  cdp: CDPSession | undefined,
  script: ScriptInfo | undefined,
  scriptId: string,
  absoluteLineNumber: number,
  radius = 2,
): Promise<Array<{ lineNumber: number; text: string }>> {
  if (!script || !cdp) return [];
  try {
    const source = await getScriptSource(cdp, scriptId);
    const lines = source.split(/\r?\n/);
    const localLine = absoluteLineNumber - script.startLine;
    const start = Math.max(0, localLine - radius);
    const end = Math.min(lines.length - 1, localLine + radius);
    const snippet: Array<{ lineNumber: number; text: string }> = [];
    for (let index = start; index <= end; index++) {
      snippet.push({
        lineNumber: script.startLine + index,
        text: lines[index],
      });
    }
    return snippet;
  } catch {
    return [];
  }
}
