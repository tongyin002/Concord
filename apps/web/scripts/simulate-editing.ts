/**
 * Multiplayer Editing Simulation with Playwright
 *
 * This script launches multiple headed browser windows that simulate
 * real users typing in the same collaborative document.
 *
 * Usage:
 *   1. First run: pnpm simulate:auth (logs in and saves session)
 *   2. Then run:  pnpm simulate (launches N clients editing)
 *
 * Or run with: npx tsx scripts/simulate-editing.ts
 */

import { chromium, Page, BrowserContext } from "playwright";
import * as path from "path";
import * as fs from "fs";

// ============ CONFIGURATION ============
const CONFIG = {
  // Your app URL - reads from VITE_WEB_URL env var, or defaults to localhost
  baseUrl: process.env.VITE_WEB_URL ?? "http://localhost:5173",

  // Document ID to edit (will be appended as ?doc=<id>)
  // Set to null to use whatever doc is shown on the page
  docId: null as string | null,

  // Number of simulated clients
  numClients: 4,

  // Typing speed (milliseconds between keystrokes)
  minTypingDelay: 60,
  maxTypingDelay: 180,

  // Pause between actions (thinking time)
  minPauseDelay: 800,
  maxPauseDelay: 3000,

  // Probability of different actions (should sum to ~1)
  actionWeights: {
    type: 0.75, // Type a character
    delete: 0.1, // Delete some text
    move: 0.05, // Move cursor
    newline: 0.05, // Create new paragraph
    pause: 0.05, // Take a thinking break
  },

  // Path to store auth session
  authStatePath: path.join(
    process.cwd(),
    "apps",
    "web",
    "scripts",
    ".auth-state.json"
  ),

  // Browser window layout
  windowWidth: 800,
  windowHeight: 600,
};

// Sample text snippets for typing
const TEXT_SNIPPETS = [
  "The quick brown fox jumps over the lazy dog. ",
  "Collaborative editing in real-time is fascinating. ",
  "CRDTs enable conflict-free synchronization across peers. ",
  "Every keystroke travels through the distributed system. ",
  "The future of work is asynchronous yet connected. ",
  "Technology bridges distances between remote teams. ",
  "Innovation happens when ideas flow freely. ",
  "Building great products one commit at a time. ",
  "The web has transformed how we create and share. ",
  "Open source powers the modern digital world. ",
  "Real-time sync enables seamless collaboration. ",
  "Watch as multiple cursors dance across the page. ",
  "Each peer maintains their own copy of the document. ",
  "Eventual consistency is the goal of CRDTs. ",
  "Type, delete, move, repeat - the rhythm of editing. ",
];

