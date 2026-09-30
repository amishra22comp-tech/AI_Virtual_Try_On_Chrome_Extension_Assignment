# AI Virtual Try-On Chrome Extension

## Setup (VS Code)
1. Install Node 18+. Get a Gemini API key at https://aistudio.google.com/apikey
2. Backend (VS Code terminal):
   ```
   cd backend
   npm install
   cp .env.example .env     # then paste GEMINI_API_KEY into .env
   npm start                # http://localhost:3000
   ```
3. Extension: open `chrome://extensions` -> enable Developer mode -> Load unpacked -> select the `extension/` folder.
4. Open the popup -> **My Profile** -> upload photos (front + upper-body + face covers tops/dresses/jackets; add legs for pants, feet for shoes).
5. Go to any shopping site (product page or listing) -> open the extension -> pick a product -> **Try On**.

## Architecture
- **Extension (MV3)**: popup UI; injects `detect.js` into the active tab only on click (`activeTab` + `scripting`, no broad site permissions). Stores only a random per-install token, never an API key.
- **Product detection** (`detect.js`, site-agnostic): 1) schema.org JSON-LD `Product`; 2) OpenGraph product meta; 3) heuristic card/image scan (size filter, best srcset image, nearest title/price). On a product page, gallery images are added as selectable variants. Category is guessed from title/URL/breadcrumb keywords (keywords come from the backend).
- **Backend** (Express): `/api/config`, `/api/profile*`, `/api/tryon*`, `/api/results*`. Bearer token -> SHA-256 -> user id.
- **Storage**: SQLite (`data/app.db`; tables `photos`, `results`) + private files in `data/profiles`, `data/results`, `data/cache`. Not served statically; only via authenticated endpoints.
- **AI**: Gemini image model (`gemini-2.5-flash-image`) receives the person's reference photos for the category + 1-2 product images + a category-specific prompt (preserve identity, preserve product colours/prints/logos, optional context-aware scene). To change provider (Replicate IDM-VTON, FASHN, ...), replace `generate()` in `server.js`.
- **Image pipeline**: client resizes to 1024px JPEG -> server normalises (EXIF rotate, JPEG) and hash-dedupes -> product image fetched server-side (SSRF guard, redirect re-validation, 8MB cap, cached by URL hash) -> AI -> result saved -> extension polls job status.
- **Error handling**: missing-photo validation, 1 automatic AI retry, friendly error messages, max 2 concurrent jobs per user, stage + progress in the UI.
- **Add a category**: add one object in `backend/categories.js` (id, label, slots, keywords, instruction). The extension reads it from `/api/config`, so no extension rebuild.

## Privacy & security
- API key only in `backend/.env`. Photos are never public and this app never trains on them (check your AI provider's data-use terms).
- Delete buttons call `DELETE /api/profile` and `DELETE /api/results`.
- For production: serve over HTTPS, update `API` in `popup.js` and `host_permissions` in `manifest.json`, add rate limiting and encryption at rest.

## Demo checklist
Create profile -> site A (e.g. t-shirt) try-on -> site B (e.g. shoes) try-on -> show the same profile reused, product colours/logo preserved, Results tab, then delete data. Test on several different sites to show detection is not hard-coded.
