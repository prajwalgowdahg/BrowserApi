import { writeFile } from 'node:fs/promises';
import { env } from '../config/env.js';
import type { ChatCompletionFunctionTool } from 'openai/resources/chat/index.js';

const BASE_URL = `http://localhost:${env.PORT}`;

let screenshotCount = 0;

export interface ToolResult {
  text: string;
  screenshotPath?: string;
  humanCheckRequired?: boolean;
}

export const toolDefinitions: ChatCompletionFunctionTool[] = [
  {
    type: 'function',
    function: {
      name: 'human_check_status',
      description: 'Check whether the current page is blocked by CAPTCHA, bot verification, OTP, or another human/security check.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'observe_page',
      description: 'Observe the current page in one call: URL, title, visible text, interactive elements, forms, viewport, and screenshot. Use after navigation or failed actions.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Maximum interactive elements to return. Defaults to 80.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'snapshot',
      description: 'Create a page snapshot with stable element refs like @e1, @e2. Prefer this before click_ref/fill_ref/select_ref.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Maximum interactive elements to return. Defaults to 80.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_elements',
      description: 'Return ranked visible element candidates for a natural-language query. Use this before choosing an observed element id.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Element query, such as "search input" or "size 32"' },
          limit: { type: 'number', description: 'Maximum candidates. Defaults to 10.' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'navigate',
      description: 'Navigate the browser to a URL. Waits for the page to fully load (network idle).',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL to navigate to' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'click',
      description: 'Click on an element described in natural language. Uses AI to find the element on the page.',
      parameters: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'Natural language description of the element to click' },
        },
        required: ['description'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'click_text',
      description: 'Click visible text exactly or partially, useful for simple links/buttons where text is known.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Visible text to click' },
          exact: { type: 'boolean', description: 'Whether the text match must be exact. Defaults to false.' },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'click_coordinates',
      description: 'Click viewport coordinates. Use only when screenshot/vision gives precise coordinates.',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'number', description: 'Viewport x coordinate' },
          y: { type: 'number', description: 'Viewport y coordinate' },
        },
        required: ['x', 'y'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'click_observed',
      description: 'Click an element id returned by observe_page or find_elements.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Observed element id, such as e4' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'click_ref',
      description: 'Click an element ref returned by snapshot, such as @e3. Prefer this over natural-language clicking after a snapshot.',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Snapshot element ref, such as @e3' },
        },
        required: ['ref'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fill_ref',
      description: 'Fill an input/textarea/contenteditable element ref returned by snapshot.',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Snapshot element ref, such as @e3' },
          value: { type: 'string', description: 'Text to fill' },
        },
        required: ['ref', 'value'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'type_text',
      description: 'Type text into an input field described in natural language. Clears existing text first.',
      parameters: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'Natural language description of the input field' },
          value: { type: 'string', description: 'The text to type into the field' },
        },
        required: ['description', 'value'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'type_and_press_enter',
      description: 'Fill an input field and press a key, default Enter. Useful for search boxes and destinations.',
      parameters: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'Natural language description of the input field' },
          value: { type: 'string', description: 'The text to type into the field' },
          key: { type: 'string', description: 'Keyboard key to press. Defaults to Enter.' },
        },
        required: ['description', 'value'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'press_key',
      description: 'Press a keyboard key on the page.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Playwright key name, such as Escape, Enter, Tab, ArrowDown' },
        },
        required: ['key'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'hover',
      description: 'Hover over an element described in natural language.',
      parameters: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'Natural language description of the element to hover' },
        },
        required: ['description'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'focus',
      description: 'Focus an element described in natural language.',
      parameters: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'Natural language description of the element to focus' },
        },
        required: ['description'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'clear',
      description: 'Clear an input field described in natural language.',
      parameters: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'Natural language description of the input field to clear' },
        },
        required: ['description'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'select_option',
      description: 'Select an option in a dropdown/select element by its visible label text.',
      parameters: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'Natural language description of the select/dropdown element' },
          value: { type: 'string', description: 'The visible label text of the option to select' },
        },
        required: ['description', 'value'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'select_choice',
      description: 'Select a visible choice in a native select, custom dropdown, radio group, or size selector.',
      parameters: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'Description of the choice group, dropdown, filter, or selector' },
          value: { type: 'string', description: 'Visible choice to select' },
        },
        required: ['description', 'value'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'select_ref',
      description: 'Select a native or custom choice using an element ref from snapshot and a visible option value.',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Snapshot element ref, such as @e5' },
          value: { type: 'string', description: 'Visible choice to select' },
        },
        required: ['ref', 'value'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'take_screenshot',
      description: 'Take a full-page screenshot and save it to disk. Use this to see the current state of the page.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_text',
      description: 'Get the text content of an element described in natural language.',
      parameters: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'Natural language description of the element to read text from' },
        },
        required: ['description'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'wait_for',
      description: 'Wait for a condition: an element to appear, a navigation to complete, or the network to be idle.',
      parameters: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'Element description (required when waitType is "element")' },
          waitType: {
            type: 'string',
            enum: ['element', 'navigation', 'networkidle'],
            description: 'What to wait for. Defaults to "element".',
          },
          timeout: { type: 'number', description: 'Timeout in milliseconds. Defaults to 10000.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scroll',
      description: 'Scroll the page up or down by a specified amount.',
      parameters: {
        type: 'object',
        properties: {
          direction: { type: 'string', enum: ['up', 'down'], description: 'Scroll direction. Defaults to "down".' },
          amount: { type: 'number', description: 'Amount to scroll. Defaults to 500.' },
          unit: { type: 'string', enum: ['pixels', 'percentage'], description: 'Unit for the amount. Defaults to "pixels".' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'dismiss_overlays',
      description: 'Dismiss common popups, modals, cookie banners, or login overlays using Escape and close/dismiss text.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'batch',
      description: 'Execute multiple deterministic browser actions in order. Use for simple flows after refs are known to reduce tool-call loops.',
      parameters: {
        type: 'object',
        properties: {
          actions: {
            type: 'array',
            items: { type: 'object' },
            description: 'Ordered actions such as {action:"navigate",url}, {action:"snapshot"}, {action:"fill_ref",ref,value}, {action:"click_ref",ref}.',
          },
          screenshots: { type: 'boolean', description: 'Whether to include screenshots after each step. Defaults to true.' },
        },
        required: ['actions'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'login',
      description: 'Perform a complete login flow: navigate to a URL, fill username and password fields, and click submit. Use this instead of individual navigate/type/click calls for login tasks.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The login page URL to navigate to' },
          username: { type: 'string', description: 'The username to enter' },
          password: { type: 'string', description: 'The password to enter' },
          usernameDescription: { type: 'string', description: 'Description of the username field (default: "the email or username input")' },
          passwordDescription: { type: 'string', description: 'Description of the password field (default: "the password input")' },
          submitDescription: { type: 'string', description: 'Description of the submit button (default: "the login or submit button")' },
        },
        required: ['url', 'username', 'password'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_site',
      description: 'Navigate to a site if provided, find its search box, search for a query, and wait for results.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Optional site URL to navigate to before searching' },
          query: { type: 'string', description: 'Search query' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'flipkart_search_product',
      description: 'Search Flipkart for a product/category and return product/result evidence. Prefer this for Flipkart product tasks.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Product/category query, e.g. "black jeans" or "poco phone"' },
          filters: { type: 'object', description: 'Optional filters such as color, size, category' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'flipkart_select_size',
      description: 'Select a Flipkart product size and report if it appears unavailable.',
      parameters: {
        type: 'object',
        properties: {
          size: { type: 'string', description: 'Size label to select, e.g. "32"' },
        },
        required: ['size'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'google_flights_search',
      description: 'Search Google Flights using structured flight parameters. Prefer this for flight tasks instead of manually filling Google Flights.',
      parameters: {
        type: 'object',
        properties: {
          origin: { type: 'string', description: 'Origin city or airport, e.g. Bengaluru or BLR' },
          destination: { type: 'string', description: 'Destination city or airport, e.g. Delhi or DEL' },
          departDate: { type: 'string', description: 'Departure date in YYYY-MM-DD' },
          tripType: { type: 'string', enum: ['one-way', 'round-trip'], description: 'Trip type. Defaults to one-way.' },
          returnDate: { type: 'string', description: 'Return date in YYYY-MM-DD for round trips' },
          passengers: { type: 'number', description: 'Passenger count. Defaults to 1.' },
          cabin: { type: 'string', description: 'Cabin class, e.g. economy' },
          preference: { type: 'string', description: 'Preference such as cheapest good deal, nonstop, morning' },
        },
        required: ['origin', 'destination', 'departDate'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'booking_search_hotels',
      description: 'Search Booking.com hotel results for a destination with optional dates/guests/rooms.',
      parameters: {
        type: 'object',
        properties: {
          destination: { type: 'string', description: 'Destination text, e.g. "Wayanad"' },
          dates: { type: 'object', description: 'Optional { checkin, checkout } in YYYY-MM-DD' },
          guests: { type: 'object', description: 'Optional guest counts, e.g. { adults: 2, children: 0 }' },
          rooms: { type: 'number', description: 'Optional room count' },
          budgetMax: { type: 'number', description: 'Optional maximum nightly/booking budget amount, e.g. 5000' },
          currency: { type: 'string', description: 'Optional currency code. Defaults to INR for Indian rupee budgets.' },
        },
        required: ['destination'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fill_form',
      description: 'Fill multiple form fields in a single call. Provide an array of { description, value } pairs.',
      parameters: {
        type: 'object',
        properties: {
          fields: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                description: { type: 'string', description: 'Natural language description of the form field' },
                value: { type: 'string', description: 'Value to fill in' },
              },
              required: ['description', 'value'],
            },
            description: 'Array of field descriptions and their values',
          },
        },
        required: ['fields'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scrape',
      description: 'Extract structured data from the current page. Provide a schema mapping field names to element descriptions. Returns the text content of each described element.',
      parameters: {
        type: 'object',
        properties: {
          schema: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'Object mapping field names to element descriptions. Example: { "title": "the main heading", "price": "the price text" }',
          },
        },
        required: ['schema'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'submit_form',
      description: 'Submit a form by clicking the submit button. Waits for the page to settle after submission.',
      parameters: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'Description of the submit button (default: "the submit button")' },
        },
        required: [],
      },
    },
  },
];

function getEndpointAndBody(
  name: string,
  args: Record<string, unknown>,
  sessionId: string,
): { endpoint: string; body: Record<string, unknown> } {
  const s = sessionId;
  switch (name) {
    case 'human_check_status':
      return { endpoint: `/sessions/${s}/human_check`, body: {} };
    case 'observe_page': {
      const body: Record<string, unknown> = {};
      if (args.limit) body.limit = args.limit;
      return { endpoint: `/sessions/${s}/observe`, body };
    }
    case 'snapshot': {
      const body: Record<string, unknown> = {};
      if (args.limit) body.limit = args.limit;
      return { endpoint: `/sessions/${s}/snapshot`, body };
    }
    case 'find_elements': {
      const body: Record<string, unknown> = { query: args.query };
      if (args.limit) body.limit = args.limit;
      return { endpoint: `/sessions/${s}/find_elements`, body };
    }
    case 'navigate':
      return { endpoint: `/sessions/${s}/navigate`, body: { url: args.url } };
    case 'click':
      return { endpoint: `/sessions/${s}/click`, body: { description: args.description } };
    case 'click_text':
      return { endpoint: `/sessions/${s}/click_text`, body: { text: args.text, exact: args.exact } };
    case 'click_coordinates':
      return { endpoint: `/sessions/${s}/click_coordinates`, body: { x: args.x, y: args.y } };
    case 'click_observed':
      return { endpoint: `/sessions/${s}/click_observed`, body: { id: args.id } };
    case 'click_ref':
      return { endpoint: `/sessions/${s}/click_ref`, body: { ref: args.ref } };
    case 'fill_ref':
      return { endpoint: `/sessions/${s}/fill_ref`, body: { ref: args.ref, value: args.value } };
    case 'type_text':
      return { endpoint: `/sessions/${s}/type`, body: { description: args.description, value: args.value } };
    case 'type_and_press_enter':
      return { endpoint: `/sessions/${s}/type_and_press`, body: { description: args.description, value: args.value, key: args.key ?? 'Enter' } };
    case 'press_key':
      return { endpoint: `/sessions/${s}/press_key`, body: { key: args.key } };
    case 'hover':
      return { endpoint: `/sessions/${s}/hover`, body: { description: args.description } };
    case 'focus':
      return { endpoint: `/sessions/${s}/focus`, body: { description: args.description } };
    case 'clear':
      return { endpoint: `/sessions/${s}/clear`, body: { description: args.description } };
    case 'select_option':
      return { endpoint: `/sessions/${s}/select`, body: { description: args.description, value: args.value } };
    case 'select_choice':
      return { endpoint: `/sessions/${s}/select_choice`, body: { description: args.description, value: args.value } };
    case 'select_ref':
      return { endpoint: `/sessions/${s}/select_ref`, body: { ref: args.ref, value: args.value } };
    case 'take_screenshot':
      return { endpoint: `/sessions/${s}/screenshot/full`, body: {} };
    case 'get_text':
      return { endpoint: `/sessions/${s}/get_text`, body: { description: args.description } };
    case 'wait_for': {
      const body: Record<string, unknown> = {};
      if (args.waitType) body.waitType = args.waitType;
      if (args.description) body.description = args.description;
      if (args.timeout) body.timeout = args.timeout;
      return { endpoint: `/sessions/${s}/wait`, body };
    }
    case 'scroll': {
      const body: Record<string, unknown> = {};
      if (args.direction) body.direction = args.direction;
      if (args.amount) body.amount = args.amount;
      if (args.unit) body.unit = args.unit;
      return { endpoint: `/sessions/${s}/scroll`, body };
    }
    case 'dismiss_overlays':
      return { endpoint: `/sessions/${s}/dismiss_overlays`, body: {} };
    case 'batch':
      return { endpoint: `/sessions/${s}/batch`, body: { actions: args.actions, screenshots: args.screenshots } };
    case 'login': {
      const body: Record<string, unknown> = { url: args.url, username: args.username, password: args.password };
      if (args.usernameDescription) body.usernameDescription = args.usernameDescription;
      if (args.passwordDescription) body.passwordDescription = args.passwordDescription;
      if (args.submitDescription) body.submitDescription = args.submitDescription;
      return { endpoint: `/sessions/${s}/login`, body };
    }
    case 'fill_form':
      return { endpoint: `/sessions/${s}/fill_form`, body: { fields: args.fields } };
    case 'search_site': {
      const body: Record<string, unknown> = { query: args.query };
      if (args.url) body.url = args.url;
      return { endpoint: `/sessions/${s}/search_site`, body };
    }
    case 'flipkart_search_product':
      return { endpoint: `/sessions/${s}/flipkart_search_product`, body: { query: args.query, filters: args.filters } };
    case 'flipkart_select_size':
      return { endpoint: `/sessions/${s}/flipkart_select_size`, body: { size: args.size } };
    case 'booking_search_hotels':
      return {
        endpoint: `/sessions/${s}/booking_search_hotels`,
        body: {
          destination: args.destination,
          dates: args.dates,
          guests: args.guests,
          rooms: args.rooms,
          budgetMax: args.budgetMax,
          currency: args.currency,
        },
      };
    case 'google_flights_search':
      return {
        endpoint: `/sessions/${s}/google_flights_search`,
        body: {
          origin: args.origin,
          destination: args.destination,
          departDate: args.departDate,
          tripType: args.tripType,
          returnDate: args.returnDate,
          passengers: args.passengers,
          cabin: args.cabin,
          preference: args.preference,
        },
      };
    case 'scrape':
      return { endpoint: `/sessions/${s}/scrape`, body: { schema: args.schema } };
    case 'submit_form': {
      const body: Record<string, unknown> = {};
      if (args.description) body.description = args.description;
      return { endpoint: `/sessions/${s}/submit_form`, body };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function saveScreenshot(base64: string): Promise<string> {
  screenshotCount++;
  const path = `/tmp/browse-agent-${screenshotCount}.png`;
  await writeFile(path, Buffer.from(base64, 'base64'));
  return path;
}

function summarizeResult(name: string, data: Record<string, unknown>, screenshotPath?: string): string {
  const ss = screenshotPath ? ` Screenshot saved to ${screenshotPath}.` : '';
  switch (name) {
    case 'human_check_status':
      if (data.required) {
        return `HUMAN_CHECK_REQUIRED. Reason: ${data.reason}. Evidence: ${JSON.stringify(data.evidence ?? [])}. URL: ${data.url}. Please ask the user to complete the verification manually in the browser, then type "continue".${ss}`;
      }
      return `No human check detected. URL: ${data.url}. Title: ${data.title}.${ss}`;
    case 'observe_page':
    case 'snapshot': {
      const elements = (data.elements as Array<Record<string, unknown>> | undefined) ?? [];
      const forms = (data.forms as Array<Record<string, unknown>> | undefined) ?? [];
      const elementSummary = elements.slice(0, 12).map((el) => {
        const label = el.label || el.text || el.placeholder || el.href || '';
        return `${el.ref ?? el.id}:${el.role ?? el.tag} "${String(label).slice(0, 80)}"`;
      }).join('; ');
      const mode = data.observationMode ? ` Mode: ${data.observationMode}.` : '';
      const diagnostics = Array.isArray(data.diagnostics) && data.diagnostics.length > 0
        ? ` Diagnostics: ${JSON.stringify(data.diagnostics)}.`
        : '';
      const snapshot = data.snapshotId ? ` Snapshot: ${data.snapshotId}.` : '';
      return `Observed page.${snapshot}${mode}${diagnostics} URL: ${data.url}. Title: ${data.title}. Text: "${String(data.text ?? '').slice(0, 1200)}". Forms: ${forms.length}. Elements: ${elementSummary}.${ss}`;
    }
    case 'find_elements': {
      const elements = (data.elements as Array<Record<string, unknown>> | undefined) ?? [];
      const summary = elements.map((el) => {
        const label = el.label || el.text || el.placeholder || el.href || '';
        return `${el.id} score=${el.score} ${el.role ?? el.tag} "${String(label).slice(0, 100)}"`;
      }).join('\n');
      const mode = data.observationMode ? ` Observation mode: ${data.observationMode}.` : '';
      const diagnostics = Array.isArray(data.diagnostics) && data.diagnostics.length > 0
        ? ` Diagnostics: ${JSON.stringify(data.diagnostics)}.`
        : '';
      return `Found ${elements.length} candidate element(s).${mode}${diagnostics}\n${summary}${ss}`;
    }
    case 'navigate':
      return `Navigated to ${data.url}.${ss}`;
    case 'click':
      return `Clicked element (strategy: ${data.strategy}).${ss}`;
    case 'click_text':
      return `Clicked text "${data.text}".${ss}`;
    case 'click_coordinates':
      return `Clicked coordinates ${JSON.stringify(data.clickedAt)}.${ss}`;
    case 'click_observed':
      return `Clicked observed element ${data.id}.${ss}`;
    case 'click_ref':
      return `Clicked snapshot ref ${data.ref}. Current URL: ${data.url}.${ss}`;
    case 'type_text':
      return `Typed text into element (strategy: ${data.strategy}).${ss}`;
    case 'fill_ref':
      return `Filled snapshot ref ${data.ref}.${ss}`;
    case 'type_and_press_enter':
      return `Typed text and pressed ${data.key} (strategy: ${data.strategy}). Current URL: ${data.url}.${ss}`;
    case 'press_key':
      return `Pressed key ${data.key}.${ss}`;
    case 'hover':
      return `Hovered element (strategy: ${data.strategy}).${ss}`;
    case 'focus':
      return `Focused element (strategy: ${data.strategy}).${ss}`;
    case 'clear':
      return `Cleared element (strategy: ${data.strategy}).${ss}`;
    case 'select_option':
      return `Selected option (strategy: ${data.strategy}).${ss}`;
    case 'select_choice':
      return `Selected choice "${data.value}" (strategy: ${data.strategy}).${ss}`;
    case 'select_ref':
      return `Selected "${data.value}" using snapshot ref ${data.ref}.${ss}`;
    case 'take_screenshot':
      return `Full-page screenshot saved to ${screenshotPath}`;
    case 'get_text':
      return `Text content: "${data.text}" (strategy: ${data.strategy})`;
    case 'wait_for':
      return `Waited for ${data.waited}.${ss}`;
    case 'scroll': {
      const scrolled = data.scrolled as Record<string, unknown>;
      return `Scrolled ${scrolled.direction} by ${scrolled.amount} ${scrolled.unit}.${ss}`;
    }
    case 'dismiss_overlays':
      return `Dismissed overlays: ${JSON.stringify(data.dismissed ?? [])}.${ss}`;
    case 'batch':
      return `Batch finished with status ${data.status}. Stop reason: ${data.stopReason ?? 'none'}. Results:\n${JSON.stringify(data.results, null, 2)}`;
    case 'login': {
      const steps = data.steps as Array<Record<string, string>>;
      return `Login completed. Current URL: ${data.url}. Steps: ${steps.map((s) => s.step).join(', ')}.${ss}`;
    }
    case 'fill_form': {
      const fields = data.fields as Array<Record<string, string>>;
      return `Filled ${fields.length} field(s).${ss}`;
    }
    case 'scrape':
      return `Scraped data:\n${JSON.stringify(data.data, null, 2)}`;
    case 'search_site':
    case 'flipkart_search_product':
    case 'flipkart_select_size':
    case 'booking_search_hotels':
    case 'google_flights_search':
      return `${String(data.status)}. URL: ${data.url}. Title: ${data.title}. Details:\n${JSON.stringify(data.details, null, 2)}${ss}`;
    case 'submit_form':
      return `Form submitted (strategy: ${data.strategy}). Current URL: ${data.url}.${ss}`;
    default:
      return `Tool ${name} completed.${ss}`;
  }
}

async function checkHumanGate(sessionId: string): Promise<ToolResult | null> {
  try {
    const endpoint = `/sessions/${sessionId}/human_check`;
    if (env.NODE_ENV !== 'test') {
      console.log(`  [api] POST ${endpoint}`);
    }
    const res = await fetch(`${BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (env.NODE_ENV !== 'test') {
      console.log(`  [api] ${res.status} POST ${endpoint}`);
    }
    const json = (await res.json()) as {
      success: boolean;
      data?: Record<string, unknown>;
    };
    if (!json.success || !json.data?.required) return null;

    let screenshotPath: string | undefined;
    if (json.data.screenshot) {
      screenshotPath = await saveScreenshot(json.data.screenshot as string);
    }

    return {
      text: summarizeResult('human_check_status', json.data, screenshotPath),
      screenshotPath,
      humanCheckRequired: true,
    };
  } catch {
    return null;
  }
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  sessionId: string,
): Promise<ToolResult> {
  if (name === 'scrape' && (!args.schema || typeof args.schema !== 'object' || Array.isArray(args.schema) || Object.keys(args.schema).length === 0)) {
    return {
      text: 'Validation error: scrape requires a non-empty schema object. Call observe_page first, then call scrape with field names mapped to element descriptions.',
    };
  }
  if (name === 'login') {
    const missing = ['url', 'username', 'password'].filter((key) => typeof args[key] !== 'string' || args[key] === '');
    if (missing.length > 0) {
      return {
        text: `Validation error: login is missing ${missing.join(', ')}. Re-read the user message and conversation history before asking the user for values.`,
      };
    }
  }

  const { endpoint, body } = getEndpointAndBody(name, args, sessionId);
  try {
    if (env.NODE_ENV !== 'test') {
      console.log(`  [api] POST ${endpoint}`);
    }

    const res = await fetch(`${BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (env.NODE_ENV !== 'test') {
      console.log(`  [api] ${res.status} POST ${endpoint}`);
    }

    const json = (await res.json()) as {
      success: boolean;
      error?: string;
      data?: Record<string, unknown>;
    };

    if (!json.success) {
      return { text: `Error: ${json.error}` };
    }

    const data = json.data!;
    let screenshotPath: string | undefined;

    if (data.screenshot) {
      screenshotPath = await saveScreenshot(data.screenshot as string);
    }

    const result = {
      text: summarizeResult(name, data, screenshotPath),
      screenshotPath,
    };

    if (!['human_check_status', 'dismiss_overlays'].includes(name)) {
      const humanGate = await checkHumanGate(sessionId);
      if (humanGate) return humanGate;
    }

    return result;
  } catch (err) {
    return { text: `Error: ${(err as Error).message}` };
  }
}