// ============ UTILITIES ============

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickAction(): keyof typeof CONFIG.actionWeights {
  const roll = Math.random();
  let cumulative = 0;

  for (const [action, weight] of Object.entries(CONFIG.actionWeights)) {
    cumulative += weight;
    if (roll < cumulative) {
      return action as keyof typeof CONFIG.actionWeights;
    }
  }
  return "type";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Calculate window position for tiling
function getWindowPosition(
  index: number,
  total: number
): { x: number; y: number } {
  const cols = Math.ceil(Math.sqrt(total));
  const row = Math.floor(index / cols);
  const col = index % cols;

  return {
    x: col * CONFIG.windowWidth,
    y: row * CONFIG.windowHeight,
  };
}

// ============ CLIENT SIMULATION ============

class SimulatedClient {
  private page: Page;
  private clientId: number;
  private isRunning = false;
  private currentText = "";
  private charIndex = 0;

  constructor(page: Page, clientId: number) {
    this.page = page;
    this.clientId = clientId;
  }

  async start() {
    this.isRunning = true;
    this.currentText = pickRandom(TEXT_SNIPPETS);
    this.charIndex = 0;

    console.log(`[Client ${this.clientId}] Starting simulation...`);

    // Focus the editor
    await this.page.click(".ProseMirror");

    // Small delay before starting
    await sleep(randomBetween(500, 2000));

    while (this.isRunning) {
      try {
        await this.performAction();
      } catch (error) {
        console.error(`[Client ${this.clientId}] Error:`, error);
        await sleep(1000);
      }
    }
  }

  stop() {
    this.isRunning = false;
    console.log(`[Client ${this.clientId}] Stopped.`);
  }

  private async performAction() {
    const action = pickAction();

    switch (action) {
      case "type":
        await this.typeCharacter();
        break;
      case "delete":
        await this.deleteText();
        break;
      case "move":
        await this.moveCursor();
        break;
      case "newline":
        await this.insertNewline();
        break;
      case "pause":
        await this.takePause();
        break;
    }
  }

  private async typeCharacter() {
    // Pick new text if we've exhausted current snippet
    if (this.charIndex >= this.currentText.length) {
      this.currentText = pickRandom(TEXT_SNIPPETS);
      this.charIndex = 0;
    }

    const char = this.currentText[this.charIndex];
    this.charIndex++;

    await this.page.keyboard.type(char);

    // Slower for punctuation/spaces
    const delay =
      char === " " || char === "." || char === ","
        ? randomBetween(CONFIG.maxTypingDelay, CONFIG.maxTypingDelay * 1.5)
        : randomBetween(CONFIG.minTypingDelay, CONFIG.maxTypingDelay);

    await sleep(delay);
  }

  private async deleteText() {
    const deleteCount = randomBetween(1, 8);

    for (let i = 0; i < deleteCount; i++) {
      await this.page.keyboard.press("Backspace");
      await sleep(randomBetween(30, 80));
    }

    await sleep(randomBetween(200, 500));
  }

  private async moveCursor() {
    // Random cursor movement
    const movements = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
    const movement = pickRandom(movements);
    const times = randomBetween(1, 10);

    for (let i = 0; i < times; i++) {
      await this.page.keyboard.press(movement);
      await sleep(randomBetween(20, 50));
    }

    await sleep(randomBetween(300, 600));
  }

  private async insertNewline() {
    await this.page.keyboard.press("Enter");
    await sleep(randomBetween(200, 500));
  }

  private async takePause() {
    const pauseTime = randomBetween(CONFIG.minPauseDelay, CONFIG.maxPauseDelay);
    console.log(`[Client ${this.clientId}] Thinking for ${pauseTime}ms...`);
    await sleep(pauseTime);
  }
}

// ============ MAIN FUNCTIONS ============

async function saveAuthState() {
  console.log("🔐 Opening browser for authentication...");
  console.log(
    "   Please log in with GitHub, then close the browser when done.\n"
  );

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(CONFIG.baseUrl);

  // Wait for user to complete login
  console.log("⏳ Waiting for you to log in...");
  console.log("   (The script will detect when you reach the home page)\n");

  // Wait for the authenticated home page (sidebar with user avatar)
  await page.waitForSelector('aside [class*="rounded-full"]', {
    timeout: 300000,
  }); // 5 min timeout

  // Give a moment for cookies to settle
  await sleep(2000);

  // Save the storage state
  await context.storageState({ path: CONFIG.authStatePath });

  console.log(`✅ Auth state saved to ${CONFIG.authStatePath}`);
  console.log("   You can now run: pnpm simulate\n");

  await browser.close();
}

async function runSimulation() {
  // Check if auth state exists
  if (!fs.existsSync(CONFIG.authStatePath)) {
    console.error("❌ No auth state found!");
    console.error('   Run "pnpm simulate:auth" first to log in.\n');
    process.exit(1);
  }

  console.log(`🚀 Launching ${CONFIG.numClients} simulated clients...\n`);

  const browser = await chromium.launch({ headless: false });
  const clients: SimulatedClient[] = [];
  const contexts: BrowserContext[] = [];

  try {
    // Create browser contexts and pages for each client
    for (let i = 0; i < CONFIG.numClients; i++) {
      const position = getWindowPosition(i, CONFIG.numClients);

      const context = await browser.newContext({
        storageState: CONFIG.authStatePath,
        viewport: {
          width: CONFIG.windowWidth - 50,
          height: CONFIG.windowHeight - 100,
        },
      });

      const page = await context.newPage();

      // Position the window (Playwright doesn't directly support this, but we can try via CDP)
      try {
        const cdpSession = await context.newCDPSession(page);
        await cdpSession.send("Browser.setWindowBounds", {
          windowId: 1,
          bounds: {
            left: position.x,
            top: position.y,
            width: CONFIG.windowWidth,
            height: CONFIG.windowHeight,
          },
        });
      } catch {
        // CDP window positioning might not work on all platforms
      }

      // Navigate to the app
      const url = CONFIG.docId
        ? `${CONFIG.baseUrl}?doc=${CONFIG.docId}`
        : CONFIG.baseUrl;

      await page.goto(url);

      // Wait for editor to be ready
      await page.waitForSelector(".ProseMirror", { timeout: 30000 });

      console.log(`✅ Client ${i + 1} connected`);

      contexts.push(context);
      clients.push(new SimulatedClient(page, i + 1));
    }

    console.log("\n🎭 All clients connected! Starting simulation...");
    console.log("   Press Ctrl+C to stop.\n");

    // Start all clients
    const promises = clients.map((client) => client.start());

    // Handle graceful shutdown
    process.on("SIGINT", async () => {
      console.log("\n\n🛑 Stopping simulation...");
      clients.forEach((client) => client.stop());

      // Wait a moment for cleanup
      await sleep(1000);

      // Close all contexts and browser
      for (const ctx of contexts) {
        await ctx.close();
      }
      await browser.close();

      console.log("👋 Goodbye!\n");
      process.exit(0);
    });

    // Keep running until Ctrl+C
    await Promise.all(promises);
  } catch (error) {
    console.error("Fatal error:", error);
    await browser.close();
    process.exit(1);
  }
}

// ============ CLI ============

const args = process.argv.slice(2);

if (args.includes("--auth") || args.includes("-a")) {
  saveAuthState();
} else if (args.includes("--help") || args.includes("-h")) {
  console.log(`
Multiplayer Editing Simulation
==============================

Usage:
  npx tsx scripts/simulate-editing.ts [options]

Options:
  --auth, -a     Open browser to log in and save auth state
  --help, -h     Show this help message
  
  (no options)   Run the simulation with saved auth state

First-time setup:
  1. Run with --auth flag to log in via GitHub
  2. Run without flags to start the simulation

Configuration:
  Edit the CONFIG object at the top of this file to change:
  - Number of clients (numClients)
  - Typing speed (minTypingDelay, maxTypingDelay)
  - Document ID (docId)
  - And more...
`);
} else {
  runSimulation();
}
