// ==UserScript==
// @name         Danbooru - Look Into The Deep AI (LITD)
// @namespace    LITD
// @version      1.3.1
// @description  Sends image to autotagger.aibooru and returns the list of suggested tags
// @author       Dramorian
// @match        https://danbooru.donmai.us/uploads/*
// @match        https://danbooru.donmai.us/posts/*
// @match        https://aibooru.online/uploads/*
// @match        https://aibooru.online/posts/*
// @connect      autotagger.aibooru.online
// @connect      autotagger.donmai.us
// @connect      cdn.aibooru.download
// @connect      cdn.donmai.us
// @grant        GM.xmlHttpRequest
// @run-at       document-end
// ==/UserScript==

/* global Danbooru $ */

(() => {
  'use strict';

  // Configuration constants
  const CONFIG = {
    AUTO_TAGGER_URL: 'https://autotagger.aibooru.online/evaluate',
    TAG_THRESHOLD: 0.01,
    TAG_LIMIT: 100,
    CACHE_EXPIRY_MS: 7 * 24 * 60 * 60 * 1000, // 7 days
    INIT_DELAY: 500,
    DB_NAME: 'LITD_Cache',
    DB_VERSION: 2,
    STORE_NAME: 'tagCache',
    MAX_CACHE_SIZE: 5000,
    SELECTORS: {
      MEDIA: "#image, .media-asset-image, video.media-asset-image",
      TAG_INPUT: "#post_tag_string",
      EDIT_LINK: "#post-edit-link",
      RELATED_TAGS: ".related-tags",
      OG_IMAGE: 'meta[property="og:image"]'
    }
  };

  // Error types for better error handling
  const ErrorTypes = {
    MEDIA_NOT_FOUND: 'Media element not found',
    CACHE_ERROR: 'Cache operation failed',
    NETWORK_ERROR: 'Network request failed',
    PARSING_ERROR: 'Response parsing failed',
    VIDEO_FRAME_ERROR: 'Video frame extraction failed',
    DB_ERROR: 'Database operation failed'
  };

  // IndexedDB Cache Manager with compressed data storage
  class IndexedDBCache {
    constructor() {
      this.db = null;
      this.initPromise = this.initialize();
    }

    async initialize() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(CONFIG.DB_NAME, CONFIG.DB_VERSION);

        request.onerror = () => {
          console.error('LITD: Failed to open IndexedDB:', request.error);
          reject(request.error);
        };

        request.onsuccess = () => {
          this.db = request.result;
          console.log('LITD: IndexedDB initialized successfully');
          resolve(this.db);
        };

        request.onupgradeneeded = (event) => {
          const db = event.target.result;

          // Delete old store if it exists (migration)
          if (db.objectStoreNames.contains(CONFIG.STORE_NAME)) {
            db.deleteObjectStore(CONFIG.STORE_NAME);
            console.log('LITD: Migrating to new cache structure');
          }

          // Create new object store with optimized structure
          const store = db.createObjectStore(CONFIG.STORE_NAME, { keyPath: 'key' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('size', 'size', { unique: false });
          console.log('LITD: Created optimized object store');
        };
      });
    }

    generateKey(url) {
      // Use a hash for shorter keys
      let hash = 0;
      for (let i = 0; i < url.length; i++) {
        const char = url.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
      }
      return `litd_${Math.abs(hash)}`;
    }

    // Extract only essential tag data from HTML response
    parseTagData(htmlString) {
      try {
        const doc = new DOMParser().parseFromString(htmlString, "text/html");
        const rows = Array.from(doc.querySelectorAll("tbody tr"));

        const tags = rows
          .map(row => {
            const link = row.querySelector("a.text-sky-600.hover\\:text-sky-500.mr-4");
            const confidence = row.querySelector("td.text-gray-400.text-right");

            if (!link || !confidence) return null;

            return {
              name: link.textContent.replace(/\s+/g, '_').trim(),
              confidence: confidence.textContent.trim()
            };
          })
          .filter(Boolean);

        return tags;
      } catch (error) {
        console.error('LITD: Failed to parse tag data:', error);
        return [];
      }
    }

    // Calculate approximate size of stored data
    calculateSize(data) {
      return new Blob([JSON.stringify(data)]).size;
    }

    async get(key) {
      try {
        await this.initPromise;

        return new Promise((resolve, reject) => {
          const transaction = this.db.transaction([CONFIG.STORE_NAME], 'readonly');
          const store = transaction.objectStore(CONFIG.STORE_NAME);
          const request = store.get(key);

          request.onsuccess = () => {
            const result = request.result;

            if (!result) {
              resolve(null);
              return;
            }

            // Check if cache is expired
            if (Date.now() - result.timestamp > CONFIG.CACHE_EXPIRY_MS) {
              console.log('LITD: Cache expired, cleaning up');
              this.delete(key); // Clean up expired entry
              resolve(null);
              return;
            }

            // Return the compressed tag data
            resolve(result.tags);
          };

          request.onerror = () => {
            console.warn('LITD: Cache retrieval error:', request.error);
            resolve(null);
          };
        });
      } catch (error) {
        console.warn('LITD: Cache get failed:', error);
        return null;
      }
    }

    formatTimestamp(timestamp) {
      const date = new Date(timestamp);
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      return `${day}.${month}.${year} ${hours}:${minutes}`;
    }

    async set(key, htmlResponse) {
      try {
        await this.initPromise;

        // Parse HTML and extract only tag data
        const tags = this.parseTagData(htmlResponse);

        if (tags.length === 0) {
          console.warn('LITD: No tags found in response, skipping cache');
          return;
        }

        return new Promise((resolve, reject) => {
          const transaction = this.db.transaction([CONFIG.STORE_NAME], 'readwrite');
          const store = transaction.objectStore(CONFIG.STORE_NAME);

          const now = Date.now();
          const record = {
            key: key,
            tags: tags,
            timestamp: now,
            timestampFormatted: this.formatTimestamp(now),
            size: this.calculateSize(tags)
          };

          console.log(`LITD: Caching ${tags.length} tags (${record.size} bytes vs ~${new Blob([htmlResponse]).size} bytes raw) at ${record.timestampFormatted}`);

          const request = store.put(record);

          request.onsuccess = () => {
            resolve();
          };

          request.onerror = () => {
            console.warn('LITD: Cache storage error:', request.error);
            reject(request.error);
          };

          transaction.oncomplete = () => {
            // Cleanup old entries if cache is too large
            this.cleanupOldEntries();
          };
        });
      } catch (error) {
        console.warn('LITD: Cache set failed:', error);
      }
    }

    async delete(key) {
      try {
        await this.initPromise;

        return new Promise((resolve) => {
          const transaction = this.db.transaction([CONFIG.STORE_NAME], 'readwrite');
          const store = transaction.objectStore(CONFIG.STORE_NAME);
          const request = store.delete(key);

          request.onsuccess = () => resolve();
          request.onerror = () => {
            console.warn('LITD: Cache deletion error:', request.error);
            resolve();
          };
        });
      } catch (error) {
        console.warn('LITD: Cache delete failed:', error);
      }
    }

    async cleanupOldEntries() {
      try {
        await this.initPromise;

        return new Promise((resolve) => {
          const transaction = this.db.transaction([CONFIG.STORE_NAME], 'readwrite');
          const store = transaction.objectStore(CONFIG.STORE_NAME);
          const index = store.index('timestamp');

          // Open cursor in ascending order (oldest first)
          const request = index.openCursor(null, 'next');

          let count = 0;
          const toDelete = [];
          const allEntries = [];

          request.onsuccess = (event) => {
            const cursor = event.target.result;

            if (cursor) {
              const record = cursor.value;
              allEntries.push(record);
              cursor.continue();
            } else {
              // Now we have all entries, process them
              const totalCount = allEntries.length;

              allEntries.forEach((record, index) => {
                // Delete expired entries
                if (Date.now() - record.timestamp > CONFIG.CACHE_EXPIRY_MS) {
                  toDelete.push(record.key);
                }
                // Delete oldest entries if over MAX_CACHE_SIZE
                // Since entries are sorted oldest first, delete from beginning
                else if (totalCount > CONFIG.MAX_CACHE_SIZE && index < (totalCount - CONFIG.MAX_CACHE_SIZE)) {
                  toDelete.push(record.key);
                }
              });

              // Delete marked entries
              if (toDelete.length > 0) {
                console.log(`LITD: Cleaning up ${toDelete.length} cache entries`);
                toDelete.forEach(key => {
                  store.delete(key);
                });
              }
              resolve();
            }
          };

          request.onerror = () => {
            console.warn('LITD: Cleanup error:', request.error);
            resolve();
          };
        });
      } catch (error) {
        console.warn('LITD: Cleanup failed:', error);
      }
    }

    async getStats() {
      try {
        await this.initPromise;

        return new Promise((resolve) => {
          const transaction = this.db.transaction([CONFIG.STORE_NAME], 'readonly');
          const store = transaction.objectStore(CONFIG.STORE_NAME);
          const request = store.openCursor();

          let totalEntries = 0;
          let totalSize = 0;
          let oldestEntry = Date.now();

          request.onsuccess = (event) => {
            const cursor = event.target.result;

            if (cursor) {
              const record = cursor.value;
              totalEntries++;
              totalSize += record.size || 0;
              oldestEntry = Math.min(oldestEntry, record.timestamp);
              cursor.continue();
            } else {
              resolve({
                entries: totalEntries,
                totalSizeKB: (totalSize / 1024).toFixed(2),
                oldestEntryAge: Math.floor((Date.now() - oldestEntry) / (1000 * 60 * 60 * 24))
              });
            }
          };

          request.onerror = () => {
            resolve({ entries: 0, totalSizeKB: 0, oldestEntryAge: 0 });
          };
        });
      } catch (error) {
        return { entries: 0, totalSizeKB: 0, oldestEntryAge: 0 };
      }
    }

    async clearAll() {
      try {
        await this.initPromise;

        return new Promise((resolve) => {
          const transaction = this.db.transaction([CONFIG.STORE_NAME], 'readwrite');
          const store = transaction.objectStore(CONFIG.STORE_NAME);
          const request = store.clear();

          request.onsuccess = () => {
            console.log('LITD: Cache cleared successfully');
            resolve();
          };

          request.onerror = () => {
            console.warn('LITD: Cache clear error:', request.error);
            resolve();
          };
        });
      } catch (error) {
        console.warn('LITD: Clear all failed:', error);
      }
    }
  }

  // Initialize cache manager
  const cacheManager = new IndexedDBCache();

  // Media processing utilities
  class MediaProcessor {
    static extractImageUrl(img) {
      if (!img?.src) return null;

      const url = new URL(img.src);
      return url.pathname === "/uploads/image_proxy" ?
        url.searchParams.get("url") :
        img.src;
    }

    static isVideo(element) {
      return element?.tagName === 'VIDEO';
    }

    static async fetchBlob(url) {
      return new Promise((resolve, reject) => {
        GM.xmlHttpRequest({
          method: "GET",
          url,
          responseType: "blob",
          onload: response => {
            if (response.status >= 200 && response.status < 300) {
              resolve(new Blob([response.response], {
                type: response.response.type || "image/jpeg"
              }));
            } else {
              reject(new Error(`HTTP ${response.status}: ${response.statusText}`));
            }
          },
          onerror: () => reject(new Error(ErrorTypes.NETWORK_ERROR))
        });
      });
    }

    static async extractVideoFrame() {
      const ogImg = document.querySelector(CONFIG.SELECTORS.OG_IMAGE);
      if (!ogImg?.content) {
        throw new Error(ErrorTypes.VIDEO_FRAME_ERROR);
      }

      try {
        const response = await fetch(ogImg.content);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return await response.blob();
      } catch (error) {
        throw new Error(`${ErrorTypes.VIDEO_FRAME_ERROR}: ${error.message}`);
      }
    }

    static createFormData(blob, fileName) {
      const formData = new FormData();
      formData.append("file", blob, fileName);
      formData.append("format", "html");
      formData.append("threshold", CONFIG.TAG_THRESHOLD);
      formData.append("limit", CONFIG.TAG_LIMIT);
      return formData;
    }
  }

  // Tag management
  class TagManager {
    static getCurrentTags() {
      const textarea = document.querySelector(CONFIG.SELECTORS.TAG_INPUT);
      if (!textarea?.value) return [];

      return textarea.value.trim()
        .split(/\s+/)
        .filter(Boolean);
    }

    // Process from cached tag data array
    static processCachedTags(tagDataArray, currentTags) {
      const tagItems = tagDataArray
        .map(tag => this.createTagItemFromData(tag, currentTags))
        .join("");

      return this.createTagColumn(tagItems);
    }

    // Process from HTML response (for non-cached responses)
    static processSuggestedTags(responseDoc, currentTags) {
      const rows = Array.from(responseDoc.querySelectorAll("tbody tr"));

      const tagItems = rows
        .map(row => this.createTagItem(row, currentTags))
        .filter(Boolean)
        .join("");

      return this.createTagColumn(tagItems);
    }

    static createTagItemFromData(tagData, currentTags) {
      const isChecked = currentTags.includes(tagData.name);

      return `
        <li class="flex items-center gap-1 w-fit leading-none">
          <input type="checkbox" tabindex="-1" ${isChecked ? 'checked' : ''}>
          <span class="related-tag">
            <a class="tag-type-0"
               data-tag-name="${tagData.name}"
               href="/posts?tags=${encodeURIComponent(tagData.name)}">
              ${tagData.name}
              <span class="text-muted text-xs">${tagData.confidence}</span>
            </a>
          </span>
        </li>`;
    }

    static createTagItem(row, currentTags) {
      const link = row.querySelector("a.text-sky-600.hover\\:text-sky-500.mr-4");
      const confidence = row.querySelector("td.text-gray-400.text-right");

      if (!link || !confidence) return null;

      const tagName = link.textContent.replace(/\s+/g, '_').trim();
      const confidenceText = confidence.textContent.trim();
      const isChecked = currentTags.includes(tagName);

      return `
        <li class="flex items-center gap-1 w-fit leading-none">
          <input type="checkbox" tabindex="-1" ${isChecked ? 'checked' : ''}>
          <span class="related-tag">
            <a class="tag-type-0"
               data-tag-name="${tagName}"
               href="/posts?tags=${encodeURIComponent(tagName)}">
              ${tagName}
              <span class="text-muted text-xs">${confidenceText}</span>
            </a>
          </span>
        </li>`;
    }

    static createTagColumn(tagItems) {
      return `
        <div class="tag-column card p-2 h-fit space-y-1">
          <h3>Suggested Tags</h3>
          <ul class="tag-list">${tagItems}</ul>
        </div>`;
    }
  }

  // UI management
  class UIManager {
    static showProgress() {
      this.hideProgress();

      const progressDiv = document.createElement('div');
      progressDiv.id = 'litd-progress';
      progressDiv.className = 'tag-column card p-2 h-fit';
      progressDiv.innerHTML = `
        <h3>Tag Processing</h3>
        <div>Analyzing media...</div>
      `;

      const container = document.querySelector(CONFIG.SELECTORS.RELATED_TAGS);
      if (container) {
        container.appendChild(progressDiv);
      }
    }

    static hideProgress() {
      const progress = document.getElementById('litd-progress');
      if (progress) {
        progress.remove();
      }
    }

    static showError(message) {
      this.hideProgress();

      const errorDiv = document.createElement('div');
      errorDiv.id = 'litd-error';
      errorDiv.className = 'tag-column card p-2 h-fit';
      errorDiv.innerHTML = `
        <h3 style="color: #dc2626;">Tagging Error</h3>
        <div class="text-sm">${message}</div>
      `;

      const container = document.querySelector(CONFIG.SELECTORS.RELATED_TAGS);
      if (container) {
        container.appendChild(errorDiv);
        setTimeout(() => errorDiv.remove(), 5000);
      }
    }

    static tagColumnExists() {
      return Array.from(document.querySelectorAll('.tag-column.card h3'))
        .some(h => h.textContent === "Suggested Tags");
    }
  }

  // Main application class
  class LITDApp {
    static async initialize() {
      try {
        // Ensure cache is initialized
        await cacheManager.initPromise;

        // Log cache stats
        const stats = await cacheManager.getStats();
        console.log(`LITD: Cache stats - ${stats.entries} entries, ${stats.totalSizeKB}KB, oldest: ${stats.oldestEntryAge} days`);

        if (this.isUploadsPage()) {
          setTimeout(() => this.processMedia(), CONFIG.INIT_DELAY);
        } else {
          this.setupEditListener();
        }
      } catch (error) {
        console.error('LITD: Initialization failed:', error);
      }
    }

    static isUploadsPage() {
      const isUploadUrl = /uploads\/\d+/.test(location.href);
      const hasMedia = document.querySelector(CONFIG.SELECTORS.MEDIA);
      return isUploadUrl && hasMedia;
    }

    static setupEditListener() {
      const editLink = document.getElementById("post-edit-link");
      if (!editLink) return;

      editLink.onclick = () => {
        if (!UIManager.tagColumnExists()) {
          this.processMedia();
        }
      };
    }

    static async processMedia() {
      const media = document.querySelector(CONFIG.SELECTORS.MEDIA);
      if (!media) {
        console.warn('LITD: No media element found');
        return;
      }

      UIManager.showProgress();

      try {
        const { blob, fileName, cacheKey } = await this.prepareMediaData(media);

        // Try cache first
        const cachedTags = await cacheManager.get(cacheKey);
        if (cachedTags && cachedTags.length > 0) {
          console.log(`LITD: Using cached response (${cachedTags.length} tags)`);
          this.handleCachedTags(cachedTags);
          return;
        }

        // Send for tagging
        await this.sendForTagging(blob, fileName, cacheKey);

      } catch (error) {
        console.error('LITD: Media processing failed:', error);
        UIManager.showError(error.message || 'Failed to process media');
      }
    }

    static async prepareMediaData(media) {
      if (MediaProcessor.isVideo(media)) {
        const blob = await MediaProcessor.extractVideoFrame();
        const ogImg = document.querySelector(CONFIG.SELECTORS.OG_IMAGE);
        return {
          blob,
          fileName: "video_frame.jpg",
          cacheKey: cacheManager.generateKey(ogImg.content)
        };
      } else {
        const url = MediaProcessor.extractImageUrl(media);
        if (!url) {
          throw new Error(ErrorTypes.MEDIA_NOT_FOUND);
        }

        const blob = await MediaProcessor.fetchBlob(url);
        const fileName = url.split("/").pop()?.split("?")[0] || "image.jpg";

        return {
          blob,
          fileName,
          cacheKey: cacheManager.generateKey(url)
        };
      }
    }

    static async sendForTagging(blob, fileName, cacheKey) {
      return new Promise((resolve, reject) => {
        GM.xmlHttpRequest({
          method: "POST",
          url: CONFIG.AUTO_TAGGER_URL,
          data: MediaProcessor.createFormData(blob, fileName),
          onload: async (response) => {
            try {
              if (response.status >= 200 && response.status < 300) {
                // Cache the response (it will parse and compress automatically)
                await cacheManager.set(cacheKey, response.responseText);
                this.handleTaggingResponse(response.responseText);
                resolve(response);
              } else {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
              }
            } catch (error) {
              reject(error);
            }
          },
          onerror: () => reject(new Error(ErrorTypes.NETWORK_ERROR))
        });
      });
    }

    static handleCachedTags(tagDataArray) {
      try {
        UIManager.hideProgress();

        const currentTags = TagManager.getCurrentTags();
        const tagColumnHtml = TagManager.processCachedTags(tagDataArray, currentTags);

        const container = document.querySelector(CONFIG.SELECTORS.RELATED_TAGS);
        if (container) {
          container.insertAdjacentHTML('beforeend', tagColumnHtml);

          // Update Danbooru's related tag functionality if available
          if (typeof Danbooru !== 'undefined' && Danbooru.RelatedTag) {
            Danbooru.RelatedTag.update_selected();
          }
        }
      } catch (error) {
        console.error('LITD: Cached tag handling failed:', error);
        UIManager.showError(ErrorTypes.PARSING_ERROR);
      }
    }

    static handleTaggingResponse(responseText) {
      try {
        UIManager.hideProgress();

        const doc = new DOMParser().parseFromString(responseText, "text/html");
        const currentTags = TagManager.getCurrentTags();
        const tagColumnHtml = TagManager.processSuggestedTags(doc, currentTags);

        const container = document.querySelector(CONFIG.SELECTORS.RELATED_TAGS);
        if (container) {
          container.insertAdjacentHTML('beforeend', tagColumnHtml);

          // Update Danbooru's related tag functionality if available
          if (typeof Danbooru !== 'undefined' && Danbooru.RelatedTag) {
            Danbooru.RelatedTag.update_selected();
          }
        }
      } catch (error) {
        console.error('LITD: Response handling failed:', error);
        UIManager.showError(ErrorTypes.PARSING_ERROR);
      }
    }
  }

  // Initialize the application
  LITDApp.initialize();

  // Expose cache manager for debugging
  window.LITD_CacheManager = cacheManager;
})();
