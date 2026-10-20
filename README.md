# CH Engineering Range

A catalogue app for the Garden Sheds, Sheds, Granny Flats and Homes range. It runs on GitHub Pages, and everything it saves lives in a **Catalog App** folder in Google Drive.

**Try it first:** open the app with `?demo` on the end of the address (for example `https://yourname.github.io/ch-range/?demo`). Demo mode works without any Google setup and keeps everything in that browser tab only.

---

## Setup (about 30–45 minutes, once)

### 1. Put the app on GitHub Pages
1. Create a new repository, e.g. `ch-range`.
2. Upload everything in this folder (keep the folder structure, including the hidden `.nojekyll` file).
3. **Settings → Pages →** Source: *Deploy from a branch*, Branch: `main`, folder `/ (root)`. Save.
4. Note the address it gives you, e.g. `https://yourname.github.io/ch-range/`.

A free GitHub account means the app’s **code** is public. Your **data** isn’t: nothing loads without signing in with a Google account that has access to the Catalog App folder. There are no secrets in the code (a Google client ID is designed to be public).

### 2. Google Cloud (lets the app talk to Drive)
1. Go to <https://console.cloud.google.com>, create a project (e.g. “CH Range”).
2. **APIs & Services → Library →** enable **Google Drive API**.
3. **APIs & Services → OAuth consent screen** (Google Auth Platform):
   - User type **External**, app name “CH Engineering Range”, your email as support and developer contact.
   - **Data access / Scopes:** add `https://www.googleapis.com/auth/drive`.
   - **Audience / Test users:** add every worker’s Gmail address (up to 100).
   - Leave the app in **Testing**. You don’t need Google verification for internal use.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type **Web application**
   - **Authorised JavaScript origins:** `https://yourname.github.io` (just the origin, no path). Add `http://localhost:8000` too if you want to test on your own computer.
   - No redirect URIs needed.
5. Copy the **Client ID**.

### 3. Fill in `config.js`
```js
GOOGLE_CLIENT_ID: '1234-abc.apps.googleusercontent.com',
CATALOG_FOLDER_ID: '',   // leave blank for now
```
Commit and push. Open the app, sign in, and choose **Create the folder**. The app makes the Catalog App folder in your Drive and shows its ID. Paste that ID into `CATALOG_FOLDER_ID`, commit again, and every worker will use the same folder automatically.

(Already have a folder? Paste its ID instead. It’s the last part of the folder’s Drive address.)

### 4. Share the folder with the team
In Google Drive, share **Catalog App** with each worker’s Gmail:
- **Editor:** can add designs, change pricing, upload files and change settings.
- **Viewer:** can browse and present the range (including client mode) but can’t change anything.

Each person also needs to be on the **test users** list from step 2.

### 5. First things to do in the app
- **Settings:** change the client mode PIN (it starts as `1234`), add your phone, email and website for spec sheets, and choose price rounding if you want it.
- **Price list:** add your common materials, doors, windows, labour and delivery rates.
- **Range:** add your first design.

---

## How it’s organised in Drive

```
Catalog App/
├── _App Data/
│   ├── settings.json          categories, default markup, rounding, PIN, business details
│   ├── price-list.json        the central price list
│   └── price-history.json     every price change: who, when, old → new, reason
├── Garden Sheds/
│   └── GS-001 Potting Shed 2.4 × 1.8/
│       ├── details.json       specs, what’s included, costing lines, status
│       ├── _thumbnail.jpg     card image, made automatically from the cover render
│       ├── Plans/             PDFs or images
│       ├── Framing Detailing/ any file type, staff only
│       ├── 3D Model/          .ifc
│       └── Renders/           JPG / PNG
├── Sheds/
├── Granny Flats/
├── Homes/
└── _Archive/                  archived designs, restorable from the app
```

Everything is normal Drive files, so Drive’s **version history** is your backup. Right-click any `details.json` or `price-list.json → Manage versions` to roll back. Deleted files go to Drive’s trash for 30 days.

Avoid renaming or moving files inside these folders by hand. Use the app so it keeps track. Adding extra files to a design’s sub-folders directly in Drive is fine; they’ll show up in the app.

---

## Pricing rules
- All prices are **excluding GST** and shown as “+ GST”.
- Markup is **on cost**: $1,000 at 20% = $1,200. Each line starts at the default (20%) and can be changed per line.
- **Price list lines** (marked “Price list”) follow the central price list. Change the price once and every design updates.
- **Custom lines** are for one-offs or special deals. Any price list line can be switched to a custom price for one design with the unlink button, and linked back later.
- If a price list item is removed, designs keep its last price.
- Designs get a **Check prices** flag when a linked price changes after their last check, or after the review period in Settings (default 6 months). Use **Mark prices checked** on the Costing tab to clear it.

## Client mode
Hides all costs, markups, drafts, framing files, internal notes and editing. Leaving it needs the PIN. Use **Previous / Next** on a design page to walk a client through the range, and **Spec sheet** to print or save a branded PDF.

## Good to know
- **Sign-in:** the first sign-in shows a “Google hasn’t verified this app” screen. Click *Continue*. That’s normal for an app in Testing. Google sessions last about an hour, after which the app asks you to sign in again and carries on.
- **File ownership:** on personal Gmail, a file someone uploads is owned by them and uses their Drive storage. If someone leaves, transfer ownership of their files before they delete their account. A dedicated business Gmail that owns the folder makes this simpler.
- **Big IFC files** upload fine (no app limit), but very large models take longer to open on tablets.
- **Two people editing the same design:** the second person to save gets a warning and can choose to keep editing or overwrite.
- **Add to home screen** on an iPad or phone for a full-screen app feel.
- **Logo:** lives in `assets/`. Replace `logo.png` (full logo) and `logo-mark.png` (roof only, used as the faint background watermark) with the same file names to update it.

## Files in this repo
| File | What it is |
|---|---|
| `index.html` | The page |
| `config.js` | Your Google client ID and folder ID |
| `css/app.css` | Look and feel |
| `js/app.js` | Sign-in, setup, navigation, client mode |
| `js/store.js` | Reads and writes the Drive folder structure |
| `js/drive.js` | Google Drive connection |
| `js/pricing.js` | Markup, totals, rounding |
| `js/ifc-viewer.js` | 3D model viewer |
| `js/pdf.js` | Plan viewer |
| `js/views/*` | The pages: range, design, editor, price list, settings, spec sheet |
| `js/mockdrive.js` | Demo mode |

Libraries load from public CDNs at pinned versions: Preact + htm (UI), three.js 0.170 and web-ifc 0.0.77 (3D), pdf.js 3.11 (plans).
