import { AzureOpenAI } from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageFunctionToolCall,
} from 'openai/resources/chat/index.js';
import { env } from '../config/env.js';
import { toolDefinitions, executeTool } from './tools.js';

const SYSTEM_PROMPT = `You are a web browsing assistant powered by BrowseAPI. You help users accomplish tasks on the web by controlling a headless browser.

Guidelines:
- Always start by navigating to the URL the user specifies
- Treat the user's current message and conversation history as authoritative. Never ask again for a username, password, query, destination, size, or URL that is already present in the user's text or previous turns.
- Use compound actions (login, fill_form, scrape) when they match the task; they are faster and more reliable than individual steps
- Use observe_page after navigation and after any failed or uncertain action. Prefer observe_page over get_text for understanding real websites.
- Use find_elements when you need ranked candidates instead of guessing one element.
- Use take_screenshot to capture the current page state when needed
- For Flipkart product/category/size tasks, prefer flipkart_search_product and flipkart_select_size before low-level clicks.
- For Booking.com hotel searches, prefer booking_search_hotels. Preserve constraints from the user: destination, relative dates converted to YYYY-MM-DD, budgetMax, currency, guests, and rooms. For Indian rupee budgets like "under 5000 rs", pass budgetMax: 5000 and currency: "INR".
- For flight searches, prefer google_flights_search instead of navigating/filling Google Flights manually. Preserve origin, destination, tripType, departDate, passengers, cabin, and preference. Convert dates like "May 15" to YYYY-MM-DD using the current local date context.
- If an action fails, observe the page, dismiss overlays if relevant, then retry with a direct search URL or alternate primitive before giving up.
- Do not proceed to purchase, payment, booking confirmation, OTP, or account-sensitive final actions without explicit user confirmation.
- If a tool returns HUMAN_CHECK_REQUIRED, stop immediately. Do not try to solve, bypass, or continue around the check. Tell the user to complete the verification manually in the browser, then type "continue".
- If the user says "continue" after a human check, call human_check_status first. Resume the prior task only if no human check is detected.
- Be concise but thorough in your responses
- Report what you observe on the page and what actions you took. If blocked, cite concrete page evidence such as URL, title, visible text, or detected elements.`;

function localIsoDate(offsetDays = 0): string {
  const now = new Date();
  const local = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  local.setDate(local.getDate() + offsetDays);
  const year = local.getFullYear();
  const month = String(local.getMonth() + 1).padStart(2, '0');
  const day = String(local.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export interface AgentCallbacks {
  onToolCall: (name: string, args: Record<string, unknown>) => void;
  onScreenshot: (path: string) => void;
}

export async function runAgentLoop(
  userMessage: string,
  history: ChatCompletionMessageParam[],
  sessionId: string,
  callbacks: AgentCallbacks,
): Promise<{ response: string; history: ChatCompletionMessageParam[] }> {
  const client = new AzureOpenAI({
    endpoint: env.AZURE_OPENAI_ENDPOINT!,
    apiKey: env.AZURE_OPENAI_API_KEY!,
    apiVersion: env.AZURE_OPENAI_API_VERSION,
    deployment: env.AZURE_OPENAI_DEPLOYMENT!,
  });

  history.push({ role: 'user', content: userMessage });

  const MAX_ROUNDS = 25;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const completion = await client.chat.completions.create({
      model: env.AZURE_OPENAI_DEPLOYMENT!,
      messages: [{
        role: 'system',
        content: `${SYSTEM_PROMPT}\n\nCurrent local date in Asia/Kolkata: ${localIsoDate()}. Tomorrow: ${localIsoDate(1)}.`,
      }, ...history],
      tools: toolDefinitions,
    });

    const choice = completion.choices[0];

    if (choice.finish_reason === 'stop') {
      history.push({ role: 'assistant', content: choice.message.content ?? '' });
      return { response: choice.message.content ?? '', history };
    }

    if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls?.length) {
      history.push(choice.message as ChatCompletionMessageParam);

      for (const toolCall of choice.message.tool_calls) {
        if (toolCall.type !== 'function') continue;
        const fn = (toolCall as ChatCompletionMessageFunctionToolCall).function;
        const name = fn.name;
        const args = JSON.parse(fn.arguments);

        callbacks.onToolCall(name, args);

        const result = await executeTool(name, args, sessionId);

        if (result.screenshotPath) {
          callbacks.onScreenshot(result.screenshotPath);
        }

        history.push({
          role: 'tool' as const,
          tool_call_id: toolCall.id,
          content: result.text,
        });
      }

      continue;
    }

    // Unexpected finish reason or empty tool_calls
    return { response: 'Unexpected response from the model.', history };
  }

  return {
    response: 'Reached maximum number of tool call rounds (25). The task may be incomplete.',
    history,
  };
}
