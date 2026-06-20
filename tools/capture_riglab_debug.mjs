import { chromium } from 'playwright';
import path from 'node:path';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:5185';
const outDir = process.argv[3] ?? path.resolve('.tmp/screenshots/riglab-debug');

const clips = [
  'RigLab_Neutral',
  'RigLab_Debug_Head_X',
  'RigLab_Debug_Head_Y',
  'RigLab_Debug_Head_Z',
  'RigLab_Debug_Neck1_X',
  'RigLab_Debug_Neck1_Y',
  'RigLab_Debug_Neck1_Z',
  'RigLab_Debug_Neck2_X',
  'RigLab_Debug_Neck2_Y',
  'RigLab_Debug_Neck2_Z',
  'RigLab_Debug_Spine2_X',
  'RigLab_Debug_Spine2_Y',
  'RigLab_Debug_Spine2_Z',
  'RigLab_Debug_L_Upper_X',
  'RigLab_Debug_L_Upper_Y',
  'RigLab_Debug_L_Upper_Z',
  'RigLab_Debug_L_Fore_X',
  'RigLab_Debug_L_Fore_Y',
  'RigLab_Debug_L_Fore_Z'
];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
await page.goto(`${baseUrl}/?fur=0#rig`, { waitUntil: 'networkidle' });
await page.locator('.rig-lab__avatar canvas').waitFor({ state: 'visible', timeout: 30000 });
await page.waitForFunction(() => typeof window.__rewindSetRigClip === 'function', null, { timeout: 30000 });

for (const clip of clips) {
  const ok = await page.evaluate((name) => window.__rewindSetRigClip(name), clip);
  if (!ok) {
    throw new Error(`Missing clip ${clip}`);
  }
  await page.waitForTimeout(250);
  await page.locator('.rig-lab__avatar').screenshot({ path: path.join(outDir, `${clip}.png`) });
}

await browser.close();
