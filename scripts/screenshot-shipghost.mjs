import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function run() {
  console.log('🎬 Initializing ShipGhost screenshot script...');
  
  const server = http.createServer((req, res) => {
    let reqUrl = req.url.split('?')[0].split('#')[0];
    if (reqUrl === '/' || reqUrl === '/index.html') {
      reqUrl = '/bundle/index.html';
    }
    
    let filePath = path.join(__dirname, '..', reqUrl);
    if (!fs.existsSync(filePath)) {
      filePath = path.join(__dirname, '../bundle', reqUrl);
    }
    if (!fs.existsSync(filePath) && reqUrl.includes('/public/')) {
      filePath = path.join(__dirname, '..', reqUrl.substring(reqUrl.indexOf('/public/')));
    }

    let contentType = 'text/html';
    if (filePath.endsWith('.js')) contentType = 'application/javascript';
    else if (filePath.endsWith('.css')) contentType = 'text/css';
    else if (filePath.endsWith('.png')) contentType = 'image/png';
    else if (filePath.endsWith('.svg')) contentType = 'image/svg+xml';
    else if (filePath.endsWith('.json')) contentType = 'application/json';

    fs.readFile(filePath, (err, content) => {
      if (err) {
        res.writeHead(404);
        res.end('Not Found');
      } else {
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
      }
    });
  });

  let port = 8000;
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      console.log(`Local static server started at http://localhost:${port}`);
      resolve();
    });
  });

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1280, height: 800 },
    args: ['--window-size=1300,900', '--no-sandbox']
  });
  
  const page = await browser.newPage();
  const indexUrl = `http://localhost:${port}/bundle/index.html`;

  try {
    // 1. Load the input screen
    console.log('Loading input screen...');
    await page.goto(indexUrl);
    await page.waitForSelector('#btn-start-analysis');
    await page.screenshot({ path: path.resolve(__dirname, '../docs/step1_input.png') });
    
    // 2. Load the sample fixtures to skip real git execution in test headless browser
    console.log('Simulating loading sample branch...');
    await page.click('#btn-load-sample');
    await delay(500);
    
    // 3. Initiate analysis
    console.log('Triggering analysis...');
    await page.click('#btn-start-analysis');
    
    // 4. Wait for analysis screen
    await delay(1000);
    await page.screenshot({ path: path.resolve(__dirname, '../docs/step2_payment.png') });
    
    // 5. Pay micro fee (if challenge is present)
    console.log('Approving payment challenge if present...');
    try {
      await page.waitForSelector('#btn-pay-x402', { visible: true, timeout: 2000 });
      await page.click('#btn-pay-x402');
      await delay(1000);
    } catch (e) {
      console.log('No active payment challenge modal detected, skipping.');
    }
    
    // 6. Wait for dashboard screen to load
    console.log('Waiting for dashboard view...');
    await page.waitForSelector('#screen-dashboard.active', { timeout: 10000 });
    await delay(1000);
    await page.screenshot({ path: path.resolve(__dirname, '../docs/step3_dashboard.png') });
    
    // 7. Toggle to comments tab
    console.log('Navigating to Comments tab...');
    await page.click('#tab-inline-comments');
    await delay(1000);
    await page.screenshot({ path: path.resolve(__dirname, '../docs/step4_comments.png') });
    
    // 8. Toggle to commits tab
    console.log('Navigating to Commits tab...');
    await page.click('#tab-commit-cleanup');
    await delay(1000);
    await page.screenshot({ path: path.resolve(__dirname, '../docs/step5_commits.png') });
    
    console.log('Screen capture run complete! Demos saved in docs/ folder.');
  } catch (error) {
    console.error('Error recording UI states:', error);
  } finally {
    await browser.close();
    server.close();
  }
}

run();
