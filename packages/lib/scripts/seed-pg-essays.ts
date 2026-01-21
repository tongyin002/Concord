/**
 * Seed script to populate the database with Paul Graham's essays
 *
 * This script:
 * 1. Scrapes the list of essays from paulgraham.com/articles.html
 * 2. Fetches each essay's content
 * 3. Parses paragraphs and creates Loro documents
 * 4. Saves to the database with base64 encoded Loro snapshots
 *
 * Usage:
 *   npx tsx scripts/seed-pg-essays.ts [--limit=N] [--dry-run]
 *
 * Options:
 *   --limit=N    Only process N essays (useful for testing)
 *   --dry-run    Don't actually insert into database, just log what would be done
 *   --owner=ID   Specify the owner user ID (defaults to first user in db)
 */

import { config } from '@dotenvx/dotenvx';
import * as cheerio from 'cheerio';
import { drizzle } from 'drizzle-orm/node-postgres';
import { LoroDoc, LoroMap, LoroMovableList, LoroText } from 'loro-crdt';
import { doc, user } from '../src/shared/schema';

// Load environment variables
config({ path: '../../.env' });

const BASE_URL = 'https://www.paulgraham.com';
const ARTICLES_URL = `${BASE_URL}/articles.html`;

// Parse command line arguments
const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : undefined;
const DRY_RUN = args.includes('--dry-run');
const ownerArg = args.find((a) => a.startsWith('--owner='));
const OWNER_ID = ownerArg ? ownerArg.split('=')[1] : undefined;

// Rate limiting: delay between requests (ms)
const REQUEST_DELAY = 1000;

