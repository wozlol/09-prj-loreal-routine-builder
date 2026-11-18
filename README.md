# Project 9: L'Oréal Routine Builder

Live site: https://wozlol.github.io/09-prj-loreal-routine-builder/

Browse L'Oréal products, select the ones you like, and generate a personalized routine with AI. Then ask follow-up questions about it.

## How it works

- `products.json` holds the product data. `script.js` loads it, filters it by category and search, and shows the cards.
- Selected products are saved in the browser with localStorage, so they stay after a reload.
- Generate Routine sends only the selected products (name, brand, category, description) and the conversation so far to a Cloudflare Worker, which adds the OpenAI API key and forwards the request. No key is in this repo.
- Extras: product search, a right-to-left (RTL) layout switch, and an installable app (PWA) with an Install App button at the bottom of the page.

## Worker

The Worker is the same one used for Project 8 (`RESOURCE_cloudflare-worker.js` in that repo). The OpenAI key is stored there as the secret `OPENAI_API_KEY`.
