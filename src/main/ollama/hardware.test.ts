import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { isLocalAddress, parseOllamaLog, readHardware } from './hardware';

const START_1 = `time=2026-10-11T20:01:02.000+02:00 level=INFO source=types.go:32 msg="inference compute" id=0 library=Vulkan name=Vulkan0 description="AMD Radeon RX 6950 XT" type=discrete total="16.0 GiB" available="14.0 GiB"
time=2026-10-11T20:01:02.010+02:00 level=INFO source=routes.go:2485 msg="vram-based default context" total_vram="16.0 GiB" default_num_ctx=4096`;
const START_2 = `time=2026-10-12T01:43:27.062+02:00 level=INFO source=types.go:32 msg="inference compute" id=0 library=Vulkan name=Vulkan0 description="AMD Radeon RX 6950 XT" type=discrete total="16.0 GiB" available="15.2 GiB"
time=2026-10-12T01:43:27.062+02:00 level=INFO source=types.go:32 msg="inference compute" id=1 library=Vulkan name=Vulkan1 description="second card" type=discrete total="8.0 GiB" available="512 MiB"
time=2026-10-12T01:43:27.062+02:00 level=INFO source=routes.go:2485 msg="vram-based default context" total_vram="24.0 GiB" default_num_ctx=8192
time=2026-10-12T01:44:00.000+02:00 level=INFO source=server.go:1 msg="llama runner started"`;

const folder = mkdtempSync(join(tmpdir(), 'wrontend-hardware-'));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

describe('Ollama’s log', () => {
  it('gives the memory of the latest start, summed over its devices, and its default context', () => {
    expect(parseOllamaLog(`${START_1}\n${START_2}\n`)).toEqual({ gpuBytes: 15.2 * 2 ** 30 + 512 * 2 ** 20, defaultContext: 8192 });
  });

  it('gives nothing it does not say', () => {
    expect(parseOllamaLog('time=x level=INFO msg="Listening on 127.0.0.1:11434"\n')).toEqual({ gpuBytes: null, defaultContext: null });
  });
});

describe('the hardware', () => {
  const log = join(folder, 'server.log');
  writeFileSync(log, `${START_1}\n${START_2}\n`);

  it('takes the stored context length over the one Ollama picked', async () => {
    expect(await readHardware({ local: true, contextSetting: '65536', logFile: log })).toMatchObject({ contextLength: 65536, source: 'ollama' });
    expect(await readHardware({ local: true, contextSetting: null, logFile: log })).toMatchObject({ contextLength: 8192 });
    expect(await readHardware({ local: true, contextSetting: 'lots', logFile: log })).toMatchObject({ contextLength: 8192 });
  });

  it('is not measured for an Ollama on another machine', async () => {
    expect(await readHardware({ local: false, contextSetting: '65536', logFile: log })).toBeNull();
    expect(isLocalAddress('http://127.0.0.1:11434')).toBe(true);
    expect(isLocalAddress('http://localhost:11434')).toBe(true);
    expect(isLocalAddress('http://gpu-box:11434')).toBe(false);
  });
});
