import { chromium } from 'playwright';
import path from 'node:path';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:5185';
const outDir = process.argv[3] ?? path.resolve('.tmp/screenshots/riglab-source-clips');
const fur = process.argv[4] ?? '1';
const rig = process.argv[5] ?? 'glb';
const look = process.argv[6] ?? 'official';

const poses = [
  'neutral',
  'tilt-left',
  'tilt-right',
  'turn-left',
  'turn-right',
  'look-up',
  'look-down',
  'hands-back',
  'raise-left',
  'raise-right',
  'mouth-left',
  'mouth-right',
  'eyes-left',
  'eyes-right'
];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });

const url = `${baseUrl}/?preset=neutral&fur=${fur}&rig=${rig}&look=${look}#rig`;
await page.goto(url, { waitUntil: 'networkidle' });
await page.locator('.rig-lab__avatar canvas').waitFor({ state: 'visible', timeout: 30000 });
await page.getByText('Unity v94', { exact: true }).waitFor({ state: 'visible', timeout: 90000 });
await page.waitForTimeout(3500);

for (const pose of poses) {
  const button = page.locator('.rig-lab__button-grid button').filter({ hasText: poseLabel(pose) });
  if (await button.count()) {
    await button.first().click();
  } else if (pose === 'neutral') {
    await page.getByText('0 Reset', { exact: true }).click();
  } else {
    await page.goto(`${baseUrl}/?preset=${pose}&fur=${fur}&rig=${rig}&look=${look}#rig`, { waitUntil: 'networkidle' });
    await page.getByText('Unity v94', { exact: true }).waitFor({ state: 'visible', timeout: 90000 });
  }
  await page.waitForTimeout(1400);
  await page.locator('.rig-lab__avatar').screenshot({ path: path.join(outDir, `${pose}.png`) });
}

await browser.close();

function poseLabel(pose) {
  const labels = {
    neutral: 'Neutral',
    'tilt-left': 'Tilt L',
    'tilt-right': 'Tilt R',
    'turn-left': 'Turn L',
    'turn-right': 'Turn R',
    'look-up': 'Look Up',
    'look-down': 'Look Down',
    'hands-back': 'Hands Back',
    'raise-left': 'Raise L',
    'raise-right': 'Raise R',
    'mouth-left': 'Mouth L',
    'mouth-right': 'Mouth R',
    'eyes-left': 'Eyes L',
    'eyes-right': 'Eyes R'
  };
  return labels[pose] ?? pose;
}
