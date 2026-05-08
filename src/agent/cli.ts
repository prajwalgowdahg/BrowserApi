import { createInterface } from 'node:readline';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/index.js';
import { env } from '../config/env.js';
import { runAgentLoop } from './loop.js';

const BASE_URL = `http://localhost:${env.PORT}`;

async function createSession(): Promise<string> {
  const res = await fetch(`${BASE_URL}/sessions`, { method: 'POST' });
  const json = (await res.json()) as {
    success: boolean;
    data?: { sessionId: string };
    error?: string;
  };
  if (!json.success) throw new Error(json.error ?? 'Unknown error');
  return json.data!.sessionId;
}

async function deleteSession(sessionId: string): Promise<void> {
  try {
    await fetch(`${BASE_URL}/sessions/${sessionId}`, { method: 'DELETE' });
  } catch {
    // Ignore errors during cleanup
  }
}

function formatToolArgs(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'observe_page':
      return `{ limit: ${args.limit ?? 80} }`;
    case 'human_check_status':
      return '{}';
    case 'find_elements':
      return `{ query: "${args.query}", limit: ${args.limit ?? 10} }`;
    case 'navigate':
      return `{ url: "${args.url}" }`;
    case 'click':
    case 'get_text':
    case 'hover':
    case 'focus':
    case 'clear':
      return `{ description: "${args.description}" }`;
    case 'click_text':
      return `{ text: "${args.text}" }`;
    case 'click_coordinates':
      return `{ x: ${args.x}, y: ${args.y} }`;
    case 'click_observed':
      return `{ id: "${args.id}" }`;
    case 'type_text':
      return `{ description: "${args.description}", value: "${args.value}" }`;
    case 'type_and_press_enter':
      return `{ description: "${args.description}", value: "${args.value}", key: "${args.key ?? 'Enter'}" }`;
    case 'press_key':
      return `{ key: "${args.key}" }`;
    case 'select_option':
    case 'select_choice':
      return `{ description: "${args.description}", value: "${args.value}" }`;
    case 'wait_for':
      return `{ waitType: "${args.waitType ?? 'element'}", description: "${args.description ?? ''}" }`;
    case 'scroll':
      return `{ direction: "${args.direction ?? 'down'}", amount: ${args.amount ?? 500} }`;
    case 'dismiss_overlays':
      return '{}';
    case 'login':
      return `{ url: "${args.url}", username: "${args.username ? '[provided]' : '[missing]'}", password: "${args.password ? '[provided]' : '[missing]'}" }`;
    case 'search_site':
      return `{ url: "${args.url ?? ''}", query: "${args.query}" }`;
    case 'flipkart_search_product':
      return `{ query: "${args.query}" }`;
    case 'flipkart_select_size':
      return `{ size: "${args.size}" }`;
    case 'booking_search_hotels':
      return `{ destination: "${args.destination}", dates: ${JSON.stringify(args.dates ?? {})}, budgetMax: ${args.budgetMax ?? 'none'} }`;
    case 'google_flights_search':
      return `{ origin: "${args.origin}", destination: "${args.destination}", departDate: "${args.departDate}", tripType: "${args.tripType ?? 'one-way'}" }`;
    case 'fill_form':
      return `{ fields: ${(args.fields as unknown[]).length} field(s) }`;
    case 'scrape':
      return `{ schema: ${JSON.stringify(args.schema)} }`;
    case 'submit_form':
      return `{ description: "${args.description ?? 'the submit button'}" }`;
    case 'take_screenshot':
      return '{}';
    default:
      return JSON.stringify(args);
  }
}

async function main() {
  // Validate Azure OpenAI credentials
  if (!env.AZURE_OPENAI_ENDPOINT || !env.AZURE_OPENAI_API_KEY || !env.AZURE_OPENAI_DEPLOYMENT) {
    console.error('Error: Azure OpenAI credentials are required.');
    console.error(
      'Set AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, and AZURE_OPENAI_DEPLOYMENT in your .env file.',
    );
    process.exit(1);
  }

  console.log('');
  console.log('  BrowseAPI Web Agent');
  console.log('  Powered by Azure OpenAI GPT-4o');
  console.log('');

  // Create browser session
  let sessionId: string;
  try {
    sessionId = await createSession();
    console.log(`  Session: ${sessionId}`);
  } catch (err) {
    console.error(`  Error: ${(err as Error).message}`);
    console.error('  Make sure the BrowseAPI server is running (npm run dev)');
    process.exit(1);
  }

  console.log('  Type a task in natural language. Press Ctrl+C to exit.');
  console.log('');

  // Graceful shutdown
  let cleaningUp = false;
  const cleanup = async () => {
    if (cleaningUp) return;
    cleaningUp = true;
    console.log('\n  Cleaning up...');
    await deleteSession(sessionId);
    console.log('  Session deleted. Goodbye!');
    process.exit(0);
  };
  process.on('SIGINT', cleanup);

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const history: ChatCompletionMessageParam[] = [];

  const prompt = () => {
    rl.question('  > ', async (input) => {
      const trimmed = input.trim();
      if (!trimmed) {
        prompt();
        return;
      }

      try {
        const userMessage = /^continue$/i.test(trimmed)
          ? 'Continue after the human verification. First call human_check_status. If no human check is detected, resume the previous task from the current page.'
          : trimmed;

        const { response } = await runAgentLoop(userMessage, history, sessionId, {
          onToolCall: (name, args) => {
            console.log(`  [tool] ${name}(${formatToolArgs(name, args)})`);
          },
          onScreenshot: (path) => {
            console.log(`  [screenshot] Saved to ${path}`);
          },
        });
        console.log(`\n  ${response}\n`);
      } catch (err) {
        console.error(`  Error: ${(err as Error).message}`);
      }

      prompt();
    });
  };

  prompt();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
