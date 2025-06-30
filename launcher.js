import puppeteer from 'puppeteer-core';
import path from 'path';
import os from 'os';
import fs from 'fs';

console.log('IAR-Launcher script\nAuther: M. Meikle');

// Config
const WEBSITE_URL = 'https://auth.iamresponding.com/login/member';
//const WEBSITE_URL = 'https://google.com';
const EXEC_PATH = '/usr/bin/chromium-browser';
const DISPLAY_WIDTH = 1920;
const DISPLAY_HEIGHT = 1080;
const USER_JS_CONTENT = `
	user_pref("toolkit.telemtry.unified", false);
	user_pref("toolkit.telemtry.enable", false);
	user_pref("datareporting.policy.dataSubmissionEnabled", false);
	user_pref("browser.disocvery.enabled", false);
	user_pref("browser.tabs.crashReporting.enabled", false);

	// Reduce Disk I/O
	user_pref("browser.cache.disk.enable", false); // Disable disk cache
	user_pref("browser.cache.memory.enable", true); // Ensure mem cache is on
	user_pref("browser.cache.memory.capacity", 524288); // Set mem manually

	// SD card longetivity
	user_pref("browser.sessionstore.interval", 600000);

	// Unecessary animations/feature
	user_pref("toolkit.cosmeticAnimations.enabled", false);
	user_pref("browser.compactmode.show", false);
	user_pref("browser.safeBrowse.downloads.remote.enabled", false);
	user_pref("browser.safeBrowse.malware.enabled", false);

	user_pref("dom.ipc.processCounty", 1); // For Pis with 1GB or less of RAM
`;

console.log(`Attempted directory: ${process.cwd()}`);
const scriptDir = path.dirname(process.argv[1]);
console.log(`New directory: ${scriptDir});

// --- Load Credentials ---
let credentials;
try {
	const credentialsPath = path.join(scriptDir, 'credentials.json');
	console.log(`Loading credentials from: ${credentialsPath}`);
	const credentialsRaw = fs.readFileSync(credentialsPath, 'utf8');
	credentials = JSON.parse(credentialsRaw);
	console.log('Credentials loaded successfully.')
} catch (error) {
	console.error('Failed to load credentials.json: ', error);
	console.error('Please ensure credentials.json exists and is valid JSON.');
	process.exit(1); // Exits if credentials could not be loaded
}

//  Extract credentials
const AGENCY = credentials.agency;
const USERNAME = credentials.username;
const PASSWORD = credentials.password;

// Create temp directory
function createTempDir() {
	const tempDir = path.join(os.tmpdir(), `puppeteer_profile__${Date.now()}`);
	fs.mkdirSync(tempDir, { recursive: true});
	// Create user.js file inside the profile directory
	const userJsPath = path.join(tempDir, 'user.js');
	console.log(`Writing profile at: ${userJsPath}`);
	fs.writeFileSync(userJsPath, USER_JS_CONTENT);
	console.log(`Profile written at: ${userJsPath}`);
	return tempDir;
}

// Clean up directory

function cleanUpDir(dirPath) {
	if(fs.existsSync(dirPath)){
		fs.rmSync(dirPath, { recursive: true, force: true});
		console.log(`Temporary directory cleaned: ${dirPath}`);
	}
}

async function runFirefoxForSignage(){
	console.log('Starting iar-launcher script');
	let browser;
	let userDataDir;

	try {
		userDataDir = createTempDir();
		console.log(userDataDir);
		console.log(`Using temporary user data directory: ${userDataDir}`);
		console.log('Launching browser...');
		browser = await puppeteer.launch({
			product: 'chrome',
			executablePath: EXEC_PATH,
			headless: false, // Forces browser to display on screen
			ignoreDefaultArgs: [ '--enable-automation'],
			args: [
				'--no-sanbox', // Required for ARM sys's like Pi
				'--disable-setuid-sandbox', // Also ^
				'--disable-gpu', // Disable GPU acceleration
				'--disable-dev-shm-usage', // Prevent usage of /dev/shm
				'--no-first-run', // Don't run the first-run experience
				'--no-default-browser-check', // Self explanatory
				'--disable-infobars', // Self explanatory
				'--disable-features=EnableEphemeralFlashPermission', //Disable flash permission
				'--disable-features=NetworkPrediction',
				'--kiosk', // Fullscreen with no browser ui
				'--incognito', // Self explanatory
				'--disable-notifications', // Self explanatory
				'--profile', userDataDir,
				'--new-instance',
				'--foreground',
				//Chromium Specific Launch Flags
				'--disable-background-networking',
				'--disable-default-apps',
				'--disable-extensions',
				'--disable-sync',
				'--disable-component-update',
				'--disable-translate',
				'--disable-backgrounding-occluded-windows',
				'--disable-breakpad',
				'--disable-ipc-flooding-protection',
				'--disable-renderer-backgrounding',
				'--disable-software-rasterizer',
				'--disable-web-security'
			],
			//userDataDir: userDataDir, // the temp data directory
			timeout: 120000,
			dumpio: true,
		});
		console.log('Browser launched.');

//		const page = await browser.newPage();
		const pages = await browser.pages();
		console.log(`Pages: ${pages}`);
		const page = pages[0];
		console.log(page.toString());

		await page.setViewport({
			width: DISPLAY_WIDTH,
			height: DISPLAY_HEIGHT,
			deviceScaleFactor: 1 // Pixel perfect rendering
		});

		// Inject CSS to hide any potential scrollbars
		await page.evaluateOnNewDocument(() => {
			const style = document.createEelement('style');
			style.type = 'text/css';
			style.innerHtml = `
				html, body {
					overflow: hidden !important;
					-ms-overflow-style: none !important;
					scrollbar-width: none !important;
				}
				::-webkit-scrollbar {
					display: none !important;
				}
			`;
			console.log(`Injecting CSS: ${style}`);
			document.head.appendChild(style);
			console.log('CSS injected.');
		});

		console.log(`Navigating to: ${WEBSITE_URL}`);
		await page.goto(WEBSITE_URL, {
			waitUntil: 'networkidle0',
			timeout: 60000
		});
		console.log('Page loaded. Starting auto-login process...');
		if(await page.$('#accept-policy') !== null) {
			await page.click('#accept-policy');
			console.log('Cookie policy accepted');
		} else {
			console.log('Cookie policy already accepted.');
		}
		console.log('Clearing login fields...');
		await page.evaluate( () => document.getElementById('Input_Agency').value = "");
		await page.evaluate( () => document.getElementById('Input_Username').value = "");
		await page.evaluate( () => document.getElementById('Input_Password').value = "");

		console.log('Entering credentials.');
		await page.type('#Input_Agency', AGENCY);
		await page.type('#Input_Username', USERNAME);
		await page.type('#Input_Password', PASSWORD);
		console.log('Credentials entered.');

		await page.click('button.btn-sm-red.w-100');
		console.log('Credentials submitted');
		await page.waitForNavigation();
		console.log('Credentials submission completed');
		console.log('IAR displaying.');
	}
	catch (error) {
		console.error('Error running iar-launcher script: ', error);
	} finally {
		// Script is designed to run continuously.
		// Manual termination (Ctrl+C) or a systemd service for restarts.
	}
}

runFirefoxForSignage();
