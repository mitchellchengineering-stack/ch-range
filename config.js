// ─────────────────────────────────────────────────────────────
//  CH Engineering Range — configuration
//  Fill these in once, commit, and every worker uses the same setup.
// ─────────────────────────────────────────────────────────────
export default {
  // Google Cloud → APIs & Services → Credentials → OAuth 2.0 Client ID (Web application)
  // Looks like: 1234567890-abc123def456.apps.googleusercontent.com
  GOOGLE_CLIENT_ID: '502936977952-cfbut0t744bshd3k7b3s4dc5denqqdth.apps.googleusercontent.com',

  // The "Catalog App" folder in your Google Drive.
  // Open the folder in Drive and copy the last part of the URL:
  // https://drive.google.com/drive/folders/THIS_PART_HERE
  // Leave blank the first time and the app will offer to create the folder for you.
  CATALOG_FOLDER_ID: '',

  // Shown in the browser tab
  APP_TITLE: 'CH Engineering Range',
};