interface Essay {
  title: string;
  url: string;
  paragraphs: string[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch the list of essay URLs from the articles page
 */
async function fetchEssayList(): Promise<{ title: string; url: string }[]> {
  console.log(`Fetching essay list from ${ARTICLES_URL}...`);

  const response = await fetch(ARTICLES_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch articles page: ${response.status}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  const essays: { title: string; url: string }[] = [];

  // Find all links to essays (they're in the main table)
  $('a').each((_, el) => {
    const href = $(el).attr('href');
    const title = $(el).text().trim();

    // Filter for essay links (end in .html and are not external)
    if (
      href &&
      href.endsWith('.html') &&
      !href.startsWith('http') &&
      title &&
      title.length > 0 &&
      // Skip non-essay pages
      !['index.html', 'articles.html', 'rss.html'].includes(href)
    ) {
      essays.push({
        title,
        url: `${BASE_URL}/${href}`,
      });
    }
  });

  // Remove duplicates (same URL might appear multiple times)
  const uniqueEssays = essays.filter(
    (essay, index, self) => index === self.findIndex((e) => e.url === essay.url)
  );

  console.log(`Found ${uniqueEssays.length} essays`);
  return uniqueEssays;
}

/**
 * Check if text looks like JavaScript code or other non-essay content
 */
function isJunkContent(text: string): boolean {
  const junkPatterns = [
    /^csell_/i,
    /^function\s+\w+\s*\(/,
    /^var\s+\w+\s*=/,
    /^\/\/\s*Begin/,
    /csell_token_map/,
    /csell_page_data/,
    /csell_env/,
    /storeCheckoutDomain/,
    /toOSTN\s*\(/,
    /node\.setAttribute/,
    /TOK_STORE_ID/,
    /TOK_SPACEID/,
    /\.turbify\./,
    /\.csell\./,
  ];

  return junkPatterns.some((pattern) => pattern.test(text));
}

/**
 * Fetch and parse a single essay's content
 */
async function fetchEssay(title: string, url: string): Promise<Essay | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`  Failed to fetch ${url}: ${response.status}`);
      return null;
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Remove script and style tags before processing
    $('script, style, noscript').remove();

    // PG's essays have content in a table with width="435"
    // Inside a <td width="435">, the content is in <font face="verdana"> tags
    // Paragraphs are separated by <br><br>
    const paragraphs: string[] = [];

    // Try to find the content font tag (most reliable)
    let contentHtml = '';
    const fontTag = $('font[face="verdana"]').first();
    if (fontTag.length > 0) {
      contentHtml = fontTag.html() || '';
    }

    // Fallback: try the td with width="435"
    if (!contentHtml) {
      const contentTd = $('td[width="435"]').first();
      if (contentTd.length > 0) {
        contentHtml = contentTd.html() || '';
      }
    }

    if (contentHtml) {
      // Split by <br><br> which PG uses as paragraph separators
      const parts = contentHtml
        .split(/<br\s*\/?>\s*<br\s*\/?>/gi)
        .map((part) => {
          // Load each part and extract text
          const $part = cheerio.load(part);
          $part('script, style, img, a').remove(); // Remove scripts, styles, images, links
          const partText = $part.text().trim();
          // Clean up whitespace
          return partText.replace(/\s+/g, ' ').trim();
        })
        .filter((text) => text.length > 30 && !isJunkContent(text));

      paragraphs.push(...parts);
    }

    // Fallback: if no content found in nested table, try direct approach
    if (paragraphs.length === 0) {
      // Some essays might have different structure
      const bodyText = $('body').text();
      const parts = bodyText
        .split(/\n\n+/)
        .map((p) => p.replace(/\s+/g, ' ').trim())
        .filter((p) => p.length > 50 && !isJunkContent(p));
      paragraphs.push(...parts.slice(0, 30));
    }

    if (paragraphs.length === 0) {
      console.warn(`  No paragraphs found for ${title}`);
      return null;
    }

    return {
      title,
      url,
      paragraphs: paragraphs.slice(0, 50), // Limit paragraphs per essay
    };
  } catch (error) {
    console.error(`  Error fetching ${url}:`, error);
    return null;
  }
}

/**
 * Create a Loro document from paragraphs
 */
function createLoroDoc(paragraphs: string[]): Uint8Array {
  const loroDoc = new LoroDoc();
  const docRoot = loroDoc.getMap('docRoot');
  docRoot.set('type', 'doc');

  const docContent = docRoot.setContainer('content', new LoroMovableList());

  for (const para of paragraphs) {
    const paragraph = docContent.pushContainer(new LoroMap());
    paragraph.set('type', 'paragraph');
    const textContainer = paragraph.setContainer('content', new LoroText());
    textContainer.insert(0, para);
  }

  return loroDoc.export({ mode: 'snapshot' });
}

/**
 * Encode Uint8Array to base64 string
 */
function encodeBase64(uint8Array: Uint8Array): string {
  // Use Buffer in Node.js environment
  return Buffer.from(uint8Array).toString('base64');
}

/**
 * Main seeding function
 */
async function seedEssays() {
  console.log('\n=== Paul Graham Essays Seeder ===\n');

  if (DRY_RUN) {
    console.log('DRY RUN MODE - No database changes will be made\n');
  }

  // Connect to database
  const connectionString = process.env.ZERO_UPSTREAM_DB;
  if (!connectionString) {
    throw new Error('ZERO_UPSTREAM_DB environment variable is not set');
  }

  const db = drizzle(connectionString);

  // Get owner ID
  let ownerId = OWNER_ID;
  if (!ownerId) {
    const users = await db.select().from(user).limit(1);
    if (users.length === 0) {
      throw new Error(
        'No users found in database. Please create a user first or specify --owner=ID'
      );
    }
    ownerId = users[0].id;
    console.log(`Using owner: ${users[0].name} (${ownerId})\n`);
  } else {
    console.log(`Using specified owner ID: ${ownerId}\n`);
  }

  // Fetch essay list
  const essayList = await fetchEssayList();

  const toProcess = LIMIT ? essayList.slice(0, LIMIT) : essayList;
  console.log(`\nProcessing ${toProcess.length} essays...\n`);

  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const { title, url } = toProcess[i];
    console.log(`[${i + 1}/${toProcess.length}] ${title}`);

    // Rate limiting
    if (i > 0) {
      await sleep(REQUEST_DELAY);
    }

    const essay = await fetchEssay(title, url);

    if (!essay || essay.paragraphs.length === 0) {
      console.log(`  Skipped (no content found)`);
      skipCount++;
      continue;
    }

    console.log(`  Found ${essay.paragraphs.length} paragraphs`);

    // Create Loro document
    const snapshot = createLoroDoc(essay.paragraphs);
    const content = encodeBase64(snapshot);

    if (DRY_RUN) {
      console.log(`  Would insert: "${essay.title}" (${content.length} bytes)`);
      console.log('  --- Paragraphs ---');
      essay.paragraphs.forEach((p, idx) => {
        // Truncate long paragraphs for readability
        const preview = p.length > 200 ? p.slice(0, 200) + '...' : p;
        console.log(`  [${idx + 1}] ${preview}`);
      });
      console.log('  --- End ---\n');
    } else {
      try {
        await db.insert(doc).values({
          id: crypto.randomUUID(),
          title: essay.title,
          content,
          ownerId,
        });
        console.log(`  Inserted successfully`);
        successCount++;
      } catch (error) {
        console.error(`  Error inserting:`, error);
        errorCount++;
      }
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Total processed: ${toProcess.length}`);
  console.log(`Successful: ${successCount}`);
  console.log(`Skipped: ${skipCount}`);
  console.log(`Errors: ${errorCount}`);

  process.exit(0);
}

// Run the seeder
seedEssays().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
