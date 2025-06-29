# BooruScripts
Tampermonkey scripts for boorus (Danbooru, Aibooru, etc.)

# Danbooru - Look Into The Deep AI (LITD)

An AI-powered auto-tagging userscript for Danbooru and related booru sites that automatically suggests tags for images.

## 🚀 Features

- **AI-Powered Tag Suggestions**: Automatically analyzes images and videos to suggest relevant tags
- **Multi-Site Support**: Works on Danbooru and AIBooru
- **Smart Caching**: Caches results for 7 days to reduce API calls and improve performance  
- **Video Support**: Extracts frames from videos for tag analysis
- **Real-time Integration**: Seamlessly integrates with the existing tag input system
- **Confidence Scores**: Shows confidence levels for each suggested tag
- **Duplicate Prevention**: Highlights already-selected tags to avoid duplicates

## 🎯 Supported Sites

- [Danbooru](https://danbooru.donmai.us/) - `danbooru.donmai.us`
- [AIBooru](https://aibooru.online/) - `aibooru.online`

## 📋 Prerequisites

You'll need a userscript manager extension installed in your browser:

- **Chrome/Edge**: [Tampermonkey](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
- **Firefox**: [Tampermonkey](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/) or [Greasemonkey](https://addons.mozilla.org/en-US/firefox/addon/greasemonkey/)
- **Safari**: [Tampermonkey](https://apps.apple.com/us/app/tampermonkey/id1482490089)

## 🔧 Installation

1. **Install a userscript manager** (see prerequisites above)
2. **Click the install link**: [Install LITD Script](https://github.com/Dramorian/BooruScripts/raw/refs/heads/main/LITD.user.js)
3. **Confirm installation** in your userscript manager
4. **Navigate to a supported site** and start using!

### Manual Installation

1. Copy the script code from [`LITD.user.js`](LITD.user.js)
2. Open your userscript manager dashboard
3. Click "Create new script" or "+" button
4. Paste the code and save
5. Ensure the script is enabled

## 📖 How to Use

### On Upload Pages

1. **Navigate to an upload page** on any supported site and upload the picture
2. **Wait for analysis**: The script automatically detects images/videos and starts analysis
3. **View suggestions**: A "Suggested Tags" section appears in the sidebar with AI-generated tags
4. **Select tags**: Click checkboxes next to suggested tags to add them to your post

### On Post Pages

1. **Go to any post page**
2. **Click "Edit"** to enter edit mode
3. **Wait for analysis**: The script automatically analyzes the media
4. **Review suggestions**: Suggested tags appear in the sidebar
5. **Add desired tags**: Select relevant tags and save your changes

## ⚙️ Configuration

The script includes several configurable options at the top of the file:

```javascript
const CONFIG = {
  AUTO_TAGGER_URL: 'https://autotagger.aibooru.online/evaluate',
  TAG_THRESHOLD: 0.01,    // Minimum confidence threshold
  TAG_LIMIT: 100,         // Maximum number of suggested tags
  CACHE_EXPIRY_MS: 7 * 24 * 60 * 60 * 1000  // 7 days cache
};
```

### Customization Options

- **TAG_THRESHOLD**: Adjust to show only high-confidence tags (0.01 = 1%, 0.5 = 50%)
- **TAG_LIMIT**: Change maximum number of suggestions (default: 100)
- **CACHE_EXPIRY_MS**: Modify cache duration in milliseconds
